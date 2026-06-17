import { Injectable } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { RealtimeGateway } from '../realtime/realtime.gateway';
import { StockService } from '../inventory/stock.service';

const D = Prisma.Decimal;

@Injectable()
export class CostingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly stock: StockService,
    private readonly realtime: RealtimeGateway,
  ) {}

  /** Theoretical cost per menu item (walks recipe tree incl. sub-recipes). */
  async itemCosts() {
    // No transaction needed — pure reads + in-memory computation
    const items = await this.prisma.menuItem.findMany({
      where: { isActive: true, recipe: { isNot: null } },
      include: { recipe: true, category: { select: { name: true } } },
    });
    const results = [];
    for (const item of items) {
      const unitCost = await this.stock.recipeUnitCost(this.prisma, item.recipe!.id);
      const costCents = Math.round(unitCost.toNumber());
      const costPctBps =
        item.priceCents > 0 ? Math.round((costCents / item.priceCents) * 10_000) : 0;
      results.push({
        itemId: item.id,
        name: item.name,
        category: item.category.name,
        department: item.department,
        priceCents: item.priceCents,
        costCents,
        costPctBps,
        marginCents: item.priceCents - costCents,
      });
    }
    return results.sort((a, b) => b.costPctBps - a.costPctBps);
  }

  /** Theoretical vs ACTUAL cost % per day: actual = SALE_DEDUCTION ledger value / revenue. */
  async costSummary(from: Date, to: Date) {
    const orders = await this.prisma.order.findMany({
      where: { status: 'PAID', closedAt: { gte: from, lte: to } },
      select: { subtotalCents: true, type: true },
    });
    const revenue = orders.reduce((a, o) => a + o.subtotalCents, 0);
    const deductions = await this.prisma.stockMovement.findMany({
      where: { kind: 'SALE_DEDUCTION', createdAt: { gte: from, lte: to } },
      select: { quantity: true, unitCostCents: true },
    });
    const actualCost = deductions.reduce(
      (a, m) => a + new D(m.quantity).mul(new D(m.unitCostCents)).toNumber(),
      0,
    );
    const waste = await this.prisma.stockMovement.findMany({
      where: { kind: 'WASTE', createdAt: { gte: from, lte: to } },
      select: { quantity: true, unitCostCents: true },
    });
    const wasteCost = waste.reduce(
      (a, m) => a + new D(m.quantity).mul(new D(m.unitCostCents)).toNumber(),
      0,
    );
    return {
      revenueCents: revenue,
      actualCostCents: Math.round(actualCost),
      wasteCostCents: Math.round(wasteCost),
      actualCostPctBps: revenue > 0 ? Math.round((actualCost / revenue) * 10_000) : 0,
    };
  }

  /**
   * Menu engineering: Stars (high pop, high margin), Plowhorses (high pop, low margin),
   * Puzzles (low pop, high margin), Dogs (low/low). Window = last N days.
   */
  async menuEngineering(days = 30) {
    const since = new Date(Date.now() - days * 86400_000);
    const sold = await this.prisma.orderItem.groupBy({
      by: ['itemId'],
      where: {
        itemId: { not: null },
        status: { not: 'VOIDED' },
        order: { status: 'PAID', closedAt: { gte: since } },
      },
      _sum: { quantity: true, lineCents: true },
    });
    const costs = await this.itemCosts();
    const costMap = new Map(costs.map((c) => [c.itemId, c]));

    const rows = sold
      .filter((s) => s.itemId && costMap.has(s.itemId))
      .map((s) => {
        const cost = costMap.get(s.itemId!)!;
        const qty = Number(s._sum.quantity ?? 0);
        const revenue = s._sum.lineCents ?? 0;
        const marginCents = revenue - cost.costCents * qty;
        return {
          itemId: s.itemId!,
          name: cost.name,
          quantitySold: qty,
          revenueCents: revenue,
          unitMarginCents: qty > 0 ? Math.round(marginCents / qty) : 0,
        };
      });
    if (!rows.length) return [];

    const avgQty = rows.reduce((a, r) => a + r.quantitySold, 0) / rows.length;
    const avgMargin = rows.reduce((a, r) => a + r.unitMarginCents, 0) / rows.length;
    return rows
      .map((r) => ({
        ...r,
        class:
          r.quantitySold >= avgQty && r.unitMarginCents >= avgMargin ? 'STAR'
          : r.quantitySold >= avgQty ? 'PLOWHORSE'
          : r.unitMarginCents >= avgMargin ? 'PUZZLE'
          : 'DOG',
      }))
      .sort((a, b) => b.revenueCents - a.revenueCents);
  }

  /**
   * Nightly snapshot + margin alerts: recompute every item's cost (supplier
   * price changes propagate through avgCost), store an ItemCostSnapshot,
   * and emit alerts when cost% crosses the threshold.
   */
  @Cron(CronExpression.EVERY_DAY_AT_4AM)
  async snapshotCosts() {
    await this.runSnapshot();
  }

  async runSnapshot(thresholdBps = 4000) {
    const costs = await this.itemCosts();
    const alerts = [];
    for (const c of costs) {
      await this.prisma.itemCostSnapshot.create({
        data: {
          itemId: c.itemId,
          costCents: c.costCents,
          priceCents: c.priceCents,
          costPctBps: c.costPctBps,
        },
      });
      if (c.costPctBps >= thresholdBps) {
        alerts.push({ itemId: c.itemId, name: c.name, costPctBps: c.costPctBps });
      }
    }
    if (alerts.length) {
      this.realtime.emitTo('pos', 'costing.margin_alerts', alerts);
    }
    return { snapshots: costs.length, alerts };
  }
}
