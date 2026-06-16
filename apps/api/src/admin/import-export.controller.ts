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
      const defaultTax = await this.prisma.taxRate.findFirst({ where: { isDefault: true } });
      const stations = await this.prisma.station.findMany();

      let categoriesCreated = 0;
      let itemsImported = 0;

      // Process each category independently (no giant transaction) to avoid timeout
      for (const catData of body) {
        if (!catData.name) continue;

        let category = await this.prisma.category.findFirst({ where: { name: catData.name } });
        if (!category) {
          category = await this.prisma.category.create({
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

          let stationId: string | null = null;
          if (itemData.department === 'BAR') {
            const barStation = stations.find((s) => s.name.toLowerCase().includes('bar'));
            if (barStation) stationId = barStation.id;
          } else {
            const kitchenStation = stations.find((s) => s.name.toLowerCase().includes('kitchen'));
            if (kitchenStation) stationId = kitchenStation.id;
          }

          let menuItem = await this.prisma.menuItem.findFirst({
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
            menuItem = await this.prisma.menuItem.update({
              where: { id: menuItem.id },
              data: itemPayload,
            });
          } else {
            menuItem = await this.prisma.menuItem.create({
              data: { ...itemPayload, categoryId: category.id },
            });
          }
          itemsImported++;

          if (!itemData.modifierGroups || !Array.isArray(itemData.modifierGroups)) continue;

          for (const groupData of itemData.modifierGroups) {
            if (!groupData.name) continue;

            let modGroup = await this.prisma.modifierGroup.findFirst({ where: { name: groupData.name } });
            if (!modGroup) {
              modGroup = await this.prisma.modifierGroup.create({
                data: {
                  name: groupData.name,
                  nameAr: groupData.nameAr || null,
                  minSelect: groupData.minSelect ?? 0,
                  maxSelect: groupData.maxSelect ?? 1,
                  isActive: groupData.isActive ?? true,
                },
              });
            }

            const link = await this.prisma.itemModifierGroup.findUnique({
              where: { itemId_groupId: { itemId: menuItem.id, groupId: modGroup.id } },
            });
            if (!link) {
              await this.prisma.itemModifierGroup.create({
                data: { itemId: menuItem.id, groupId: modGroup.id },
              });
            }

            if (!groupData.modifiers || !Array.isArray(groupData.modifiers)) continue;

            for (const modData of groupData.modifiers) {
              if (!modData.name) continue;

              const existingMod = await this.prisma.modifier.findFirst({
                where: { name: modData.name, groupId: modGroup.id },
              });

              if (!existingMod) {
                await this.prisma.modifier.create({
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
                await this.prisma.modifier.update({
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
      let created = 0;
      let updated = 0;

      for (const c of body) {
        if (!c.name || !c.phone) continue;

        const existing = await this.prisma.customer.findFirst({ where: { phone: c.phone } });

        const payload = {
          name: c.name,
          phone: c.phone,
          email: c.email || null,
          birthday: c.birthday ? new Date(c.birthday) : null,
          tags: c.tags || [],
          notes: c.notes || null,
        };

        if (existing) {
          await this.prisma.customer.update({ where: { id: existing.id }, data: payload });
          updated++;
        } else {
          await this.prisma.customer.create({ data: payload });
          created++;
        }
      }

      await this.audit.log({
        userId: req.user.sub,
        action: 'customer.import',
        entity: 'Customer',
        entityId: 'import',
        detail: { created, updated },
      });

      return { success: true, created, updated };
    } catch (e) {
      throw new BadRequestException(e instanceof Error ? e.message : 'Customer import failed.');
    }
  }
}
