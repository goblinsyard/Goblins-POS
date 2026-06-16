import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('Deleting demo menu items, categories, ingredients, and recipes...');

  // Helper to check if string is a CUID (alphanumeric, starts with c, length > 15)
  // Poster IDs are numeric strings (like '77', '864') or short integers.
  const isCuid = (id: string) => id.startsWith('c') && id.length > 15;

  // 1. Delete price schedules for demo items
  const schedules = await prisma.priceSchedule.findMany();
  const schedulesToDelete = schedules.filter(s => isCuid(s.itemId));
  console.log(`Deleting ${schedulesToDelete.length} demo price schedules...`);
  if (schedulesToDelete.length > 0) {
    await prisma.priceSchedule.deleteMany({
      where: { id: { in: schedulesToDelete.map(s => s.id) } }
    });
  }

  // 2. Delete cost snapshots for demo items
  const costSnapshots = await prisma.itemCostSnapshot.findMany();
  const costSnapshotsToDelete = costSnapshots.filter(s => isCuid(s.itemId));
  console.log(`Deleting ${costSnapshotsToDelete.length} demo cost snapshots...`);
  if (costSnapshotsToDelete.length > 0) {
    await prisma.itemCostSnapshot.deleteMany({
      where: { id: { in: costSnapshotsToDelete.map(s => s.id) } }
    });
  }

  // 3. Delete combo lines for demo items
  const comboLines = await prisma.comboLine.findMany();
  const comboLinesToDelete = comboLines.filter(s => isCuid(s.itemId));
  console.log(`Deleting ${comboLinesToDelete.length} demo combo lines...`);
  if (comboLinesToDelete.length > 0) {
    await prisma.comboLine.deleteMany({
      where: { id: { in: comboLinesToDelete.map(s => s.id) } }
    });
  }

  // 4. Delete recipe lines for demo recipes/ingredients
  const recipeLines = await prisma.recipeLine.findMany({
    include: { recipe: true }
  });
  const recipeLinesToDelete = recipeLines.filter(line => 
    isCuid(line.ingredientId) || (line.recipe.menuItemId && isCuid(line.recipe.menuItemId))
  );
  console.log(`Deleting ${recipeLinesToDelete.length} demo recipe lines...`);
  if (recipeLinesToDelete.length > 0) {
    await prisma.recipeLine.deleteMany({
      where: { id: { in: recipeLinesToDelete.map(l => l.id) } }
    });
  }

  // 5. Delete recipes for demo items
  const recipes = await prisma.recipe.findMany();
  const recipesToDelete = recipes.filter(r => r.menuItemId && isCuid(r.menuItemId));
  console.log(`Deleting ${recipesToDelete.length} demo recipes...`);
  if (recipesToDelete.length > 0) {
    await prisma.recipe.deleteMany({
      where: { id: { in: recipesToDelete.map(r => r.id) } }
    });
  }

  // 5.1. Delete manufacturing processes for demo ingredients
  const processes = await prisma.manufacturingProcess.findMany();
  const processesToDelete = processes.filter(p => isCuid(p.outputIngredientId));
  console.log(`Deleting ${processesToDelete.length} demo manufacturing processes...`);
  if (processesToDelete.length > 0) {
    await prisma.manufacturingProcess.deleteMany({
      where: { id: { in: processesToDelete.map(p => p.id) } }
    });
  }

  // 5.5 Delete modifiers and modifier groups that are demo
  const modifiers = await prisma.modifier.findMany();
  const modifiersToDelete = modifiers.filter(m => isCuid(m.id));
  console.log(`Deleting ${modifiersToDelete.length} demo modifiers...`);
  if (modifiersToDelete.length > 0) {
    await prisma.modifier.deleteMany({
      where: { id: { in: modifiersToDelete.map(m => m.id) } }
    });
  }

  const modifierGroups = await prisma.modifierGroup.findMany();
  const modifierGroupsToDelete = modifierGroups.filter(g => isCuid(g.id));
  console.log(`Deleting ${modifierGroupsToDelete.length} demo modifier groups...`);
  if (modifierGroupsToDelete.length > 0) {
    await prisma.modifierGroup.deleteMany({
      where: { id: { in: modifierGroupsToDelete.map(g => g.id) } }
    });
  }

  // 6. Delete menu items that are demo
  const menuItems = await prisma.menuItem.findMany();
  const menuItemsToDelete = menuItems.filter(m => isCuid(m.id));
  console.log(`Deleting ${menuItemsToDelete.length} demo menu items...`);
  if (menuItemsToDelete.length > 0) {
    await prisma.menuItem.deleteMany({
      where: { id: { in: menuItemsToDelete.map(m => m.id) } }
    });
  }

  // 7. Delete categories that are demo
  const categories = await prisma.category.findMany();
  const categoriesToDelete = categories.filter(c => isCuid(c.id));
  console.log(`Deleting ${categoriesToDelete.length} demo categories...`);
  if (categoriesToDelete.length > 0) {
    // Find or create a general Poster category
    let generalCat = await prisma.category.findFirst({
      where: { NOT: { id: { startsWith: 'c' } } }
    });
    if (!generalCat) {
      generalCat = await prisma.category.create({
        data: { id: 'general', name: 'General' }
      });
    }

    // Re-assign any Poster menu items (which are not demo, i.e. not CUID) linked to demo categories
    const allItems = await prisma.menuItem.findMany();
    const itemsToReassign = allItems.filter(m => !isCuid(m.id) && m.categoryId && isCuid(m.categoryId));
    console.log(`Re-assigning ${itemsToReassign.length} Poster menu items to general category (${generalCat.name})...`);
    for (const item of itemsToReassign) {
      await prisma.menuItem.update({
        where: { id: item.id },
        data: { categoryId: generalCat.id }
      });
    }

    // Set parentCategoryId to null for subcategories to prevent setNull/FK errors
    await prisma.category.updateMany({
      where: { id: { in: categoriesToDelete.map(c => c.id) } },
      data: { parentCategoryId: null }
    });
    await prisma.category.deleteMany({
      where: { id: { in: categoriesToDelete.map(c => c.id) } }
    });
  }

  // 8. Delete related records for demo ingredients (to prevent FK violations)
  const stockMovements = await prisma.stockMovement.findMany();
  const stockMovementsToDelete = stockMovements.filter(s => isCuid(s.ingredientId));
  console.log(`Deleting ${stockMovementsToDelete.length} demo stock movements...`);
  if (stockMovementsToDelete.length > 0) {
    await prisma.stockMovement.deleteMany({
      where: { id: { in: stockMovementsToDelete.map(s => s.id) } }
    });
  }

  const poLines = await prisma.purchaseOrderLine.findMany();
  const poLinesToDelete = poLines.filter(p => isCuid(p.ingredientId));
  console.log(`Deleting ${poLinesToDelete.length} demo PO lines...`);
  if (poLinesToDelete.length > 0) {
    await prisma.purchaseOrderLine.deleteMany({
      where: { id: { in: poLinesToDelete.map(p => p.id) } }
    });
  }

  const batches = await prisma.batch.findMany();
  const batchesToDelete = batches.filter(b => isCuid(b.ingredientId));
  console.log(`Deleting ${batchesToDelete.length} demo batches...`);
  if (batchesToDelete.length > 0) {
    await prisma.batch.deleteMany({
      where: { id: { in: batchesToDelete.map(b => b.id) } }
    });
  }

  const countLines = await prisma.stockCountLine.findMany();
  const countLinesToDelete = countLines.filter(c => isCuid(c.ingredientId));
  console.log(`Deleting ${countLinesToDelete.length} demo stock count lines...`);
  if (countLinesToDelete.length > 0) {
    await prisma.stockCountLine.deleteMany({
      where: { id: { in: countLinesToDelete.map(c => c.id) } }
    });
  }

  const wasteLogs = await prisma.wasteLog.findMany();
  const wasteLogsToDelete = wasteLogs.filter(w => isCuid(w.ingredientId));
  console.log(`Deleting ${wasteLogsToDelete.length} demo waste logs...`);
  if (wasteLogsToDelete.length > 0) {
    await prisma.wasteLog.deleteMany({
      where: { id: { in: wasteLogsToDelete.map(w => w.id) } }
    });
  }

  // 9. Delete stock levels for demo ingredients
  const stockLevels = await prisma.stockLevel.findMany();
  const stockLevelsToDelete = stockLevels.filter(s => isCuid(s.ingredientId));
  console.log(`Deleting ${stockLevelsToDelete.length} demo stock levels...`);
  if (stockLevelsToDelete.length > 0) {
    await prisma.stockLevel.deleteMany({
      where: {
        ingredientId: {
          in: stockLevelsToDelete.map(s => s.ingredientId)
        }
      }
    });
  }

  // 9. Delete supplier prices for demo ingredients
  const supplierPrices = await prisma.supplierPriceHistory.findMany();
  const supplierPricesToDelete = supplierPrices.filter(s => isCuid(s.ingredientId));
  console.log(`Deleting ${supplierPricesToDelete.length} demo supplier prices...`);
  if (supplierPricesToDelete.length > 0) {
    await prisma.supplierPriceHistory.deleteMany({
      where: { id: { in: supplierPricesToDelete.map(s => s.id) } }
    });
  }

  // 10. Delete ingredients that are demo
  const ingredients = await prisma.ingredient.findMany();
  const ingredientsToDelete = ingredients.filter(i => isCuid(i.id));
  console.log(`Deleting ${ingredientsToDelete.length} demo ingredients...`);
  if (ingredientsToDelete.length > 0) {
    await prisma.ingredient.deleteMany({
      where: { id: { in: ingredientsToDelete.map(i => i.id) } }
    });
  }

  console.log('Demo menu cleanup completed successfully.');
}

main()
  .catch((e) => {
    console.error('Cleanup failed with error:', e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
