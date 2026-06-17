import { PrismaClient, AccountType } from '@prisma/client';

const prisma = new PrismaClient();

async function ensureChartOfAccounts(prisma: PrismaClient) {
  console.log('Ensuring baseline Chart of Accounts exists...');
  const coa = [
    // Assets
    { code: '1000', name: 'Assets', nameAr: 'الأصول', type: 'ASSET' as AccountType },
    { code: '1100', name: 'Cash on Hand', nameAr: 'النقدية بالصندوق', type: 'ASSET' as AccountType, parentCode: '1000' },
    { code: '1110', name: 'Cash Drawer / Safe', nameAr: 'درج الكاشير / الخزينة', type: 'ASSET' as AccountType, parentCode: '1100' },
    { code: '1120', name: 'Main Safe', nameAr: 'الخزينة الرئيسية', type: 'ASSET' as AccountType, parentCode: '1100' },
    { code: '1125', name: 'Tips Drawer', nameAr: 'درج البقشيش', type: 'ASSET' as AccountType, parentCode: '1100' },
    { code: '1130', name: 'Custody', nameAr: 'العهدة', type: 'ASSET' as AccountType, parentCode: '1100' },
    { code: '1200', name: 'Bank Accounts', nameAr: 'الحسابات البنكية', type: 'ASSET' as AccountType, parentCode: '1000' },
    { code: '1210', name: 'Main Bank Account', nameAr: 'الحساب البنكي الرئيسي', type: 'ASSET' as AccountType, parentCode: '1200' },
    { code: '1220', name: 'Fawry Account', nameAr: 'حساب فوري', type: 'ASSET' as AccountType, parentCode: '1200' },
    { code: '1300', name: 'Accounts Receivable', nameAr: 'العملاء / المدينون', type: 'ASSET' as AccountType, parentCode: '1000' },
    { code: '1400', name: 'Food & Beverage Inventory', nameAr: 'مخزون الأغذية والمشروبات', type: 'ASSET' as AccountType, parentCode: '1000' },
    { code: '1500', name: 'Prepaid Expenses', nameAr: 'المصروفات المقدمة', type: 'ASSET' as AccountType, parentCode: '1000' },
    { code: '1600', name: 'Equipment & Furniture', nameAr: 'المعدات والأثاث', type: 'ASSET' as AccountType, parentCode: '1000' },
 
    // Liabilities
    { code: '2000', name: 'Liabilities', nameAr: 'الخصوم', type: 'LIABILITY' as AccountType },
    { code: '2100', name: 'Accounts Payable', nameAr: 'الموردون / الدائنون', type: 'LIABILITY' as AccountType, parentCode: '2000' },
    { code: '2200', name: 'Sales Tax (VAT) Payable', nameAr: 'ضريبة القيمة المضافة المستحقة', type: 'LIABILITY' as AccountType, parentCode: '2000' },
    { code: '2300', name: 'Accrued Salaries', nameAr: 'الرواتب المستحقة', type: 'LIABILITY' as AccountType, parentCode: '2000' },
    { code: '2400', name: 'Customer Deposits', nameAr: 'تأمين عملاء', type: 'LIABILITY' as AccountType, parentCode: '2000' },
    { code: '2500', name: 'Tips Payable', nameAr: 'بقشيش مستحق للعامليين', type: 'LIABILITY' as AccountType, parentCode: '2000' },
 
    // Equity
    { code: '3000', name: 'Equity', nameAr: 'حقوق الملكية', type: 'EQUITY' as AccountType },
    { code: '3100', name: "Owner's Capital", nameAr: 'رأس المال', type: 'EQUITY' as AccountType, parentCode: '3000' },
    { code: '3200', name: 'Retained Earnings', nameAr: 'الأرباح المحتجزة', type: 'EQUITY' as AccountType, parentCode: '3000' },
 
    // Revenue
    { code: '4000', name: 'Revenue', nameAr: 'الإيرادات', type: 'REVENUE' as AccountType },
    { code: '4100', name: 'Food & Beverage Sales', nameAr: 'مبيعات الأغذية والمشروبات', type: 'REVENUE' as AccountType, parentCode: '4000' },
    { code: '4200', name: 'PlayStation Services Revenue', nameAr: 'إيرادات بلايستيشن', type: 'REVENUE' as AccountType, parentCode: '4000' },
    { code: '4300', name: 'Billiards Services Revenue', nameAr: 'إيرادات البلياردو', type: 'REVENUE' as AccountType, parentCode: '4000' },
    { code: '4400', name: 'Event Bookings & Room Rental', nameAr: 'حجز الفعاليات وإيجار الغرف', type: 'REVENUE' as AccountType, parentCode: '4000' },
    { code: '4500', name: 'Other Income', nameAr: 'إيرادات أخرى', type: 'REVENUE' as AccountType, parentCode: '4000' },
    { code: '4600', name: 'Service Charge Revenue', nameAr: 'إيرادات الخدمة', type: 'REVENUE' as AccountType, parentCode: '4000' },
 
    // Expenses
    { code: '5000', name: 'Expenses', nameAr: 'المصروفات', type: 'EXPENSE' as AccountType },
    { code: '5100', name: 'Cost of Goods Sold (COGS)', nameAr: 'تكلفة المبيعات', type: 'EXPENSE' as AccountType, parentCode: '5000' },
    { code: '5110', name: 'Food & Beverage Cost', nameAr: 'تكلفة الأغذية والمشروبات', type: 'EXPENSE' as AccountType, parentCode: '5100' },
    { code: '5120', name: 'PlayStation & Billiards Maintenance Cost', nameAr: 'تكلفة صيانة البلايستيشن والبلياردو', type: 'EXPENSE' as AccountType, parentCode: '5100' },
    { code: '5200', name: 'Operating Expenses', nameAr: 'المصاريف التشغيلية', type: 'EXPENSE' as AccountType, parentCode: '5000' },
    { code: '5210', name: 'Salaries & Wages', nameAr: 'الرواتب والأجور', type: 'EXPENSE' as AccountType, parentCode: '5200' },
    { code: '5220', name: 'Rent', nameAr: 'الإيجار', type: 'EXPENSE' as AccountType, parentCode: '5200' },
    { code: '5230', name: 'Utilities', nameAr: 'المنافع العامة', type: 'EXPENSE' as AccountType, parentCode: '5200' },
    { code: '5240', name: 'Marketing & Advertising', nameAr: 'التسويق والإعلان', type: 'EXPENSE' as AccountType, parentCode: '5200' },
    { code: '5250', name: 'Repairs & Maintenance', nameAr: 'الإصلاحات والصيانة', type: 'EXPENSE' as AccountType, parentCode: '5200' },
    { code: '5260', name: 'Supplies', nameAr: 'المستلزمات', type: 'EXPENSE' as AccountType, parentCode: '5200' },
    { code: '5270', name: 'Printing & Stationery', nameAr: 'الطباعة والأدوات المكتبية', type: 'EXPENSE' as AccountType, parentCode: '5200' },
    { code: '5280', name: 'Bank Fees & Commission', nameAr: 'عمولات ومصاريف بنكية', type: 'EXPENSE' as AccountType, parentCode: '5200' },
    { code: '5290', name: 'Miscellaneous Expense', nameAr: 'مصاريف متنوعة', type: 'EXPENSE' as AccountType, parentCode: '5200' },
  ];

  const createdAccounts: Record<string, string> = {};
  for (const a of coa) {
    let acc = await prisma.account.findUnique({ where: { code: a.code } });
    if (!acc) {
      const parentId = a.parentCode ? createdAccounts[a.parentCode] : null;
      acc = await prisma.account.create({
        data: {
          code: a.code,
          name: a.name,
          nameAr: a.nameAr,
          type: a.type,
          parentAccountId: parentId,
          isPaymentSource: ['1110', '1210', '1220'].includes(a.code),
        },
      });
      console.log(`- Created account: ${acc.code} - ${acc.name}`);
    } else {
      const parentId = a.parentCode ? createdAccounts[a.parentCode] : null;
      acc = await prisma.account.update({
        where: { id: acc.id },
        data: {
          isActive: true,
          isPaymentSource: ['1110', '1210', '1220'].includes(a.code),
          parentAccountId: acc.parentAccountId || parentId,
        }
      });
    }
    createdAccounts[a.code] = acc.id;
  }

  // Link payment methods to accounts
  const cashAccId = createdAccounts['1110'];
  const bankAccId = createdAccounts['1210'];
  const walletAccId = createdAccounts['1220'];

  if (cashAccId) {
    await prisma.paymentMethod.updateMany({
      where: { kind: 'CASH', accountId: null },
      data: { accountId: cashAccId },
    });
  }
  if (bankAccId) {
    await prisma.paymentMethod.updateMany({
      where: { kind: 'CARD', accountId: null },
      data: { accountId: bankAccId },
    });
  }
  if (walletAccId) {
    await prisma.paymentMethod.updateMany({
      where: { kind: 'WALLET', accountId: null },
      data: { accountId: walletAccId },
    });
  }

  // Link expense categories to accounts
  const expCats = [
    { name: 'Rent', code: '5220' },
    { name: 'Utilities', code: '5230' },
    { name: 'Salaries', code: '5210' },
    { name: 'Marketing', code: '5240' },
    { name: 'Maintenance', code: '5250' },
    { name: 'COGS adjustment', code: '5110' },
  ];
  for (const cat of expCats) {
    const accId = createdAccounts[cat.code];
    if (accId) {
      await prisma.expenseCategory.updateMany({
        where: { name: cat.name, accountId: null },
        data: { accountId: accId },
      });
    }
  }
}

