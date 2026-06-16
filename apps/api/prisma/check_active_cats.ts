import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function check() {
  try {
    const activeCats = await prisma.category.findMany({
      where: { isActive: true },
      include: { _count: { select: { items: { where: { isActive: true } } } } }
    });
    console.log(`Active categories in DB: ${activeCats.length}`);
    console.log('Active categories with item counts:');
    for (const c of activeCats) {
      if (c._count.items > 0) {
        console.log(`- ${c.name} (ID: ${c.id}, Parent: ${c.parentCategoryId || 'None'}): ${c._count.items} active items`);
      }
    }
  } catch (e) {
    console.error(e);
  } finally {
    await prisma.$disconnect();
  }
}

check();
