import { PrismaClient } from '@prisma/client';
import * as argon2 from 'argon2';

const prisma = new PrismaClient();

async function main() {
  console.log('Baseline Seed — wiping database...');
  const tables = await prisma.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename NOT LIKE '_prisma%'`;
  await prisma.$executeRawUnsafe(
    `TRUNCATE TABLE ${tables.map((t) => `"${t.tablename}"`).join(', ')} CASCADE`,
  );

  console.log('Seeding Goblins Yard baseline configuration...');

  // ---------- permissions & roles ----------
  const { PERMISSIONS, PERMISSION_GROUPS, DEFAULT_ROLE_PERMISSIONS } = await import(
    '@goblins/shared'
  );
  const groupOf: Record<string, string> = {};
  for (const [group, ids] of Object.entries(PERMISSION_GROUPS)) {
    for (const id of ids) groupOf[id] = group;
  }
  for (const [id, label] of Object.entries(PERMISSIONS)) {
    await prisma.permission.create({ data: { id, label, group: groupOf[id] ?? 'Other' } });
  }
  const allPermIds = Object.keys(PERMISSIONS);
  const roles: Record<string, string> = {};
  for (const [roleName, perms] of Object.entries(DEFAULT_ROLE_PERMISSIONS)) {
    const role = await prisma.role.create({
      data: {
        name: roleName,
        isSystem: true,
        permissions: {
          create: (perms === 'ALL' ? allPermIds : perms).map((p) => ({ permissionId: p })),
        },
      },
    });
    roles[roleName] = role.id;
  }

  // ---------- branch, locations, stations, printers, terminals ----------
  const branch = await prisma.branch.create({
    data: {
      name: 'Goblins Yard',
      nameAr: 'جوبلنز يارد',
      address: 'Cairo, Egypt',
      phone: '+20 100 000 0000',
      taxId: 'EG-123-456-789',
    },
  });

  const mainStore = await prisma.storeLocation.create({
    data: { branchId: branch.id, name: 'Main store', nameAr: 'المخزن الرئيسي' },
  });
  await prisma.storeLocation.create({
    data: { branchId: branch.id, name: 'Kitchen', nameAr: 'المطبخ' },
  });
  await prisma.storeLocation.create({
    data: { branchId: branch.id, name: 'Bar', nameAr: 'البار' },
  });

  await prisma.printer.create({
    data: { name: 'Receipt printer', connection: 'PREVIEW', address: 'preview' },
  });
  const kitchenPrinter = await prisma.printer.create({
    data: { name: 'Kitchen printer', connection: 'PREVIEW', address: 'preview' },
  });
  const barPrinter = await prisma.printer.create({
    data: { name: 'Bar printer', connection: 'PREVIEW', address: 'preview' },
  });

  await prisma.station.create({
    data: { name: 'Kitchen', nameAr: 'المطبخ', printerId: kitchenPrinter.id, sortOrder: 1 },
  });
  await prisma.station.create({
    data: { name: 'Bar', nameAr: 'البار', printerId: barPrinter.id, sortOrder: 2 },
  });
  await prisma.station.create({
    data: { name: 'Expo', kind: 'EXPO', sortOrder: 3 },
  });

  await prisma.terminal.createMany({
    data: [
      { branchId: branch.id, name: 'POS-1', deviceKey: 'pos-1-key' },
      { branchId: branch.id, name: 'POS-2', deviceKey: 'pos-2-key' },
    ],
  });

  // ---------- payment methods & tax ----------
  await prisma.paymentMethod.createMany({
    data: [
      { name: 'Cash', nameAr: 'كاش', kind: 'CASH', opensDrawer: true, sortOrder: 1 },
      { name: 'Card', nameAr: 'بطاقة', kind: 'CARD', sortOrder: 2 },
      { name: 'Mobile Wallet', nameAr: 'محفظة', kind: 'WALLET', sortOrder: 3 },
    ],
  });
  const vat = await prisma.taxRate.create({
    data: { name: 'VAT 14%', rateBps: 1400, isDefault: true },
  });

  // ---------- staff ----------
  const pw = await argon2.hash('admin123');
  const mkPin = (pin: string) => argon2.hash(pin);
  await prisma.user.create({
    data: {
      branchId: branch.id, name: 'Tamer (Owner)', email: 'owner@goblinsyard.com',
      passwordHash: pw, pinHash: await mkPin('9999'), roleId: roles.Owner!,
    },
  });
  await prisma.user.create({
    data: {
      branchId: branch.id, name: 'Mona (Manager)', email: 'manager@goblinsyard.com',
      passwordHash: pw, pinHash: await mkPin('1111'), roleId: roles.Manager!,
    },
  });
  await prisma.user.create({
    data: {
      branchId: branch.id, name: 'Karim (Cashier)',
      pinHash: await mkPin('2222'), roleId: roles.Cashier!,
    },
  });
  await prisma.user.create({
    data: {
      branchId: branch.id, name: 'Sara (Waiter)',
      pinHash: await mkPin('3333'), roleId: roles.Waiter!,
    },
  });
  await prisma.user.create({
    data: {
      branchId: branch.id, name: 'Hassan (Kitchen)',
      pinHash: await mkPin('4444'), roleId: roles.Kitchen!,
    },
  });
  await prisma.user.create({
    data: {
      branchId: branch.id, name: 'Omar (Bar)',
      pinHash: await mkPin('5555'), roleId: roles.Bar!,
    },
  });

  // ---------- uoms ----------
  const uoms = [
    { id: 'g', label: 'gram', baseUnit: 'g', factor: 1 },
    { id: 'kg', label: 'kilogram', baseUnit: 'g', factor: 1000 },
    { id: 'ml', label: 'millilitre', baseUnit: 'ml', factor: 1 },
    { id: 'L', label: 'litre', baseUnit: 'ml', factor: 1000 },
    { id: 'pc', label: 'piece', baseUnit: 'pc', factor: 1 },
    { id: 'bottle', label: 'bottle', baseUnit: 'pc', factor: 1 },
    { id: 'case24', label: 'case of 24', baseUnit: 'pc', factor: 24 },
  ];
  await prisma.uom.createMany({ data: uoms as any });

  // ---------- loyalty tiers ----------
  await prisma.loyaltyTier.createMany({
    data: [
      { name: 'Goblin', nameAr: 'جوبلن', minLifetimeCents: 0, earnRateBps: 100, sortOrder: 1 },
      { name: 'Hobgoblin', nameAr: 'هوبجوبلن', minLifetimeCents: 5000 * 100, earnRateBps: 150, sortOrder: 2 },
      { name: 'Goblin King', nameAr: 'ملك الجوبلن', minLifetimeCents: 20000 * 100, earnRateBps: 200, sortOrder: 3 },
    ],
  });

  // ---------- Chart of Accounts ----------
  console.log('Seeding Chart of Accounts...');
  const coa = [
    // Assets
    { code: '1000', name: 'Assets', nameAr: 'الأصول', type: 'ASSET' },
    { code: '1100', name: 'Cash on Hand', nameAr: 'النقدية بالصندوق', type: 'ASSET', parentCode: '1000' },
    { code: '1110', name: 'Cash Drawer / Safe', nameAr: 'درج الكاشير / الخزينة', type: 'ASSET', parentCode: '1100' },
    { code: '1120', name: 'Main Safe', nameAr: 'الخزينة الرئيسية', type: 'ASSET', parentCode: '1100' },
    { code: '1125', name: 'Tips Drawer', nameAr: 'درج البقشيش', type: 'ASSET', parentCode: '1100' },
    { code: '1130', name: 'Custody', nameAr: 'العهدة', type: 'ASSET', parentCode: '1100' },
    { code: '1200', name: 'Bank Accounts', nameAr: 'الحسابات البنكية', type: 'ASSET', parentCode: '1000' },
    { code: '1210', name: 'Main Bank Account', nameAr: 'الحساب البنكي الرئيسي', type: 'ASSET', parentCode: '1200' },
    { code: '1220', name: 'Fawry Account', nameAr: 'حساب فوري', type: 'ASSET', parentCode: '1200' },
    { code: '1300', name: 'Accounts Receivable', nameAr: 'العملاء / المدينون', type: 'ASSET', parentCode: '1000' },
    { code: '1400', name: 'Food & Beverage Inventory', nameAr: 'مخزون الأغذية والمشروبات', type: 'ASSET', parentCode: '1000' },
    { code: '1500', name: 'Prepaid Expenses', nameAr: 'المصروفات المقدمة', type: 'ASSET', parentCode: '1000' },
    { code: '1600', name: 'Equipment & Furniture', nameAr: 'المعدات والأثاث', type: 'ASSET', parentCode: '1000' },
 
    // Liabilities
    { code: '2000', name: 'Liabilities', nameAr: 'الخصوم', type: 'LIABILITY' },
    { code: '2100', name: 'Accounts Payable', nameAr: 'الموردون / الدائنون', type: 'LIABILITY', parentCode: '2000' },
    { code: '2200', name: 'Sales Tax (VAT) Payable', nameAr: 'ضريبة القيمة المضافة المستحقة', type: 'LIABILITY', parentCode: '2000' },
    { code: '2300', name: 'Accrued Salaries', nameAr: 'الرواتب المستحقة', type: 'LIABILITY', parentCode: '2000' },
    { code: '2400', name: 'Customer Deposits', nameAr: 'تأمين عملاء', type: 'LIABILITY', parentCode: '2000' },
    { code: '2500', name: 'Tips Payable', nameAr: 'بقشيش مستحق للعامليين', type: 'LIABILITY', parentCode: '2000' },
 
    // Equity
    { code: '3000', name: 'Equity', nameAr: 'حقوق الملكية', type: 'EQUITY' },
    { code: '3100', name: "Owner's Capital", nameAr: 'رأس المال', type: 'EQUITY', parentCode: '3000' },
    { code: '3200', name: 'Retained Earnings', nameAr: 'الأرباح المحتجزة', type: 'EQUITY', parentCode: '3000' },
 
    // Revenue
    { code: '4000', name: 'Revenue', nameAr: 'الإيرادات', type: 'REVENUE' },
    { code: '4100', name: 'Food & Beverage Sales', nameAr: 'مبيعات الأغذية والمشروبات', type: 'REVENUE', parentCode: '4000' },
    { code: '4200', name: 'PlayStation Services Revenue', nameAr: 'إيرادات بلايستيشن', type: 'REVENUE', parentCode: '4000' },
    { code: '4300', name: 'Billiards Services Revenue', nameAr: 'إيرادات البلياردو', type: 'REVENUE', parentCode: '4000' },
    { code: '4400', name: 'Event Bookings & Room Rental', nameAr: 'حجز الفعاليات وإيجار الغرف', type: 'REVENUE', parentCode: '4000' },
    { code: '4500', name: 'Other Income', nameAr: 'إيرادات أخرى', type: 'REVENUE', parentCode: '4000' },
    { code: '4600', name: 'Service Charge Revenue', nameAr: 'إيرادات الخدمة', type: 'REVENUE', parentCode: '4000' },
 
    // Expenses
    { code: '5000', name: 'Expenses', nameAr: 'المصروفات', type: 'EXPENSE' },
    { code: '5100', name: 'Cost of Goods Sold (COGS)', nameAr: 'تكلفة المبيعات', type: 'EXPENSE', parentCode: '5000' },
    { code: '5110', name: 'Food & Beverage Cost', nameAr: 'تكلفة الأغذية والمشروبات', type: 'EXPENSE', parentCode: '5100' },
    { code: '5120', name: 'PlayStation & Billiards Maintenance Cost', nameAr: 'تكلفة صيانة البلايستيشن والبلياردو', type: 'EXPENSE', parentCode: '5100' },
    { code: '5200', name: 'Operating Expenses', nameAr: 'المصاريف التشغيلية', type: 'EXPENSE', parentCode: '5000' },
    { code: '5210', name: 'Salaries & Wages', nameAr: 'الرواتب والأجور', type: 'EXPENSE', parentCode: '5200' },
    { code: '5220', name: 'Rent', nameAr: 'الإيجار', type: 'EXPENSE', parentCode: '5200' },
    { code: '5230', name: 'Utilities', nameAr: 'المنافع العامة', type: 'EXPENSE', parentCode: '5200' },
    { code: '5240', name: 'Marketing & Advertising', nameAr: 'التسويق والإعلان', type: 'EXPENSE', parentCode: '5200' },
    { code: '5250', name: 'Repairs & Maintenance', nameAr: 'الإصلاحات والصيانة', type: 'EXPENSE', parentCode: '5200' },
    { code: '5260', name: 'Supplies', nameAr: 'المستلزمات', type: 'EXPENSE', parentCode: '5200' },
    { code: '5270', name: 'Printing & Stationery', nameAr: 'الطباعة والأدوات المكتبية', type: 'EXPENSE', parentCode: '5200' },
    { code: '5280', name: 'Bank Fees & Commission', nameAr: 'عمولات ومصاريف بنكية', type: 'EXPENSE', parentCode: '5200' },
    { code: '5290', name: 'Miscellaneous Expense', nameAr: 'مصاريف متنوعة', type: 'EXPENSE', parentCode: '5200' },
  ];

  const createdAccounts: Record<string, string> = {};
  for (const a of coa) {
    const parentId = a.parentCode ? createdAccounts[a.parentCode] : null;
    const acc = await prisma.account.create({
      data: {
        code: a.code,
        name: a.name,
        nameAr: a.nameAr,
        type: a.type as any,
        parentAccountId: parentId,
        isPaymentSource: ['1110', '1210', '1220'].includes(a.code),
      },
    });
    createdAccounts[a.code] = acc.id;
  }

  // Link payment methods to accounts
  await prisma.paymentMethod.updateMany({
    where: { kind: 'CASH' },
    data: { accountId: createdAccounts['1110'] },
  });
  await prisma.paymentMethod.updateMany({
    where: { kind: 'CARD' },
    data: { accountId: createdAccounts['1210'] },
  });
  await prisma.paymentMethod.updateMany({
    where: { kind: 'WALLET' },
    data: { accountId: createdAccounts['1220'] },
  });

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
    await prisma.expenseCategory.create({
      data: {
        name: cat.name,
        accountId: createdAccounts[cat.code],
      },
    });
  }

  console.log('Baseline seed completed successfully.');
}

main()
  .catch((e) => {
    console.error('Baseline seed failed:', e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