async function main() {
  console.log('Ensuring default accounts exist first...');
  await ensureChartOfAccounts(prisma);

  console.log('Deleting all transactional and activity data...');

  // Delete transaction records in strict dependency order (children first)
  await prisma.pointsTransaction.deleteMany();
  await prisma.feedback.deleteMany();
  await prisma.prepaidBlock.deleteMany();
  await prisma.sessionSegment.deleteMany();
  await prisma.session.deleteMany();
  await prisma.ticketItem.deleteMany();
  await prisma.ticket.deleteMany();
  await prisma.orderItemModifier.deleteMany();
  await prisma.orderItem.deleteMany();
  await prisma.orderDiscount.deleteMany();
  await prisma.payment.deleteMany();
  await prisma.orderSeatCustomer.deleteMany();
  await prisma.order.deleteMany();
  await prisma.cashMovement.deleteMany();
  await prisma.shift.deleteMany();
  await prisma.timeClockEntry.deleteMany();
  await prisma.productionOrder.deleteMany();
  await prisma.reservation.deleteMany();
  await prisma.expense.deleteMany();
  await prisma.hrTransaction.deleteMany();
  await prisma.journalLine.deleteMany();
  await prisma.journalEntry.deleteMany();
  await prisma.stockMovement.deleteMany();
  await prisma.stockCountLine.deleteMany();
  await prisma.stockCount.deleteMany();
  await prisma.wasteLog.deleteMany();
  await prisma.purchaseOrderLine.deleteMany();
  await prisma.purchaseOrder.deleteMany();
  await prisma.goodsReceipt.deleteMany();
  await prisma.supplierInvoice.deleteMany();
  await prisma.supplierPriceHistory.deleteMany();
  await prisma.batch.deleteMany();
  await prisma.auditLog.deleteMany();

  console.log('Resetting Chart of Accounts initial balances to 0...');
  await prisma.account.updateMany({
    data: { initialBalanceCents: 0 }
  });

  console.log('Deleting demo menu items, categories, ingredients, and recipes...');

  // Helper to check if string is a CUID (alphanumeric, starts with c, length > 15)
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

  // 8. Delete stock levels for demo ingredients
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

  // 9. Delete ingredients that are demo
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
