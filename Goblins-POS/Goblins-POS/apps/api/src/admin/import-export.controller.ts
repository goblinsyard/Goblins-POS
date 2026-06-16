import { BadRequestException, Body, Controller, Get, Post, Req } from '@nestjs/common';
import { AuthedRequest, RequirePermissions } from '../auth/auth.guard';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import { RealtimeGateway } from '../realtime/realtime.gateway';

interface ImportedModifier {
  name: string;
  nameAr?: string;
  priceDeltaCents?: number;
  isActive?: boolean;
  sortOrder?: number;
}

interface ImportedModifierGroup {
  name: string;
  nameAr?: string;
  minSelect?: number;
  maxSelect?: number;
  isActive?: boolean;
  modifiers?: ImportedModifier[];
}

interface ImportedMenuItem {
  name: string;
  nameAr?: string;
  description?: string;
  sku?: string;
  priceCents: number;
  isActive?: boolean;
  isFavorite?: boolean;
  department?: 'RESTAURANT' | 'BAR' | 'BILLIARDS' | 'PLAYSTATION';
  modifierGroups?: ImportedModifierGroup[];
}

interface ImportedCategory {
  name: string;
  nameAr?: string;
  sortOrder?: number;
  color?: string;
  isActive?: boolean;
  items?: ImportedMenuItem[];
}

interface ImportedCustomer {
  name: string;
  phone: string;
  email?: string;
  birthday?: string;
  tags?: string[];
  notes?: string;
  pointsBalance?: number;
  lifetimeCents?: number;
}

