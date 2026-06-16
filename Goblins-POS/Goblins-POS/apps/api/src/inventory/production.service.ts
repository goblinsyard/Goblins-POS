import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import { StockService } from './stock.service';

const D = Prisma.Decimal;

/** Manufacturing: production orders turn raw stock into intermediate stock. */
@Injectable()
export class ProductionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly stock: StockService,
    private readonly audit: AuditService,
  ) {}

  async list() {
    return this.prisma.productionOrder.findMany({
      include: {
        manufacturingProcess: { include: { outputIngredient: true } },
        producedBy: { select: { name: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
  }

  /** List recipes that produce intermediates (what production can make). */
  async producibleRecipes() {
    return this.prisma.manufacturingProcess.findMany({
      where: { isActive: true },
      include: {
        outputIngredient: { include: { uom: true } },
        lines: { include: { ingredient: { include: { uom: true } } } },
      },
    });
  }

  /**
   * Execute a production order atomically:
   * consume raw lines (scaled to batchQty), create intermediate output stock,
   * set the intermediate's cost from actual consumed cost.
   */
  async produce(params: { processId: string; batchQty: number; userId: string; laborMinutes?: number; notes?: string }) {
    if (params.batchQty <= 0) throw new BadRequestException('Batch quantity must be positive');
    return this.prisma.$transaction(async (tx) => {
      const process = await tx.manufacturingProcess.findUniqueOrThrow({
        where: { id: params.processId },
        include: { lines: { include: { ingredient: true } }, outputIngredient: true },
      });
      const locationId = await this.stock.locationByName(tx, process.deductLocationName);
      const scale = new D(params.batchQty); // in yield units

      const po = await tx.productionOrder.create({
        data: {
          manufacturingProcessId: process.id,
          batchQty: scale,
          status: 'COMPLETED',
          producedById: params.userId,
          laborMinutes: params.laborMinutes,
          notes: params.notes,
          completedAt: new Date(),
        },
      });

      // consume raws: line.quantity is per ONE yield unit
      let totalCost = new D(0);
      for (const line of process.lines) {
        const needed = new D(line.quantity).mul(scale).mul(new D(1).plus(new D(line.wastePct).div(100)));
        const level = await tx.stockLevel.findUnique({
          where: { ingredientId_locationId: { ingredientId: line.ingredientId, locationId } },
        });
        if (!level || new D(level.quantity).lt(needed)) {
          throw new BadRequestException(
            `Insufficient ${line.ingredient.name}: need ${needed}, have ${level?.quantity ?? 0}`,
          );
        }
        await this.stock.move(tx, {
          ingredientId: line.ingredientId,
          kind: 'PRODUCTION_OUT',
          quantity: needed,
          fromLocationId: locationId,
          unitCostCents: line.ingredient.avgCostCents,
          productionOrderId: po.id,
        });
        totalCost = totalCost.plus(new D(line.ingredient.avgCostCents).mul(needed));
      }

      // create intermediate stock at computed unit cost
      const unitCost = totalCost.div(scale);
      await this.stock.move(tx, {
        ingredientId: process.outputIngredientId,
        kind: 'PRODUCTION_IN',
        quantity: scale,
        toLocationId: locationId,
        unitCostCents: unitCost,
        productionOrderId: po.id,
      });
      // moving-average cost update for the intermediate
      await tx.ingredient.update({
        where: { id: process.outputIngredientId },
        data: { avgCostCents: unitCost, lastCostCents: unitCost },
      });

      await this.audit.log(
        { userId: params.userId, action: 'production.complete', entity: 'ProductionOrder', entityId: po.id,
          detail: { recipe: process.name, batchQty: params.batchQty, costCents: totalCost.toNumber() } },
        tx,
      );
      return tx.productionOrder.findUniqueOrThrow({
        where: { id: po.id },
        include: { manufacturingProcess: { include: { outputIngredient: true } }, movements: true },
      });
    });
  }
}
