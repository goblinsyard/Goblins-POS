import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma, StockMoveKind } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import { RealtimeGateway } from '../realtime/realtime.gateway';

const D = Prisma.Decimal;

/**
 * Stock core. EVERY quantity change flows through move() so the
 * StockMovement ledger is complete; StockLevel rows are a maintained cache.
 */
@Injectable()
export class StockService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly realtime: RealtimeGateway,
  ) {}

  /** Apply a stock movement inside a transaction. Quantity is always positive. */
  async move(
    tx: Prisma.TransactionClient,
    params: {
      ingredientId: string;
      kind: StockMoveKind;
      quantity: Prisma.Decimal | number;
      fromLocationId?: string | null;
      toLocationId?: string | null;
      unitCostCents?: Prisma.Decimal | number;
      orderItemId?: string;
      goodsReceiptId?: string;
      productionOrderId?: string;
      wasteLogId?: string;
      stockCountId?: string;
      batchId?: string;
      note?: string;
    },
  ) {
    const qty = new D(params.quantity);
    if (qty.lte(0)) throw new BadRequestException('Movement quantity must be positive');

    if (params.fromLocationId) {
      await tx.stockLevel.upsert({
        where: { ingredientId_locationId: { ingredientId: params.ingredientId, locationId: params.fromLocationId } },
        update: { quantity: { decrement: qty } },
        create: { ingredientId: params.ingredientId, locationId: params.fromLocationId, quantity: qty.neg() },
      });
    }
    if (params.toLocationId) {
      await tx.stockLevel.upsert({
        where: { ingredientId_locationId: { ingredientId: params.ingredientId, locationId: params.toLocationId } },
        update: { quantity: { increment: qty } },
        create: { ingredientId: params.ingredientId, locationId: params.toLocationId, quantity: qty },
      });
    }
    return tx.stockMovement.create({
      data: {
        ingredientId: params.ingredientId,
        kind: params.kind,
        quantity: qty,
        fromLocationId: params.fromLocationId ?? null,
        toLocationId: params.toLocationId ?? null,
        unitCostCents: new D(params.unitCostCents ?? 0),
        orderItemId: params.orderItemId,
        goodsReceiptId: params.goodsReceiptId,
        productionOrderId: params.productionOrderId,
        wasteLogId: params.wasteLogId,
        stockCountId: params.stockCountId,
        batchId: params.batchId,
        note: params.note,
      },
    });
  }

  /** Resolve a deduct-location name ("Kitchen"/"Bar") to its id, cached per call. */
  async locationByName(tx: Prisma.TransactionClient, name: string): Promise<string> {
    const loc = await tx.storeLocation.findFirst({ where: { name } });
    if (!loc) throw new BadRequestException(`Store location "${name}" not found`);
    return loc.id;
  }

  /**
   * Deduct stock for a sold order item by walking its recipe tree.
   * Intermediate ingredients (sub-recipe outputs) are consumed AS STOCK —
   * they were produced by production orders. Only if an intermediate is out
   * of stock do we NOT cascade (variance shows the gap; kitchens must produce).
   */
  async deductForSale(
    tx: Prisma.TransactionClient,
    orderItemId: string,
    menuItemId: string,
    quantity: Prisma.Decimal,
  ) {
    const recipe = await tx.recipe.findUnique({
      where: { menuItemId },
      include: { lines: { include: { ingredient: true } } },
    });
    if (!recipe || !recipe.isActive) return; // items without recipes simply don't deduct
    const locationId = await this.locationByName(tx, recipe.deductLocationName);
    for (const line of recipe.lines) {
      const needed = new D(line.quantity)
        .mul(quantity)
        .mul(new D(1).plus(new D(line.wastePct).div(100)));
      await this.move(tx, {
        ingredientId: line.ingredientId,
        kind: 'SALE_DEDUCTION',
        quantity: needed,
        fromLocationId: locationId,
        unitCostCents: line.ingredient.avgCostCents,
        orderItemId,
        note: `Sale deduction (${recipe.name})`,
      });
      await this.consumeFefoBatches(tx, line.ingredientId, needed);
    }
  }

  /** Reduce batch remaining quantities oldest-expiry-first (FEFO). */
  private async consumeFefoBatches(
    tx: Prisma.TransactionClient,
    ingredientId: string,
    quantity: Prisma.Decimal,
  ) {
    let remaining = new D(quantity);
    const batches = await tx.batch.findMany({
      where: { ingredientId, remainingQty: { gt: 0 } },
      orderBy: [{ expiresAt: 'asc' }, { receivedAt: 'asc' }],
    });
    for (const batch of batches) {
      if (remaining.lte(0)) break;
      const take = D.min(new D(batch.remainingQty), remaining);
      await tx.batch.update({
        where: { id: batch.id },
        data: { remainingQty: { decrement: take } },
      });
      remaining = remaining.minus(take);
    }
  }

  /** Theoretical unit cost of a recipe (recursive over sub-processes), in piasters. */
  async recipeUnitCost(tx: Prisma.TransactionClient, recipeId: string, seen = new Set<string>()): Promise<Prisma.Decimal> {
    if (seen.has(recipeId)) throw new BadRequestException('Recipe cycle detected');
    seen.add(recipeId);
    const recipe = await tx.recipe.findUniqueOrThrow({
      where: { id: recipeId },
      include: { lines: { include: { ingredient: { include: { producedBy: true } } } } },
    });
    let batchCost = new D(0);
    for (const line of recipe.lines) {
      const lineQty = new D(line.quantity).mul(new D(recipe.yieldQty)).mul(new D(1).plus(new D(line.wastePct).div(100)));
      const subProcess = line.ingredient.producedBy[0];
      const unitCost = subProcess
        ? await this.processUnitCost(tx, subProcess.id, new Set(seen))
        : new D(line.ingredient.avgCostCents);
      batchCost = batchCost.plus(unitCost.mul(lineQty));
    }
    return batchCost.div(new D(recipe.yieldQty));
  }

  /** Theoretical unit cost of a manufacturing process (recursive), in piasters. */
  async processUnitCost(tx: Prisma.TransactionClient, processId: string, seen = new Set<string>()): Promise<Prisma.Decimal> {
    if (seen.has(processId)) throw new BadRequestException('Manufacturing process cycle detected');
    seen.add(processId);
    const process = await tx.manufacturingProcess.findUniqueOrThrow({
      where: { id: processId },
      include: { lines: { include: { ingredient: { include: { producedBy: true } } } } },
    });
    let batchCost = new D(0);
    for (const line of process.lines) {
      const lineQty = new D(line.quantity).mul(new D(process.yieldQty)).mul(new D(1).plus(new D(line.wastePct).div(100)));
      const subProcess = line.ingredient.producedBy[0];
      const unitCost = subProcess
        ? await this.processUnitCost(tx, subProcess.id, new Set(seen))
        : new D(line.ingredient.avgCostCents);
      batchCost = batchCost.plus(unitCost.mul(lineQty));
    }
    return batchCost.div(new D(process.yieldQty));
  }
}
