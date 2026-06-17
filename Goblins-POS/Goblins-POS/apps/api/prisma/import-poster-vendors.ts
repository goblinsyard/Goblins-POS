import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const token = '608147:008369291fa894e30ff02d042efb7a04';
const subdomain = 'goblins-yard2';

async function main() {
  console.log('Fetching suppliers from Poster POS API...');
  const url = `https://${subdomain}.joinposter.com/api/storage.getSuppliers?token=${token}`;
  const res = await fetch(url);
  const json = await res.json() as any;

  if (json.error) {
    throw new Error(`Poster API error: ${JSON.stringify(json.error)}`);
  }

  const posterSuppliers = json.response || [];
  console.log(`Fetched ${posterSuppliers.length} suppliers from Poster.`);

  let importedCount = 0;
  let updatedCount = 0;

  for (const s of posterSuppliers) {
    if (!s.supplier_name) continue;

    const name = s.supplier_name.trim();
    const phone = s.supplier_phone ? s.supplier_phone.trim() : null;
    const taxId = s.supplier_tin ? s.supplier_tin.trim() : null;
    const notes = s.supplier_comment ? s.supplier_comment.trim() : null;
    const isActive = s.delete === '0';

    const existing = await prisma.supplier.findFirst({
      where: { name }
    });

    const supplierData = {
      phone,
      email: null,
      taxId,
      notes,
      isActive
    };

    if (existing) {
      await prisma.supplier.update({
        where: { id: existing.id },
        data: supplierData
      });
      updatedCount++;
    } else {
      await prisma.supplier.create({
        data: {
          name,
          ...supplierData
        }
      });
      importedCount++;
    }
  }

  console.log('\nPoster POS Supplier Import completed successfully.');
  console.log(`Summary:`);
  console.log(`- Total Poster Suppliers: ${posterSuppliers.length}`);
  console.log(`- New Suppliers Imported: ${importedCount}`);
  console.log(`- Existing Suppliers Updated: ${updatedCount}`);
}

main()
  .catch((e) => {
    console.error('Poster POS Supplier Import failed:', e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
