import {
  BadRequestException, ConflictException, Injectable, NotFoundException, ServiceUnavailableException,
} from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { Prisma, ReservationStatus, ResourceType } from '@prisma/client';
import { randomInt } from 'node:crypto';
import { AuditService } from '../audit/audit.service';
import { NotifyService } from '../notify/notify.service';
import { PrismaService } from '../prisma/prisma.service';
import { RealtimeGateway } from '../realtime/realtime.gateway';
import { SettingsService } from '../settings/settings.service';

const ACTIVE: ReservationStatus[] = ['PENDING', 'CONFIRMED', 'SEATED'];
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O, 1/I
const TYPE_LABEL: Record<string, { en: string; ar: string }> = {
  BILLIARDS_TABLE: { en: 'Billiards table', ar: 'ترابيزة بلياردو' },
  PS_ROOM: { en: 'PlayStation room', ar: 'غرفة بلايستيشن' },
  RESTAURANT_TABLE: { en: 'Restaurant table', ar: 'ترابيزة مطعم' },
};

// ---------- Cairo time (DST-aware) ----------
function cairoOffsetMinutes(at: Date): number {
  const name = new Intl.DateTimeFormat('en-US', { timeZone: 'Africa/Cairo', timeZoneName: 'longOffset' })
    .formatToParts(at)
    .find((p) => p.type === 'timeZoneName')?.value ?? 'GMT+02:00';
  const m = /GMT([+-])(\d{2}):?(\d{2})?/.exec(name);
  if (!m) return 120;
  return (m[1] === '-' ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3] ?? 0));
}
/** Cairo wall-clock date + "HH:mm" → UTC instant. */
function cairoToUtc(date: string, hhmm: string): Date {
  const [y, mo, d] = date.split('-').map(Number);
  const [h, mi] = hhmm.split(':').map(Number);
  const naive = Date.UTC(y!, mo! - 1, d!, h!, mi!);
  let utc = naive - cairoOffsetMinutes(new Date(naive)) * 60_000;
  utc = naive - cairoOffsetMinutes(new Date(utc)) * 60_000; // settle across a DST switch
  return new Date(utc);
}
function addDays(date: string, n: number): string {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
function cairoToday(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Cairo' }).format(new Date());
}
const toMin = (hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
};

/** Egyptian mobile → 01XXXXXXXXX, or null if it isn't one. */
export function normalizeEgMobile(raw: string): string | null {
  const p = raw.replace(/[\s\-()]/g, '');
  const m = /^(?:\+20|0020|20|0)?(1[0125]\d{8})$/.exec(p);
  return m ? `0${m[1]}` : null;
}

export interface BookInput {
  type?: string;
  resourceId?: string;
  date: string; // business day, YYYY-MM-DD (Cairo)
  time: string; // HH:mm (Cairo); after-midnight times belong to the same business day
  durationMinutes: number;
  name: string;
  phone: string;
  partySize: number;
  notes?: string;
}

/**
 * Public online booking for the goblinsyard.com website (and the /book page).
 * Bookings and POS activity share one calendar: online bookings block the slot
 * on the POS, and live billiards/PS sessions show as busy online.
 */
@Injectable()
export class PublicBookingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly notify: NotifyService,
    private readonly audit: AuditService,
    private readonly realtime: RealtimeGateway,
  ) {}

  private async cfg() {
    const s = await this.settings.getAll();
    const list = (v: unknown) => String(v ?? '').split(',').map((x) => x.trim()).filter(Boolean);
    return {
      enabled: s['booking.enabled'] !== false,
      businessName: String(s['business.name'] ?? 'Goblins Yard'),
      types: list(s['booking.types']).filter((t) => t in TYPE_LABEL) as ResourceType[],
      openTime: String(s['booking.openTime'] ?? '12:00'),
      closeTime: String(s['booking.closeTime'] ?? '02:00'),
      slotMinutes: Number(s['booking.slotMinutes'] ?? 30),
      durations: list(s['booking.durations']).map(Number).filter((n) => n > 0),
      maxDaysAhead: Number(s['booking.maxDaysAhead'] ?? 14),
      minLeadMinutes: Number(s['booking.minLeadMinutes'] ?? 30),
      holdMinutes: Number(s['booking.depositHoldMinutes'] ?? 120),
      liveBufferMinutes: Number(s['booking.liveSessionBufferMinutes'] ?? 60),
      instapay: String(s['booking.instapay'] ?? ''),
      wallet: String(s['booking.wallet'] ?? ''),
      deposit: (type: string) => Number(s[`booking.depositCents.${type}`] ?? 0),
    };
  }

  /** Business-day window, e.g. 12:00 → 02:00 next morning. */
  private window(date: string, openTime: string, closeTime: string) {
    const start = cairoToUtc(date, openTime);
    const wraps = toMin(closeTime) <= toMin(openTime);
    const end = cairoToUtc(wraps ? addDays(date, 1) : date, closeTime);
    return { start, end, wraps };
  }

  /** What the website needs to render the booking form. Contains no secrets. */
  async config() {
    const c = await this.cfg();
    const resources = await this.prisma.resource.findMany({
      where: { isActive: true, type: { in: c.types } },
      select: { type: true, ratePlan: { select: { hourlyCents: true } } },
    });
    return {
      enabled: c.enabled,
      businessName: c.businessName,
      openTime: c.openTime,
      closeTime: c.closeTime,
      slotMinutes: c.slotMinutes,
      durations: c.durations.length ? c.durations : [60, 90, 120],
      maxDaysAhead: c.maxDaysAhead,
      minLeadMinutes: c.minLeadMinutes,
      depositHoldMinutes: c.holdMinutes,
      payment: { instapay: c.instapay, wallet: c.wallet },
      types: c.types.map((type) => {
        const rates = resources.filter((r) => r.type === type).map((r) => r.ratePlan?.hourlyCents ?? 0).filter(Boolean);
        return {
          type,
          label: TYPE_LABEL[type]!.en,
          labelAr: TYPE_LABEL[type]!.ar,
          count: resources.filter((r) => r.type === type).length,
          depositCents: c.deposit(type),
          fromHourlyCents: rates.length ? Math.min(...rates) : null,
        };
      }),
    };
  }

  /** Busy intervals per bookable table/room for one business day (reservations + live play). */
  async availability(date: string, type?: string) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new BadRequestException('date must be YYYY-MM-DD');
    const c = await this.cfg();
    const types = type ? c.types.filter((t) => t === type) : c.types;
    const win = this.window(date, c.openTime, c.closeTime);
    const resources = await this.prisma.resource.findMany({
      where: { isActive: true, type: { in: types } },
      select: { id: true, name: true, nameAr: true, type: true, capacity: true, ratePlan: { select: { hourlyCents: true } } },
      orderBy: { name: 'asc' },
    });
    const ids = resources.map((r) => r.id);
    const [reservations, live] = await Promise.all([
      this.prisma.reservation.findMany({
        where: { resourceId: { in: ids }, status: { in: ACTIVE }, startAt: { lt: win.end }, endAt: { gt: win.start } },
        select: { resourceId: true, startAt: true, endAt: true },
      }),
      this.prisma.session.findMany({
        where: { resourceId: { in: ids }, status: { in: ['RUNNING', 'PAUSED'] } },
        select: { resourceId: true, startedAt: true, prepaidBlocks: { select: { minutes: true } } },
      }),
    ]);
    const now = Date.now();
    return {
      date,
      window: { start: win.start, end: win.end },
      resources: resources.map((r) => ({
        id: r.id,
        name: r.name,
        nameAr: r.nameAr,
        type: r.type,
        capacity: r.capacity,
        hourlyCents: r.ratePlan?.hourlyCents ?? null,
        busy: [
          ...reservations.filter((b) => b.resourceId === r.id).map((b) => ({ startAt: b.startAt, endAt: b.endAt })),
          ...live.filter((s) => s.resourceId === r.id).map((s) => {
            const prepaidEnd = s.startedAt.getTime() + s.prepaidBlocks.reduce((a, p) => a + p.minutes, 0) * 60_000;
            return { startAt: s.startedAt, endAt: new Date(Math.max(now + c.liveBufferMinutes * 60_000, prepaidEnd)) };
          }),
        ],
      })),
    };
  }

  private async uniqueCode(tx: Prisma.TransactionClient): Promise<string> {
    for (;;) {
      const code = Array.from({ length: 6 }, () => CODE_ALPHABET[randomInt(CODE_ALPHABET.length)]).join('');
      if (!(await tx.reservation.findUnique({ where: { bookingCode: code } }))) return code;
    }
  }

  async book(input: BookInput) {
    const c = await this.cfg();
    if (!c.enabled) throw new ServiceUnavailableException('Online booking is closed right now');
    const phone = normalizeEgMobile(input.phone);
    if (!phone) throw new BadRequestException('Please enter a valid Egyptian mobile number (01XXXXXXXXX)');
    const name = input.name.trim();
    if (name.length < 2) throw new BadRequestException('Please enter your name');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date) || !/^\d{2}:\d{2}$/.test(input.time)) {
      throw new BadRequestException('Invalid date or time');
    }
    const durations = c.durations.length ? c.durations : [60, 90, 120];
    if (!durations.includes(input.durationMinutes)) throw new BadRequestException('Invalid duration');
    if (input.partySize < 1 || input.partySize > 20) throw new BadRequestException('Invalid party size');

    // business-day window and the actual start (after-midnight times are the next calendar day)
    const win = this.window(input.date, c.openTime, c.closeTime);
    const t = toMin(input.time);
    const afterMidnight = win.wraps && t < toMin(c.closeTime);
    if (!win.wraps && (t < toMin(c.openTime) || t >= toMin(c.closeTime))) throw new BadRequestException('We are closed at that time');
    if (win.wraps && !afterMidnight && t < toMin(c.openTime)) throw new BadRequestException('We are closed at that time');
    const startAt = cairoToUtc(afterMidnight ? addDays(input.date, 1) : input.date, input.time);
    const endAt = new Date(startAt.getTime() + input.durationMinutes * 60_000);
    if (endAt > win.end) throw new BadRequestException('That booking would run past closing time');
    if (startAt.getTime() < Date.now() + c.minLeadMinutes * 60_000) {
      throw new BadRequestException(`Please book at least ${c.minLeadMinutes} minutes ahead`);
    }
    if (input.date > addDays(cairoToday(), c.maxDaysAhead)) {
      throw new BadRequestException(`Bookings open ${c.maxDaysAhead} days ahead`);
    }

    // simple abuse guard: at most 2 upcoming online bookings per phone
    const mine = await this.prisma.reservation.count({
      where: { source: 'ONLINE', guestPhone: phone, status: { in: ACTIVE }, endAt: { gt: new Date() } },
    });
    if (mine >= 2) throw new BadRequestException('You already have 2 upcoming bookings — call us to book more');

    // which tables/rooms qualify
    let candidates = await this.prisma.resource.findMany({
      where: {
        isActive: true,
        type: { in: c.types },
        ...(input.resourceId ? { id: input.resourceId } : input.type ? { type: input.type as ResourceType } : {}),
      },
      orderBy: { name: 'asc' },
    });
    if (input.type && !c.types.includes(input.type as ResourceType)) candidates = [];
    if (!candidates.length) throw new BadRequestException('Nothing bookable matches that choice');
    const type = candidates[0]!.type;
    const depositCents = c.deposit(type);

    // a live session counts as busy until now + buffer (or its prepaid end)
    const liveBusy = new Set<string>();
    if (startAt.getTime() < Date.now() + c.liveBufferMinutes * 60_000) {
      const live = await this.prisma.session.findMany({
        where: { resourceId: { in: candidates.map((r) => r.id) }, status: { in: ['RUNNING', 'PAUSED'] } },
        select: { resourceId: true },
      });
      for (const s of live) liveBusy.add(s.resourceId);
    }
    const customer = await this.prisma.customer.findFirst({
      where: { OR: [{ phone }, { phone: `+2${phone}` }, { phone: phone.slice(1) }] },
    });

    const reservation = await this.prisma.$transaction(async (tx) => {
      for (const r of candidates) {
        if (liveBusy.has(r.id)) continue;
        await tx.$queryRaw`SELECT id FROM "Resource" WHERE id = ${r.id} FOR UPDATE`;
        const clash = await tx.reservation.findFirst({
          where: { resourceId: r.id, status: { in: ACTIVE }, startAt: { lt: endAt }, endAt: { gt: startAt } },
        });
        if (clash) continue;
        return tx.reservation.create({
          data: {
            branchId: r.branchId,
            resourceId: r.id,
            customerId: customer?.id,
            guestName: name.slice(0, 80),
            guestPhone: phone,
            partySize: input.partySize,
            startAt,
            endAt,
            status: depositCents > 0 ? 'PENDING' : 'CONFIRMED',
            source: 'ONLINE',
            bookingCode: await this.uniqueCode(tx),
            depositCents,
            depositStatus: depositCents > 0 ? 'AWAITING' : 'NONE',
            notes: input.notes?.trim().slice(0, 300) || null,
          },
          include: { resource: true },
        });
      }
      return null;
    });
    if (!reservation) throw new ConflictException('That time was just taken — please pick another slot');

    await this.audit.log({
      action: 'reservation.online_booking', entity: 'Reservation', entityId: reservation.id,
      detail: { code: reservation.bookingCode, resource: reservation.resource.name, startAt: startAt.toISOString() },
    });
    this.realtime.emitTo('floor', 'reservation.created', { id: reservation.id });
    this.realtime.emitTo('floor', 'floor.refresh', {});

    const when = this.fmtWhen(startAt);
    const payLine = depositCents > 0
      ? `Deposit ${(depositCents / 100).toFixed(0)} EGP — send it within ${c.holdMinutes} min` +
        `${c.instapay ? ` via InstaPay to ${c.instapay}` : ''}${c.wallet ? `${c.instapay ? ' or' : ''} to wallet ${c.wallet}` : ''}` +
        ` with code ${reservation.bookingCode} in the note, or the booking is released.`
      : 'You are confirmed — see you then!';
    void this.notify.sendTo([phone], `${c.businessName}: booking ${reservation.bookingCode} — ${reservation.resource.name}, ${when}, ${input.durationMinutes} min.\n${payLine}`);
    void this.notify.sendToOwner(`New online booking ${reservation.bookingCode}: ${name} (${phone}) — ${reservation.resource.name}, ${when}, ${input.durationMinutes} min${depositCents ? `, deposit ${(depositCents / 100).toFixed(0)} EGP awaiting` : ''}.`);

    return this.publicView(reservation, c.holdMinutes);
  }

  async status(code: string) {
    const c = await this.cfg();
    const r = await this.prisma.reservation.findUnique({
      where: { bookingCode: code.trim().toUpperCase() },
      include: { resource: true },
    });
    if (!r) throw new NotFoundException('Booking not found');
    return this.publicView(r, c.holdMinutes);
  }

  private publicView(
    r: { bookingCode: string | null; status: ReservationStatus; depositStatus: string; depositCents: number; startAt: Date; endAt: Date; partySize: number; createdAt: Date; resource: { name: string; nameAr: string | null; type: ResourceType } },
    holdMinutes: number,
  ) {
    return {
      code: r.bookingCode,
      status: r.status,
      depositStatus: r.depositStatus,
      depositCents: r.depositCents,
      payBy: r.depositStatus === 'AWAITING' ? new Date(r.createdAt.getTime() + holdMinutes * 60_000) : null,
      startAt: r.startAt,
      endAt: r.endAt,
      partySize: r.partySize,
      resource: { name: r.resource.name, nameAr: r.resource.nameAr, type: r.resource.type },
    };
  }

  private fmtWhen(d: Date) {
    return d.toLocaleString('en-GB', {
      timeZone: 'Africa/Cairo', weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
    });
  }

  /** Staff confirm the InstaPay / wallet transfer arrived. Posts Dr bank / Cr customer deposits. */
  async confirmDeposit(id: string, reference: string, userId: string) {
    const r = await this.prisma.reservation.findUniqueOrThrow({ where: { id }, include: { resource: true } });
    if (r.depositStatus !== 'AWAITING') throw new BadRequestException('No deposit is awaited for this booking');
    if (!['PENDING', 'CONFIRMED'].includes(r.status)) throw new BadRequestException(`Booking is ${r.status.toLowerCase()}`);
    const updated = await this.prisma.$transaction(async (tx) => {
      const bank = await tx.account.findUnique({ where: { code: '1210' } });
      const deposits = await tx.account.findUnique({ where: { code: '2400' } });
      if (bank && deposits && r.depositCents > 0) {
        await tx.journalEntry.create({
          data: {
            description: `Booking deposit ${r.bookingCode ?? r.id} — ${r.guestName ?? ''}`.trim(),
            reference: `Deposit #${r.id}`,
            lines: {
              create: [
                { accountId: bank.id, debitCents: r.depositCents, creditCents: 0 },
                { accountId: deposits.id, debitCents: 0, creditCents: r.depositCents },
              ],
            },
          },
        });
      }
      return tx.reservation.update({
        where: { id },
        data: { depositStatus: 'RECEIVED', depositReference: reference.trim().slice(0, 80) || null, status: 'CONFIRMED' },
      });
    });
    await this.audit.log({ userId, action: 'reservation.deposit_received', entity: 'Reservation', entityId: id, detail: { reference, depositCents: r.depositCents } });
    this.realtime.emitTo('floor', 'reservation.updated', { id, status: 'CONFIRMED' });
    if (r.guestPhone) {
      const c = await this.cfg();
      void this.notify.sendTo([r.guestPhone], `${c.businessName}: deposit received — booking ${r.bookingCode} is confirmed for ${this.fmtWhen(r.startAt)} (${r.resource.name}). See you!`);
    }
    return updated;
  }

  /** Release online bookings whose deposit didn't arrive in time. */
  @Cron(CronExpression.EVERY_5_MINUTES)
  async expireUnpaid() {
    const c = await this.cfg();
    const cutoff = new Date(Date.now() - c.holdMinutes * 60_000);
    const stale = await this.prisma.reservation.findMany({
      where: { source: 'ONLINE', status: 'PENDING', depositStatus: 'AWAITING', createdAt: { lt: cutoff } },
    });
    for (const r of stale) {
      await this.prisma.reservation.update({ where: { id: r.id }, data: { status: 'CANCELLED' } });
      await this.audit.log({ action: 'reservation.deposit_expired', entity: 'Reservation', entityId: r.id, detail: { code: r.bookingCode } });
      this.realtime.emitTo('floor', 'reservation.updated', { id: r.id, status: 'CANCELLED' });
      if (r.guestPhone) {
        void this.notify.sendTo([r.guestPhone], `${c.businessName}: booking ${r.bookingCode} was released because the deposit didn't arrive in time. You're welcome to book again.`);
      }
    }
    return { expired: stale.length };
  }
}
