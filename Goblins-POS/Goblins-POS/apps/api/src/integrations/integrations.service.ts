import { BadRequestException, ConflictException, Injectable, UnauthorizedException, UnprocessableEntityException } from '@nestjs/common';
import { OrderChannel, Prisma } from '@prisma/client';
import { lineTotal } from '@goblins/shared';
import { timingSafeEqual } from 'node:crypto';
import { AuditService } from '../audit/audit.service';
import { KdsService } from '../kds/kds.service';
import { OrdersService } from '../orders/orders.service';
import { PrismaService } from '../prisma/prisma.service';
import { SettingsService } from '../settings/settings.service';

export const APP_CHANNELS = ['TALABAT', 'ELMENUS', 'RABBIT'] as const;
export type AppChannel = (typeof APP_CHANNELS)[number];

export interface IncomingOrder {
  externalRef: string;
  customer?: { name?: string; phone?: string; address?: string };
  items: { sku?: string; name?: string; quantity: number; unitPriceCents?: number; notes?: string }[];
  notes?: string;
}

const SYSTEM_USER_NAME = 'Delivery apps (system)';

/**
 * Receives orders pushed by delivery apps (Talabat, Elmenus, Rabbit) once you
 * have API access from them. Each app authenticates with its own key from
 * Settings (integration.<APP>.apiKey); items are matched to the menu by SKU,
 * then by exact name. The order lands on the POS as a DELIVERY order and is
 * sent straight to the kitchen/bar screens.
 */
@Injectable()
export class IntegrationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly orders: OrdersService,
    private readonly kds: KdsService,
    private readonly audit: AuditService,
  ) {}

  async checkKey(channel: AppChannel, key: string | undefined) {
    const expected = String((await this.settings.getAll())[`integration.${channel}.apiKey`] ?? '');
    if (!expected) throw new UnauthorizedException(`${channel} integration is turned off`);
    const a = Buffer.from(key ?? '');
    const b = Buffer.from(expected);
    if (a.length !== b.length || !timingSafeEqual(a, b)) throw new UnauthorizedException('Invalid API key');
  }

  /** An inactive, login-less user that "opens" app orders (orders need an opener). */
  private async systemUser(branchId: string): Promise<string> {
    const existing = await this.prisma.user.findFirst({ where: { name: SYSTEM_USER_NAME, branchId } });
    if (existing) return existing.id;
    const role = await this.prisma.role.findFirst({ where: { name: 'Cashier' } })
      ?? await this.prisma.role.findFirstOrThrow();
    const user = await this.prisma.user.create({
      data: { name: SYSTEM_USER_NAME, branchId, roleId: role.id, isActive: false },
    });
    return user.id;
  }

  async receive(channel: AppChannel, body: IncomingOrder) {
    const externalRef = body.externalRef?.trim();
    if (!externalRef) throw new BadRequestException('externalRef is required');
    if (!Array.isArray(body.items) || body.items.length === 0) throw new BadRequestException('items are required');

    // the same app order delivered twice (retries) returns the first one
    const dup = await this.prisma.order.findFirst({ where: { channel: channel as OrderChannel, externalRef } });
    if (dup) return { orderId: dup.id, number: dup.number, totalCents: dup.totalCents, duplicate: true };

    const menu = await this.prisma.menuItem.findMany({
      where: { isActive: true, category: { isActive: true } },
      include: { taxRate: true },
    });
    const bySku = new Map(menu.filter((m) => m.sku).map((m) => [m.sku!.trim().toLowerCase(), m]));
    const byName = new Map<string, (typeof menu)[number]>();
    for (const m of menu) {
      byName.set(m.name.trim().toLowerCase(), m);
      if (m.nameAr) byName.set(m.nameAr.trim(), m);
    }
    const unmatched: string[] = [];
    const lines = body.items.map((i) => {
      const q = Number(i.quantity);
      if (!Number.isFinite(q) || q <= 0) throw new BadRequestException(`Invalid quantity for ${i.sku ?? i.name}`);
      const sku = i.sku?.trim().toLowerCase();
      const name = i.name?.trim();
      const item =
        (sku ? bySku.get(sku) : undefined) ??
        (name ? byName.get(name.toLowerCase()) ?? byName.get(name) : undefined);
      if (!item) unmatched.push(i.sku ?? i.name ?? '(no name)');
      if (item?.is86ed) throw new UnprocessableEntityException(`${item.name} is unavailable right now`);
      return { input: i, item, quantity: q };
    });
    if (unmatched.length) {
      throw new UnprocessableEntityException(`Not on the menu (set matching SKUs in Back office → Menu): ${unmatched.join(', ')}`);
    }

    const branch = await this.prisma.branch.findFirstOrThrow();
    const userId = await this.systemUser(branch.id);
    const shift = await this.prisma.shift.findFirst({ where: { branchId: branch.id, status: 'OPEN' } });
    if (!shift) throw new ConflictException('The venue has no open shift — order not accepted');

    const order = await this.orders.create({
      userId,
      branchId: branch.id,
      type: 'DELIVERY',
      channel: channel as OrderChannel,
      externalRef,
      deliveryName: body.customer?.name,
      deliveryPhone: body.customer?.phone,
      deliveryAddress: body.customer?.address,
    });

    const final = await this.prisma.$transaction(async (tx) => {
      let sort = 1;
      for (const l of lines) {
        const item = l.item!;
        // the app's price wins when given (apps often price differently from the venue)
        const unitCents = l.input.unitPriceCents != null ? Math.max(0, Math.round(l.input.unitPriceCents)) : item.priceCents;
        await tx.orderItem.create({
          data: {
            orderId: order.id,
            itemId: item.id,
            description: item.name,
            quantity: new Prisma.Decimal(l.quantity),
            unitCents,
            modifiersCents: 0,
            lineCents: lineTotal(unitCents, l.quantity),
            taxBps: item.taxRate?.rateBps ?? 0,
            notes: l.input.notes?.slice(0, 300),
            sortOrder: sort++,
          },
        });
      }
      if (body.notes) await tx.order.update({ where: { id: order.id }, data: { notes: body.notes.slice(0, 500) } });
      return this.orders.recompute(tx, order.id);
    });

    await this.kds.send(order.id, userId).catch(() => undefined); // items without a station simply aren't routed
    await this.audit.log({
      userId, action: 'integration.order_received', entity: 'Order', entityId: order.id,
      detail: { channel, externalRef, totalCents: final.totalCents },
    });
    return { orderId: order.id, number: order.number, totalCents: final.totalCents, duplicate: false };
  }
}
