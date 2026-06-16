/**
 * Goblins Yard seed — realistic demo data:
 * roles & permission matrix, staff, floor (6 tables, 4 billiards, 3 PS rooms),
 * full menu with recipes & sub-recipes, suppliers & stock, rate plans,
 * loyalty tiers, customers, and 2 weeks of simulated sales history.
 *
 * Idempotent-ish: aborts if a Branch already exists (use FORCE_RESEED=true to wipe).
 */
import { PrismaClient, Prisma } from '@prisma/client';
import * as argon2 from 'argon2';

const prisma = new PrismaClient();

const EGP = (v: number) => Math.round(v * 100); // EGP → piasters

async function main() {
  const existing = await prisma.branch.findFirst();
  if (existing && process.env.FORCE_RESEED !== 'true') {
    console.log('Seed skipped — data already present.');
    return;
  }
  if (existing) {
    console.log('FORCE_RESEED — wiping database…');
    // order matters for FK constraints; raw truncate cascade is simplest
    const tables = await prisma.$queryRaw<{ tablename: string }[]>`
      SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename NOT LIKE '_prisma%'`;
    await prisma.$executeRawUnsafe(
      `TRUNCATE TABLE ${tables.map((t) => `"${t.tablename}"`).join(', ')} CASCADE`,
    );
  }

  console.log('Seeding Goblins Yard…');

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
  const kitchenStore = await prisma.storeLocation.create({
    data: { branchId: branch.id, name: 'Kitchen', nameAr: 'المطبخ' },
  });
  const barStore = await prisma.storeLocation.create({
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

  const kitchenStation = await prisma.station.create({
    data: { name: 'Kitchen', nameAr: 'المطبخ', printerId: kitchenPrinter.id, sortOrder: 1 },
  });
  const barStation = await prisma.station.create({
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
  const cashier = await prisma.user.create({
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

  // ---------- rate plans ----------
  const billiardsPlan = await prisma.ratePlan.create({
    data: {
      name: 'Billiards standard',
      hourlyCents: EGP(120),
      minimumCents: EGP(30),
      roundToMinutes: 5,
      roundingMode: 'nearest',
      rules: {
        create: [
          {
            name: 'Weekday happy hour',
            daysOfWeek: [0, 1, 2, 3], // Sun–Wed
            startTime: '14:00',
            endTime: '17:00',
            hourlyCents: EGP(80),
            priority: 1,
          },
        ],
      },
    },
  });
  const psPlanNormal = await prisma.ratePlan.create({
    data: {
      name: 'PS5 Normal',
      hourlyCents: EGP(80),
      hourlyMultiCents: EGP(120),
      minimumCents: EGP(20),
      roundToMinutes: 5,
      roundingMode: 'nearest',
    },
  });
  const psPlanVip = await prisma.ratePlan.create({
    data: {
      name: 'PS5 VIP',
      hourlyCents: EGP(150),
      hourlyMultiCents: EGP(220),
      minimumCents: EGP(40),
      roundToMinutes: 5,
      roundingMode: 'nearest',
    },
  });

  // ---------- floor ----------
  const hallZone = await prisma.floorZone.create({ data: { name: 'Main hall', nameAr: 'الصالة', sortOrder: 1 } });
  const billiardsZone = await prisma.floorZone.create({ data: { name: 'Billiards lounge', nameAr: 'البلياردو', sortOrder: 2 } });
  const psZone = await prisma.floorZone.create({ data: { name: 'PS rooms', nameAr: 'غرف البلايستيشن', sortOrder: 3 } });

  const restaurantTables: string[] = [];
  for (let i = 1; i <= 6; i++) {
    const t = await prisma.resource.create({
      data: {
        branchId: branch.id, zoneId: hallZone.id, type: 'RESTAURANT_TABLE',
        name: `T${i}`, capacity: i <= 4 ? 4 : 6,
        posX: 60 + ((i - 1) % 3) * 140, posY: 60 + Math.floor((i - 1) / 3) * 140,
        shape: i % 2 === 0 ? 'circle' : 'rect',
      },
    });
    restaurantTables.push(t.id);
  }
  const billiardsTables: string[] = [];
  for (let i = 1; i <= 4; i++) {
    const t = await prisma.resource.create({
      data: {
        branchId: branch.id, zoneId: billiardsZone.id, type: 'BILLIARDS_TABLE',
        name: `Billiards ${i}`, nameAr: `بلياردو ${i}`, capacity: 4,
        ratePlanId: billiardsPlan.id,
        posX: 60 + ((i - 1) % 2) * 220, posY: 320 + Math.floor((i - 1) / 2) * 130,
        width: 180, height: 90,
      },
    });
    billiardsTables.push(t.id);
  }
  const psRooms: string[] = [];
  for (let i = 1; i <= 3; i++) {
    const isVip = i === 3;
    const t = await prisma.resource.create({
      data: {
        branchId: branch.id, zoneId: psZone.id, type: 'PS_ROOM',
        name: isVip ? 'PS Room C (VIP)' : `PS Room ${String.fromCharCode(64 + i)}`,
        nameAr: isVip ? 'غرفة C (VIP)' : `غرفة ${String.fromCharCode(64 + i)}`,
        capacity: 4,
        ratePlanId: isVip ? psPlanVip.id : psPlanNormal.id,
        posX: 520, posY: 60 + (i - 1) * 130, width: 120, height: 100,
      },
    });
    psRooms.push(t.id);
  }

  // ---------- units & ingredients ----------
  const uoms: Prisma.UomCreateManyInput[] = [
    { id: 'g', label: 'gram', baseUnit: 'g', factor: 1 },
    { id: 'kg', label: 'kilogram', baseUnit: 'g', factor: 1000 },
    { id: 'ml', label: 'millilitre', baseUnit: 'ml', factor: 1 },
    { id: 'L', label: 'litre', baseUnit: 'ml', factor: 1000 },
    { id: 'pc', label: 'piece', baseUnit: 'pc', factor: 1 },
    { id: 'bottle', label: 'bottle', baseUnit: 'pc', factor: 1 },
    { id: 'case24', label: 'case of 24', baseUnit: 'pc', factor: 24 },
  ];
  await prisma.uom.createMany({ data: uoms });

  // helper to create an ingredient with opening stock
  async function ingredient(
    name: string, uomId: string, costPerUnitEgp: number,
    stock: { loc: string; qty: number }[], opts: Partial<Prisma.IngredientUncheckedCreateInput> = {},
  ) {
    // exact piasters — per-gram costs are fractional (e.g. flour 1.5 pt/g), never round
    const exactCost = new Prisma.Decimal(String(costPerUnitEgp)).mul(100);
    const ing = await prisma.ingredient.create({
      data: {
        name, uomId,
        avgCostCents: exactCost,
        lastCostCents: exactCost,
        ...opts,
      },
    });
    for (const s of stock) {
      await prisma.stockLevel.create({
        data: { ingredientId: ing.id, locationId: s.loc, quantity: new Prisma.Decimal(s.qty) },
      });
    }
    return ing;
  }

  const K = kitchenStore.id, B = barStore.id, M = mainStore.id;
  // raw ingredients (cost per stock UoM)
  const beefPatty = await ingredient('Beef patty 150g', 'pc', 35, [{ loc: K, qty: 80 }], { isPerishable: true });
  const burgerBun = await ingredient('Burger bun', 'pc', 8, [{ loc: K, qty: 100 }], { isPerishable: true });
  const cheddar = await ingredient('Cheddar slice', 'pc', 5, [{ loc: K, qty: 200 }]);
  const lettuce = await ingredient('Lettuce', 'g', 0.05, [{ loc: K, qty: 3000 }], { isPerishable: true });
  const tomato = await ingredient('Tomato', 'g', 0.04, [{ loc: K, qty: 5000 }], { isPerishable: true });
  const fries = await ingredient('Frozen fries', 'g', 0.06, [{ loc: K, qty: 20000 }]);
  const mozzarella = await ingredient('Mozzarella', 'g', 0.25, [{ loc: K, qty: 8000 }], { isPerishable: true });
  const flour = await ingredient('Flour', 'g', 0.015, [{ loc: K, qty: 25000 }, { loc: M, qty: 50000 }]);
  const tomatoSauceRaw = await ingredient('Canned tomato', 'g', 0.045, [{ loc: K, qty: 10000 }, { loc: M, qty: 20000 }]);
  const pasta = await ingredient('Penne pasta', 'g', 0.07, [{ loc: K, qty: 12000 }]);
  const chicken = await ingredient('Chicken breast', 'g', 0.18, [{ loc: K, qty: 15000 }], { isPerishable: true });
  const cookingCream = await ingredient('Cooking cream', 'ml', 0.09, [{ loc: K, qty: 6000 }], { isPerishable: true });
  const coffee = await ingredient('Espresso beans', 'g', 0.9, [{ loc: B, qty: 4000 }]);
  const milk = await ingredient('Milk', 'ml', 0.035, [{ loc: B, qty: 20000 }], { isPerishable: true });
  const sugar = await ingredient('Sugar', 'g', 0.02, [{ loc: B, qty: 10000 }, { loc: M, qty: 25000 }]);
  const tea = await ingredient('Tea bags', 'pc', 1.5, [{ loc: B, qty: 500 }]);
  const mango = await ingredient('Mango pulp', 'g', 0.12, [{ loc: B, qty: 8000 }], { isPerishable: true });
  const orange = await ingredient('Oranges', 'g', 0.03, [{ loc: B, qty: 15000 }], { isPerishable: true });
  const mintLeaves = await ingredient('Fresh mint', 'g', 0.15, [{ loc: B, qty: 1500 }], { isPerishable: true });
  const limes = await ingredient('Limes', 'g', 0.06, [{ loc: B, qty: 5000 }], { isPerishable: true });
  const soda = await ingredient('Sprite (bottle)', 'bottle', 12, [{ loc: B, qty: 96 }]);
  const cola = await ingredient('Cola (bottle)', 'bottle', 12, [{ loc: B, qty: 120 }]);
  const water = await ingredient('Water (bottle)', 'bottle', 5, [{ loc: B, qty: 150 }]);
  const shishaTobacco = await ingredient('Shisha tobacco', 'g', 0.6, [{ loc: B, qty: 3000 }]);
  const charcoal = await ingredient('Charcoal', 'pc', 2, [{ loc: B, qty: 400 }]);

  // intermediate (sub-recipe outputs)
  const mojitoBase = await ingredient('Mojito base (batch)', 'ml', 0, [{ loc: B, qty: 0 }], { isIntermediate: true });
  const pizzaDough = await ingredient('Pizza dough ball', 'pc', 0, [{ loc: K, qty: 0 }], { isIntermediate: true });
  const redSauce = await ingredient('Red sauce (batch)', 'ml', 0, [{ loc: K, qty: 0 }], { isIntermediate: true });
  // ---------- sub-recipes (manufacturing) ----------
  await prisma.manufacturingProcess.create({
    data: {
      name: 'Mojito base 2L batch',
      outputIngredientId: mojitoBase.id,
      yieldQty: new Prisma.Decimal(2000), // ml
      deductLocationName: 'Bar',
      prepInstructions: 'Muddle mint + lime + sugar, top with soda. Chill.',
      lines: {
        create: [
          { ingredientId: mintLeaves.id, quantity: new Prisma.Decimal(0.06) },
          { ingredientId: limes.id, quantity: new Prisma.Decimal(0.2) },
          { ingredientId: sugar.id, quantity: new Prisma.Decimal(0.1) },
          { ingredientId: soda.id, quantity: new Prisma.Decimal(0.00075) },
        ],
      },
    },
  });

  await prisma.manufacturingProcess.create({
    data: {
      name: 'Pizza dough — 10 balls',
      outputIngredientId: pizzaDough.id,
      yieldQty: new Prisma.Decimal(10),
      deductLocationName: 'Kitchen',
      prepInstructions: 'Mix, knead, proof 2h, ball at 250g.',
      lines: {
        create: [
          { ingredientId: flour.id, quantity: new Prisma.Decimal(180) }, // g per ball
          { ingredientId: sugar.id, quantity: new Prisma.Decimal(5) },
        ],
      },
    },
  });

  await prisma.manufacturingProcess.create({
    data: {
      name: 'Red sauce 3L batch',
      outputIngredientId: redSauce.id,
      yieldQty: new Prisma.Decimal(3000),
      deductLocationName: 'Kitchen',
      prepInstructions: 'Simmer canned tomato with seasoning 40 min.',
      lines: {
        create: [{ ingredientId: tomatoSauceRaw.id, quantity: new Prisma.Decimal(1.1) }], // g per ml
      },
    },
  });

  // ---------- menu ----------
  const catHot = await prisma.category.create({ data: { name: 'Hot drinks', nameAr: 'مشروبات ساخنة', sortOrder: 1, color: '#b45309' } });
  const catJuice = await prisma.category.create({ data: { name: 'Fresh juices', nameAr: 'عصائر طازجة', sortOrder: 2, color: '#f59e0b' } });
  const catSoft = await prisma.category.create({ data: { name: 'Soft drinks', nameAr: 'مشروبات غازية', sortOrder: 3, color: '#0ea5e9' } });
  const catMocktail = await prisma.category.create({ data: { name: 'Mocktails', nameAr: 'موكتيلز', sortOrder: 4, color: '#10b981' } });
  const catBurger = await prisma.category.create({ data: { name: 'Burgers', nameAr: 'برجر', sortOrder: 5, color: '#dc2626' } });
  const catPizza = await prisma.category.create({ data: { name: 'Pizza', nameAr: 'بيتزا', sortOrder: 6, color: '#ea580c' } });
  const catPasta = await prisma.category.create({ data: { name: 'Pasta', nameAr: 'مكرونة', sortOrder: 7, color: '#ca8a04' } });
  const catApps = await prisma.category.create({ data: { name: 'Appetizers', nameAr: 'مقبلات', sortOrder: 8, color: '#65a30d' } });
  const catShisha = await prisma.category.create({ data: { name: 'Shisha', nameAr: 'شيشة', sortOrder: 9, color: '#6b7280' } });

  // modifier groups
  const sizeGroup = await prisma.modifierGroup.create({
    data: {
      name: 'Size', nameAr: 'الحجم', minSelect: 1, maxSelect: 1,
      modifiers: { create: [
        { name: 'Regular', nameAr: 'عادي', priceDeltaCents: 0, sortOrder: 1 },
        { name: 'Large', nameAr: 'كبير', priceDeltaCents: EGP(10), sortOrder: 2 },
      ] },
    },
  });
  const extrasGroup = await prisma.modifierGroup.create({
    data: {
      name: 'Extras', nameAr: 'إضافات', minSelect: 0, maxSelect: 3,
      modifiers: { create: [
        { name: 'Extra cheese', nameAr: 'جبنة زيادة', priceDeltaCents: EGP(15), sortOrder: 1 },
        { name: 'Extra patty', nameAr: 'لحمة زيادة', priceDeltaCents: EGP(40), sortOrder: 2 },
        { name: 'Bacon (beef)', nameAr: 'بيكون', priceDeltaCents: EGP(20), sortOrder: 3 },
      ] },
    },
  });
  const iceGroup = await prisma.modifierGroup.create({
    data: {
      name: 'Ice', nameAr: 'الثلج', minSelect: 0, maxSelect: 1,
      modifiers: { create: [
        { name: 'No ice', nameAr: 'بدون ثلج', priceDeltaCents: 0, sortOrder: 1 },
        { name: 'Less ice', nameAr: 'ثلج خفيف', priceDeltaCents: 0, sortOrder: 2 },
      ] },
    },
  });
  const spiceGroup = await prisma.modifierGroup.create({
    data: {
      name: 'Spice level', nameAr: 'الحرارة', minSelect: 0, maxSelect: 1,
      modifiers: { create: [
        { name: 'Mild', nameAr: 'خفيف', priceDeltaCents: 0, sortOrder: 1 },
        { name: 'Hot', nameAr: 'حار', priceDeltaCents: 0, sortOrder: 2 },
        { name: 'Extra hot', nameAr: 'حار جداً', priceDeltaCents: 0, sortOrder: 3 },
      ] },
    },
  });

  interface ItemDef {
    cat: string; name: string; nameAr: string; price: number; station: string;
    dept?: 'RESTAURANT' | 'BAR';
    mods?: string[];
    recipe?: { lines: { ing: string; qty: number }[]; deduct: 'Kitchen' | 'Bar' };
  }
  const items: ItemDef[] = [
    // hot drinks (bar)
    { cat: catHot.id, name: 'Espresso', nameAr: 'إسبريسو', price: 45, station: barStation.id, dept: 'BAR',
      recipe: { lines: [{ ing: coffee.id, qty: 18 }], deduct: 'Bar' } },
    { cat: catHot.id, name: 'Cappuccino', nameAr: 'كابتشينو', price: 60, station: barStation.id, dept: 'BAR', mods: [sizeGroup.id],
      recipe: { lines: [{ ing: coffee.id, qty: 18 }, { ing: milk.id, qty: 150 }], deduct: 'Bar' } },
    { cat: catHot.id, name: 'Turkish coffee', nameAr: 'قهوة تركي', price: 40, station: barStation.id, dept: 'BAR',
      recipe: { lines: [{ ing: coffee.id, qty: 12 }, { ing: sugar.id, qty: 8 }], deduct: 'Bar' } },
    { cat: catHot.id, name: 'Tea', nameAr: 'شاي', price: 30, station: barStation.id, dept: 'BAR',
      recipe: { lines: [{ ing: tea.id, qty: 1 }, { ing: sugar.id, qty: 8 }], deduct: 'Bar' } },
    // juices (bar)
    { cat: catJuice.id, name: 'Mango juice', nameAr: 'عصير مانجو', price: 70, station: barStation.id, dept: 'BAR', mods: [iceGroup.id],
      recipe: { lines: [{ ing: mango.id, qty: 200 }, { ing: sugar.id, qty: 15 }], deduct: 'Bar' } },
    { cat: catJuice.id, name: 'Orange juice', nameAr: 'عصير برتقال', price: 60, station: barStation.id, dept: 'BAR', mods: [iceGroup.id],
      recipe: { lines: [{ ing: orange.id, qty: 400 }], deduct: 'Bar' } },
    // soft drinks (bar)
    { cat: catSoft.id, name: 'Cola', nameAr: 'كولا', price: 30, station: barStation.id, dept: 'BAR',
      recipe: { lines: [{ ing: cola.id, qty: 1 }], deduct: 'Bar' } },
    { cat: catSoft.id, name: 'Water', nameAr: 'مياه', price: 15, station: barStation.id, dept: 'BAR',
      recipe: { lines: [{ ing: water.id, qty: 1 }], deduct: 'Bar' } },
    // mocktails — consume the mojito base INTERMEDIATE (sub-recipe flow)
    { cat: catMocktail.id, name: 'Virgin Mojito', nameAr: 'موهيتو', price: 85, station: barStation.id, dept: 'BAR', mods: [iceGroup.id],
      recipe: { lines: [{ ing: mojitoBase.id, qty: 200 }, { ing: mintLeaves.id, qty: 5 }], deduct: 'Bar' } },
    { cat: catMocktail.id, name: 'Mango Mojito', nameAr: 'مانجو موهيتو', price: 95, station: barStation.id, dept: 'BAR', mods: [iceGroup.id],
      recipe: { lines: [{ ing: mojitoBase.id, qty: 150 }, { ing: mango.id, qty: 100 }], deduct: 'Bar' } },
    // burgers (kitchen)
    { cat: catBurger.id, name: 'Classic Goblin Burger', nameAr: 'برجر كلاسيك', price: 180, station: kitchenStation.id, mods: [extrasGroup.id, spiceGroup.id],
      recipe: { lines: [
        { ing: beefPatty.id, qty: 1 }, { ing: burgerBun.id, qty: 1 }, { ing: cheddar.id, qty: 1 },
        { ing: lettuce.id, qty: 20 }, { ing: tomato.id, qty: 30 }, { ing: fries.id, qty: 150 },
      ], deduct: 'Kitchen' } },
    { cat: catBurger.id, name: 'Double Trouble Burger', nameAr: 'برجر دبل', price: 250, station: kitchenStation.id, mods: [extrasGroup.id, spiceGroup.id],
      recipe: { lines: [
        { ing: beefPatty.id, qty: 2 }, { ing: burgerBun.id, qty: 1 }, { ing: cheddar.id, qty: 2 },
        { ing: lettuce.id, qty: 20 }, { ing: tomato.id, qty: 30 }, { ing: fries.id, qty: 150 },
      ], deduct: 'Kitchen' } },
    // pizza — consumes dough INTERMEDIATE + red sauce INTERMEDIATE
    { cat: catPizza.id, name: 'Margherita', nameAr: 'مارجريتا', price: 160, station: kitchenStation.id,
      recipe: { lines: [
        { ing: pizzaDough.id, qty: 1 }, { ing: redSauce.id, qty: 80 }, { ing: mozzarella.id, qty: 120 },
      ], deduct: 'Kitchen' } },
    { cat: catPizza.id, name: 'Chicken BBQ Pizza', nameAr: 'بيتزا فراخ باربيكيو', price: 210, station: kitchenStation.id,
      recipe: { lines: [
        { ing: pizzaDough.id, qty: 1 }, { ing: redSauce.id, qty: 60 }, { ing: mozzarella.id, qty: 100 }, { ing: chicken.id, qty: 120 },
      ], deduct: 'Kitchen' } },
    // pasta
    { cat: catPasta.id, name: 'Penne Alfredo', nameAr: 'بيني ألفريدو', price: 170, station: kitchenStation.id,
      recipe: { lines: [
        { ing: pasta.id, qty: 180 }, { ing: chicken.id, qty: 100 }, { ing: cookingCream.id, qty: 120 },
      ], deduct: 'Kitchen' } },
    { cat: catPasta.id, name: 'Penne Arrabbiata', nameAr: 'بيني أرابياتا', price: 140, station: kitchenStation.id, mods: [spiceGroup.id],
      recipe: { lines: [
        { ing: pasta.id, qty: 180 }, { ing: redSauce.id, qty: 150 },
      ], deduct: 'Kitchen' } },
    // appetizers
    { cat: catApps.id, name: 'Fries basket', nameAr: 'بطاطس', price: 60, station: kitchenStation.id,
      recipe: { lines: [{ ing: fries.id, qty: 250 }], deduct: 'Kitchen' } },
    { cat: catApps.id, name: 'Cheese sticks', nameAr: 'أصابع جبنة', price: 90, station: kitchenStation.id,
      recipe: { lines: [{ ing: mozzarella.id, qty: 120 }, { ing: flour.id, qty: 40 }], deduct: 'Kitchen' } },
    // shisha (configurable category — bar station)
    { cat: catShisha.id, name: 'Shisha — Double Apple', nameAr: 'شيشة تفاحتين', price: 100, station: barStation.id, dept: 'BAR',
      recipe: { lines: [{ ing: shishaTobacco.id, qty: 25 }, { ing: charcoal.id, qty: 3 }], deduct: 'Bar' } },
    { cat: catShisha.id, name: 'Shisha — Mint', nameAr: 'شيشة نعناع', price: 100, station: barStation.id, dept: 'BAR',
      recipe: { lines: [{ ing: shishaTobacco.id, qty: 25 }, { ing: charcoal.id, qty: 3 }], deduct: 'Bar' } },
  ];

  const menuItemIds: { id: string; price: number; name: string }[] = [];
  for (const def of items) {
    const mi = await prisma.menuItem.create({
      data: {
        categoryId: def.cat, name: def.name, nameAr: def.nameAr,
        priceCents: EGP(def.price), taxRateId: vat.id, stationId: def.station,
        department: def.dept ?? 'RESTAURANT',
        modifierGroups: def.mods
          ? { create: def.mods.map((g) => ({ groupId: g })) }
          : undefined,
        recipe: def.recipe
          ? {
              create: {
                name: `${def.name} recipe`,
                deductLocationName: def.recipe.deduct,
                lines: {
                  create: def.recipe.lines.map((l) => ({
                    ingredientId: l.ing,
                    quantity: new Prisma.Decimal(l.qty),
                  })),
                },
              },
            }
          : undefined,
      },
    });
    menuItemIds.push({ id: mi.id, price: EGP(def.price), name: def.name });
  }

  // happy-hour price example on cappuccino
  const capp = menuItemIds.find((m) => m.name === 'Cappuccino')!;
  await prisma.priceSchedule.create({
    data: {
      itemId: capp.id, name: 'Morning deal', priceCents: EGP(45),
      daysOfWeek: [0, 1, 2, 3, 4], startTime: '08:00', endTime: '12:00',
    },
  });

  // ---------- suppliers ----------
  const sup1 = await prisma.supplier.create({
    data: { name: 'Cairo Fresh Produce', phone: '+20 100 111 2222' },
  });
  const sup2 = await prisma.supplier.create({
    data: { name: 'Delta Meat Co.', phone: '+20 100 333 4444' },
  });
  await prisma.supplier.create({
    data: { name: 'Nile Beverages', phone: '+20 100 555 6666' },
  });
  await prisma.supplierPriceHistory.createMany({
    data: [
      { supplierId: sup2.id, ingredientId: beefPatty.id, unitCostCents: new Prisma.Decimal(EGP(35)) },
      { supplierId: sup1.id, ingredientId: tomato.id, unitCostCents: new Prisma.Decimal(EGP(0.04)) },
      { supplierId: sup1.id, ingredientId: orange.id, unitCostCents: new Prisma.Decimal(EGP(0.03)) },
    ],
  });

  // ---------- loyalty tiers ----------
  await prisma.loyaltyTier.createMany({
    data: [
      { name: 'Goblin', nameAr: 'جوبلن', minLifetimeCents: 0, earnRateBps: 100, sortOrder: 1 },
      { name: 'Hobgoblin', nameAr: 'هوبجوبلن', minLifetimeCents: EGP(5000), earnRateBps: 150, sortOrder: 2 },
      { name: 'Goblin King', nameAr: 'ملك الجوبلن', minLifetimeCents: EGP(20000), earnRateBps: 200, sortOrder: 3 },
    ],
  });
  const tierGoblin = await prisma.loyaltyTier.findFirstOrThrow({ where: { name: 'Goblin' } });

  // ---------- customers ----------
  const customerDefs = [
    { phone: '+201001234567', name: 'Ahmed Mostafa', birthday: new Date('1995-06-15') },
    { phone: '+201007654321', name: 'Nour El-Sayed', birthday: new Date('1998-03-22') },
    { phone: '+201009876543', name: 'Youssef Khaled' },
    { phone: '+201005551234', name: 'Mariam Adel', birthday: new Date('2000-11-08') },
    { phone: '+201003337777', name: 'Omar Farouk' },
  ];
  const customers: string[] = [];
  for (const c of customerDefs) {
    const cust = await prisma.customer.create({
      data: { ...c, tierId: tierGoblin.id, tags: ['regular'] },
    });
    customers.push(cust.id);
  }

  // ---------- 2 weeks of simulated sales history ----------
  console.log('Generating 2 weeks of sales history…');
  const cash = await prisma.paymentMethod.findFirstOrThrow({ where: { kind: 'CASH' } });
  const card = await prisma.paymentMethod.findFirstOrThrow({ where: { kind: 'CARD' } });
  let orderNo = 1;
  const now = Date.now();
  const DAY = 86400_000;

  for (let day = 14; day >= 1; day--) {
    const dayStart = new Date(now - day * DAY);
    dayStart.setHours(12, 0, 0, 0); // venue opens at noon
    const shift = await prisma.shift.create({
      data: {
        branchId: branch.id, openedById: cashier.id,
        openedAt: dayStart, floatCents: EGP(500),
        status: 'CLOSED',
        closedAt: new Date(dayStart.getTime() + 12 * 3600_000),
      },
    });

    const ordersToday = 12 + Math.floor(Math.random() * 10);
    for (let o = 0; o < ordersToday; o++) {
      const openedAt = new Date(dayStart.getTime() + Math.random() * 11 * 3600_000);
      const itemCount = 1 + Math.floor(Math.random() * 4);
      const lines: { item: (typeof menuItemIds)[0]; qty: number }[] = [];
      for (let i = 0; i < itemCount; i++) {
        lines.push({
          item: menuItemIds[Math.floor(Math.random() * menuItemIds.length)]!,
          qty: 1 + Math.floor(Math.random() * 2),
        });
      }
      const subtotal = lines.reduce((a, l) => a + l.item.price * l.qty, 0);
      const service = Math.round(subtotal * 0.12);
      const tax = Math.round((subtotal + service) * 0.14);
      const total = subtotal + service + tax;
      const isDineIn = Math.random() < 0.7;
      const withCustomer = Math.random() < 0.3;

      const order = await prisma.order.create({
        data: {
          branchId: branch.id, number: orderNo++,
          type: isDineIn ? 'DINE_IN' : 'TAKEAWAY',
          status: 'PAID',
          resourceId: isDineIn ? restaurantTables[Math.floor(Math.random() * 6)] : null,
          customerId: withCustomer ? customers[Math.floor(Math.random() * customers.length)] : null,
          openedById: cashier.id, shiftId: shift.id,
          subtotalCents: subtotal, serviceChargeCents: service, taxCents: tax, totalCents: total,
          paidCents: total,
          openedAt, closedAt: new Date(openedAt.getTime() + 45 * 60_000),
          items: {
            create: lines.map((l, idx) => ({
              itemId: l.item.id, description: l.item.name,
              quantity: new Prisma.Decimal(l.qty), unitCents: l.item.price,
              lineCents: l.item.price * l.qty, taxBps: 1400,
              status: 'SENT', kdsStatus: 'SERVED', sortOrder: idx,
            })),
          },
          payments: {
            create: [{
              methodId: Math.random() < 0.6 ? cash.id : card.id,
              amountCents: total, shiftId: shift.id,
              createdAt: new Date(openedAt.getTime() + 40 * 60_000),
            }],
          },
        },
      });

      // loyalty earn for customer orders
      if (withCustomer && order.customerId) {
        const points = Math.floor(total / EGP(100));
        if (points > 0) {
          await prisma.pointsTransaction.create({
            data: { customerId: order.customerId, orderId: order.id, points, kind: 'EARN' },
          });
          await prisma.customer.update({
            where: { id: order.customerId },
            data: {
              pointsBalance: { increment: points },
              lifetimeCents: { increment: total },
              visitCount: { increment: 1 },
            },
          });
        }
      }
    }

    // a few billiards/PS sessions per day
    const sessionsToday = 3 + Math.floor(Math.random() * 4);
    for (let s = 0; s < sessionsToday; s++) {
      const isPs = Math.random() < 0.45;
      let resId: string;
      let plan: any;
      let isMulti = false;
      if (isPs) {
        const roomIdx = Math.floor(Math.random() * 3);
        resId = psRooms[roomIdx]!;
        plan = roomIdx === 2 ? psPlanVip : psPlanNormal;
        isMulti = Math.random() < 0.5;
      } else {
        resId = billiardsTables[Math.floor(Math.random() * 4)]!;
        plan = billiardsPlan;
      }
      const startedAt = new Date(dayStart.getTime() + Math.random() * 9 * 3600_000);
      const minutes = 30 + Math.floor(Math.random() * 120);
      const endedAt = new Date(startedAt.getTime() + minutes * 60_000);
      const hourly = isMulti ? plan.hourlyMultiCents! : plan.hourlyCents;
      const billed = Math.max(Math.round((minutes * hourly) / 60), plan.minimumCents);
      const service2 = Math.round(billed * 0.12);
      const tax2 = Math.round((billed + service2) * 0.14);
      const total2 = billed + service2 + tax2;

      const order = await prisma.order.create({
        data: {
          branchId: branch.id, number: orderNo++,
          type: isPs ? 'PS_ROOM' : 'BILLIARDS', status: 'PAID',
          resourceId: resId, openedById: cashier.id, shiftId: shift.id,
          subtotalCents: billed, serviceChargeCents: service2, taxCents: tax2,
          totalCents: total2, paidCents: total2,
          openedAt: startedAt, closedAt: endedAt,
          items: {
            create: [{
              description: `${isPs ? 'PS room' : 'Billiards'} time — ${minutes} min`,
              quantity: new Prisma.Decimal(1), unitCents: billed, lineCents: billed,
              taxBps: 1400, isTimeCharge: true, status: 'SENT', kdsStatus: 'SERVED',
            }],
          },
          payments: {
            create: [{ methodId: cash.id, amountCents: total2, shiftId: shift.id, createdAt: endedAt }],
          },
        },
      });
      await prisma.session.create({
        data: {
          resourceId: resId, ratePlanId: plan.id, orderId: order.id,
          status: 'STOPPED', isMultiplayer: isMulti,
          startedAt, endedAt, billedCents: billed, billedMinutes: minutes,
          segments: {
            create: [{ resourceId: resId, isMultiplayer: isMulti, startedAt, endedAt }],
          },
        },
      });
    }
  }

  // ---------- Chart of Accounts ----------
  console.log('Seeding Chart of Accounts...');
  const coa = [
    // Assets
    { code: '1000', name: 'Assets', nameAr: 'الأصول', type: 'ASSET' },
    { code: '1100', name: 'Cash on Hand', nameAr: 'النقدية بالصندوق', type: 'ASSET', parentCode: '1000' },
    { code: '1110', name: 'Cash Drawer / Safe', nameAr: 'درج الكاشير / الخزينة', type: 'ASSET', parentCode: '1100' },
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

  // Link payment methods to accounts in seed
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


  // ---------- expense categories + sample expenses ----------
  const expCats = [
    { name: 'Rent', code: '5220' },
    { name: 'Utilities', code: '5230' },
    { name: 'Salaries', code: '5210' },
    { name: 'Marketing', code: '5240' },
    { name: 'Maintenance', code: '5250' },
    { name: 'COGS adjustment', code: '5110' },
  ];
  const owner = await prisma.user.findFirstOrThrow({ where: { email: 'owner@goblinsyard.com' } });
  for (const cat of expCats) {
    await prisma.expenseCategory.create({
      data: {
        name: cat.name,
        accountId: createdAccounts[cat.code],
      },
    });
  }
  const utilCat = await prisma.expenseCategory.findFirstOrThrow({ where: { name: 'Utilities' } });
  await prisma.expense.create({
    data: {
      branchId: branch.id,
      categoryId: utilCat.id,
      accountId: utilCat.accountId,
      description: 'Electricity bill',
      amountCents: EGP(8500),
      expenseDate: new Date(now - 5 * DAY),
      enteredById: owner.id,
    },
  });

  // ---------- a couple of upcoming reservations ----------
  const tomorrow8pm = new Date(now + DAY);
  tomorrow8pm.setHours(20, 0, 0, 0);
  await prisma.reservation.create({
    data: {
      branchId: branch.id, resourceId: billiardsTables[0]!, customerId: customers[0]!,
      partySize: 4, startAt: tomorrow8pm,
      endAt: new Date(tomorrow8pm.getTime() + 2 * 3600_000),
      status: 'CONFIRMED',
    },
  });

  console.log(`Seed complete: ${orderNo - 1} orders over 14 days.`);
  console.log('Logins — owner@goblinsyard.com / admin123 (back office); PINs: Owner 9999, Manager 1111, Cashier 2222.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
