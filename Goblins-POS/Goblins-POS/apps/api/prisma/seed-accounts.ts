import { PrismaClient, AccountType } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('Seeding Chart of Accounts...');
  const coa = [
    // Assets
    { code: '1000', name: 'Assets', nameAr: 'الأصول', type: 'ASSET' as AccountType },
    { code: '1100', name: 'Cash on Hand', nameAr: 'النقدية بالصندوق', type: 'ASSET' as AccountType, parentCode: '1000' },
    { code: '1110', name: 'Cash Drawer / Safe', nameAr: 'درج الكاشير / الخزينة', type: 'ASSET' as AccountType, parentCode: '1100' },
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
      console.log(`Created Account: ${acc.code} - ${acc.name}`);
    } else {
      console.log(`Account already exists: ${acc.code} - ${acc.name}`);
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
  console.log('Payment methods linked to accounts.');

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
  console.log('Expense categories linked to accounts.');
  console.log('Chart of Accounts seeding completed.');
}

main().catch(console.error).finally(() => prisma.$disconnect());
