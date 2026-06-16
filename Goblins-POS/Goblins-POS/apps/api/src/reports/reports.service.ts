import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

const D = Prisma.Decimal;
const CAIRO = 'Africa/Cairo';

function cairoHour(d: Date): number {
  return Number(
    new Intl.DateTimeFormat('en-US', { timeZone: CAIRO, hour: 'numeric', hour12: false }).format(d),
  ) % 24;
}
function cairoDay(d: Date): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: CAIRO }).format(d); // YYYY-MM-DD
}

@Injectable()
export class ReportsService {
  constructor(private readonly prisma: PrismaService) {}

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
  async sales(branchId: string, from: Date, to: Date, groupBy: 'hour' | 'day' | 'department' | 'category' | 'item' | 'method' | 'staff') {
    const orders = await this.prisma.order.findMany({
      where: { branchId, status: 'PAID', closedAt: { gte: from, lte: to } },
      include: {
        items: { where: { status: { not: 'VOIDED' } }, include: { item: { include: { category: true } } } },
        payments: { include: { method: true } },
        openedBy: { select: { name: true } },
      },
    });
    const agg = new Map<string, { orders: number; revenueCents: number; quantity: number }>();
    const add = (key: string, revenue: number, qty = 0, countOrder = true) => {
      const row = agg.get(key) ?? { orders: 0, revenueCents: 0, quantity: 0 };
      if (countOrder) row.orders++;
      row.revenueCents += revenue;
      row.quantity += qty;
      agg.set(key, row);
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

  /** Billiards/PS utilization: occupancy %, revenue/available hour, peak heatmap. */
  async utilization(from: Date, to: Date) {
    const sessions = await this.prisma.session.findMany({
      where: { status: 'STOPPED', startedAt: { gte: from }, endedAt: { lte: to } },
      include: { resource: { select: { id: true, name: true, type: true } }, segments: true },
    });
    const windowHours = Math.max(1, (to.getTime() - from.getTime()) / 3600_000);
    // assume venue open 12h/day
    const availableHours = (windowHours / 24) * 12;

    const byResource = new Map<string, { name: string; type: string; minutes: number; revenueCents: number; sessions: number }>();
    const heatmap = new Map<string, number>(); // "dow-hour" → minutes
    for (const s of sessions) {
      const row = byResource.get(s.resourceId) ?? {
        name: s.resource.name, type: s.resource.type, minutes: 0, revenueCents: 0, sessions: 0,
      };
      row.minutes += s.billedMinutes ?? 0;
      row.revenueCents += s.billedCents ?? 0;
      row.sessions++;
      byResource.set(s.resourceId, row);
      for (const seg of s.segments) {
        if (!seg.endedAt) continue;
        let cursor = seg.startedAt.getTime();
        while (cursor < seg.endedAt.getTime()) {
          const d = new Date(cursor);
          const key = `${d.getDay()}-${cairoHour(d)}`;
          heatmap.set(key, (heatmap.get(key) ?? 0) + Math.min(60, (seg.endedAt.getTime() - cursor) / 60_000));
          cursor += 3600_000;
        }
      }
    }
    return {
      resources: [...byResource.entries()].map(([id, v]) => ({
        resourceId: id,
        ...v,
        occupancyPctBps: Math.round((v.minutes / 60 / availableHours) * 10_000),
        revenuePerAvailableHourCents: Math.round(v.revenueCents / availableHours),
      })),
      heatmap: [...heatmap.entries()].map(([key, minutes]) => {
        const [dow, hour] = key.split('-');
        return { dayOfWeek: Number(dow), hour: Number(hour), minutes: Math.round(minutes) };
      }),
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
