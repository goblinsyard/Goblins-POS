import { PrismaClient } from '@prisma/client';
import * as XLSX from 'xlsx';

const prisma = new PrismaClient();

function cleanPhone(phoneRaw: any): string {
  if (!phoneRaw) return '';
  const p = String(phoneRaw).replace(/\s+/g, ''); // Remove all spaces
  if (p.startsWith('+')) {
    return p;
  }
  if (p.startsWith('20')) {
    return '+' + p;
  }
  if (p.startsWith('01') && p.length === 11) {
    return '+2' + p;
  }
  if (p.length === 11) {
    return '+2' + p;
  }
  return p;
}

function swapFirstAndRest(name: string): string {
  const clean = name.trim();
  const words = clean.split(/\s+/);
  if (words.length <= 1) return clean;

  const lastName = words[0];
  const firstName = words.slice(1).join(' ');
  return `${firstName} ${lastName}`;
}

async function main() {
  console.log('Starting customer import...');
  
  // Read workbook
  const filePath = 'C:\\Users\\Tamer\\Downloads\\export_clients_260613 (1).xlsx';
  const workbook = XLSX.readFile(filePath);
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) {
    throw new Error('No sheets found in workbook');
  }
  
  const worksheet = workbook.Sheets[sheetName];
  if (!worksheet) {
    throw new Error(`Worksheet ${sheetName} not found`);
  }
  const rows = XLSX.utils.sheet_to_json<any[]>(worksheet, { header: 1 });
  
  // Skip the first row (empty/offset) and the header row (index 1)
  const dataRows = rows.slice(2);
  console.log(`Found ${dataRows.length} potential customer rows to import.`);

  // Get default Loyalty Tier
  const tierGoblin = await prisma.loyaltyTier.findFirst({
    where: { name: 'Goblin' }
  });

  let createdCount = 0;
  let updatedCount = 0;
  let skippedCount = 0;

  for (const row of dataRows) {
    // Row mapping:
    // Index 1: Name
    // Index 3: Phone
    // Index 4: Group Name
    // Index 6: Overall Sum (lifetime EGP)
    
    const rawName = row[1];
    const rawPhone = row[3];
    const rawGroupName = row[4];
    const rawSum = row[6];

    const rawNameStr = typeof rawName === 'string' ? rawName.trim() : '';
    const name = swapFirstAndRest(rawNameStr);
    const phone = cleanPhone(rawPhone);
    const groupName = typeof rawGroupName === 'string' ? rawGroupName.trim() : '';
    const overallSum = typeof rawSum === 'number' ? rawSum : (rawSum ? parseFloat(rawSum) : 0);

    if (!phone || !name) {
      skippedCount++;
      continue;
    }

    // Convert EGP to Cents (piasters)
    const lifetimeCents = Math.round(overallSum * 100);
    // 1 point per 100 EGP = 1 point per 10000 cents
    const pointsBalance = Math.floor(lifetimeCents / 10000);

    // Find or create customer group if present
    let groupId: string | undefined = undefined;
    if (groupName) {
      const group = await prisma.customerGroup.upsert({
        where: { name: groupName },
        update: {},
        create: { name: groupName, discountBps: 0 }
      });
      groupId = group.id;
    }

    // Check if customer already exists to increment statistics
    const existing = await prisma.customer.findUnique({
      where: { phone }
    });

    await prisma.customer.upsert({
      where: { phone },
      update: {
        name,
        lifetimeCents,
        pointsBalance,
        groupId: groupId || null,
      },
      create: {
        phone,
        name,
        lifetimeCents,
        pointsBalance,
        groupId: groupId || null,
        tierId: tierGoblin ? tierGoblin.id : null,
      }
    });

    if (existing) {
      updatedCount++;
    } else {
      createdCount++;
    }
  }

  console.log('Customer import completed successfully.');
  console.log(`Summary:`);
  console.log(`- Created: ${createdCount}`);
  console.log(`- Updated/Overwritten: ${updatedCount}`);
  console.log(`- Skipped (invalid name or phone): ${skippedCount}`);
}

main()
  .catch((e) => {
    console.error('Import failed with error:', e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
