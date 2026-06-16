import {
  BadRequestException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { Prisma, OrderType } from '@prisma/client';
import { computeBill, lineTotal, resolveDiscount } from '@goblins/shared';
import { AuditService } from '../audit/audit.service';
import { AuthService } from '../auth/auth.service';
import { PrismaService } from '../prisma/prisma.service';
import { RealtimeGateway } from '../realtime/realtime.gateway';
import { SettingsService } from '../settings/settings.service';

export interface AddItemInput {
  itemId: string;
  quantity: number;
  modifierIds?: string[];
  notes?: string;
  course?: number;
  seat?: number;
}

@Injectable()
export class OrdersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly auth: AuthService,
    private readonly realtime: RealtimeGateway,
    private readonly settings: SettingsService,
  ) {}

  // ---------- helpers ----------

  private async nextOrderNumber(tx: Prisma.TransactionClient, branchId: string): Promise<number> {
    const last = await tx.order.findFirst({
      where: { branchId },
      orderBy: { number: 'desc' },
      select: { number: true },
    });
    return (last?.number ?? 0) + 1;
  }

  /** Current price for an item considering active price schedules (Cairo local). */
  private effectivePrice(item: {
    priceCents: number;
    priceSchedules: { priceCents: number; daysOfWeek: number[]; startTime: string; endTime: string; isActive: boolean }[];
  }): number {
    const now = new Date();
    const cairo = new Intl.DateTimeFormat('en-US', {
      timeZone: 'Africa/Cairo', weekday: 'short', hour: 'numeric', minute: 'numeric', hour12: false,
    }).formatToParts(now);
    const dowMap: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
    let dow = 0, mins = 0;
    for (const p of cairo) {
      if (p.type === 'weekday') dow = dowMap[p.value] ?? 0;
      else if (p.type === 'hour') mins += (Number(p.value) % 24) * 60;
      else if (p.type === 'minute') mins += Number(p.value);
    }
    for (const s of item.priceSchedules) {
      if (!s.isActive || !s.daysOfWeek.includes(dow)) continue;
      const [sh, sm] = s.startTime.split(':').map(Number);
      const [eh, em] = s.endTime.split(':').map(Number);
      const start = (sh ?? 0) * 60 + (sm ?? 0);
      const end = (eh ?? 0) * 60 + (em ?? 0);
      if (start <= end ? mins >= start && mins < end : mins >= start || mins < end) {
        return s.priceCents;
      }
    }
    return item.priceCents;
  }

  /** Recompute & persist order money snapshot from its lines. Call inside tx. */
  async recompute(tx: Prisma.TransactionClient, orderId: string) {
    const order = await tx.order.findUniqueOrThrow({
      where: { id: orderId },
      include: {
        items: true,
        discounts: true,
        payments: true,
        customer: { include: { group: true } },
        seatCustomers: { include: { customer: { include: { group: true } } } },
      },
    });
    const activeLines = order.items.filter((i) => i.status !== 'VOIDED');
    // customer-group discount is applied automatically whenever the customer is attached (seat-level falls back to order-level)
    let groupDiscount = 0;
    for (const line of activeLines) {
      const seatCust = line.seat ? order.seatCustomers.find((sc) => sc.seat === line.seat) : null;
      const cust = seatCust?.customer || order.customer;
      const bps = cust?.group?.isActive ? cust.group.discountBps : 0;
      groupDiscount += Math.floor((line.lineCents * bps) / 10_000);
    }
    const billDiscount = groupDiscount + order.discounts
      .filter((d) => !d.orderItemId)
      .reduce((a, d) => a + d.amountCents, 0);
    const vatBps = order.noVat ? 0 : await this.settings.get('tax.vatBps');
    const serviceBps =
      (order.type === 'TAKEAWAY' || order.noService) ? 0 : await this.settings.get('tax.serviceChargeBps');
    const totals = computeBill({
      lineCents: activeLines.map((l) => l.lineCents),
      billDiscountCents: billDiscount,
      serviceChargeBps: serviceBps,
      taxBps: vatBps,
    });
    const paid = order.payments.reduce((a, p) => a + p.amountCents, 0);
    const itemDiscounts = activeLines.reduce((a, l) => a + l.discountCents, 0);
    return tx.order.update({
      where: { id: orderId },
      data: {
        subtotalCents: totals.subtotalCents,
        discountCents: totals.discountCents + itemDiscounts,
        serviceChargeCents: totals.serviceChargeCents,
        taxCents: totals.taxCents,
        totalCents: totals.totalCents,
        paidCents: paid,
      },
      include: { items: { include: { modifiers: true } }, discounts: true, payments: true },
    });
  }

  private emitOrder(order: { id: string; resourceId?: string | null }) {
    this.realtime.emitTo('pos', 'order.updated', { orderId: order.id });
    this.realtime.emitTo('floor', 'order.updated', {
      orderId: order.id,
      resourceId: order.resourceId ?? null,
    });
  }

  async listPaymentMethods() {
    return this.prisma.paymentMethod.findMany({
      where: { isActive: true },
      include: { account: true },
      orderBy: { sortOrder: 'asc' },
    });
  }

  // ---------- order lifecycle ----------

  async create(params: {
    userId: string;
    branchId: string;
    type: OrderType;
    resourceId?: string;
    customerId?: string;
    guestCount?: number;
  }) {
    return this.prisma.$transaction(async (tx) => {
      const shift = await tx.shift.findFirst({
        where: { branchId: params.branchId, status: 'OPEN' },
        orderBy: { openedAt: 'desc' },
      });
      if (!shift) throw new BadRequestException('No open shift — open a shift first');

      if (params.resourceId) {
        await tx.resource.update({
          where: { id: params.resourceId },
          data: { status: 'OCCUPIED' },
        });
      }
      const order = await tx.order.create({
        data: {
          branchId: params.branchId,
          number: await this.nextOrderNumber(tx, params.branchId),
          type: params.type,
          resourceId: params.resourceId,
          customerId: params.customerId,
          guestCount: params.guestCount ?? 1,
          openedById: params.userId,
          shiftId: shift.id,
        },
        include: { items: { include: { modifiers: true } }, discounts: true, payments: true },
      });
      this.emitOrder(order);
      return order;
    });
  }

  async get(orderId: string) {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: {
        items: { include: { modifiers: true }, orderBy: { sortOrder: 'asc' } },
        discounts: true,
        payments: { include: { method: true } },
        customer: true,
        resource: { include: { ratePlan: { include: { rules: true } } } },
        session: { include: { segments: true, prepaidBlocks: true, ratePlan: { include: { rules: true } } } },
        seatCustomers: { include: { customer: true } },
      },
    });
    if (!order) throw new NotFoundException();
    return order;
  }

  async listOpen(branchId: string) {
    return this.prisma.order.findMany({
      where: { branchId, status: 'OPEN' },
      include: { resource: true, items: true, customer: { select: { name: true, phone: true } } },
      orderBy: { openedAt: 'asc' },
    });
  }

  async addItems(orderId: string, userId: string, inputs: AddItemInput[]) {
    const order = await this.prisma.$transaction(async (tx) => {
      const order = await tx.order.findUniqueOrThrow({ where: { id: orderId } });
      if (order.status !== 'OPEN') throw new BadRequestException('Order is not open');

      const maxSort = await tx.orderItem.aggregate({
        where: { orderId },
        _max: { sortOrder: true },
      });
      let sort = (maxSort._max.sortOrder ?? 0) + 1;

      for (const input of inputs) {
        const item = await tx.menuItem.findUniqueOrThrow({
          where: { id: input.itemId },
          include: { taxRate: true, priceSchedules: { where: { isActive: true } } },
        });
        if (item.is86ed) throw new BadRequestException(`${item.name} is unavailable (86'd)`);

        const modifiers = input.modifierIds?.length
          ? await tx.modifier.findMany({ where: { id: { in: input.modifierIds } } })
          : [];
        const unitCents = this.effectivePrice(item);
        const modsCents = modifiers.reduce((a, m) => a + m.priceDeltaCents, 0);
        await tx.orderItem.create({
          data: {
            orderId,
            itemId: item.id,
            description: item.name,
            quantity: new Prisma.Decimal(input.quantity),
            unitCents,
            modifiersCents: modsCents,
            lineCents: lineTotal(unitCents + modsCents, input.quantity),
            taxBps: item.taxRate?.rateBps ?? 0,
            course: input.course ?? 1,
            seat: input.seat,
            notes: input.notes,
            sortOrder: sort++,
            modifiers: {
              create: modifiers.map((m) => ({
                modifierId: m.id,
                name: m.name,
                priceCents: m.priceDeltaCents,
              })),
            },
          },
        });
      }
      return this.recompute(tx, orderId);
    });
    this.emitOrder(order);
    return order;
  }

  /** Void an item — requires order.void permission (already gated) and writes audit. */
  async voidItem(params: {
    orderId: string;
    orderItemId: string;
    userId: string;
    reason: string;
    approverPin?: string;
    terminalId?: string;
  }) {
    let approverId: string | null = null;
    if (params.approverPin) {
      approverId = await this.auth.approveWithPin(params.approverPin, 'order.void');
    }
    const order = await this.prisma.$transaction(async (tx) => {
      const item = await tx.orderItem.findUniqueOrThrow({ where: { id: params.orderItemId } });
      if (item.orderId !== params.orderId) throw new BadRequestException();
      if (item.status === 'VOIDED') throw new BadRequestException('Already voided');
      await tx.orderItem.update({
        where: { id: item.id },
        data: { status: 'VOIDED', voidedAt: new Date(), voidReason: params.reason, lineCents: 0 },
      });
      await this.audit.log(
        {
          userId: params.userId,
          approverId,
          terminalId: params.terminalId,
          action: 'order.void_item',
          entity: 'OrderItem',
          entityId: item.id,
          detail: { reason: params.reason, description: item.description, lineCents: item.lineCents },
        },
        tx,
      );
      return this.recompute(tx, params.orderId);
    });
    this.emitOrder(order);
    return order;
  }

  async voidOrder(params: { orderId: string; userId: string; reason: string; terminalId?: string }) {
    const order = await this.prisma.$transaction(async (tx) => {
      const order = await tx.order.findUniqueOrThrow({
        where: { id: params.orderId },
        include: { payments: true, session: true },
      });
      if (order.status !== 'OPEN') throw new BadRequestException('Only open orders can be voided');
      if (order.payments.length) throw new BadRequestException('Refund payments first');
      // a void must kill the timer too, or the table shows a ghost session forever
      if (order.session && (order.session.status === 'RUNNING' || order.session.status === 'PAUSED')) {
        const now = new Date();
        await tx.sessionSegment.updateMany({
          where: { sessionId: order.session.id, endedAt: null },
          data: { endedAt: now },
        });
        await tx.session.update({
          where: { id: order.session.id },
          data: { status: 'CANCELLED', endedAt: now },
        });
      }
      const updated = await tx.order.update({
        where: { id: order.id },
        data: { status: 'VOIDED', closedAt: new Date() },
      });
      if (order.resourceId) {
        const others = await tx.order.count({
          where: { resourceId: order.resourceId, status: 'OPEN' },
        });
        if (others === 0) {
          await tx.resource.update({ where: { id: order.resourceId }, data: { status: 'FREE' } });
        }
      }
      await this.audit.log(
        {
          userId: params.userId,
          terminalId: params.terminalId,
          action: 'order.void',
          entity: 'Order',
          entityId: order.id,
          detail: { reason: params.reason, totalCents: order.totalCents },
        },
        tx,
      );
      return updated;
    });
    this.emitOrder(order);
    this.realtime.emitTo('floor', 'resource.status', { id: order.resourceId, status: 'FREE' });
    return order;
  }

  // ---------- discounts ----------

  async applyDiscount(params: {
    orderId: string;
    userId: string;
    orderItemId?: string;
    kind: 'PERCENT' | 'FIXED';
    value: number;
    reasonCode: string;
    approverPin?: string;
    terminalId?: string;
  }) {
    if (!params.reasonCode?.trim()) throw new BadRequestException('Reason code is mandatory');
    let approverId: string | null = null;
    if (params.approverPin) {
      approverId = await this.auth.approveWithPin(params.approverPin, 'discount.apply');
    }
    const order = await this.prisma.$transaction(async (tx) => {
      let base: number;
      if (params.orderItemId) {
        const item = await tx.orderItem.findUniqueOrThrow({ where: { id: params.orderItemId } });
        base = item.lineCents;
        const amount = resolveDiscount(params.kind, params.value, base);
        await tx.orderItem.update({
          where: { id: item.id },
          data: { lineCents: item.lineCents - amount, discountCents: item.discountCents + amount },
        });
        await tx.orderDiscount.create({
          data: {
            orderId: params.orderId, orderItemId: item.id, kind: params.kind,
            value: params.value, amountCents: amount, reasonCode: params.reasonCode,
            approvedById: approverId,
          },
        });
      } else {
        const o = await tx.order.findUniqueOrThrow({
          where: { id: params.orderId },
          include: { items: true },
        });
        base = o.items.filter((i) => i.status !== 'VOIDED').reduce((a, i) => a + i.lineCents, 0);
        const amount = resolveDiscount(params.kind, params.value, base);
        await tx.orderDiscount.create({
          data: {
            orderId: params.orderId, kind: params.kind, value: params.value,
            amountCents: amount, reasonCode: params.reasonCode, approvedById: approverId,
          },
        });
      }
      await this.audit.log(
        {
          userId: params.userId, approverId, terminalId: params.terminalId,
          action: 'discount.apply', entity: 'Order', entityId: params.orderId,
          detail: { kind: params.kind, value: params.value, reasonCode: params.reasonCode, itemId: params.orderItemId },
        },
        tx,
      );
      return this.recompute(tx, params.orderId);
    });
    this.emitOrder(order);
    return order;
  }

  // ---------- split / merge / transfer ----------

  /** Split selected items into a new order (split by item / by seat both route here). */
  async splitByItems(params: { orderId: string; userId: string; orderItemIds: string[] }) {
    const result = await this.prisma.$transaction(async (tx) => {
      const source = await tx.order.findUniqueOrThrow({
        where: { id: params.orderId },
        include: { items: true },
      });
      if (source.status !== 'OPEN') throw new BadRequestException('Order not open');
      const moving = source.items.filter(
        (i) => params.orderItemIds.includes(i.id) && i.status !== 'VOIDED',
      );
      if (!moving.length) throw new BadRequestException('No items to split');
      if (moving.length === source.items.filter((i) => i.status !== 'VOIDED').length) {
        throw new BadRequestException('Cannot split all items — pay the order instead');
      }
      const child = await tx.order.create({
        data: {
          branchId: source.branchId,
          number: await this.nextOrderNumber(tx, source.branchId),
          type: source.type,
          resourceId: source.resourceId,
          customerId: source.customerId,
          openedById: params.userId,
          shiftId: source.shiftId,
          parentOrderId: source.id,
        },
      });
      await tx.orderItem.updateMany({
        where: { id: { in: moving.map((m) => m.id) } },
        data: { orderId: child.id },
      });
      await this.audit.log(
        {
          userId: params.userId, action: 'order.split', entity: 'Order', entityId: source.id,
          detail: { childOrderId: child.id, movedItems: moving.length },
        },
        tx,
      );
      await this.recompute(tx, source.id);
      const childOrder = await this.recompute(tx, child.id);
      return { source: await tx.order.findUniqueOrThrow({ where: { id: source.id }, include: { items: true } }), child: childOrder };
    });
    this.emitOrder(result.source);
    this.emitOrder(result.child);
    return result;
  }

  /** Split evenly into N percent-based child orders is handled at payment time
   *  (pay-by-amount); this handles physical item splits. */

  /**
   * Silently void an untouched order (no items, payments, or session) so a
   * mis-tapped table doesn't stay OCCUPIED. The POS calls this automatically
   * when leaving an empty order screen.
   */
  async abandonIfEmpty(orderId: string, userId: string) {
    const result = await this.prisma.$transaction(async (tx) => {
      const order = await tx.order.findUnique({
        where: { id: orderId },
        include: { items: true, payments: true, session: true },
      });
      const activeItems = order?.items.filter((i) => i.status !== 'VOIDED') ?? [];
      if (!order || order.status !== 'OPEN' || activeItems.length || order.payments.length || order.session) {
        return { abandoned: false };
      }
      await tx.order.update({
        where: { id: order.id },
        data: { status: 'VOIDED', closedAt: new Date() },
      });
      if (order.resourceId) {
        const others = await tx.order.count({
          where: { resourceId: order.resourceId, status: 'OPEN' },
        });
        if (others === 0) {
          await tx.resource.update({ where: { id: order.resourceId }, data: { status: 'FREE' } });
        }
      }
      await this.audit.log(
        { userId, action: 'order.abandon', entity: 'Order', entityId: order.id },
        tx,
      );
      return { abandoned: true };
    });
    if (result.abandoned) this.realtime.emitTo('floor', 'floor.refresh', {});
    return result;
  }

  /** Attach/detach a CRM customer on an open order (loyalty earn + POS flags). */
  async setCustomer(params: { orderId: string; customerId: string | null; userId: string }) {
    const order = await this.prisma.order.findUnique({ where: { id: params.orderId } });
    if (!order) throw new NotFoundException();
    if (order.status !== 'OPEN') throw new BadRequestException('Order not open');
    await this.prisma.$transaction(async (tx) => {
      await tx.order.update({
        where: { id: order.id },
        data: { customerId: params.customerId },
      });
      // group discounts follow the customer, so totals must refresh
      await this.recompute(tx, order.id);
    });
    await this.audit.log({
      userId: params.userId, action: 'order.customer', entity: 'Order', entityId: order.id,
      detail: { customerId: params.customerId },
    });
    return this.get(order.id);
  }

  async mergeOrders(params: { sourceOrderId: string; targetOrderId: string; userId: string }) {
    const order = await this.prisma.$transaction(async (tx) => {
      const [source, target] = await Promise.all([
        tx.order.findUniqueOrThrow({ where: { id: params.sourceOrderId }, include: { payments: true, session: true } }),
        tx.order.findUniqueOrThrow({ where: { id: params.targetOrderId } }),
      ]);
      if (source.status !== 'OPEN' || target.status !== 'OPEN') {
        throw new BadRequestException('Both orders must be open');
      }
      if (source.payments.length) throw new BadRequestException('Source order has payments');
      if (source.session && (source.session.status === 'RUNNING' || source.session.status === 'PAUSED')) {
        throw new BadRequestException('Stop the running timer before merging this order');
      }
      await tx.orderItem.updateMany({
        where: { orderId: source.id },
        data: { orderId: target.id },
      });
      await tx.orderDiscount.updateMany({
        where: { orderId: source.id },
        data: { orderId: target.id },
      });
      await tx.order.update({
        where: { id: source.id },
        data: { status: 'MERGED', closedAt: new Date(), parentOrderId: target.id },
      });
      if (source.resourceId && source.resourceId !== target.resourceId) {
        const others = await tx.order.count({
          where: { resourceId: source.resourceId, status: 'OPEN' },
        });
        if (others === 0) {
          await tx.resource.update({ where: { id: source.resourceId }, data: { status: 'FREE' } });
        }
      }
      await this.audit.log(
        {
          userId: params.userId, action: 'order.merge', entity: 'Order', entityId: target.id,
          detail: { mergedFrom: source.id },
        },
        tx,
      );
      return this.recompute(tx, target.id);
    });
    this.emitOrder(order);
    return order;
  }

  async transferOrder(params: { orderId: string; toResourceId: string; userId: string }) {
    const { order, sourceOrders } = await this.prisma.$transaction(async (tx) => {
      const order = await tx.order.findUniqueOrThrow({ where: { id: params.orderId } });
      if (order.status !== 'OPEN') throw new BadRequestException('Order not open');
      const from = order.resourceId;
      const target = await tx.resource.findUniqueOrThrow({ where: { id: params.toResourceId } });
      const tableType =
        target.type === 'BILLIARDS_TABLE' ? 'BILLIARDS' : target.type === 'PS_ROOM' ? 'PS_ROOM' : 'DINE_IN';

      // Find all open orders on the source table
      const sourceOrders = from
        ? await tx.order.findMany({ where: { resourceId: from, status: 'OPEN' } })
        : [order];

      for (const o of sourceOrders) {
        const session = await tx.session.findUnique({ where: { orderId: o.id } });
        const sessionActive = session?.status === 'RUNNING' || session?.status === 'PAUSED';
        const retype = !sessionActive
          && (o.type === 'DINE_IN' || o.type === 'BILLIARDS' || o.type === 'PS_ROOM');

        await tx.order.update({
          where: { id: o.id },
          data: { resourceId: params.toResourceId, ...(retype ? { type: tableType } : {}) },
        });

        // If this order has an active session, transfer the session too
        if (sessionActive && session) {
          const now = new Date();
          if (session.status === 'RUNNING') {
            await tx.sessionSegment.updateMany({
              where: { sessionId: session.id, endedAt: null },
              data: { endedAt: now },
            });
            await tx.sessionSegment.create({
              data: { sessionId: session.id, resourceId: params.toResourceId, isMultiplayer: session.isMultiplayer, startedAt: now },
            });
          }
          await tx.session.update({
            where: { id: session.id },
            data: { resourceId: params.toResourceId },
          });
        }

        const fromResource = from ? await tx.resource.findUnique({ where: { id: from } }) : null;
        await this.audit.log(
          {
            userId: params.userId, action: 'order.transfer', entity: 'Order', entityId: o.id,
            detail: {
              from,
              to: params.toResourceId,
              fromResourceName: fromResource?.name ?? 'Takeaway',
              toResourceName: target.name,
            },
          },
          tx,
        );
      }

      await tx.resource.update({ where: { id: params.toResourceId }, data: { status: 'OCCUPIED' } });
      if (from) {
        await tx.resource.update({ where: { id: from }, data: { status: 'FREE' } });
      }

      const mainOrder = await tx.order.findUniqueOrThrow({
        where: { id: order.id },
        include: { items: { include: { modifiers: true } }, discounts: true, payments: true },
      });

      return { order: mainOrder, sourceOrders };
    });

    for (const o of sourceOrders) {
      this.emitOrder({ id: o.id, resourceId: params.toResourceId });
    }
    this.realtime.emitTo('floor', 'floor.refresh', {});
    return order;
  }

  async moveOrderItem(id: string, orderItemId: string, userId: string, dto: { seat?: number | null; targetOrderId?: string }) {
    const result = await this.prisma.$transaction(async (tx) => {
      const item = await tx.orderItem.findUniqueOrThrow({ where: { id: orderItemId } });
      if (item.orderId !== id) throw new BadRequestException('Item does not belong to the source order');
      if (item.status === 'VOIDED') throw new BadRequestException('Cannot move a voided item');

      const sourceOrder = await tx.order.findUniqueOrThrow({ where: { id } });
      if (sourceOrder.status !== 'OPEN') throw new BadRequestException('Source order is not open');

      const targetOrderId = dto.targetOrderId;
      if (targetOrderId && targetOrderId !== id) {
        const targetOrder = await tx.order.findUniqueOrThrow({ where: { id: targetOrderId } });
        if (targetOrder.status !== 'OPEN') throw new BadRequestException('Target order is not open');

        await tx.orderItem.update({
          where: { id: orderItemId },
          data: { orderId: targetOrderId, seat: dto.seat ?? null },
        });

        await this.audit.log({
          userId,
          action: 'order.move_item',
          entity: 'OrderItem',
          entityId: orderItemId,
          detail: { fromOrderId: id, toOrderId: targetOrderId, seat: dto.seat ?? null },
        }, tx);

        await this.recompute(tx, id);
        const updatedTarget = await this.recompute(tx, targetOrderId);
        return { sourceOrderId: id, targetOrderId, updatedTarget };
      } else {
        await tx.orderItem.update({
          where: { id: orderItemId },
          data: { seat: dto.seat ?? null },
        });

        await this.audit.log({
          userId,
          action: 'order.move_item',
          entity: 'OrderItem',
          entityId: orderItemId,
          detail: { fromSeat: item.seat, toSeat: dto.seat ?? null },
        }, tx);

        const updatedSource = await this.recompute(tx, id);
        return { sourceOrderId: id, updatedSource };
      }
    });

    const source = await this.prisma.order.findUniqueOrThrow({ where: { id: result.sourceOrderId }, include: { items: true } });
    this.emitOrder(source);
    if (result.targetOrderId) {
      const target = await this.prisma.order.findUniqueOrThrow({ where: { id: result.targetOrderId }, include: { items: true } });
      this.emitOrder(target);
    }
    return result.updatedSource || result.updatedTarget;
  }

  async splitTimeCharge(id: string, orderItemId: string, userId: string, seats: number[]) {
    if (!seats || seats.length === 0) throw new BadRequestException('Seats array is required');
    const order = await this.prisma.$transaction(async (tx) => {
      const item = await tx.orderItem.findUniqueOrThrow({ where: { id: orderItemId } });
      if (item.orderId !== id) throw new BadRequestException('Item does not belong to the source order');
      if (item.status === 'VOIDED') throw new BadRequestException('Cannot split a voided time charge');
      if (!item.isTimeCharge) throw new BadRequestException('Item is not a time charge');

      const sourceOrder = await tx.order.findUniqueOrThrow({ where: { id } });
      if (sourceOrder.status !== 'OPEN') throw new BadRequestException('Order is not open');

      const N = seats.length;
      const totalCents = item.lineCents;
      const baseShare = Math.floor(totalCents / N);
      const remainder = totalCents - (baseShare * N);

      const maxSort = await tx.orderItem.aggregate({
        where: { orderId: id },
        _max: { sortOrder: true },
      });
      let sort = (maxSort._max.sortOrder ?? 0) + 1;

      for (let i = 0; i < N; i++) {
        const seat = seats[i];
        const seatShare = baseShare + (i < remainder ? 1 : 0);
        const quantityShare = new Prisma.Decimal(item.quantity.toNumber() / N);
        await tx.orderItem.create({
          data: {
            orderId: id,
            itemId: item.itemId,
            description: `${item.description} (Seat ${seat})`,
            quantity: quantityShare,
            unitCents: Math.round(item.unitCents / N),
            lineCents: seatShare,
            isTimeCharge: true,
            seat,
            sortOrder: sort++,
            status: 'PENDING',
            kdsStatus: 'NEW',
            taxBps: item.taxBps,
          },
        });
      }

      await tx.orderItem.update({
        where: { id: orderItemId },
        data: { status: 'VOIDED', voidedAt: new Date(), voidReason: 'Split time charge', lineCents: 0 },
      });

      await this.audit.log({
        userId,
        action: 'order.split_time',
        entity: 'OrderItem',
        entityId: orderItemId,
        detail: { seats, originalCents: totalCents },
      }, tx);

      return this.recompute(tx, id);
    });

    this.emitOrder(order);
    return order;
  }

  async setSeatCustomer(params: { orderId: string; seat: number; customerId: string | null; userId: string }) {
    const order = await this.prisma.$transaction(async (tx) => {
      const order = await tx.order.findUniqueOrThrow({ where: { id: params.orderId } });
      if (order.status !== 'OPEN') throw new BadRequestException('Order is not open');

      if (params.customerId === null) {
        await tx.orderSeatCustomer.deleteMany({
          where: { orderId: params.orderId, seat: params.seat },
        });
      } else {
        await tx.orderSeatCustomer.upsert({
          where: {
            orderId_seat: { orderId: params.orderId, seat: params.seat },
          },
          update: { customerId: params.customerId },
          create: { orderId: params.orderId, seat: params.seat, customerId: params.customerId },
        });
      }

      await this.audit.log({
        userId: params.userId,
        action: 'order.seat_customer',
        entity: 'Order',
        entityId: params.orderId,
        detail: { seat: params.seat, customerId: params.customerId },
      }, tx);

      return this.recompute(tx, params.orderId);
    });

    this.emitOrder(order);
    return order;
  }

  async addCombo(orderId: string, userId: string, dto: { comboId: string; course?: number; seat?: number }) {
    const order = await this.prisma.$transaction(async (tx) => {
      const order = await tx.order.findUniqueOrThrow({ where: { id: orderId } });
      if (order.status !== 'OPEN') throw new BadRequestException('Order is not open');

      const combo = await tx.combo.findUniqueOrThrow({
        where: { id: dto.comboId },
        include: { lines: { include: { item: { include: { taxRate: true } } } } },
      });
      if (!combo.isActive) throw new BadRequestException('Combo is not active');

      for (const line of combo.lines) {
        if (line.item.is86ed) throw new BadRequestException(`${line.item.name} is unavailable (86'd)`);
      }

      const maxSort = await tx.orderItem.aggregate({
        where: { orderId },
        _max: { sortOrder: true },
      });
      let sort = (maxSort._max.sortOrder ?? 0) + 1;

      // 1. Create price-bearing parent combo line
      await tx.orderItem.create({
        data: {
          orderId,
          description: combo.name,
          quantity: new Prisma.Decimal(1),
          unitCents: combo.priceCents,
          lineCents: combo.priceCents,
          course: dto.course ?? 1,
          seat: dto.seat,
          sortOrder: sort++,
          status: 'PENDING',
          kdsStatus: 'NEW',
        },
      });

      // 2. Create zero-priced component lines
      for (const line of combo.lines) {
        await tx.orderItem.create({
          data: {
            orderId,
            itemId: line.item.id,
            description: `${line.item.name} (Combo Component)`,
            quantity: new Prisma.Decimal(line.quantity),
            unitCents: 0,
            lineCents: 0,
            course: dto.course ?? 1,
            seat: dto.seat,
            sortOrder: sort++,
            status: 'PENDING',
            kdsStatus: 'NEW',
            taxBps: line.item.taxRate?.rateBps ?? 0,
          },
        });
      }

      await this.audit.log({
        userId,
        action: 'order.add_combo',
        entity: 'Order',
        entityId: orderId,
        detail: { comboId: dto.comboId, priceCents: combo.priceCents },
      }, tx);

      return this.recompute(tx, orderId);
    });

    this.emitOrder(order);
    return order;
  }

  async listClosedOrders(
    branchId: string,
    filters?: { startDate?: string; endDate?: string; search?: string },
  ) {
    const where: Prisma.OrderWhereInput = {
      branchId,
      status: { in: ['PAID', 'OPEN', 'VOIDED'] },
    };

    const andConditions: Prisma.OrderWhereInput[] = [];

    if (filters?.startDate || filters?.endDate) {
      const gte = filters.startDate ? new Date(`${filters.startDate}T00:00:00`) : undefined;
      const lte = filters.endDate ? new Date(`${filters.endDate}T23:59:59.999`) : undefined;

      andConditions.push({
        OR: [
          {
            status: { in: ['PAID', 'VOIDED'] },
            closedAt: {
              ...(gte ? { gte } : {}),
              ...(lte ? { lte } : {}),
            },
          },
          {
            status: 'OPEN',
            openedAt: {
              ...(gte ? { gte } : {}),
              ...(lte ? { lte } : {}),
            },
          },
        ],
      });
    }

    if (filters?.search) {
      const q = filters.search.trim();
      const num = q.startsWith('#') ? Number(q.slice(1)) : Number(q);

      andConditions.push({
        OR: [
          { customer: { name: { contains: q, mode: 'insensitive' } } },
          { customer: { phone: { contains: q, mode: 'insensitive' } } },
          { openedBy: { name: { contains: q, mode: 'insensitive' } } },
          ...(!isNaN(num) ? [{ number: num }] : []),
        ],
      });
    }

    if (andConditions.length > 0) {
      where.AND = andConditions;
    }

    return this.prisma.order.findMany({
      where,
      include: {
        payments: {
          include: {
            method: true,
            shift: { select: { id: true } },
          },
        },
        customer: { select: { id: true, name: true, phone: true } },
        openedBy: { select: { id: true, name: true } },
      },
      orderBy: { openedAt: 'desc' },
      take: 100,
    });
  }

  async updateTaxService(params: {
    orderId: string;
    userId: string;
    noService?: boolean;
    noVat?: boolean;
    approverPin?: string;
    terminalId?: string;
  }) {
    let approverId: string | null = null;
    if (params.approverPin) {
      approverId = await this.auth.approveWithPin(params.approverPin, 'discount.apply');
    } else {
      const user = await this.prisma.user.findUniqueOrThrow({
        where: { id: params.userId },
        include: { role: { include: { permissions: true } } },
      });
      const hasPerm = user.role.permissions.some((p) => p.permissionId === 'discount.apply');
      if (!hasPerm) {
        throw new UnauthorizedException('Manager PIN is required for this action');
      }
    }

    const order = await this.prisma.$transaction(async (tx) => {
      const order = await tx.order.findUniqueOrThrow({ where: { id: params.orderId } });
      if (order.status !== 'OPEN') throw new BadRequestException('Order is not open');

      await tx.order.update({
        where: { id: params.orderId },
        data: {
          noService: params.noService !== undefined ? params.noService : order.noService,
          noVat: params.noVat !== undefined ? params.noVat : order.noVat,
        },
      });

      await this.audit.log(
        {
          userId: params.userId,
          approverId,
          terminalId: params.terminalId,
          action: 'order.tax_service_override',
          entity: 'Order',
          entityId: params.orderId,
          detail: { noService: params.noService, noVat: params.noVat },
        },
        tx,
      );

      return this.recompute(tx, params.orderId);
    });

    this.emitOrder(order);
    return order;
  }

  async updateItemNote(orderId: string, orderItemId: string, userId: string, notes: string) {
    const order = await this.prisma.$transaction(async (tx) => {
      const item = await tx.orderItem.findUniqueOrThrow({ where: { id: orderItemId } });
      if (item.orderId !== orderId) throw new BadRequestException('Item does not belong to this order');
      const order = await tx.order.findUniqueOrThrow({ where: { id: orderId } });
      if (order.status !== 'OPEN') throw new BadRequestException('Order is not open');

      await tx.orderItem.update({
        where: { id: orderItemId },
        data: { notes: notes || null },
      });

      await this.audit.log(
        {
          userId,
          action: 'order.update_item_note',
          entity: 'OrderItem',
          entityId: orderItemId,
          detail: { notes },
        },
        tx,
      );

      return this.recompute(tx, orderId);
    });

    this.emitOrder(order);
    return order;
  }

  async updateItemQuantity(orderId: string, orderItemId: string, userId: string, quantity: number) {
    if (quantity <= 0) {
      throw new BadRequestException('Quantity must be greater than zero. To remove, void the item instead.');
    }
    const order = await this.prisma.$transaction(async (tx) => {
      const item = await tx.orderItem.findUniqueOrThrow({
        where: { id: orderItemId },
        include: { modifiers: true },
      });
      if (item.orderId !== orderId) throw new BadRequestException('Item does not belong to this order');
      const order = await tx.order.findUniqueOrThrow({ where: { id: orderId } });
      if (order.status !== 'OPEN') throw new BadRequestException('Order is not open');
      if (item.status === 'VOIDED') throw new BadRequestException('Cannot change quantity of a voided item');

      if (item.status === 'PENDING') {
        const unitCents = item.unitCents;
        const modsCents = item.modifiersCents;
        const lineCents = lineTotal(unitCents + modsCents, quantity);

        await tx.orderItem.update({
          where: { id: orderItemId },
          data: {
            quantity: new Prisma.Decimal(quantity),
            lineCents,
          },
        });

        await this.audit.log(
          {
            userId,
            action: 'order.update_item_quantity',
            entity: 'OrderItem',
            entityId: orderItemId,
            detail: { oldQuantity: Number(item.quantity), newQuantity: quantity },
          },
          tx,
        );
      } else {
        const oldQty = Number(item.quantity);
        if (quantity < oldQty) {
          throw new BadRequestException('Cannot decrease quantity of a sent item directly. Use Void instead.');
        } else if (quantity > oldQty) {
          const diff = quantity - oldQty;
          const maxSort = await tx.orderItem.aggregate({
            where: { orderId },
            _max: { sortOrder: true },
          });
          const sort = (maxSort._max.sortOrder ?? 0) + 1;

          const newItem = await tx.orderItem.create({
            data: {
              orderId,
              itemId: item.itemId,
              description: item.description,
              quantity: new Prisma.Decimal(diff),
              unitCents: item.unitCents,
              modifiersCents: item.modifiersCents,
              lineCents: lineTotal(item.unitCents + item.modifiersCents, diff),
              taxBps: item.taxBps,
              course: item.course,
              seat: item.seat,
              notes: item.notes,
              status: 'PENDING',
              sortOrder: sort,
              modifiers: {
                create: item.modifiers.map((m) => ({
                  modifierId: m.modifierId,
                  name: m.name,
                  priceCents: m.priceCents,
                })),
              },
            },
          });

          await this.audit.log(
            {
              userId,
              action: 'order.add_item_quantity_sent',
              entity: 'OrderItem',
              entityId: item.id,
              detail: { oldQuantity: oldQty, addedQuantity: diff, newItemId: newItem.id },
            },
            tx,
          );
        }
      }

      return this.recompute(tx, orderId);
    });

    this.emitOrder(order);
    return order;
  }
}
