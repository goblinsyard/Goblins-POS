import { PrismaClient, Prisma, AccountType } from '@prisma/client';

const prisma = new PrismaClient();

const token = '608147:008369291fa894e30ff02d042efb7a04';
const subdomain = 'goblins-yard2';

function mapUom(posterUnit: string): string {
  const u = String(posterUnit || '').toLowerCase().trim();
  if (u === 'kg') return 'kg';
  if (u === 'g') return 'g';
  if (u === 'l' || u === 'liter' || u === 'L') return 'L';
  if (u === 'ml') return 'ml';
  if (u === 'pc' || u === 'p' || u === 'pcs' || u === 'piece' || u === 'шт') return 'pc';
  if (u === 'bottle') return 'bottle';
  return 'pc';
}

function getUnitConversionFactor(ingredientUnit: string, structureUnit: string): number {
  const ingUnit = String(ingredientUnit || '').toLowerCase().trim();
  const structUnit = String(structureUnit || '').toLowerCase().trim();
  
  if (ingUnit === 'kg' && structUnit === 'g') return 1000;
  if (ingUnit === 'g' && structUnit === 'kg') return 0.001;
  if ((ingUnit === 'l' || ingUnit === 'liter' || ingUnit === 'L') && structUnit === 'ml') return 1000;
  if (ingUnit === 'ml' && (structUnit === 'l' || structUnit === 'liter' || structUnit === 'L')) return 0.001;
  
  return 1;
}

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
  console.log('Fetching data from Poster POS API...');
  
  // 1. Fetch Workshops (Stations)
  console.log('- Fetching workshops...');
  const wsRes = await fetch(`https://${subdomain}.joinposter.com/api/menu.getWorkshops?token=${token}`);
  const wsJson = await wsRes.json() as any;
  const posterWorkshops = wsJson.response || [];

  // 2. Fetch Categories
  console.log('- Fetching categories...');
  const catRes = await fetch(`https://${subdomain}.joinposter.com/api/menu.getCategories?token=${token}`);
  const catJson = await catRes.json() as any;
  if (catJson.error) {
    throw new Error(`Poster API error: ${JSON.stringify(catJson.error)}`);
  }
  const posterCategories = catJson.response || [];

  // 3. Fetch Ingredients
  console.log('- Fetching ingredients...');
  const ingRes = await fetch(`https://${subdomain}.joinposter.com/api/menu.getIngredients?token=${token}`);
  const ingJson = await ingRes.json() as any;
  const posterIngredients = ingJson.response || [];

  const officialIngredientUnits = new Map<string, string>();
  for (const ing of posterIngredients) {
    if (ing.ingredient_id) {
      officialIngredientUnits.set(String(ing.ingredient_id), ing.ingredient_unit);
    }
  }

  // 4. Fetch Prepacks (Sub-recipes)
  console.log('- Fetching prepacks...');
  const prepRes = await fetch(`https://${subdomain}.joinposter.com/api/menu.getPrepacks?token=${token}`);
  const prepJson = await prepRes.json() as any;
  const posterPrepacks = prepJson.response || [];

  // 5. Fetch Products with Recipes
  console.log('- Fetching products...');
  const prodRes = await fetch(`https://${subdomain}.joinposter.com/api/menu.getProducts?token=${token}&get_recipes=1`);
  const prodJson = await prodRes.json() as any;
  const posterProducts = prodJson.response || [];

  console.log(`Poster API fetched:`);
  console.log(`- Workshops (Stations): ${posterWorkshops.length}`);
  console.log(`- Categories: ${posterCategories.length}`);
  console.log(`- Ingredients: ${posterIngredients.length}`);
  console.log(`- Prepacks (Sub-recipes): ${posterPrepacks.length}`);
  console.log(`- Products/Dishes: ${posterProducts.length}`);

  // Resolve Branch and Setup missing baseline defaults (StoreLocation, TaxRate)
  console.log('\nResolving database defaults...');
  const branch = await prisma.branch.findFirst();
  if (!branch) {
    throw new Error('No Branch found in the database. Please run the baseline seed first.');
  }

  await ensureChartOfAccounts(prisma);

  let mainStore = await prisma.storeLocation.findFirst({ where: { name: 'Main store' } });
  if (!mainStore) {
    mainStore = await prisma.storeLocation.create({
      data: {
        branchId: branch.id,
        name: 'Main store',
        nameAr: 'المخزن الرئيسي',
      }
    });
    console.log('- Created default StoreLocation ("Main store")');
  }

  const locationsToEnsure = [
    { name: 'Kitchen', nameAr: 'المطبخ' },
    { name: 'Bar', nameAr: 'البار' }
  ];
  for (const loc of locationsToEnsure) {
    const locExists = await prisma.storeLocation.findFirst({ where: { name: loc.name } });
    if (!locExists) {
      await prisma.storeLocation.create({
        data: {
          branchId: branch.id,
          name: loc.name,
          nameAr: loc.nameAr,
        }
      });
      console.log(`- Created default StoreLocation ("${loc.name}")`);
    }
  }

  let defaultTaxRate = await prisma.taxRate.findFirst({ where: { isDefault: true } });
  if (!defaultTaxRate) {
    defaultTaxRate = await prisma.taxRate.create({
      data: {
        name: 'VAT 14%',
        rateBps: 1400,
        isDefault: true,
      }
    });
    console.log('- Created default TaxRate ("VAT 14%")');
  }

  // ----------------------------------------------------
  // Import Stations (Workshops)
  // ----------------------------------------------------
  console.log('\nImporting stations (workshops)...');
  const workshopsMap = new Map<string, string>();
  for (const ws of posterWorkshops) {
    const wsId = String(ws.workshop_id);
    await prisma.station.upsert({
      where: { id: wsId },
      update: {
        name: ws.workshop_name,
        isActive: ws.delete !== '1',
      },
      create: {
        id: wsId,
        name: ws.workshop_name,
        isActive: ws.delete !== '1',
        sortOrder: ws.workshop_id ? parseInt(ws.workshop_id) : 0,
      }
    });
    workshopsMap.set(wsId, ws.workshop_name);
  }
  console.log(`- Station import completed. Stations loaded: ${workshopsMap.size}`);

  // ----------------------------------------------------
  // Import Categories (Pass 1 & 2 for 3-Level Hierarchy)
  // ----------------------------------------------------
  console.log('\nImporting categories (Pass 1: creation)...');
  for (const cat of posterCategories) {
    await prisma.category.upsert({
      where: { id: String(cat.category_id) },
      update: {
        name: cat.category_name,
        sortOrder: cat.sort_order ? parseInt(cat.sort_order) : 0,
      },
      create: {
        id: String(cat.category_id),
        name: cat.category_name,
        sortOrder: cat.sort_order ? parseInt(cat.sort_order) : 0,
        isActive: cat.category_hidden !== '1',
      }
    });
  }

  console.log('Linking parent categories (Pass 2: hierarchy)...');
  for (const cat of posterCategories) {
    if (cat.parent_category && cat.parent_category !== '0') {
      const parentExists = await prisma.category.findUnique({ where: { id: String(cat.parent_category) } });
      if (parentExists) {
        await prisma.category.update({
          where: { id: String(cat.category_id) },
          data: { parentCategoryId: String(cat.parent_category) }
        });
      }
    }
  }
  console.log('- Category hierarchy imported successfully.');

  // ----------------------------------------------------
  // Calculate Ingredient Costs from Recipes and Prepacks
  // ----------------------------------------------------
  console.log('\nCalculating ingredient unit costs from recipe lines...');
  const ingredientCosts = new Map<string, number>();

  // Helper to process ingredient selfprices
  const processRecipeIngredients = (ingredients: any[]) => {
    for (const ing of ingredients || []) {
      const ingId = String(ing.ingredient_id);
      const officialUnit = officialIngredientUnits.get(ingId);
      if (officialUnit && ing.ingredient_unit !== officialUnit) {
        continue;
      }
      const brutto = parseFloat(ing.structure_brutto || '0');
      const selfprice = parseFloat(ing.structure_selfprice || '0');
      if (brutto > 0 && selfprice > 0) {
        const factor = getUnitConversionFactor(ing.ingredient_unit, ing.structure_unit);
        const calculatedUnitCost = (selfprice / brutto) * factor;
        const currentMax = ingredientCosts.get(ingId) || 0;
        if (calculatedUnitCost > currentMax) {
          ingredientCosts.set(ingId, calculatedUnitCost);
        }
      }
    }
  };

  // Collect from products (dishes)
  for (const prod of posterProducts) {
    if (prod.ingredients && prod.ingredients.length > 0) {
      processRecipeIngredients(prod.ingredients);
    }
  }

  // Collect from prepacks (semifinished goods)
  for (const prep of posterPrepacks) {
    if (prep.ingredients && prep.ingredients.length > 0) {
      processRecipeIngredients(prep.ingredients);
    }
  }
  console.log(`- Calculated costs for ${ingredientCosts.size} ingredients.`);

  // ----------------------------------------------------
  // Import Ingredients
  // ----------------------------------------------------
  console.log('\nImporting ingredients...');
  
  // Create a set of all ingredient IDs to track if any prepack is missing
  const importedIngredientIds = new Set<string>();

  for (const ing of posterIngredients) {
    const uomId = mapUom(ing.ingredient_unit);
    const ingId = String(ing.ingredient_id);
    
    // Ensure Uom exists in DB
    const uomExists = await prisma.uom.findUnique({ where: { id: uomId } });
    if (!uomExists) {
      await prisma.uom.create({ data: { id: uomId, label: uomId, baseUnit: uomId, factor: 1 } });
    }

    const calculatedCost = ingredientCosts.get(ingId) || 0;

    const localIng = await prisma.ingredient.upsert({
      where: { id: ingId },
      update: {
        name: ing.ingredient_name,
        uomId,
        sku: ing.ingredient_barcode || null,
        avgCostCents: new Prisma.Decimal(calculatedCost),
        lastCostCents: new Prisma.Decimal(calculatedCost),
      },
      create: {
        id: ingId,
        name: ing.ingredient_name,
        uomId,
        sku: ing.ingredient_barcode || null,
        avgCostCents: new Prisma.Decimal(calculatedCost),
        lastCostCents: new Prisma.Decimal(calculatedCost),
      }
    });

    importedIngredientIds.add(ingId);

    // Initialize/Update stock level in Main Store
    if (ing.ingredient_left != null) {
      const stockQty = new Prisma.Decimal(ing.ingredient_left);
      await prisma.stockLevel.upsert({
        where: {
          ingredientId_locationId: {
            ingredientId: localIng.id,
            locationId: mainStore.id
          }
        },
        update: {
          quantity: stockQty
        },
        create: {
          ingredientId: localIng.id,
          locationId: mainStore.id,
          quantity: stockQty
        }
      });
    }
  }

  // Also import any prepack as intermediate ingredient if not already imported
  console.log('Ensuring prepacks exist as intermediate ingredients...');
  for (const prep of posterPrepacks) {
    const outputIngId = String(prep.ingredient_id);
    if (outputIngId === '0') continue;

    const calculatedCost = ingredientCosts.get(outputIngId) || 0;

    if (!importedIngredientIds.has(outputIngId)) {
      await prisma.ingredient.upsert({
        where: { id: outputIngId },
        update: {
          name: prep.product_name,
          isIntermediate: true,
          avgCostCents: new Prisma.Decimal(calculatedCost),
          lastCostCents: new Prisma.Decimal(calculatedCost),
        },
        create: {
          id: outputIngId,
          name: prep.product_name,
          uomId: 'pc', // fallback
          isIntermediate: true,
          avgCostCents: new Prisma.Decimal(calculatedCost),
          lastCostCents: new Prisma.Decimal(calculatedCost),
        }
      });
      importedIngredientIds.add(outputIngId);
    } else {
      await prisma.ingredient.update({
        where: { id: outputIngId },
        data: { isIntermediate: true }
      });
    }
  }
  console.log('- Ingredients import completed.');

  // ----------------------------------------------------
  // Import Prepack Recipes (Manufacturing Processes)
  // ----------------------------------------------------
  console.log('\nImporting prepacks as manufacturing processes...');
  let importedPrepacksCount = 0;
  for (const prep of posterPrepacks) {
    const outputIngId = String(prep.ingredient_id);
    if (outputIngId === '0') continue;

    const processName = `${prep.product_name} Process`;
    const process = await prisma.manufacturingProcess.upsert({
      where: { outputIngredientId: outputIngId },
      update: {
        name: processName,
        yieldQty: new Prisma.Decimal(prep.out || 1),
      },
      create: {
        outputIngredientId: outputIngId,
        name: processName,
        yieldQty: new Prisma.Decimal(prep.out || 1),
      }
    });

    const yieldQty = Number(process.yieldQty || 1);

    // Clear old manufacturing process lines
    await prisma.manufacturingProcessLine.deleteMany({ where: { manufacturingProcessId: process.id } });

    // Create new process lines
    for (const ing of prep.ingredients || []) {
      const ingId = String(ing.ingredient_id);
      const ingExists = await prisma.ingredient.findUnique({ where: { id: ingId } });
      if (ingExists) {
        const conversionFactor = getUnitConversionFactor(ing.ingredient_unit, ing.structure_unit);
        const brutto = parseFloat(ing.structure_brutto || '0');
        const quantity = (conversionFactor > 0 ? brutto / conversionFactor : brutto) / yieldQty;

        await prisma.manufacturingProcessLine.create({
          data: {
            manufacturingProcessId: process.id,
            ingredientId: ingId,
            quantity: new Prisma.Decimal(quantity),
          }
        });
      }
    }
    importedPrepacksCount++;
  }
  console.log(`- Prepack recipes linked: ${importedPrepacksCount}`);

  // ----------------------------------------------------
  // Import Products, Recipes, Modifiers
  // ----------------------------------------------------
  console.log('\nImporting products, recipes, modifiers...');
  let importedProducts = 0;
  let importedRecipes = 0;
  
  // Track menu item prices for cost snapshot margin calculations
  const menuItemPrices = new Map<string, number>();

  for (const prod of posterProducts) {
    const productId = String(prod.product_id);
    
    // Determine Department
    const catName = String(prod.category_name || '').toUpperCase();
    const prodName = String(prod.product_name || '').toUpperCase();
    const wsName = String(workshopsMap.get(String(prod.workshop)) || '').toUpperCase();
    
    let department: 'RESTAURANT' | 'BAR' | 'BILLIARDS' | 'PLAYSTATION' = 'RESTAURANT';
    if (wsName.includes('BAR') || catName.includes('DRINK') || catName.includes('BAR') || catName.includes('BEVERAGE') || catName.includes('JUICE') || catName.includes('SOFT')) {
      department = 'BAR';
    } else if (wsName.includes('BILLIARD') || catName.includes('BILLIARD') || prodName.includes('BILLIARD')) {
      department = 'BILLIARDS';
    } else if (wsName.includes('PLAYSTATION') || wsName.includes('PS5') || catName.includes('PLAYSTATION') || catName.includes('PS5') || prodName.includes('PLAYSTATION') || prodName.includes('PS5')) {
      department = 'PLAYSTATION';
    }

    // Determine Linked Station ID
    const prodWorkshopId = String(prod.workshop);
    const stationExists = prodWorkshopId !== '0' && workshopsMap.has(prodWorkshopId);
    const stationId = stationExists ? prodWorkshopId : null;

    // Price (spots price returned in cents)
    const spotPrice = Object.values(prod.price || {})[0] || '0';
    const priceCents = parseInt(String(spotPrice));
    menuItemPrices.set(productId, priceCents);

    // Category
    let menuCategoryId = prod.menu_category_id && prod.menu_category_id !== '0' ? String(prod.menu_category_id) : null;
    if (menuCategoryId === '80') {
      menuCategoryId = '125';
    }
    if (menuCategoryId) {
      const catExists = await prisma.category.findUnique({ where: { id: menuCategoryId } });
      if (!catExists) {
        await prisma.category.create({
          data: { id: menuCategoryId, name: prod.category_name || 'Uncategorized' }
        });
      }
    } else {
      // Ensure General fallback category exists
      let generalCat = await prisma.category.findFirst({ where: { name: 'General' } });
      if (!generalCat) {
        generalCat = await prisma.category.create({
          data: { id: 'general', name: 'General' }
        });
        console.log('- Created General fallback category');
      }
      menuCategoryId = generalCat.id;
    }

    let menuItem: any;
    try {
      // Upsert MenuItem
      menuItem = await prisma.menuItem.upsert({
        where: { id: productId },
        update: {
          name: prod.product_name,
          priceCents,
          sku: prod.barcode || null,
          categoryId: menuCategoryId,
          department,
          stationId,
          isActive: prod.hidden !== '1',
        },
        create: {
          id: productId,
          name: prod.product_name,
          priceCents,
          sku: prod.barcode || null,
          categoryId: menuCategoryId,
          department,
          stationId,
          taxRateId: defaultTaxRate?.id || null,
          isActive: prod.hidden !== '1',
        }
      });
      importedProducts++;
    } catch (e: any) {
      console.error(`Failed to upsert product ${prod.product_name} (ID: ${productId}) with categoryId: ${menuCategoryId}`);
      throw e;
    }

    // --- Modifiers & Variants Import ---
    
    // 1. Group Modifications (extras, sizes, optional components)
    if (prod.group_modifications && prod.group_modifications.length > 0) {
      for (const group of prod.group_modifications) {
        const groupId = String(group.dish_modification_group_id);
        
        await prisma.modifierGroup.upsert({
          where: { id: groupId },
          update: {
            name: group.name,
            minSelect: group.num_min ?? 0,
            maxSelect: group.num_max ?? 1,
            isActive: group.is_deleted !== 1,
          },
          create: {
            id: groupId,
            name: group.name,
            minSelect: group.num_min ?? 0,
            maxSelect: group.num_max ?? 1,
            isActive: group.is_deleted !== 1,
          }
        });

        for (const opt of group.modifications || []) {
          const modId = String(opt.dish_modification_id);
          // Group modifications price is returned in EGP (major unit), convert to cents
          const priceDeltaCents = Math.round(parseFloat(String(opt.price || 0)) * 100);
          
          await prisma.modifier.upsert({
            where: { id: modId },
            update: {
              groupId,
              name: opt.name,
              priceDeltaCents,
              sortOrder: opt.sort_order ?? 0,
            },
            create: {
              id: modId,
              groupId,
              name: opt.name,
              priceDeltaCents,
              sortOrder: opt.sort_order ?? 0,
              isActive: true,
            }
          });
        }

        await prisma.itemModifierGroup.upsert({
          where: { itemId_groupId: { itemId: menuItem.id, groupId } },
          update: {},
          create: { itemId: menuItem.id, groupId }
        });
      }
    }

    // 2. Direct Modifications (Variants on the product)
    if (prod.modifications && prod.modifications.length > 0 && !(prod.group_modifications && prod.group_modifications.length > 0)) {
      const varGroupId = `var_${menuItem.id}`;
      
      await prisma.modifierGroup.upsert({
        where: { id: varGroupId },
        update: {
          name: 'Variants',
          minSelect: 1,
          maxSelect: 1,
          isActive: true,
        },
        create: {
          id: varGroupId,
          name: 'Variants',
          minSelect: 1,
          maxSelect: 1,
          isActive: true,
        }
      });

      for (const mod of prod.modifications) {
        const modId = String(mod.modificator_id);
        const spotPrice = (Object.values(mod.spots || {})[0] as any)?.price || (mod.spots as any)?.[0]?.price || '0';
        const optionPriceCents = parseInt(String(spotPrice));
        // Variants price is returned in cents (minor unit), calculate delta relative to parent price
        const priceDeltaCents = optionPriceCents - menuItem.priceCents;

        await prisma.modifier.upsert({
          where: { id: modId },
          update: {
            groupId: varGroupId,
            name: mod.modificator_name,
            priceDeltaCents,
          },
          create: {
            id: modId,
            groupId: varGroupId,
            name: mod.modificator_name,
            priceDeltaCents,
            isActive: true,
          }
        });
      }

      await prisma.itemModifierGroup.upsert({
        where: { itemId_groupId: { itemId: menuItem.id, groupId: varGroupId } },
        update: {},
        create: { itemId: menuItem.id, groupId: varGroupId }
      });
    }

    // --- Recipe Import ---
    if (prod.type === '2' && prod.ingredients && prod.ingredients.length > 0) {
      const recipeName = `${menuItem.name} Recipe`;
      const recipe = await prisma.recipe.upsert({
        where: { menuItemId: menuItem.id },
        update: {
          name: recipeName,
          deductLocationName: department === 'BAR' ? 'Bar' : 'Kitchen',
        },
        create: {
          menuItemId: menuItem.id,
          name: recipeName,
          deductLocationName: department === 'BAR' ? 'Bar' : 'Kitchen',
        }
      });

      const yieldQty = Number(recipe.yieldQty || 1);

      await prisma.recipeLine.deleteMany({ where: { recipeId: recipe.id } });

      for (const ing of prod.ingredients) {
        const localIngId = String(ing.ingredient_id);
        const ingExists = await prisma.ingredient.findUnique({ where: { id: localIngId } });
        if (ingExists) {
          const conversionFactor = getUnitConversionFactor(ing.ingredient_unit, ing.structure_unit);
          const brutto = parseFloat(ing.structure_brutto || '0');
          const quantity = (conversionFactor > 0 ? brutto / conversionFactor : brutto) / yieldQty;

          await prisma.recipeLine.create({
            data: {
              recipeId: recipe.id,
              ingredientId: localIngId,
              quantity: new Prisma.Decimal(quantity),
            }
          });
        }
      }
      importedRecipes++;
    }
  }

  // ----------------------------------------------------
  // Calculate and Create MenuItem Cost Snapshots
  // ----------------------------------------------------
  console.log('\nCalculating and creating MenuItem cost snapshots...');
  let costSnapshotsCount = 0;
  
  // Clear old cost snapshots first
  await prisma.itemCostSnapshot.deleteMany();

  for (const prod of posterProducts) {
    const productId = String(prod.product_id);
    let costCents = Math.round(parseFloat(prod.cost || '0'));

    // If it is a dish (composite), calculate cost from recipe ingredients
    if (prod.type === '2' && prod.ingredients && prod.ingredients.length > 0) {
      let calculatedCost = 0;
      for (const ing of prod.ingredients) {
        const ingId = String(ing.ingredient_id);
        const brutto = parseFloat(ing.structure_brutto || '0');
        const ingUnitCost = ingredientCosts.get(ingId) || 0;
        
        // Convert recipe line unit back to stock unit to match ingredient costs map unit
        const conversionFactor = getUnitConversionFactor(ing.ingredient_unit, ing.structure_unit);
        const qtyInStockUnit = conversionFactor > 0 ? brutto / conversionFactor : brutto;
        calculatedCost += qtyInStockUnit * ingUnitCost;
      }
      if (calculatedCost > 0) {
        costCents = Math.round(calculatedCost);
      }
    }

    if (costCents > 0) {
      const priceCents = menuItemPrices.get(productId) || 0;
      const costPctBps = priceCents > 0 ? Math.round((costCents / priceCents) * 10000) : 0;

      await prisma.itemCostSnapshot.create({
        data: {
          itemId: productId,
          costCents,
          priceCents,
          costPctBps
        }
      });
      costSnapshotsCount++;
    }
  }
  console.log(`- Cost snapshots created: ${costSnapshotsCount}`);

  console.log('\nPoster POS Menu Import completed successfully.');
  console.log(`Summary:`);
  console.log(`- Stations Imported/Updated: ${posterWorkshops.length}`);
  console.log(`- Menu Categories Imported/Updated: ${posterCategories.length}`);
  console.log(`- Inventory Ingredients Imported/Updated: ${importedIngredientIds.size}`);
  console.log(`- Prepack Recipes Linked: ${importedPrepacksCount}`);
  console.log(`- Menu Items Imported/Updated: ${importedProducts}`);
  console.log(`- Recipes Imported/Linked: ${importedRecipes}`);
  console.log(`- Cost Snapshots Created: ${costSnapshotsCount}`);
}

main()
  .catch((e) => {
    console.error('Poster POS Import failed:', e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
