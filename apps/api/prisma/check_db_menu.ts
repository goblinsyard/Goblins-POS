import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function check() {
  try {
    const cats = await prisma.category.findMany({
      include: { _count: { select: { items: true } } }
    });
    console.log(`Total categories in DB: ${cats.length}`);
    console.log('Sample categories:');
    console.log(cats.slice(0, 10).map(c => ({ id: c.id, name: c.name, isActive: c.isActive, count: c._count.items })));
    
    const itemsCount = await prisma.menuItem.count();
    console.log(`Total MenuItem records in DB: ${itemsCount}`);
  } catch (e) {
    console.error(e);
  } finally {
    await prisma.$disconnect();
  }
}

check();
