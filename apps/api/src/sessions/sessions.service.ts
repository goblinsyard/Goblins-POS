import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { Prisma } from '@prisma/client';
import {
  priceSession,
  rateAt,
  toCairoLocal,
  type RatePlanSpec,
  type SegmentSpec,
} from '@goblins/shared';
import { AuditService } from '../audit/audit.service';
import { OrdersService } from '../orders/orders.service';
import { PrismaService } from '../prisma/prisma.service';
import { RealtimeGateway } from '../realtime/realtime.gateway';
import { SettingsService } from '../settings/settings.service';

type PlanWithRules = Prisma.RatePlanGetPayload<{ include: { rules: true } }>;
type SessionFull = Prisma.SessionGetPayload<{
  include: { segments: true; ratePlan: { include: { rules: true } }; prepaidBlocks: true };
}>;

function toSpec(plan: PlanWithRules): RatePlanSpec {
  return {
    hourlyCents: plan.hourlyCents,
    hourlyMultiCents: plan.hourlyMultiCents,
    minimumCents: plan.minimumCents,
    roundToMinutes: plan.roundToMinutes,
    roundingMode: plan.roundingMode as 'nearest' | 'up' | 'down',
    graceMinutes: plan.graceMinutes,
    rules: plan.rules
      .filter((r) => r.isActive)
      .map((r) => ({
        daysOfWeek: r.daysOfWeek,
        startTime: r.startTime,
        endTime: r.endTime,
        hourlyCents: r.hourlyCents,
        hourlyMultiCents: r.hourlyMultiCents,
        priority: r.priority,
      })),
  };
}

function toSegments(session: SessionFull, nowMs: number): SegmentSpec[] {
  return session.segments.map((s) => ({
    startedAt: s.startedAt.getTime(),
    endedAt: s.endedAt ? s.endedAt.getTime() : nowMs,
    isMultiplayer: s.isMultiplayer,
  }));
}

