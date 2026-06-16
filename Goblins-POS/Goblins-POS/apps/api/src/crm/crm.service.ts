import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import { SettingsService } from '../settings/settings.service';

@Injectable()
export class CrmService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly settings: SettingsService,
  ) {}

  /** Customer lookup for the POS: name or phone; empty query lists regulars first. */
  async lookup(query: string, onlyActive = false) {
    const q = query.trim();
    return this.prisma.customer.findMany({
      where: {
        ...(onlyActive ? { isActive: true } : {}),
        ...(q ? { OR: [{ phone: { contains: q } }, { name: { contains: q, mode: 'insensitive' } }] } : {}),
      },
      include: { tier: true, group: true },
      orderBy: [{ visitCount: 'desc' }, { createdAt: 'desc' }],
      take: q ? 15 : 30,
    });
  }

  // ---------- customer groups ----------

  async groups() {
    return this.prisma.customerGroup.findMany({
      orderBy: { name: 'asc' },
      include: { _count: { select: { customers: true } } },
    });
  }

  async createGroup(params: { name: string; nameAr?: string; discountBps: number }, userId: string) {
    const group = await this.prisma.customerGroup.create({ data: params });
    await this.audit.log({ userId, action: 'customer.group_create', entity: 'CustomerGroup', entityId: group.id });
    return group;
  }

  async updateGroup(id: string, body: Record<string, unknown>, userId: string) {
    const allowed = ['name', 'nameAr', 'discountBps', 'isActive'];
    const data = Object.fromEntries(Object.entries(body).filter(([k]) => allowed.includes(k)));
    const group = await this.prisma.customerGroup.update({ where: { id }, data });
    await this.audit.log({ userId, action: 'customer.group_update', entity: 'CustomerGroup', entityId: id, detail: data as never });
    return group;
  }

  async get(id: string) {
    const customer = await this.prisma.customer.findUnique({
      where: { id },
      include: {
        tier: true,
        group: true,
        orders: {
          where: { status: 'PAID' },
          orderBy: { closedAt: 'desc' },
          take: 20,
          include: { items: { select: { description: true, quantity: true } } },
        },
        pointsTransactions: { orderBy: { createdAt: 'desc' }, take: 20 },
        reservations: { orderBy: { startAt: 'desc' }, take: 10, include: { resource: true } },
      },
    });
    if (!customer) throw new NotFoundException();
    // favourite items from order history
    const counts = new Map<string, number>();
    for (const o of customer.orders) {
      for (const i of o.items) counts.set(i.description, (counts.get(i.description) ?? 0) + Number(i.quantity));
    }
    const favorites = [...counts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([name, count]) => ({ name, count }));
    return { ...customer, favorites };
  }

  async create(params: { phone: string; name: string; email?: string; birthday?: string; tags?: string[]; notes?: string; groupId?: string; isActive?: boolean; walletBalanceCents?: number; userId: string }) {
    const tier = await this.prisma.loyaltyTier.findFirst({ orderBy: { minLifetimeCents: 'asc' } });
    const customer = await this.prisma.customer.create({
      data: {
        phone: params.phone,
        name: params.name,
        email: params.email,
        birthday: params.birthday ? new Date(params.birthday) : undefined,
        tags: params.tags ?? [],
        notes: params.notes,
        tierId: tier?.id,
        groupId: params.groupId,
        isActive: params.isActive ?? true,
        walletBalanceCents: params.walletBalanceCents ?? 0,
      },
    });
    await this.audit.log({
      userId: params.userId, action: 'customer.create', entity: 'Customer', entityId: customer.id,
    });
    return customer;
  }

  async update(id: string, data: { name?: string; email?: string; birthday?: string; tags?: string[]; notes?: string; groupId?: string | null; isActive?: boolean; walletBalanceCents?: number }, userId: string) {
    const customer = await this.prisma.customer.update({
      where: { id },
      data: { ...data, birthday: data.birthday ? new Date(data.birthday) : undefined },
    });
    await this.audit.log({ userId, action: 'customer.update', entity: 'Customer', entityId: id });
    return customer;
  }

  /** Redeem points as payment credit. Returns the credit in piasters. */
  async redeemPoints(params: { customerId: string; points: number; orderId: string; userId: string }) {
    if (params.points <= 0) throw new BadRequestException('Points must be positive');
    const centsPerPoint = Number(await this.settings.get('loyalty.redeemCentsPerPoint'));
    return this.prisma.$transaction(async (tx) => {
      const customer = await tx.customer.findUniqueOrThrow({ where: { id: params.customerId } });
      if (customer.pointsBalance < params.points) {
        throw new BadRequestException(`Insufficient points: has ${customer.pointsBalance}`);
      }
      const order = await tx.order.findUniqueOrThrow({
        where: { id: params.orderId },
        include: { items: true },
      });
      if (order.status !== 'OPEN') throw new BadRequestException('Order not open');
      const creditCents = params.points * centsPerPoint;
      const due = order.totalCents - order.paidCents;
      if (creditCents > due) throw new BadRequestException(`Credit ${creditCents} exceeds due ${due}`);

      await tx.pointsTransaction.create({
        data: { customerId: params.customerId, orderId: params.orderId, points: -params.points, kind: 'REDEEM' },
      });
      await tx.customer.update({
        where: { id: params.customerId },
        data: { pointsBalance: { decrement: params.points } },
      });
      // record as a loyalty payment
      let method = await tx.paymentMethod.findFirst({ where: { kind: 'LOYALTY_POINTS' } });
      method ??= await tx.paymentMethod.create({
        data: { name: 'Loyalty points', kind: 'LOYALTY_POINTS', sortOrder: 99 },
      });
      await tx.payment.create({
        data: { orderId: params.orderId, methodId: method.id, amountCents: creditCents, shiftId: order.shiftId },
      });
      await tx.order.update({
        where: { id: params.orderId },
        data: { paidCents: { increment: creditCents } },
      });
      await this.audit.log(
        { userId: params.userId, action: 'loyalty.redeem', entity: 'Customer', entityId: params.customerId,
          detail: { points: params.points, creditCents, orderId: params.orderId } },
        tx,
      );
      return { creditCents, remainingPoints: customer.pointsBalance - params.points };
    });
  }

  /** Targeted segments for SMS/WhatsApp export. */
  async segment(kind: 'inactive30' | 'top10pct' | 'birthdayThisWeek' | 'all') {
    if (kind === 'inactive30') {
      const cutoff = new Date(Date.now() - 30 * 86400_000);
      return this.prisma.customer.findMany({
        where: { orders: { none: { closedAt: { gte: cutoff } } } },
        select: { id: true, name: true, phone: true, pointsBalance: true, lifetimeCents: true },
      });
    }
    if (kind === 'top10pct') {
      const count = await this.prisma.customer.count();
      return this.prisma.customer.findMany({
        orderBy: { lifetimeCents: 'desc' },
        take: Math.max(1, Math.ceil(count / 10)),
        select: { id: true, name: true, phone: true, pointsBalance: true, lifetimeCents: true },
      });
    }
    if (kind === 'birthdayThisWeek') {
      const all = await this.prisma.customer.findMany({
        where: { birthday: { not: null } },
        select: { id: true, name: true, phone: true, birthday: true, pointsBalance: true, lifetimeCents: true },
      });
      const now = new Date();
      const week = 7 * 86400_000;
      return all.filter((c) => {
        const b = new Date(c.birthday!);
        const thisYear = new Date(now.getFullYear(), b.getMonth(), b.getDate());
        return thisYear.getTime() - now.getTime() >= -86400_000 && thisYear.getTime() - now.getTime() < week;
      });
    }
    return this.prisma.customer.findMany({
      select: { id: true, name: true, phone: true, pointsBalance: true, lifetimeCents: true },
    });
  }

  /** CSV export of a segment with a message template column. */
  async segmentCsv(kind: 'inactive30' | 'top10pct' | 'birthdayThisWeek' | 'all', template?: string) {
    const rows = (await this.segment(kind)) as { name: string; phone: string }[];
    const msg = template ?? 'Hi {name}! We miss you at Goblins Yard â€” show this message for 10% off.';
    const lines = ['name,phone,message'];
    for (const r of rows) {
      const message = msg.replaceAll('{name}', r.name.split(' ')[0] ?? r.name);
      lines.push(`"${r.name}","${r.phone}","${message.replaceAll('"', '""')}"`);
    }
    return lines.join('\n');
  }

  /** Birthday flag for the POS when attaching a customer. */
  async posFlags(customerId: string) {
    const c = await this.prisma.customer.findUniqueOrThrow({
      where: { id: customerId },
      include: { tier: true, group: true },
    });
    let birthdayThisWeek = false;
    if (c.birthday) {
      const now = new Date();
      const b = new Date(c.birthday);
      const thisYear = new Date(now.getFullYear(), b.getMonth(), b.getDate());
      const diff = thisYear.getTime() - now.getTime();
      birthdayThisWeek = diff >= -86400_000 && diff < 7 * 86400_000;
    }
    return {
      id: c.id, name: c.name, tier: c.tier?.name,
      pointsBalance: c.pointsBalance, visitCount: c.visitCount,
      birthdayThisWeek,
      walletBalanceCents: c.walletBalanceCents,
      group: c.group?.isActive
        ? { name: c.group.name, discountBps: c.group.discountBps }
        : null,
    };
  }

  /** Quick feedback at payment. */
  async feedback(params: { orderId: string; rating: number; comment?: string }) {
    if (params.rating < 1 || params.rating > 5) throw new BadRequestException('Rating 1-5');
    const order = await this.prisma.order.findUniqueOrThrow({ where: { id: params.orderId } });
    return this.prisma.feedback.upsert({
      where: { orderId: params.orderId },
      update: { rating: params.rating, comment: params.comment },
      create: {
        orderId: params.orderId,
        customerId: order.customerId,
        rating: params.rating,
        comment: params.comment,
      },
    });
  }

  /** Run campaign to segments. */
  async sendCampaign(params: {
    segment: 'inactive30' | 'top10pct' | 'birthdayThisWeek' | 'all';
    gateway: 'twilio_sms' | 'twilio_whatsapp' | 'mock_sms' | 'mock_whatsapp';
    template: string;
    userId: string;
  }) {
    const customers = await this.segment(params.segment);
    const accountSid = await this.settings.get('twilio.accountSid');
    const authToken = await this.settings.get('twilio.authToken');
    const fromNumber = await this.settings.get('twilio.from');

    const results: Array<{ customerId: string; success: boolean; error?: string; message?: string }> = [];
    let successCount = 0;
    let failCount = 0;

    for (const customer of customers) {
      if (!customer.phone) {
        results.push({ customerId: customer.id, success: false, error: 'No phone number' });
        failCount++;
        continue;
      }

      const messageBody = params.template
        .replaceAll('{name}', customer.name)
        .replaceAll('{points}', String(customer.pointsBalance));

      const toPhone = customer.phone.trim();
      const formattedTo = toPhone.startsWith('+') ? toPhone : (toPhone.startsWith('0') ? '+2' + toPhone : '+' + toPhone);

      const isWhatsapp = params.gateway.includes('whatsapp');
      const isMock = params.gateway.startsWith('mock');

      if (isMock) {
        results.push({
          customerId: customer.id,
          success: true,
          message: `Mock sent to ${formattedTo}: ${messageBody}`,
        });
        successCount++;
      } else {
        if (!accountSid || !authToken || !fromNumber) {
          throw new BadRequestException('Twilio credentials or From number are not configured in Settings.');
        }

        try {
          const fromField = isWhatsapp ? `whatsapp:${fromNumber}` : fromNumber;
          const toField = isWhatsapp ? `whatsapp:${formattedTo}` : formattedTo;

          const url = `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`;
          const auth = Buffer.from(`${accountSid}:${authToken}`).toString('base64');

          const bodyParams = new URLSearchParams();
          bodyParams.append('From', fromField);
          bodyParams.append('To', toField);
          bodyParams.append('Body', messageBody);

          const response = await fetch(url, {
            method: 'POST',
            headers: {
              'Authorization': `Basic ${auth}`,
              'Content-Type': 'application/x-www-form-urlencoded',
            },
            body: bodyParams.toString(),
          });

          const resText = await response.text();
          if (response.ok) {
            results.push({ customerId: customer.id, success: true });
            successCount++;
          } else {
            results.push({ customerId: customer.id, success: false, error: `Twilio Error: ${resText}` });
            failCount++;
          }
        } catch (err: any) {
          results.push({ customerId: customer.id, success: false, error: err.message || 'Unknown network error' });
          failCount++;
        }
      }
    }

    await this.audit.log({
      userId: params.userId,
      action: 'crm.campaign_send',
      entity: 'Customer',
      entityId: params.segment,
      detail: {
        gateway: params.gateway,
        template: params.template,
        total: customers.length,
        successCount,
        failCount,
      } as any,
    });

    return {
      total: customers.length,
      successCount,
      failCount,
      results,
    };
  }
}
