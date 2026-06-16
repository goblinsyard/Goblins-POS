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

  console.log('Baseline seed completed successfully.');
}

main()
  .catch((e) => {
    console.error('Baseline seed failed:', e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
