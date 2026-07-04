import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const token = '608147:008369291fa894e30ff02d042efb7a04';
const subdomain = 'goblins-yard2';

async function main() {
  console.log('Fetching clients from Poster POS API...');
  const url = `https://${subdomain}.joinposter.com/api/clients.getClients?token=${token}`;
  const res = await fetch(url);
  const json = await res.json() as any;

  if (json.error) {
    throw new Error(`Poster API error: ${JSON.stringify(json.error)}`);
  }

  const posterClients = json.response || [];
  console.log(`Fetched ${posterClients.length} clients from Poster.`);

  // Resolve default loyalty tier
  const defaultTier = await prisma.loyaltyTier.findFirst({
    orderBy: { sortOrder: 'asc' },
  });

  let importedCount = 0;
  let updatedCount = 0;
  let skippedCount = 0;

  for (const client of posterClients) {
    // Determine raw name
    const rawName = [client.firstname, client.lastname].map(s => s?.trim()).filter(Boolean).join(' ');
    const name = rawName || `Client #${client.client_id}`;

    // Clean phone number
    const rawPhone = (client.phone || client.phone_number || '').trim();
    // Normalize: remove spaces, dashes, parentheses
    const phone = rawPhone.replace(/[\s\-()]/g, '');

    // Skip if phone is empty, "0", or invalid length (e.g. less than 5 characters)
    if (!phone || phone === '0' || phone.length < 5) {
      skippedCount++;
      continue;
    }

    // Resolve or create CustomerGroup
    let groupId: string | null = null;
    if (client.client_groups_name) {
      const groupName = client.client_groups_name.trim();
      const targetDiscountBps = Math.round(parseFloat(client.client_groups_discount || '0') * 100);

      let group = await prisma.customerGroup.findUnique({
        where: { name: groupName },
      });

      if (!group) {
        group = await prisma.customerGroup.create({
          data: {
            name: groupName,
            discountBps: targetDiscountBps,
          },
        });
        console.log(`Created Customer Group: ${groupName} (${targetDiscountBps} bps)`);
      } else if (group.discountBps !== targetDiscountBps) {
        group = await prisma.customerGroup.update({
          where: { id: group.id },
          data: { discountBps: targetDiscountBps },
        });
        console.log(`Updated Customer Group: ${groupName} to (${targetDiscountBps} bps)`);
      }
      groupId = group.id;
    }

    // Parse numeric fields
    const pointsBalance = Math.round(parseFloat(client.bonus || '0'));
    const lifetimeCents = Math.round(parseFloat(client.total_payed_sum || '0') * 100);
    const walletBalanceCents = Math.round(parseFloat(client.ewallet || '0') * 100);

    // Parse email and birthday
    const email = client.email ? client.email.trim() : null;
    let birthday: Date | null = null;
    if (client.birthday && client.birthday !== '0000-00-00') {
      birthday = new Date(client.birthday);
    }

    // Check if customer exists by phone
    const existing = await prisma.customer.findUnique({
      where: { phone },
    });

    const customerData = {
      name,
      email,
      birthday,
      groupId,
      pointsBalance,
      lifetimeCents,
      walletBalanceCents,
    };

    if (existing) {
      await prisma.customer.update({
        where: { id: existing.id },
        data: customerData,
      });
      updatedCount++;
    } else {
      await prisma.customer.create({
        data: {
          ...customerData,
          phone,
          tierId: defaultTier?.id || null,
        },
      });
      importedCount++;
    }
  }

  console.log('\nPoster POS Customer Import completed successfully.');
  console.log(`Summary:`);
  console.log(`- Total Poster Clients: ${posterClients.length}`);
  console.log(`- New Customers Imported: ${importedCount}`);
  console.log(`- Existing Customers Updated: ${updatedCount}`);
  console.log(`- Skipped (No valid phone): ${skippedCount}`);
}

main()
  .catch((e) => {
    console.error('Poster POS Customer Import failed:', e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
