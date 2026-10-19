import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { SettingsService } from '../settings/settings.service';

const D = Prisma.Decimal;
const CAIRO = 'Africa/Cairo';

function cairoHour(d: Date): number {
  return Number(
    new Intl.DateTimeFormat('en-US', { timeZone: CAIRO, hour: 'numeric', hour12: false }).format(d),
  ) % 24;
}
function cairoDow(d: Date): number {
  const wd = new Intl.DateTimeFormat('en-US', { timeZone: CAIRO, weekday: 'short' }).format(d);
  return ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(wd);
}
function cairoDay(d: Date): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: CAIRO }).format(d); // YYYY-MM-DD
}

@Injectable()
export class ReportsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
  ) {}

  /** Owner dashboard: today at a glance. */
  async dashboard(branchId: string) {
    const today = new Date();
    today.setHours(today.getHours() - cairoHour(today), 0, 0, 0); // midnight Cairo approx
    const [orders, occupied, total, clockedIn, expenses] = await Promise.all([
      this.prisma.order.findMany({
        where: { branchId, status: 'PAID', closedAt: { gte: today } },
        include: { items: { where: { status: { not: 'VOIDED' } } } },
      }),
      this.prisma.resource.count({ where: { branchId, status: 'OCCUPIED' } }),
      this.prisma.resource.count({ where: { branchId, isActive: true } }),
      this.prisma.timeClockEntry.count({ where: { clockOut: null } }),
      this.prisma.expense.aggregate({
        where: { branchId, expenseDate: { gte: today } },
        _sum: { amountCents: true },
      }),
    ]);

    const byDept: Record<string, number> = {};
    const itemCounts = new Map<string, { qty: number; revenue: number }>();
    for (const o of orders) {
      const dept = o.type === 'BILLIARDS' ? 'Billiards' : o.type === 'PS_ROOM' ? 'PlayStation' : 'Restaurant';
      byDept[dept] = (byDept[dept] ?? 0) + o.totalCents;
      for (const i of o.items) {
        const row = itemCounts.get(i.description) ?? { qty: 0, revenue: 0 };
        row.qty += Number(i.quantity);
        row.revenue += i.lineCents;
        itemCounts.set(i.description, row);
      }
    }
    const deductions = await this.prisma.stockMovement.findMany({
      where: { kind: 'SALE_DEDUCTION', createdAt: { gte: today } },
      select: { quantity: true, unitCostCents: true },
    });
    const cogs = deductions.reduce((a, m) => a + new D(m.quantity).mul(new D(m.unitCostCents)).toNumber(), 0);
    const revenue = orders.reduce((a, o) => a + o.subtotalCents, 0);

    return {
      revenueCents: orders.reduce((a, o) => a + o.totalCents, 0),
      revenueByDepartment: byDept,
      orderCount: orders.length,
      occupancy: { occupied, total },
      laborClockedIn: clockedIn,
      foodCostPctBps: revenue > 0 ? Math.round((cogs / revenue) * 10_000) : 0,
      expensesTodayCents: expenses._sum.amountCents ?? 0,
      topSellers: [...itemCounts.entries()]
        .map(([name, v]) => ({ name, ...v }))
        .sort((a, b) => b.qty - a.qty)
        .slice(0, 8),
    };
  }

  /** Sales report with grouping. */
  async sales(branchId: string, from: Date, to: Date, groupBy: 'hour' | 'day' | 'department' | 'category' | 'item' | 'method' | 'staff' | 'channel') {
    const orders = await this.prisma.order.findMany({
      where: { branchId, status: 'PAID', closedAt: { gte: from, lte: to } },
      include: {
        items: { where: { status: { not: 'VOIDED' } }, include: { item: { include: { category: true } } } },
        payments: { include: { method: true } },
        openedBy: { select: { name: true } },
      },
    });
    const agg = new Map<string, { orders: number; revenueCents: number; quantity: number; commissionCents: number }>();
    const add = (key: string, revenue: number, qty = 0, countOrder = true, commission = 0) => {
      const row = agg.get(key) ?? { orders: 0, revenueCents: 0, quantity: 0, commissionCents: 0 };
      if (countOrder) row.orders++;
      row.revenueCents += revenue;
      row.quantity += qty;
      row.commissionCents += commission;
      agg.set(key, row);
    };
    const CHANNEL_LABEL: Record<string, string> = {
      IN_HOUSE: 'In house', PHONE: 'Phone delivery', TALABAT: 'Talabat', ELMENUS: 'Elmenus', RABBIT: 'Rabbit',
    };

    for (const o of orders) {
      const closed = o.closedAt!;
      switch (groupBy) {
        case 'hour': add(`${String(cairoHour(closed)).padStart(2, '0')}:00`, o.totalCents); break;
        case 'day': add(cairoDay(closed), o.totalCents); break;
        case 'department':
          add(o.type === 'BILLIARDS' ? 'Billiards' : o.type === 'PS_ROOM' ? 'PlayStation' : 'Restaurant', o.totalCents);
          break;
        case 'staff': add(o.openedBy.name, o.totalCents); break;
        case 'channel': add(CHANNEL_LABEL[o.channel] ?? o.channel, o.totalCents, 0, true, o.commissionCents); break;
        case 'method':
          for (const p of o.payments) add(p.method.name, p.amountCents, 0, false);
          break;
        case 'category':
          for (const i of o.items) add(i.item?.category.name ?? 'Time/Other', i.lineCents, Number(i.quantity), false);
          break;
        case 'item':
          for (const i of o.items) add(i.description, i.lineCents, Number(i.quantity), false);
          break;
      }
    }
    return [...agg.entries()]
      .map(([key, v]) => ({ key, ...v }))
      .sort((a, b) => (groupBy === 'hour' || groupBy === 'day' ? a.key.localeCompare(b.key) : b.revenueCents - a.revenueCents));
  }

  /**
   * Billiards / PlayStation utilization. Every active table/room is listed (idle
   * ones show 0%), minutes are split exactly at Cairo hour boundaries, occupancy
   * is measured against `business.openHoursPerDay`, and food & drink sold on a
   * session's bill is reported next to the time revenue.
   */
  async utilization(from: Date, to: Date, type?: 'BILLIARDS_TABLE' | 'PS_ROOM') {
    const types: ('BILLIARDS_TABLE' | 'PS_ROOM')[] = type ? [type] : ['BILLIARDS_TABLE', 'PS_ROOM'];
    const openHours = Math.min(24, Math.max(1, Number((await this.settings.getAll())['business.openHoursPerDay'] ?? 12)));
    const resources = await this.prisma.resource.findMany({
      where: { isActive: true, type: { in: types } },
      select: { id: true, name: true, type: true },
      orderBy: { name: 'asc' },
    });
    const ids = resources.map((r) => r.id);
    const sessions = await this.prisma.session.findMany({
      where: { status: 'STOPPED', resourceId: { in: ids }, startedAt: { gte: from, lt: to } },
      include: {
        segments: true,
        order: { select: { status: true, items: { select: { lineCents: true, status: true, isTimeCharge: true } } } },
      },
    });

    const days = Math.max(1, (to.getTime() - from.getTime()) / 86_400_000);
    const availableHours = days * openHours;
    const rows = new Map(
      resources.map((r) => [r.id, { resourceId: r.id, name: r.name, type: r.type, sessions: 0, minutes: 0, revenueCents: 0, fnbRevenueCents: 0 }]),
    );
    const heat = new Map<string, number>(); // "dow-hour" -> minutes
    const HOUR = 3_600_000;

    for (const s of sessions) {
      const row = rows.get(s.resourceId);
      if (row) {
        row.sessions++;
        row.minutes += s.billedMinutes ?? 0;
        row.revenueCents += s.billedCents ?? 0;
        if (s.order?.status === 'PAID') {
          row.fnbRevenueCents += s.order.items
            .filter((i) => i.status !== 'VOIDED' && !i.isTimeCharge)
            .reduce((a, i) => a + i.lineCents, 0);
        }
      }
      for (const seg of s.segments) {
        if (!seg.endedAt) continue;
        const end = seg.endedAt.getTime();
        let cursor = seg.startedAt.getTime();
        // Cairo's UTC offset is a whole number of hours, so UTC hour boundaries are Cairo ones too
        while (cursor < end) {
          const next = Math.min(end, Math.floor(cursor / HOUR) * HOUR + HOUR);
          const d = new Date(cursor);
          const key = `${cairoDow(d)}-${cairoHour(d)}`;
          heat.set(key, (heat.get(key) ?? 0) + (next - cursor) / 60_000);
          cursor = next;
        }
      }
    }

    const list = [...rows.values()].map((r) => ({
      ...r,
      occupancyPctBps: Math.round((r.minutes / 60 / availableHours) * 10_000),
      revenuePerAvailableHourCents: Math.round(r.revenueCents / availableHours),
      avgSessionMinutes: r.sessions ? Math.round(r.minutes / r.sessions) : 0,
    }));
    const heatmap = [...heat.entries()].map(([key, minutes]) => {
      const [dow, hour] = key.split('-');
      return { dayOfWeek: Number(dow), hour: Number(hour), minutes: Math.round(minutes) };
    });
    const peak = heatmap.reduce<(typeof heatmap)[number] | null>((a, h) => (!a || h.minutes > a.minutes ? h : a), null);
    const totalMinutes = list.reduce((a, r) => a + r.minutes, 0);
    const totalSessions = list.reduce((a, r) => a + r.sessions, 0);
    return {
      from, to, openHoursPerDay: openHours,
      totals: {
        sessions: totalSessions,
        minutes: totalMinutes,
        revenueCents: list.reduce((a, r) => a + r.revenueCents, 0),
        fnbRevenueCents: list.reduce((a, r) => a + r.fnbRevenueCents, 0),
        occupancyPctBps: list.length ? Math.round((totalMinutes / 60 / (availableHours * list.length)) * 10_000) : 0,
        avgSessionMinutes: totalSessions ? Math.round(totalMinutes / totalSessions) : 0,
      },
      peak,
      resources: list.sort((a, b) => b.occupancyPctBps - a.occupancyPctBps),
      heatmap,
    };
  }

  /** Inventory reports: consumption, variance, waste, supplier price history. */
  async inventoryReport(kind: 'consumption' | 'variance' | 'waste' | 'prices', from: Date, to: Date) {
    if (kind === 'prices') {
      return this.prisma.supplierPriceHistory.findMany({
        where: { recordedAt: { gte: from, lte: to } },
        include: { supplier: { select: { name: true } }, ingredient: { select: { name: true } } },
        orderBy: { recordedAt: 'desc' },
      });
    }
    const kinds = kind === 'consumption' ? ['SALE_DEDUCTION', 'PRODUCTION_OUT'] : kind === 'waste' ? ['WASTE'] : ['COUNT_ADJUSTMENT'];
    const moves = await this.prisma.stockMovement.findMany({
      where: { kind: { in: kinds as never }, createdAt: { gte: from, lte: to } },
      include: { ingredient: { select: { name: true } } },
    });
    const agg = new Map<string, { quantity: number; valueCents: number }>();
    for (const m of moves) {
      const row = agg.get(m.ingredient.name) ?? { quantity: 0, valueCents: 0 };
      row.quantity += Number(m.quantity);
      row.valueCents += new D(m.quantity).mul(new D(m.unitCostCents)).toNumber();
      agg.set(m.ingredient.name, row);
    }
    return [...agg.entries()]
      .map(([name, v]) => ({ name, quantity: v.quantity, valueCents: Math.round(v.valueCents) }))
      .sort((a, b) => b.valueCents - a.valueCents);
  }

  /** Generic CSV serializer for any report payload. */
  toCsv(rows: Record<string, unknown>[]): string {
    if (!rows.length) return '';
    const keys = Object.keys(rows[0]!);
    const lines = [keys.join(',')];
    for (const row of rows) {
      lines.push(keys.map((k) => {
        const v = row[k];
        const s = typeof v === 'object' ? JSON.stringify(v) : String(v ?? '');
        return `"${s.replaceAll('"', '""')}"`;
      }).join(','));
    }
    return lines.join('\n');
  }
}
