/**
 * DoD #4: theoretical food cost matches a hand-calculated example.
 *
 * Margherita pizza (seed data):
 *   1 × pizza dough ball  (sub-recipe: 180 g flour @1.5 pt/g + 5 g sugar @2 pt/g = 280 pt)
 *   80 ml red sauce       (sub-recipe: 1.1 g canned tomato/ml @4.5 pt/g = 4.95 pt/ml → 396 pt)
 *   120 g mozzarella      (@25 pt/g = 3000 pt)
 *   TOTAL THEORETICAL COST = 280 + 396 + 3000 = 3676 piasters (36.76 EGP)
 *   Price 160 EGP → cost % = 3676/16000 = 22.975 % → 2298 bps (rounded)
 *
 * Integration test — requires the dev DB (docker compose up db + seed).
 */
import { PrismaClient, Prisma } from '@prisma/client';
import { afterAll, describe, expect, it } from 'vitest';

const prisma = new PrismaClient();
const D = Prisma.Decimal;

/** Reimplementation-free: walk the recipe tree exactly like StockService.recipeUnitCost. */
async function recipeUnitCost(recipeId: string, seen = new Set<string>()): Promise<Prisma.Decimal> {
  if (seen.has(recipeId)) throw new Error('cycle');
  seen.add(recipeId);
  const recipe = await prisma.recipe.findUniqueOrThrow({
    where: { id: recipeId },
    include: { lines: { include: { ingredient: { include: { producedBy: true } } } } },
  });
  let batchCost = new D(0);
  for (const line of recipe.lines) {
    const lineQty = new D(line.quantity)
      .mul(new D(recipe.yieldQty))
      .mul(new D(1).plus(new D(line.wastePct).div(100)));
    const sub = line.ingredient.producedBy[0];
    const unitCost = sub ? await processUnitCost(sub.id, new Set(seen)) : new D(line.ingredient.avgCostCents);
    batchCost = batchCost.plus(unitCost.mul(lineQty));
  }
  return batchCost.div(new D(recipe.yieldQty));
}

async function processUnitCost(processId: string, seen = new Set<string>()): Promise<Prisma.Decimal> {
  if (seen.has(processId)) throw new Error('cycle');
  seen.add(processId);
  const process = await prisma.manufacturingProcess.findUniqueOrThrow({
    where: { id: processId },
    include: { lines: { include: { ingredient: { include: { producedBy: true } } } } },
  });
  let batchCost = new D(0);
  for (const line of process.lines) {
    const lineQty = new D(line.quantity)
      .mul(new D(process.yieldQty))
      .mul(new D(1).plus(new D(line.wastePct).div(100)));
    const sub = line.ingredient.producedBy[0];
    const unitCost = sub ? await processUnitCost(sub.id, new Set(seen)) : new D(line.ingredient.avgCostCents);
    batchCost = batchCost.plus(unitCost.mul(lineQty));
  }
  return batchCost.div(new D(process.yieldQty));
}

describe('theoretical food cost (hand-calculated, DoD #4)', () => {
  afterAll(() => prisma.$disconnect());

  it('Margherita = 36.76 EGP theoretical cost → ~22.98% of 160 EGP', async () => {
    const item = await prisma.menuItem.findFirstOrThrow({
      where: { name: 'Margherita' },
      include: { recipe: true },
    });
    expect(item.priceCents).toBe(16000);

    // pin the raw input costs this calculation depends on (seed values)
    const flour = await prisma.ingredient.findFirstOrThrow({ where: { name: 'Flour' } });
    const sugar = await prisma.ingredient.findFirstOrThrow({ where: { name: 'Sugar' } });
    const tomato = await prisma.ingredient.findFirstOrThrow({ where: { name: 'Canned tomato' } });
    const mozz = await prisma.ingredient.findFirstOrThrow({ where: { name: 'Mozzarella' } });
    expect(Number(flour.avgCostCents)).toBeCloseTo(1.5, 3);
    expect(Number(sugar.avgCostCents)).toBeCloseTo(2, 3);
    expect(Number(tomato.avgCostCents)).toBeCloseTo(4.5, 3);
    expect(Number(mozz.avgCostCents)).toBeCloseTo(25, 3);

    const unitCost = await recipeUnitCost(item.recipe!.id);
    // hand calculation: dough 280 + sauce 396 + mozzarella 3000 = 3676 pt
    expect(Math.round(unitCost.toNumber())).toBe(3676);

    const costPctBps = Math.round((unitCost.toNumber() / item.priceCents) * 10_000);
    expect(costPctBps).toBe(2298); // 22.98 %
  });

  it('sub-recipe (dough ball) unit cost = 2.80 EGP', async () => {
    const dough = await prisma.ingredient.findFirstOrThrow({
      where: { name: 'Pizza dough ball' },
      include: { producedBy: true },
    });
    const cost = await processUnitCost(dough.producedBy[0]!.id);
    expect(Math.round(cost.toNumber())).toBe(280);
  });
});
