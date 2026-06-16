import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function check() {
  try {
    const items = await prisma.menuItem.findMany({
      where: { categoryId: '78' }
    });
    console.log(`Items in category 78 (Soup) in DB: ${items.length}`);
    console.log(items.map(i => ({ id: i.id, name: i.name, isActive: i.isActive, price: i.priceCents })));
  } catch (e) {
    console.error(e);
  } finally {
    await prisma.$disconnect();
  }
}

check();
