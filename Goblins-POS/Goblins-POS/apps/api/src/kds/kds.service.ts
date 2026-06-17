import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma, TicketStatus } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import { RealtimeGateway } from '../realtime/realtime.gateway';

const TICKET_INCLUDE = {
  items: { include: { orderItem: { include: { modifiers: true } } } },
  order: { select: { number: true, type: true, resource: { select: { name: true } }, notes: true } },
  station: { select: { id: true, name: true, usePrinter: true, printer: { select: { connection: true, address: true } } } },
} satisfies Prisma.TicketInclude;

@Injectable()
export class KdsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly realtime: RealtimeGateway,
  ) {}

  /**
   * Send pending order items to their stations. Groups by (station, course):
   * course 1 fires immediately (NEW), later courses are HELD until fired.
   * Returns the created tickets; emits WS events + print jobs.
   */
  async send(orderId: string, userId: string) {
    const tickets = await this.prisma.$transaction(async (tx) => {
      const order = await tx.order.findUniqueOrThrow({
        where: { id: orderId },
        include: {
          items: {
            where: { status: 'PENDING' },
            include: { item: { select: { stationId: true, categoryId: true, category: { select: { stationId: true } } } } },
          },
        },
      });
      if (order.status !== 'OPEN') throw new BadRequestException('Order not open');
      const sendable = order.items.filter((i) => (i.item?.stationId || i.item?.category?.stationId) && !i.isTimeCharge);
      if (!sendable.length) {
        // surface misconfiguration loudly: pending food that routes nowhere never reaches a monitor
        const pendingFood = order.items.filter((i) => !i.isTimeCharge);
        if (pendingFood.length) {
          throw new BadRequestException(
            'These items are not routed to any kitchen/bar station — set a station on each menu item (Back office → Menu)',
          );
        }
        return [];
      }

      // group by station + course — item stationId takes priority, then category default
      const groups = new Map<string, typeof sendable>();
      for (const item of sendable) {
        const effectiveStationId = item.item!.stationId ?? item.item!.category?.stationId;
        const key = `${effectiveStationId}|${item.course}`;
        const arr = groups.get(key) ?? [];
        arr.push(item);
        groups.set(key, arr);
      }

      const created = [];
      for (const [key, items] of groups) {
        const pipeIdx = key.indexOf('|');
        const stationId = key.slice(0, pipeIdx);
        const courseStr = key.slice(pipeIdx + 1);
        const course = Number(courseStr);
        const ticket = await tx.ticket.create({
          data: {
            orderId,
            stationId: stationId!,
            course,
            status: course === 1 ? 'NEW' : 'HELD',
            items: {
              create: items.map((i) => ({ orderItemId: i.id, quantity: i.quantity })),
            },
          },
          include: TICKET_INCLUDE,
        });
        created.push(ticket);
      }
      await tx.orderItem.updateMany({
        where: { id: { in: sendable.map((i) => i.id) } },
        data: { status: 'SENT' },
      });
      await this.audit.log(
        { userId, action: 'kds.send', entity: 'Order', entityId: orderId,
          detail: { tickets: created.length } },
        tx,
      );
      return created;
    });

    for (const ticket of tickets) {
      if (ticket.status === 'NEW') this.announce(ticket);
    }
    return tickets;
  }

  /** Fire held courses ("fire mains"). */
  async fireCourse(orderId: string, course: number, userId: string) {
    const tickets = await this.prisma.ticket.findMany({
      where: { orderId, course, status: 'HELD' },
      select: { id: true },
    });
    if (!tickets.length) throw new BadRequestException('No held tickets for that course');
    await this.prisma.ticket.updateMany({
      where: { id: { in: tickets.map((t) => t.id) } },
      data: { status: 'NEW', firedAt: new Date() },
    });
    await this.audit.log({
      userId, action: 'kds.fire_course', entity: 'Order', entityId: orderId, detail: { course },
    });
    const fired = await this.prisma.ticket.findMany({
      where: { id: { in: tickets.map((t) => t.id) } },
      include: TICKET_INCLUDE,
    });
    for (const t of fired) this.announce(t);
    return fired;
  }

  /** Station screen: active tickets, oldest first. */
  async stationTickets(stationId: string) {
    return this.prisma.ticket.findMany({
      where: { stationId, status: { in: ['NEW', 'IN_PROGRESS', 'READY'] } },
      include: TICKET_INCLUDE,
      orderBy: { firedAt: 'asc' },
    });
  }

  /** Expo: readiness across all stations for open orders. */
  async expo() {
    return this.prisma.ticket.findMany({
      where: { status: { in: ['NEW', 'IN_PROGRESS', 'READY'] } },
      include: TICKET_INCLUDE,
      orderBy: { firedAt: 'asc' },
    });
  }

  /** "All day" aggregate: total outstanding quantity per item for a station. */
  async allDay(stationId: string) {
    const tickets = await this.prisma.ticket.findMany({
      where: { stationId, status: { in: ['NEW', 'IN_PROGRESS'] } },
      include: { items: { include: { orderItem: { select: { description: true } } } } },
    });
    const agg = new Map<string, number>();
    for (const t of tickets) {
      for (const ti of t.items) {
        const key = ti.orderItem.description;
        agg.set(key, (agg.get(key) ?? 0) + Number(ti.quantity));
      }
    }
    return [...agg.entries()]
      .map(([description, quantity]) => ({ description, quantity }))
      .sort((a, b) => b.quantity - a.quantity);
  }

  /** Bump a ticket through its lifecycle: NEW → IN_PROGRESS → READY → SERVED. */
  async bump(ticketId: string, _userId: string) {
    const ticket = await this.prisma.ticket.findUniqueOrThrow({
      where: { id: ticketId },
      include: { items: true },
    });
    const next: Partial<Record<TicketStatus, { status: TicketStatus; stamp: 'startedAt' | 'readyAt' | 'servedAt' }>> = {
      NEW: { status: 'IN_PROGRESS', stamp: 'startedAt' },
      IN_PROGRESS: { status: 'READY', stamp: 'readyAt' },
      READY: { status: 'SERVED', stamp: 'servedAt' },
    };
    const step = next[ticket.status];
    if (!step) throw new BadRequestException(`Cannot bump a ${ticket.status} ticket`);
    const updated = await this.prisma.ticket.update({
      where: { id: ticketId },
      data: { status: step.status, [step.stamp]: new Date() },
      include: TICKET_INCLUDE,
    });
    // mirror onto order items so waiters see readiness
    const kdsStatus =
      step.status === 'IN_PROGRESS' ? 'IN_PROGRESS' : step.status === 'READY' ? 'READY' : 'SERVED';
    await this.prisma.orderItem.updateMany({
      where: { id: { in: ticket.items.map((i) => i.orderItemId) } },
      data: { kdsStatus },
    });
    this.realtime.emitTo(`kds:${updated.stationId}`, 'ticket.updated', updated);
    this.realtime.emitTo('expo', 'ticket.updated', updated);
    this.realtime.emitTo('pos', 'order.updated', { orderId: updated.orderId });
    return updated;
  }

  /** Recall the last SERVED ticket back to READY. */
  async recall(ticketId: string, userId: string) {
    const ticket = await this.prisma.ticket.findUniqueOrThrow({ where: { id: ticketId } });
    if (ticket.status !== 'SERVED' && ticket.status !== 'READY') {
      throw new BadRequestException('Only served/ready tickets can be recalled');
    }
    const updated = await this.prisma.ticket.update({
      where: { id: ticketId },
      data: { status: 'IN_PROGRESS', recalled: true, servedAt: null, readyAt: null },
      include: TICKET_INCLUDE,
    });
    await this.audit.log({ userId, action: 'kds.recall', entity: 'Ticket', entityId: ticketId });
    this.realtime.emitTo(`kds:${updated.stationId}`, 'ticket.updated', updated);
    this.realtime.emitTo('expo', 'ticket.updated', updated);
    return updated;
  }

  async stations() {
    return this.prisma.station.findMany({
      where: { isActive: true },
      orderBy: { sortOrder: 'asc' },
      include: { printer: true },
    });
  }

  /** Re-emit a ticket to its station's printer/screen. */
  async reprint(ticketId: string) {
    const ticket = await this.prisma.ticket.findUniqueOrThrow({
      where: { id: ticketId },
      include: TICKET_INCLUDE,
    });
    await this.prisma.ticket.update({ where: { id: ticketId }, data: { printedAt: new Date() } });
    this.announce(ticket, true);
    return ticket;
  }

  /** Emit new-ticket events to the KDS room and the print room. */
  private announce(ticket: Prisma.TicketGetPayload<{ include: typeof TICKET_INCLUDE }>, reprint = false) {
    this.realtime.emitTo(`kds:${ticket.stationId}`, 'ticket.new', { ...ticket, reprint });
    this.realtime.emitTo('expo', 'ticket.new', ticket);
    this.realtime.emitTo('print', 'ticket.print', {
      ticketId: ticket.id,
      stationId: ticket.stationId,
      stationName: ticket.station.name,
      printerAddress:
        ticket.station.usePrinter && ticket.station.printer?.connection === 'NETWORK'
          ? ticket.station.printer.address
          : undefined,
      orderNumber: ticket.order.number,
      resourceName: ticket.order.resource?.name ?? ticket.order.type,
      course: ticket.course,
      reprint,
      lines: ticket.items.map((ti) => ({
        quantity: Number(ti.quantity),
        description: ti.orderItem.description,
        modifiers: ti.orderItem.modifiers.map((m) => m.name),
        notes: ti.orderItem.notes,
      })),
    });
  }
}
