import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import { StockService } from './stock.service';

const D = Prisma.Decimal;

@Injectable()
export class InventoryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly stock: StockService,
    private readonly audit: AuditService,
  ) {}

  // ---------- views ----------

  async locations() {
    return this.prisma.storeLocation.findMany({ where: { isActive: true } });
  }

  async levels(locationId?: string) {
    return this.prisma.stockLevel.findMany({
      where: locationId ? { locationId } : undefined,
      include: { ingredient: { include: { uom: true } }, location: true },
      orderBy: { ingredient: { name: 'asc' } },
    });
  }

  async ingredients() {
    return this.prisma.ingredient.findMany({
      where: { isActive: true },
      include: { uom: true, stockLevels: { include: { location: true } } },
      orderBy: { name: 'asc' },
    });
  }

  /** Items at/below reorder point (sums across locations). */
  async lowStock() {
    const ingredients = await this.prisma.ingredient.findMany({
      where: { isActive: true, reorderPoint: { gt: 0 } },
      include: { stockLevels: true, uom: true },
    });
    return ingredients
      .map((ing) => ({
        id: ing.id,
        name: ing.name,
        uom: ing.uom.id,
        reorderPoint: ing.reorderPoint,
        reorderQty: ing.reorderQty,
        totalQty: ing.stockLevels.reduce((a, l) => a.plus(new D(l.quantity)), new D(0)),
      }))
      .filter((x) => x.totalQty.lte(new D(x.reorderPoint)));
  }

  /** Batches expiring within N days, soonest first (FEFO working list). */
  async expiring(days = 7) {
    return this.prisma.batch.findMany({
      where: {
        remainingQty: { gt: 0 },
        expiresAt: { not: null, lte: new Date(Date.now() + days * 86400_000) },
      },
      include: { ingredient: { include: { uom: true } } },
      orderBy: { expiresAt: 'asc' },
    });
  }

  async movements(params: { ingredientId?: string; kind?: string; take?: number }) {
    return this.prisma.stockMovement.findMany({
      where: {
        ingredientId: params.ingredientId,
        kind: params.kind as never,
      },
      include: {
        ingredient: { select: { name: true } },
        fromLocation: { select: { name: true } },
        toLocation: { select: { name: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: params.take ?? 100,
    });
  }

  // ---------- transfers ----------

  async transfer(params: {
    ingredientId: string;
    fromLocationId: string;
    toLocationId: string;
    quantity: number;
    userId: string;
  }) {
    if (params.fromLocationId === params.toLocationId) {
      throw new BadRequestException('Source and target are the same');
    }
    return this.prisma.$transaction(async (tx) => {
      const level = await tx.stockLevel.findUnique({
        where: { ingredientId_locationId: { ingredientId: params.ingredientId, locationId: params.fromLocationId } },
      });
      if (!level || new D(level.quantity).lt(params.quantity)) {
        throw new BadRequestException('Insufficient stock at source');
      }
      const ing = await tx.ingredient.findUniqueOrThrow({ where: { id: params.ingredientId } });
      const move = await this.stock.move(tx, {
        ingredientId: params.ingredientId,
        kind: 'TRANSFER',
        quantity: params.quantity,
        fromLocationId: params.fromLocationId,
        toLocationId: params.toLocationId,
        unitCostCents: ing.avgCostCents,
      });
      await this.audit.log(
        { userId: params.userId, action: 'inventory.transfer', entity: 'StockMovement', entityId: move.id,
          detail: params as unknown as Prisma.InputJsonValue },
        tx,
      );
      return move;
    });
  }

  // ---------- waste ----------

  async logWaste(params: { ingredientId: string; locationId: string; quantity: number; reason: string; userId: string }) {
    return this.prisma.$transaction(async (tx) => {
      const ing = await tx.ingredient.findUniqueOrThrow({ where: { id: params.ingredientId } });
      const waste = await tx.wasteLog.create({
        data: {
          ingredientId: params.ingredientId,
          quantity: new D(params.quantity),
          reason: params.reason,
          loggedById: params.userId,
        },
      });
      await this.stock.move(tx, {
        ingredientId: params.ingredientId,
        kind: 'WASTE',
        quantity: params.quantity,
        fromLocationId: params.locationId,
        unitCostCents: ing.avgCostCents,
        wasteLogId: waste.id,
        note: params.reason,
      });
      await this.audit.log(
        { userId: params.userId, action: 'inventory.waste', entity: 'WasteLog', entityId: waste.id,
          detail: { ingredient: ing.name, quantity: params.quantity, reason: params.reason } },
        tx,
      );
      return waste;
    });
  }

  // ---------- stock counts ----------

  async startCount(params: { locationId: string; kind: 'FULL' | 'SPOT'; userId: string; ingredientIds?: string[] }) {
    const levels = await this.prisma.stockLevel.findMany({
      where: {
        locationId: params.locationId,
        ...(params.kind === 'SPOT' && params.ingredientIds?.length
          ? { ingredientId: { in: params.ingredientIds } }
          : {}),
      },
    });
    return this.prisma.stockCount.create({
      data: {
        locationId: params.locationId,
        kind: params.kind,
        countedById: params.userId,
        lines: {
          create: levels.map((l) => ({
            ingredientId: l.ingredientId,
            systemQty: l.quantity,
            countedQty: l.quantity,
            varianceQty: new D(0),
          })),
        },
      },
      include: { lines: { include: { ingredient: { include: { uom: true } } } } },
    });
  }

  async submitCount(params: {
    countId: string;
    userId: string;
    lines: { ingredientId: string; countedQty: number }[];
  }) {
    return this.prisma.$transaction(async (tx) => {
      const count = await tx.stockCount.findUniqueOrThrow({
        where: { id: params.countId },
        include: { lines: true },
      });
      if (count.status !== 'IN_PROGRESS') throw new BadRequestException('Count not in progress');

      for (const input of params.lines) {
        const line = count.lines.find((l) => l.ingredientId === input.ingredientId);
        if (!line) continue;
        const counted = new D(input.countedQty);
        const variance = counted.minus(new D(line.systemQty));
        await tx.stockCountLine.update({
          where: { id: line.id },
          data: { countedQty: counted, varianceQty: variance },
        });
        if (!variance.isZero()) {
          const ing = await tx.ingredient.findUniqueOrThrow({ where: { id: line.ingredientId } });
          await this.stock.move(tx, {
            ingredientId: line.ingredientId,
            kind: 'COUNT_ADJUSTMENT',
            quantity: variance.abs(),
            // negative variance removes stock, positive adds
            fromLocationId: variance.isNegative() ? count.locationId : null,
            toLocationId: variance.isNegative() ? null : count.locationId,
            unitCostCents: ing.avgCostCents,
            stockCountId: count.id,
          });
        }
      }
      const posted = await tx.stockCount.update({
        where: { id: count.id },
        data: { status: 'POSTED', postedAt: new Date() },
        include: { lines: { include: { ingredient: true } } },
      });
      await this.audit.log(
        { userId: params.userId, action: 'inventory.count_posted', entity: 'StockCount', entityId: count.id,
          detail: { lines: params.lines.length } },
        tx,
      );
      return posted;
    });
  }

  /** Manual adjustment (gated, audited). */
  async adjust(params: { ingredientId: string; locationId: string; delta: number; reason: string; userId: string }) {
    if (params.delta === 0) throw new BadRequestException('Delta cannot be zero');
    return this.prisma.$transaction(async (tx) => {
      const ing = await tx.ingredient.findUniqueOrThrow({ where: { id: params.ingredientId } });
      const move = await this.stock.move(tx, {
        ingredientId: params.ingredientId,
        kind: 'COUNT_ADJUSTMENT',
        quantity: Math.abs(params.delta),
        fromLocationId: params.delta < 0 ? params.locationId : null,
        toLocationId: params.delta > 0 ? params.locationId : null,
        unitCostCents: ing.avgCostCents,
        note: params.reason,
      });
      await this.audit.log(
        { userId: params.userId, action: 'stock.adjust', entity: 'StockMovement', entityId: move.id,
          detail: { ingredient: ing.name, delta: params.delta, reason: params.reason } },
        tx,
      );
      return move;
    });
  }
}
