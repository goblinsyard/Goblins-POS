import { BadRequestException, ConflictException, Injectable } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { ReservationStatus } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import { RealtimeGateway } from '../realtime/realtime.gateway';
import { SettingsService } from '../settings/settings.service';

const ACTIVE: ReservationStatus[] = ['PENDING', 'CONFIRMED', 'SEATED'];

@Injectable()
export class ReservationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly realtime: RealtimeGateway,
    private readonly settings: SettingsService,
  ) {}

  /** Timeline for the calendar view: all reservations per resource for a day range. */
  async timeline(from: Date, to: Date) {
    return this.prisma.reservation.findMany({
      where: { startAt: { lt: to }, endAt: { gt: from }, status: { in: [...ACTIVE, 'COMPLETED', 'NO_SHOW'] } },
      include: {
        resource: { select: { id: true, name: true, type: true } },
        customer: { select: { id: true, name: true, phone: true, visitCount: true } },
      },
      orderBy: { startAt: 'asc' },
    });
  }

  /** Overlap check: any active reservation OR running session on the resource. */
  private async findConflict(resourceId: string, startAt: Date, endAt: Date, excludeId?: string) {
    return this.prisma.reservation.findFirst({
      where: {
        resourceId,
        id: excludeId ? { not: excludeId } : undefined,
        status: { in: ACTIVE },
        startAt: { lt: endAt },
        endAt: { gt: startAt },
      },
    });
  }

  async create(params: {
    branchId: string;
    resourceId: string;
    startAt: string;
    endAt: string;
    partySize: number;
    customerId?: string;
    guestName?: string;
    guestPhone?: string;
    depositCents?: number;
    notes?: string;
    userId?: string;
  }) {
    const startAt = new Date(params.startAt);
    const endAt = new Date(params.endAt);
    if (endAt <= startAt) throw new BadRequestException('End must be after start');
    if (startAt < new Date()) throw new BadRequestException('Cannot book in the past');
    if (!params.customerId && !params.guestName) {
      throw new BadRequestException('Customer or guest name required');
    }

    const reservation = await this.prisma.$transaction(async (tx) => {
      // Row-lock the resource to prevent race conditions on concurrent reservation checks
      await tx.$executeRawUnsafe(
        `SELECT id FROM "Resource" WHERE id = $1 FOR UPDATE`,
        params.resourceId,
      );

      const conflict = await tx.reservation.findFirst({
        where: {
          resourceId: params.resourceId,
          status: { in: ACTIVE },
          startAt: { lt: endAt },
          endAt: { gt: startAt },
        },
      });
      if (conflict) {
        throw new ConflictException('Time slot conflicts with an existing reservation');
      }

      return tx.reservation.create({
        data: {
          branchId: params.branchId,
          resourceId: params.resourceId,
          customerId: params.customerId,
          guestName: params.guestName,
          guestPhone: params.guestPhone,
          partySize: params.partySize,
          startAt,
          endAt,
          depositCents: params.depositCents ?? 0,
          notes: params.notes,
          status: 'CONFIRMED',
          createdById: params.userId,
        },
        include: { resource: true, customer: true },
      });
    });

    await this.audit.log({
      userId: params.userId, action: 'reservation.create', entity: 'Reservation', entityId: reservation.id,
      detail: { resourceId: params.resourceId, startAt: params.startAt },
    });
    this.realtime.emitTo('floor', 'reservation.created', { id: reservation.id });
    return reservation;
  }

  async setStatus(id: string, status: ReservationStatus, userId?: string) {
    const reservation = await this.prisma.reservation.findUniqueOrThrow({ where: { id } });
    const allowed: Record<ReservationStatus, ReservationStatus[]> = {
      PENDING: ['CONFIRMED', 'CANCELLED'],
      CONFIRMED: ['SEATED', 'NO_SHOW', 'CANCELLED'],
      SEATED: ['COMPLETED'],
      COMPLETED: [],
      NO_SHOW: [],
      CANCELLED: [],
    };
    if (!allowed[reservation.status].includes(status)) {
      throw new BadRequestException(`Cannot go from ${reservation.status} to ${status}`);
    }
    const updated = await this.prisma.reservation.update({
      where: { id },
      data: {
        status,
        seatedAt: status === 'SEATED' ? new Date() : undefined,
      },
    });
    if (status === 'SEATED') {
      await this.prisma.resource.update({
        where: { id: reservation.resourceId },
        data: { status: 'OCCUPIED' },
      });
    }
    await this.audit.log({
      userId, action: `reservation.${status.toLowerCase()}`, entity: 'Reservation', entityId: id,
    });
    this.realtime.emitTo('floor', 'reservation.updated', { id, status });
    return updated;
  }

  /** Mark resources RESERVED shortly before, release no-shows after grace. */
  @Cron(CronExpression.EVERY_MINUTE)
  async sweep() {
    const grace = Number(await this.settings.get('reservation.noShowGraceMinutes'));
    const now = new Date();

    // 1. flag upcoming (next 30 min) reservations on the floor plan
    const upcoming = await this.prisma.reservation.findMany({
      where: {
        status: 'CONFIRMED',
        startAt: { lte: new Date(now.getTime() + 30 * 60_000), gt: now },
      },
      select: { resourceId: true },
    });
    for (const r of upcoming) {
      await this.prisma.resource.updateMany({
        where: { id: r.resourceId, status: 'FREE' },
        data: { status: 'RESERVED' },
      });
    }

    // 2. auto no-show release after grace period
    const overdue = await this.prisma.reservation.findMany({
      where: { status: 'CONFIRMED', startAt: { lt: new Date(now.getTime() - grace * 60_000) } },
    });
    for (const r of overdue) {
      await this.prisma.reservation.update({
        where: { id: r.id },
        data: { status: 'NO_SHOW' },
      });
      await this.prisma.resource.updateMany({
        where: { id: r.resourceId, status: 'RESERVED' },
        data: { status: 'FREE' },
      });
      await this.audit.log({
        action: 'reservation.no_show_auto', entity: 'Reservation', entityId: r.id,
        detail: { graceMinutes: grace },
      });
      this.realtime.emitTo('floor', 'reservation.updated', { id: r.id, status: 'NO_SHOW' });
    }
    if (upcoming.length || overdue.length) this.realtime.emitTo('floor', 'floor.refresh', {});
  }

  /** Public booking API for goblinsyard.com (phase-2 web embed). Rate-limited + no auth. */
  async publicAvailability(date: string, type?: string) {
    const dayStart = new Date(`${date}T00:00:00+02:00`);
    const dayEnd = new Date(dayStart.getTime() + 86400_000);
    const resources = await this.prisma.resource.findMany({
      where: { isActive: true, ...(type ? { type: type as never } : {}) },
      select: { id: true, name: true, type: true, capacity: true },
    });
    const reservations = await this.prisma.reservation.findMany({
      where: { startAt: { lt: dayEnd }, endAt: { gt: dayStart }, status: { in: ACTIVE } },
      select: { resourceId: true, startAt: true, endAt: true },
    });
    return resources.map((r) => ({
      ...r,
      busy: reservations
        .filter((b) => b.resourceId === r.id)
        .map((b) => ({ startAt: b.startAt, endAt: b.endAt })),
    }));
  }
}
