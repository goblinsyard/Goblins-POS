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
  async importMenu(@Req() req: AuthedRequest, @Body() body: ImportedCategory[]) {
    if (!Array.isArray(body)) {
      throw new BadRequestException('Payload must be a JSON array of categories.');
    }

    try {
      // Find a default tax rate to assign to imported items if none specified
      const defaultTax = await this.prisma.taxRate.findFirst({
        where: { isDefault: true },
      });

      // Find standard stations (Kitchen / Bar) to auto-route
      const stations = await this.prisma.station.findMany();

      let categoriesCreated = 0;
      let itemsImported = 0;

      await this.prisma.$transaction(async (tx) => {
        for (const catData of body) {
          if (!catData.name) continue;

          // 1. Find or create Category
          let category = await tx.category.findFirst({
            where: { name: catData.name },
          });

          if (!category) {
            category = await tx.category.create({
              data: {
                name: catData.name,
                nameAr: catData.nameAr || null,
                sortOrder: catData.sortOrder ?? 0,
                color: catData.color || null,
                isActive: catData.isActive ?? true,
              },
            });
            categoriesCreated++;
          }

          if (!catData.items || !Array.isArray(catData.items)) continue;

          for (const itemData of catData.items) {
            if (!itemData.name || !(itemData.priceCents >= 0)) continue;

            // Determine routing station
            let stationId: string | null = null;
            if (itemData.department === 'BAR') {
              const barStation = stations.find((s) => s.name.toLowerCase().includes('bar'));
              if (barStation) stationId = barStation.id;
            } else {
              const kitchenStation = stations.find((s) => s.name.toLowerCase().includes('kitchen'));
              if (kitchenStation) stationId = kitchenStation.id;
            }

            // 2. Find or create Menu Item
            let menuItem = await tx.menuItem.findFirst({
              where: {
                OR: [
                  ...(itemData.sku ? [{ sku: itemData.sku }] : []),
                  { name: itemData.name, categoryId: category.id },
                ],
              },
            });

            const itemPayload = {
              name: itemData.name,
              nameAr: itemData.nameAr || null,
              description: itemData.description || null,
              sku: itemData.sku || null,
              priceCents: itemData.priceCents,
              isActive: itemData.isActive ?? true,
              isFavorite: itemData.isFavorite ?? false,
              department: itemData.department ?? 'RESTAURANT',
              stationId: stationId,
              taxRateId: defaultTax?.id || null,
            };

            if (menuItem) {
              menuItem = await tx.menuItem.update({
                where: { id: menuItem.id },
                data: itemPayload,
              });
            } else {
              menuItem = await tx.menuItem.create({
                data: {
                  ...itemPayload,
                  categoryId: category.id,
                },
              });
            }
            itemsImported++;

            if (!itemData.modifierGroups || !Array.isArray(itemData.modifierGroups)) continue;

            for (const groupData of itemData.modifierGroups) {
              if (!groupData.name) continue;

              // 3. Find or create Modifier Group
              let modGroup = await tx.modifierGroup.findFirst({
                where: { name: groupData.name },
              });

              if (!modGroup) {
                modGroup = await tx.modifierGroup.create({
                  data: {
                    name: groupData.name,
                    nameAr: groupData.nameAr || null,
                    minSelect: groupData.minSelect ?? 0,
                    maxSelect: groupData.maxSelect ?? 1,
                    isActive: groupData.isActive ?? true,
                  },
                });
              }

              // 4. Ensure linked to MenuItem
              const link = await tx.itemModifierGroup.findUnique({
                where: {
                  itemId_groupId: {
                    itemId: menuItem.id,
                    groupId: modGroup.id,
                  },
                },
              });

              if (!link) {
                await tx.itemModifierGroup.create({
                  data: {
                    itemId: menuItem.id,
                    groupId: modGroup.id,
                  },
                });
              }

              if (!groupData.modifiers || !Array.isArray(groupData.modifiers)) continue;

              for (const modData of groupData.modifiers) {
                if (!modData.name) continue;

                // 5. Find or create Modifier
                const existingMod = await tx.modifier.findFirst({
                  where: { name: modData.name, groupId: modGroup.id },
                });

                if (!existingMod) {
                  await tx.modifier.create({
                    data: {
                      groupId: modGroup.id,
                      name: modData.name,
                      nameAr: modData.nameAr || null,
                      priceDeltaCents: modData.priceDeltaCents ?? 0,
                      isActive: modData.isActive ?? true,
                      sortOrder: modData.sortOrder ?? 0,
                    },
                  });
                } else {
                  await tx.modifier.update({
                    where: { id: existingMod.id },
                    data: {
                      nameAr: modData.nameAr || null,
                      priceDeltaCents: modData.priceDeltaCents ?? 0,
                      isActive: modData.isActive ?? true,
                    },
                  });
                }
              }
            }
          }
        }
      });

      await this.audit.log({
        userId: req.user.sub,
        action: 'menu.import',
        entity: 'MenuCatalog',
        entityId: 'import',
        detail: { categoriesCreated, itemsImported },
      });

      this.realtime.emitTo('pos', 'menu.changed', {});
      return { success: true, categoriesCreated, itemsImported };
    } catch (e) {
      throw new BadRequestException(e instanceof Error ? e.message : 'Menu import failed.');
    }
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
}