@Controller('admin')
export class ImportExportController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly realtime: RealtimeGateway,
  ) {}

  @Get('export/menu')
  @RequirePermissions('menu.manage')
  async exportMenu() {
    const categories = await this.prisma.category.findMany({
      include: {
        items: {
          include: {
            modifierGroups: {
              include: {
                group: {
                  include: {
                    modifiers: true,
                  },
                },
              },
            },
          },
        },
      },
      orderBy: { sortOrder: 'asc' },
    });

    // Transform into clean importable structure
    return categories.map((cat) => ({
      name: cat.name,
      nameAr: cat.nameAr,
      sortOrder: cat.sortOrder,
      color: cat.color,
      isActive: cat.isActive,
      items: cat.items.map((item) => ({
        name: item.name,
        nameAr: item.nameAr,
        description: item.description,
        sku: item.sku,
        priceCents: item.priceCents,
        isActive: item.isActive,
        isFavorite: item.isFavorite,
        department: item.department,
        modifierGroups: item.modifierGroups.map((img) => ({
          name: img.group.name,
          nameAr: img.group.nameAr,
          minSelect: img.group.minSelect,
          maxSelect: img.group.maxSelect,
          isActive: img.group.isActive,
          modifiers: img.group.modifiers.map((mod) => ({
            name: mod.name,
            nameAr: mod.nameAr,
            priceDeltaCents: mod.priceDeltaCents,
            isActive: mod.isActive,
            sortOrder: mod.sortOrder,
          })),
        })),
      })),
    }));
  }

  @Get('export/customers')
  @RequirePermissions('customer.manage')
  async exportCustomers() {
    return this.prisma.customer.findMany({
      select: {
        name: true,
        phone: true,
        email: true,
        birthday: true,
        tags: true,
        notes: true,
      },
      orderBy: { name: 'asc' },
    });
  }

  @Post('import/menu')
  @RequirePermissions('menu.manage')
  async importMenu(@Req() req: AuthedRequest, @Body() body: any) {
    // Accept either flat array OR { clearFirst: bool, categories: [...] }
    let clearFirst = false;
    let categories: any[] = [];
    if (Array.isArray(body)) {
      categories = body;
    } else if (body && Array.isArray(body.categories)) {
      categories = body.categories;
      clearFirst = !!body.clearFirst;
    } else {
      throw new BadRequestException('Payload must be an array or { clearFirst, categories }');
    }

    const defaultTax = await this.prisma.taxRate.findFirst({ where: { isDefault: true } });
    const stations = await this.prisma.station.findMany();

    const kitchenStation = stations.find((s) => s.name.toLowerCase().includes('kitchen'));
    const barStation = stations.find((s) => s.name.toLowerCase().includes('bar'));

    let categoriesCreated = 0;
    let itemsImported = 0;

    // Helper: upsert a category and its items, returning the category record
    const upsertCategory = async (tx: any, catData: any, parentId: string | null) => {
      let category = await tx.category.findFirst({ where: { name: catData.name } });
      if (!category) {
        category = await tx.category.create({
          data: {
            name: catData.name,
            nameAr: catData.nameAr || null,
            sortOrder: catData.sortOrder ?? 0,
            color: catData.color || null,
            isActive: catData.isActive ?? true,
            ...(parentId ? { parentCategoryId: parentId } : {}),
          },
        });
        categoriesCreated++;
      } else if (parentId && category.parentCategoryId !== parentId) {
        category = await tx.category.update({
          where: { id: category.id },
          data: { parentCategoryId: parentId },
        });
      }

      // Upsert items
      if (Array.isArray(catData.items)) {
        for (const itemData of catData.items) {
          if (!itemData.name || itemData.priceCents == null) continue;
          const stationId = itemData.department === 'BAR' ? barStation?.id : kitchenStation?.id;

          const existing = await tx.menuItem.findFirst({
            where: {
              OR: [
                ...(itemData.sku ? [{ sku: itemData.sku }] : []),
                { name: itemData.name, categoryId: category.id },
              ],
            },
          });

          const payload = {
            name: itemData.name,
            nameAr: itemData.nameAr || null,
            priceCents: itemData.priceCents,
            sku: itemData.sku || null,
            categoryId: category.id,
            taxRateId: defaultTax?.id || null,
            stationId: stationId || null,
            isActive: itemData.isActive ?? true,
          };

          if (!existing) {
            await tx.menuItem.create({ data: payload });
            itemsImported++;
          } else {
            await tx.menuItem.update({ where: { id: existing.id }, data: payload });
            itemsImported++;
          }
        }
      }

      return category;
    };

    await this.prisma.$transaction(async (tx) => {
      if (clearFirst) {
        await tx.menuItem.deleteMany({});
        await tx.category.deleteMany({});
      }

      for (const catData of categories) {
        if (!catData.name) continue;
        const parent = await upsertCategory(tx, catData, null);

        // Level 2
        if (Array.isArray(catData.subCategories)) {
          for (const sub of catData.subCategories) {
            if (!sub.name) continue;
            const sub2 = await upsertCategory(tx, sub, parent.id);

            // Level 3
            if (Array.isArray(sub.subCategories)) {
              for (const sub3 of sub.subCategories) {
                if (!sub3.name) continue;
                await upsertCategory(tx, sub3, sub2.id);
              }
            }
          }
        }
      }
    }, { timeout: 120000 });

    return { categoriesCreated, itemsImported };
  }

    @Post('import/customers')
  @RequirePermissions('customer.manage')
  async importCustomers(@Req() req: AuthedRequest, @Body() body: ImportedCustomer[]) {
    if (!Array.isArray(body)) {
      throw new BadRequestException('Payload must be a JSON array of customers.');
    }

    try {
      let importedCount = 0;

      await this.prisma.$transaction(async (tx) => {
        // Find default loyalty tier if any
        const defaultTier = await tx.loyaltyTier.findFirst({
          orderBy: { sortOrder: 'asc' },
        });

        for (const custData of body) {
          if (!custData.name || !custData.phone) continue;

          // Standardize phone (remove spaces)
          const phone = custData.phone.replace(/\s+/g, '');

          // Find or create customer by phone number
          const existing = await tx.customer.findUnique({
            where: { phone },
          });

          const customerPayload = {
            name: custData.name,
            email: custData.email || null,
            birthday: custData.birthday ? new Date(custData.birthday) : null,
            tags: custData.tags || [],
            notes: custData.notes || null,
            ...(custData.pointsBalance != null ? { pointsBalance: custData.pointsBalance } : {}),
            ...(custData.lifetimeCents != null ? { lifetimeCents: custData.lifetimeCents } : {}),
          };

          if (existing) {
            await tx.customer.update({
              where: { id: existing.id },
              data: customerPayload,
            });
          } else {
            await tx.customer.create({
              data: {
                ...customerPayload,
                phone,
                tierId: defaultTier?.id || null,
              },
            });
          }
          importedCount++;
        }
      });

      await this.audit.log({
        userId: req.user.sub,
        action: 'crm.import',
        entity: 'Customers',
        entityId: 'import',
        detail: { importedCount },
      });

      return { success: true, importedCount };
    } catch (e) {
      throw new BadRequestException(e instanceof Error ? e.message : 'Customer import failed.');
    }
  }
  // ─── Fix Category Hierarchy ───────────────────────────────────────────────
  // Rebuilds parentCategoryId assignments to match Poster's tree exactly.
  // Safe to run multiple times (idempotent).
  @Post('fix-category-hierarchy')
  @RequirePermissions('menu.manage')
  async fixCategoryHierarchy() {
    // Map of child name → parent name (from Poster export)
    const parentMap: Record<string, string> = {
      // Food sub-categories
      'Soup': 'Food',
      'Salad': 'Food',
      'Appitizers': 'Food',
      'Appetizers': 'Food',
      'Sandwiches': 'Food',
      'Pasta': 'Food',
      'Pizza': 'Food',
      'Main Course': 'Food',
      'Side Items': 'Food',
      'Food Extras': 'Food',
      // Sandwiches sub-categories
      'Chicken Sandwiches': 'Sandwiches',
      'Meat Sandwiches': 'Sandwiches',
      'Sea Food Sandwich': 'Sandwiches',
      // Main Course sub-categories
      'Chicken Main Course': 'Main Course',
      'Beef Main Course': 'Main Course',
      'Seafood Main Course': 'Main Course',
      // Drinks sub-categories
      'Coffee': 'Drinks',
      'Tea & Hot Drinks': 'Drinks',
      'Soft Drinks': 'Drinks',
      'Fresh Juices': 'Drinks',
      'Smoothies': 'Drinks',
      'Cocktails': 'Drinks',
      'Milkshakes': 'Drinks',
      'Hot Chocolate': 'Drinks',
      'Energy Drinks': 'Drinks',
      'Frappe': 'Drinks',
      'Flavor & Soda': 'Drinks',
      'Drinks Extras': 'Drinks',
      'Matcha': 'Drinks',
      // Matcha sub-categories
      'CREAMY MATCHA': 'Matcha',
      'ICED MATCHA LATTE': 'Matcha',
      'HOT MATCHA LATTE': 'Matcha',
      // Desserts sub-categories
      'Waffle': 'Desserts',
      'Popcorn': 'Desserts',
      'Croissants': 'Desserts',
      // Ramadan sub-categories
      'Meals': 'Ramadan',
      'Ramadan Shoor': 'Ramadan',
      'Ramadan Desserts': 'Ramadan',
      'Ramadan Drinks': 'Ramadan',
      'Tajen': 'Ramadan',
      'Sides': 'Ramadan',
      'Soups': 'Ramadan',
      // Ramadan Shoor sub-categories
      'Foul': 'Ramadan Shoor',
      'Eggs': 'Ramadan Shoor',
      'Cheese': 'Ramadan Shoor',
      'Sohoor Sides': 'Ramadan Shoor',
    };

    const allCategories = await this.prisma.category.findMany();
    const nameToId: Record<string, string> = {};
    for (const c of allCategories) {
      nameToId[c.name] = c.id;
    }

    let fixed = 0;
    let errors: string[] = [];

    for (const [childName, parentName] of Object.entries(parentMap)) {
      const childId = nameToId[childName];
      const parentId = nameToId[parentName];
      if (!childId) { errors.push(`Not found: ${childName}`); continue; }
      if (!parentId) { errors.push(`Parent not found: ${parentName}`); continue; }

      const child = allCategories.find(c => c.id === childId)!;
      if (child.parentCategoryId === parentId) continue; // already correct

      await this.prisma.category.update({
        where: { id: childId },
        data: { parentCategoryId: parentId },
      });
      fixed++;
    }

    return { fixed, errors, total: Object.keys(parentMap).length };
  }


  // -------- Floor Layout Export --------
  @Get('export/floor')
  @RequirePermissions('settings.manage')
  async exportFloor() {
    const zones = await this.prisma.floorZone.findMany({
      orderBy: { sortOrder: 'asc' },
      include: {
        resources: {
          orderBy: { name: 'asc' },
          include: { ratePlan: { select: { id: true, name: true } } },
        },
      },
    });
    return zones.map((z) => ({
      name: z.name,
      nameAr: z.nameAr,
      sortOrder: z.sortOrder,
      resources: z.resources.map((r) => ({
        name: r.name,
        nameAr: r.nameAr,
        type: r.type,
        capacity: r.capacity,
        posX: r.posX,
        posY: r.posY,
        width: r.width,
        height: r.height,
        shape: r.shape,
        rotation: r.rotation,
        isActive: r.isActive,
        ratePlanName: r.ratePlan?.name ?? null,
      })),
    }));
  }

  // -------- Floor Layout Import --------
  @Post('import/floor')
  @RequirePermissions('settings.manage')
  async importFloor(@Req() req: AuthedRequest, @Body() body: any[]) {
    if (!Array.isArray(body)) throw new BadRequestException('Payload must be an array of zones.');

    // Build ratePlan name->id map
    const ratePlans = await this.prisma.ratePlan.findMany({ select: { id: true, name: true } });
    const rpMap: Record<string, string> = {};
    for (const rp of ratePlans) rpMap[rp.name.toLowerCase()] = rp.id;

    let zonesCreated = 0;
    let resourcesCreated = 0;

    for (const zoneData of body) {
      if (!zoneData.name) continue;
      const zone = await this.prisma.floorZone.create({
        data: {
          name: zoneData.name,
          nameAr: zoneData.nameAr || null,
          sortOrder: zoneData.sortOrder ?? 0,
        },
      });
      zonesCreated++;

      for (const res of zoneData.resources ?? []) {
        if (!res.name) continue;
        // Match ratePlan by name (case-insensitive partial)
        let ratePlanId: string | null | undefined = undefined;
        if (res.ratePlanName && res.ratePlanName !== 'None') {
          const key = Object.keys(rpMap).find((k) => k.includes(res.ratePlanName.toLowerCase()) || res.ratePlanName.toLowerCase().includes(k));
          if (key) ratePlanId = rpMap[key];
        }
        await this.prisma.resource.create({
          data: {
            name: res.name,
            nameAr: res.nameAr || null,
            type: res.type ?? 'RESTAURANT_TABLE',
            capacity: res.capacity ?? 4,
            posX: res.posX ?? 0,
            posY: res.posY ?? 0,
            width: res.width ?? 120,
            height: res.height ?? 80,
            shape: res.shape ?? 'rect',
            rotation: res.rotation ?? 0,
            isActive: res.isActive ?? true,
            zoneId: zone.id,
            branchId: req.user.branchId,
            ...(ratePlanId !== undefined ? { ratePlanId } : {}),
          },
        });
        resourcesCreated++;
      }
    }

    return { zonesCreated, resourcesCreated };
  }


}