@Injectable()
export class SessionsService {
  private readonly smsAlertedPrepaidKeys = new Set<string>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly orders: OrdersService,
    private readonly realtime: RealtimeGateway,
    private readonly settings: SettingsService,
  ) {}

  private async loadSession(id: string): Promise<SessionFull> {
    const session = await this.prisma.session.findUnique({
      where: { id },
      include: { segments: true, ratePlan: { include: { rules: true } }, prepaidBlocks: true },
    });
    if (!session) throw new NotFoundException('Session not found');
    return session;
  }

  private livePricing(session: SessionFull, nowMs = Date.now()) {
    return priceSession(toSegments(session, nowMs), toSpec(session.ratePlan), toCairoLocal);
  }

  /** Live view used by the POS panel. */
  async byOrder(orderId: string) {
    const session = await this.prisma.session.findUnique({
      where: { orderId },
      include: { segments: true, ratePlan: { include: { rules: true } }, prepaidBlocks: true },
    });
    if (!session) return null;
    const pricing = this.livePricing(session);
    return {
      id: session.id,
      status: session.status,
      isMultiplayer: session.isMultiplayer,
      startedAt: session.startedAt,
      liveCostCents: session.status === 'STOPPED' ? (session.billedCents ?? 0) : pricing.totalCents,
      liveMinutes: session.status === 'STOPPED' ? (session.billedMinutes ?? 0) : pricing.billedMinutes,
      bands: pricing.bands,
      prepaidBlocks: session.prepaidBlocks,
    };
  }

  async start(params: { orderId: string; userId: string; isMultiplayer: boolean }) {
    const result = await this.prisma.$transaction(async (tx) => {
      const order = await tx.order.findUniqueOrThrow({
        where: { id: params.orderId },
        include: { resource: { include: { ratePlan: { include: { rules: true } } } }, session: true },
      });
      if (order.status !== 'OPEN') throw new BadRequestException('Order is not open');
      if (order.session && order.session.status !== 'CANCELLED') {
        throw new BadRequestException('Order already has a session');
      }
      const resource = order.resource;
      if (!resource) throw new BadRequestException('Order has no table/room');
      if (resource.type === 'RESTAURANT_TABLE') {
        throw new BadRequestException('Restaurant tables are not time-billed');
      }
      if (!resource.ratePlan) throw new BadRequestException('Resource has no rate plan');
      const running = await tx.session.findFirst({
        where: { resourceId: resource.id, status: { in: ['RUNNING', 'PAUSED'] } },
      });
      if (running) throw new BadRequestException('Resource already has a running session');

      const now = new Date();
      const session = await tx.session.create({
        data: {
          resourceId: resource.id,
          ratePlanId: resource.ratePlan.id,
          orderId: order.id,
          isMultiplayer: params.isMultiplayer,
          startedAt: now,
          segments: {
            create: [{ resourceId: resource.id, isMultiplayer: params.isMultiplayer, startedAt: now }],
          },
        },
      });
      await tx.resource.update({ where: { id: resource.id }, data: { status: 'OCCUPIED' } });
      await this.audit.log(
        { userId: params.userId, action: 'session.start', entity: 'Session', entityId: session.id,
          detail: { resourceId: resource.id, isMultiplayer: params.isMultiplayer } },
        tx,
      );
      return session;
    });
    this.realtime.emitTo('floor', 'floor.refresh', {});
    return result;
  }

  async pause(sessionId: string, userId: string) {
    const session = await this.loadSession(sessionId);
    if (session.status !== 'RUNNING') throw new BadRequestException('Session is not running');
    await this.prisma.$transaction([
      this.prisma.sessionSegment.updateMany({
        where: { sessionId, endedAt: null },
        data: { endedAt: new Date() },
      }),
      this.prisma.session.update({ where: { id: sessionId }, data: { status: 'PAUSED' } }),
    ]);
    await this.audit.log({ userId, action: 'session.pause', entity: 'Session', entityId: sessionId });
    this.realtime.emitTo('floor', 'floor.refresh', {});
    return this.byOrder(session.orderId!);
  }

  async resume(sessionId: string, userId: string) {
    const session = await this.loadSession(sessionId);
    if (session.status !== 'PAUSED') throw new BadRequestException('Session is not paused');
    await this.prisma.$transaction([
      this.prisma.sessionSegment.create({
        data: {
          sessionId,
          resourceId: session.resourceId,
          isMultiplayer: session.isMultiplayer,
          startedAt: new Date(),
        },
      }),
      this.prisma.session.update({ where: { id: sessionId }, data: { status: 'RUNNING' } }),
    ]);
    await this.audit.log({ userId, action: 'session.resume', entity: 'Session', entityId: sessionId });
    this.realtime.emitTo('floor', 'floor.refresh', {});
    return this.byOrder(session.orderId!);
  }

  /** Toggle single ↔ multiplayer mid-session (PS rooms). */
  async setMode(sessionId: string, userId: string, isMultiplayer: boolean) {
    const session = await this.loadSession(sessionId);
    if (session.status !== 'RUNNING') throw new BadRequestException('Session is not running');
    const now = new Date();
    await this.prisma.$transaction([
      this.prisma.sessionSegment.updateMany({
        where: { sessionId, endedAt: null },
        data: { endedAt: now },
      }),
      this.prisma.sessionSegment.create({
        data: { sessionId, resourceId: session.resourceId, isMultiplayer, startedAt: now },
      }),
      this.prisma.session.update({ where: { id: sessionId }, data: { isMultiplayer } }),
    ]);
    await this.audit.log({
      userId, action: 'session.set_mode', entity: 'Session', entityId: sessionId,
      detail: { isMultiplayer },
    });
    return this.byOrder(session.orderId!);
  }

  async transfer(sessionId: string, userId: string, toResourceId: string) {
    const { orderId, sourceOrders } = await this.prisma.$transaction(async (tx) => {
      const session = await tx.session.findUniqueOrThrow({
        where: { id: sessionId },
        include: { resource: true },
      });
      if (session.status !== 'RUNNING' && session.status !== 'PAUSED') {
        throw new BadRequestException('Session is not active');
      }
      const target = await tx.resource.findUniqueOrThrow({
        where: { id: toResourceId },
        include: { ratePlan: true },
      });
      if (target.type !== session.resource.type) {
        throw new BadRequestException('Target must be the same resource type');
      }
      const busy = await tx.session.findFirst({
        where: { resourceId: toResourceId, status: { in: ['RUNNING', 'PAUSED'] } },
      });
      if (busy) throw new BadRequestException('Target resource is busy');

      const fromResourceId = session.resourceId;

      // Find all open orders on the source table
      const sourceOrders = await tx.order.findMany({
        where: { resourceId: fromResourceId, status: 'OPEN' },
      });

      for (const o of sourceOrders) {
        const oSession = await tx.session.findUnique({ where: { orderId: o.id } });
        const oSessionActive = oSession?.status === 'RUNNING' || oSession?.status === 'PAUSED';

        if (oSessionActive && oSession) {
          const now = new Date();
          if (oSession.status === 'RUNNING') {
            await tx.sessionSegment.updateMany({
              where: { sessionId: oSession.id, endedAt: null },
              data: { endedAt: now },
            });
            await tx.sessionSegment.create({
              data: { sessionId: oSession.id, resourceId: toResourceId, isMultiplayer: oSession.isMultiplayer, startedAt: now },
            });
          }
          await tx.session.update({ where: { id: oSession.id }, data: { resourceId: toResourceId } });
        }

        const tableType =
          target.type === 'BILLIARDS_TABLE' ? 'BILLIARDS' : target.type === 'PS_ROOM' ? 'PS_ROOM' : 'DINE_IN';
        const retype = !oSessionActive
          && (o.type === 'DINE_IN' || o.type === 'BILLIARDS' || o.type === 'PS_ROOM');

        await tx.order.update({
          where: { id: o.id },
          data: { resourceId: toResourceId, ...(retype ? { type: tableType } : {}) },
        });

        const fromResource = await tx.resource.findUnique({ where: { id: fromResourceId } });
        await this.audit.log(
          {
            userId, action: 'order.transfer', entity: 'Order', entityId: o.id,
            detail: {
              from: fromResourceId,
              to: toResourceId,
              fromResourceName: fromResource?.name ?? 'Takeaway',
              toResourceName: target.name,
            },
          },
          tx,
        );
      }

      await tx.resource.update({ where: { id: toResourceId }, data: { status: 'OCCUPIED' } });
      await tx.resource.update({ where: { id: fromResourceId }, data: { status: 'FREE' } });

      const fromResource = await tx.resource.findUnique({ where: { id: fromResourceId } });
      await this.audit.log(
        { userId, action: 'session.transfer', entity: 'Session', entityId: sessionId,
          detail: {
            from: fromResourceId,
            to: toResourceId,
            fromResourceName: fromResource?.name,
            toResourceName: target.name,
          } },
        tx,
      );
      return { orderId: session.orderId, sourceOrders };
    });

    for (const o of sourceOrders) {
      this.realtime.emitTo('pos', 'order.updated', { orderId: o.id });
      this.realtime.emitTo('floor', 'order.updated', {
        orderId: o.id,
        resourceId: toResourceId,
      });
    }
    this.realtime.emitTo('floor', 'floor.refresh', {});
    return orderId ? this.byOrder(orderId) : null;
  }

  /** Stop & bill: freeze cost as a time-charge line on the combined order. */
  async stop(sessionId: string, userId: string) {
    const orderId = await this.prisma.$transaction(async (tx) => {
      const session = await tx.session.findUniqueOrThrow({
        where: { id: sessionId },
        include: { segments: true, ratePlan: { include: { rules: true } }, resource: true },
      });
      if (session.status !== 'RUNNING' && session.status !== 'PAUSED') {
        throw new BadRequestException('Session is not active');
      }
      const now = new Date();
      await tx.sessionSegment.updateMany({
        where: { sessionId, endedAt: null },
        data: { endedAt: now },
      });
      const fresh = await tx.session.findUniqueOrThrow({
        where: { id: sessionId },
        include: { segments: true, ratePlan: { include: { rules: true } }, prepaidBlocks: true },
      });
      const pricing = priceSession(
        toSegments(fresh, now.getTime()),
        toSpec(fresh.ratePlan),
        toCairoLocal,
      );
      // prepaid blocks reduce the charge (already paid up front)
      const prepaidCents = fresh.prepaidBlocks.reduce((a, b) => a + b.paidCents, 0);
      const chargeCents = Math.max(0, pricing.totalCents - prepaidCents);

      await tx.session.update({
        where: { id: sessionId },
        data: {
          status: 'STOPPED',
          endedAt: now,
          billedCents: pricing.totalCents,
          billedMinutes: pricing.billedMinutes,
        },
      });
      if (session.orderId) {
        const hours = Math.floor(pricing.billedMinutes / 60);
        const mins = pricing.billedMinutes % 60;
        const label = session.resource.type === 'PS_ROOM' ? 'PS room time' : 'Billiards time';
        const maxSort = await tx.orderItem.aggregate({
          where: { orderId: session.orderId },
          _max: { sortOrder: true },
        });
        await tx.orderItem.create({
          data: {
            orderId: session.orderId,
            description: `${label} — ${hours ? `${hours}h ` : ''}${mins}m${prepaidCents ? ' (prepaid applied)' : ''}`,
            quantity: new Prisma.Decimal(1),
            unitCents: chargeCents,
            lineCents: chargeCents,
            taxBps: 1400,
            isTimeCharge: true,
            status: 'SENT',
            kdsStatus: 'SERVED',
            sortOrder: (maxSort._max.sortOrder ?? 0) + 1,
          },
        });
        await this.orders.recompute(tx, session.orderId);
      }
      await this.audit.log(
        { userId, action: 'session.stop', entity: 'Session', entityId: sessionId,
          detail: { billedCents: pricing.totalCents, billedMinutes: pricing.billedMinutes, prepaidCents } },
        tx,
      );
      return session.orderId;
    });
    this.realtime.emitTo('floor', 'floor.refresh', {});
    if (orderId) this.realtime.emitTo('pos', 'order.updated', { orderId });
    return orderId ? this.byOrder(orderId) : null;
  }

  /** Sell a prepaid block (e.g. 2 hours up front). Charged immediately as a line. */
  async addPrepaid(params: { sessionId: string; userId: string; minutes: number }) {
    const result = await this.prisma.$transaction(async (tx) => {
      const session = await tx.session.findUniqueOrThrow({
        where: { id: params.sessionId },
        include: { ratePlan: { include: { rules: true } } },
      });
      if (session.status !== 'RUNNING' && session.status !== 'PAUSED') {
        throw new BadRequestException('Session is not active');
      }
      // price the block at the CURRENT rate (simple & predictable for staff)
      const spec = toSpec(session.ratePlan);
      const nowLocal = toCairoLocal(Date.now());
      const { hourlyCents } = rateAt(spec, nowLocal, session.isMultiplayer);
      const paidCents = Math.round((params.minutes * hourlyCents) / 60);
      const block = await tx.prepaidBlock.create({
        data: { sessionId: params.sessionId, minutes: params.minutes, paidCents },
      });
      if (session.orderId) {
        const maxSort = await tx.orderItem.aggregate({
          where: { orderId: session.orderId },
          _max: { sortOrder: true },
        });
        await tx.orderItem.create({
          data: {
            orderId: session.orderId,
            description: `Prepaid time — ${params.minutes} min`,
            quantity: new Prisma.Decimal(1),
            unitCents: paidCents,
            lineCents: paidCents,
            taxBps: 1400,
            isTimeCharge: true,
            status: 'SENT',
            kdsStatus: 'SERVED',
            sortOrder: (maxSort._max.sortOrder ?? 0) + 1,
          },
        });
        await this.orders.recompute(tx, session.orderId);
      }
      await this.audit.log(
        { userId: params.userId, action: 'session.prepaid', entity: 'Session', entityId: params.sessionId,
          detail: { minutes: params.minutes, paidCents } },
        tx,
      );
      return block;
    });
    return result;
  }

  /**
   * Self-healing: a session whose order is no longer OPEN can never be stopped
   * from the POS (the order screen is gone) — cancel it and free the table.
   */
  @Cron(CronExpression.EVERY_MINUTE)
  async cancelOrphanedSessions() {
    const orphans = await this.prisma.session.findMany({
      where: {
        status: { in: ['RUNNING', 'PAUSED'] },
        OR: [{ orderId: null }, { order: { status: { not: 'OPEN' } } }],
      },
      select: { id: true, resourceId: true },
    });
    if (!orphans.length) return;
    const now = new Date();
    for (const s of orphans) {
      await this.prisma.$transaction(async (tx) => {
        await tx.sessionSegment.updateMany({
          where: { sessionId: s.id, endedAt: null },
          data: { endedAt: now },
        });
        await tx.session.update({
          where: { id: s.id },
          data: { status: 'CANCELLED', endedAt: now },
        });
        const openOrders = await tx.order.count({
          where: { resourceId: s.resourceId, status: 'OPEN' },
        });
        if (openOrders === 0) {
          await tx.resource.update({ where: { id: s.resourceId }, data: { status: 'FREE' } });
        }
        await this.audit.log(
          { action: 'session.orphan_cancelled', entity: 'Session', entityId: s.id },
          tx,
        );
      });
    }
    this.realtime.emitTo('floor', 'floor.refresh', {});
  }

  /** Every 30s: fire near-expiry alerts for prepaid blocks. */
  @Cron(CronExpression.EVERY_30_SECONDS)
  async prepaidAlerts() {
    const sessions = await this.prisma.session.findMany({
      where: { status: 'RUNNING', prepaidBlocks: { some: {} } },
      include: {
        segments: true,
        ratePlan: { include: { rules: true } },
        prepaidBlocks: true,
        resource: true,
        order: { include: { customer: true } },
      },
    });
    if (!sessions.length) return;

    const alertAt = await this.settings.get('session.prepaidAlertMinutes');
    const smsAlertAt = await this.settings.get('session.prepaidSmsAlertMinutes');

    for (const session of sessions) {
      const pricing = this.livePricing(session);
      const prepaidMinutes = session.prepaidBlocks.reduce((a, b) => a + b.minutes, 0);
      const remaining = prepaidMinutes - pricing.billedMinutes;

      // 1. POS near-expiry alert (realtime)
      const unfiredBlocksForPos = session.prepaidBlocks.filter((b) => !b.alertFired);
      if (unfiredBlocksForPos.length > 0 && remaining <= Number(alertAt)) {
        await this.prisma.prepaidBlock.updateMany({
          where: { id: { in: unfiredBlocksForPos.map((b) => b.id) } },
          data: { alertFired: true },
        });
        this.realtime.emitTo('pos', 'session.prepaid_alert', {
          sessionId: session.id,
          resourceName: session.resource.name,
          remainingMinutes: Math.max(0, remaining),
        });
      }

      // 2. Customer SMS / WhatsApp alert
      const customer = session.order?.customer;
      if (customer && customer.phone && remaining <= Number(smsAlertAt)) {
        const alertKey = `${session.id}-${prepaidMinutes}`;
        if (!this.smsAlertedPrepaidKeys.has(alertKey)) {
          this.smsAlertedPrepaidKeys.add(alertKey);

          const remainingMinutesText = String(Math.max(0, remaining));
          const messageBody = `Hi ${customer.name}! Your prepaid session on ${session.resource.name} at Goblins Yard has only ${remainingMinutesText} minutes remaining. Please visit the counter to extend.`;

          const accountSid = (await this.settings.get('twilio.accountSid')) as string;
          const authToken = (await this.settings.get('twilio.authToken')) as string;
          const fromNumber = (await this.settings.get('twilio.from')) as string;
          const twilioConfigured = !!(accountSid && authToken && fromNumber);

          const toPhone = customer.phone.trim();
          const formattedTo = toPhone.startsWith('+') ? toPhone : (toPhone.startsWith('0') ? '+2' + toPhone : '+' + toPhone);

          if (twilioConfigured) {
            try {
              const url = `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`;
              const auth = Buffer.from(`${accountSid}:${authToken}`).toString('base64');
              const isWhatsapp = fromNumber.startsWith('whatsapp:');
              const fromField = isWhatsapp ? fromNumber : fromNumber;
              const toField = isWhatsapp ? `whatsapp:${formattedTo}` : formattedTo;

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

              if (!response.ok) {
                const resText = await response.text();
                console.error(`Prepaid expiry SMS Twilio failed: ${resText}`);
              }
            } catch (err: any) {
              console.error(`Prepaid expiry SMS network failed: ${err.message}`);
            }
          } else {
            console.log(`[MOCK SMS] Prepaid expiry alert sent to ${formattedTo}: ${messageBody}`);
          }
        }
      }
    }
  }
}
