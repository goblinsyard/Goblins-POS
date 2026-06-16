import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function check() {
  try {
    const cat = await prisma.category.findUnique({
      where: { id: '117' },
      include: { items: true }
    });
    console.log('Category 117:', { id: cat?.id, name: cat?.name, parent: cat?.parentCategoryId, isActive: cat?.isActive });
    console.log('Items in category 117 (first 10):');
    console.log(cat?.items.slice(0, 10).map(i => ({ id: i.id, name: i.name, isActive: i.isActive, price: i.priceCents })));
  } catch (e) {
    console.error(e);
  } finally {
    await prisma.$disconnect();
  }
}

check();
