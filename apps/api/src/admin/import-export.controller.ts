import { BadRequestException, Body, Controller, Get, Post, Req } from '@nestjs/common';
import { AuthedRequest, RequirePermissions } from '../auth/auth.guard';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import { RealtimeGateway } from '../realtime/realtime.gateway';

interface ImportedModifier {
  name: string; nameAr?: string;
  priceDeltaCents?: number; isActive?: boolean; sortOrder?: number;
}
interface ImportedModifierGroup {
  name: string; nameAr?: string;
  minSelect?: number; maxSelect?: number; isActive?: boolean;
  modifiers?: ImportedModifier[];
}
interface ImportedMenuItem {
  name: string; nameAr?: string; description?: string; sku?: string;
  priceCents: number; isActive?: boolean; isFavorite?: boolean;
  department?: 'RESTAURANT' | 'BAR' | 'BILLIARDS' | 'PLAYSTATION';
  modifierGroups?: ImportedModifierGroup[];
}
interface ImportedCategory {
  name: string; nameAr?: string; sortOrder?: number;
  color?: string; isActive?: boolean; items?: ImportedMenuItem[];
}
interface ImportedCustomer {
  name: string; phone: string; email?: string;
  birthday?: string; tags?: string[]; notes?: string;
}
interface ImportedResource {
  name: string; nameAr?: string; type: string; capacity?: number;
  posX?: number; posY?: number; width?: number; height?: number;
  shape?: string; rotation?: number; isActive?: boolean;
  ratePlanName?: string;
}
interface ImportedFloorZone {
  name: string; nameAr?: string; sortOrder?: number;
  resources?: ImportedResource[];
}

/** Resolve the best station for an item based on its department and category name */
function resolveStation(
  department: string | undefined,
  categoryName: string,
  stations: Array<{ id: string; name: string }>,
): string | null {
  if (!stations.length) return null;

  const dept = (department ?? 'RESTAURANT').toUpperCase();
  const catLower = categoryName.toLowerCase();

  // BAR department → bar station
  if (dept === 'BAR') {
    const bar = stations.find(s => s.name.toLowerCase().includes('bar'));
    if (bar) return bar.id;
  }

  // Category-name hints → bar station
  const barKeywords = ['coffee', 'tea', 'drink', 'juice', 'smoothie', 'cocktail',
    'mocktail', 'soda', 'beverage', 'hot drink', 'cold drink', 'frappe',
    'flavor', 'boba', 'milkshake', 'shake'];
  if (barKeywords.some(k => catLower.includes(k))) {
    const bar = stations.find(s => s.name.toLowerCase().includes('bar'));
    if (bar) return bar.id;
  }

  // Everything else → kitchen
  const kitchen = stations.find(s => s.name.toLowerCase().includes('kitchen'));
  if (kitchen) return kitchen.id;

  // Fallback: first station
  return stations[0]?.id ?? null;
}

@Controller('admin')
export class ImportExportController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly realtime: RealtimeGateway,
  ) {}

  // ─── MENU EXPORT ─────────────────────────────────────────────────────────────
  @Get('export/menu')
  @RequirePermissions('menu.manage')
  async exportMenu() {
    const categories = await this.prisma.category.findMany({
      include: {
        items: {
          include: {
            modifierGroups: { include: { group: { include: { modifiers: true } } } },
          },
        },
      },
      orderBy: { sortOrder: 'asc' },
    });
    return categories.map(cat => ({
      name: cat.name, nameAr: cat.nameAr, sortOrder: cat.sortOrder,
      color: cat.color, isActive: cat.isActive,
      items: cat.items.map(item => ({
        name: item.name, nameAr: item.nameAr, description: item.description,
        sku: item.sku, priceCents: item.priceCents,
        isActive: item.isActive, isFavorite: item.isFavorite, department: item.department,
        modifierGroups: item.modifierGroups.map(img => ({
          name: img.group.name, nameAr: img.group.nameAr,
          minSelect: img.group.minSelect, maxSelect: img.group.maxSelect,
          isActive: img.group.isActive,
          modifiers: img.group.modifiers.map(mod => ({
            name: mod.name, nameAr: mod.nameAr,
            priceDeltaCents: mod.priceDeltaCents,
            isActive: mod.isActive, sortOrder: mod.sortOrder,
          })),
        })),
      })),
    }));
  }

  // ─── MENU IMPORT ─────────────────────────────────────────────────────────────
  @Post('import/menu')
  @RequirePermissions('menu.manage')
  async importMenu(@Req() req: AuthedRequest, @Body() body: ImportedCategory[]) {
    if (!Array.isArray(body)) throw new BadRequestException('Payload must be a JSON array of categories.');

    try {
      const defaultTax = await this.prisma.taxRate.findFirst({ where: { isDefault: true } });
      const stations = await this.prisma.station.findMany({ where: { isActive: true } });

      let categoriesCreated = 0;
      let itemsImported = 0;

      for (const catData of body) {
        if (!catData.name) continue;

        let category = await this.prisma.category.findFirst({ where: { name: catData.name } });
        if (!category) {
          category = await this.prisma.category.create({
            data: {
              name: catData.name, nameAr: catData.nameAr ?? null,
              sortOrder: catData.sortOrder ?? 0, color: catData.color ?? null,
              isActive: catData.isActive ?? true,
            },
          });
          categoriesCreated++;
        }

        if (!Array.isArray(catData.items)) continue;

        for (const itemData of catData.items) {
          if (!itemData.name || !(itemData.priceCents >= 0)) continue;

          // Use smart department + category-name resolution
          const stationId = resolveStation(itemData.department, catData.name, stations);

          let menuItem = await this.prisma.menuItem.findFirst({
            where: {
              OR: [
                ...(itemData.sku ? [{ sku: itemData.sku }] : []),
                { name: itemData.name, categoryId: category.id },
              ],
            },
          });

          const itemPayload = {
            name: itemData.name, nameAr: itemData.nameAr ?? null,
            description: itemData.description ?? null, sku: itemData.sku ?? null,
            priceCents: itemData.priceCents,
            isActive: itemData.isActive ?? true, isFavorite: itemData.isFavorite ?? false,
            department: itemData.department ?? 'RESTAURANT',
            stationId, taxRateId: defaultTax?.id ?? null,
          };

          if (menuItem) {
            menuItem = await this.prisma.menuItem.update({ where: { id: menuItem.id }, data: itemPayload });
          } else {
            menuItem = await this.prisma.menuItem.create({ data: { ...itemPayload, categoryId: category.id } });
          }
          itemsImported++;

          if (!Array.isArray(itemData.modifierGroups)) continue;

          for (const groupData of itemData.modifierGroups) {
            if (!groupData.name) continue;

            let modGroup = await this.prisma.modifierGroup.findFirst({ where: { name: groupData.name } });
            if (!modGroup) {
              modGroup = await this.prisma.modifierGroup.create({
                data: {
                  name: groupData.name, nameAr: groupData.nameAr ?? null,
                  minSelect: groupData.minSelect ?? 0, maxSelect: groupData.maxSelect ?? 1,
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

            if (!Array.isArray(groupData.modifiers)) continue;

            for (const modData of groupData.modifiers) {
              if (!modData.name) continue;
              const existing = await this.prisma.modifier.findFirst({
                where: { name: modData.name, groupId: modGroup.id },
              });
              if (!existing) {
                await this.prisma.modifier.create({
                  data: {
                    groupId: modGroup.id, name: modData.name, nameAr: modData.nameAr ?? null,
                    priceDeltaCents: modData.priceDeltaCents ?? 0,
                    isActive: modData.isActive ?? true, sortOrder: modData.sortOrder ?? 0,
                  },
                });
              } else {
                await this.prisma.modifier.update({
                  where: { id: existing.id },
                  data: { nameAr: modData.nameAr ?? null, priceDeltaCents: modData.priceDeltaCents ?? 0, isActive: modData.isActive ?? true },
                });
              }
            }
          }
        }
      }

      await this.audit.log({
        userId: req.user.sub, action: 'menu.import', entity: 'MenuCatalog', entityId: 'import',
        detail: { categoriesCreated, itemsImported },
      });
      this.realtime.emitTo('pos', 'menu.changed', {});
      return { success: true, categoriesCreated, itemsImported };
    } catch (e) {
      throw new BadRequestException(e instanceof Error ? e.message : 'Menu import failed.');
    }
  }

  // ─── CUSTOMER EXPORT ─────────────────────────────────────────────────────────
  @Get('export/customers')
  @RequirePermissions('customer.manage')
  async exportCustomers() {
    return this.prisma.customer.findMany({
      select: { name: true, phone: true, email: true, birthday: true, tags: true, notes: true },
      orderBy: { name: 'asc' },
    });
  }

  // ─── CUSTOMER IMPORT ─────────────────────────────────────────────────────────
  @Post('import/customers')
  @RequirePermissions('customer.manage')
  async importCustomers(@Req() req: AuthedRequest, @Body() body: ImportedCustomer[]) {
    if (!Array.isArray(body)) throw new BadRequestException('Payload must be a JSON array of customers.');

    try {
      let created = 0; let updated = 0;
      for (const c of body) {
        if (!c.name || !c.phone) continue;
        const existing = await this.prisma.customer.findFirst({ where: { phone: c.phone } });
        const payload = {
          name: c.name, phone: c.phone, email: c.email ?? null,
          birthday: c.birthday ? new Date(c.birthday) : null,
          tags: c.tags ?? [], notes: c.notes ?? null,
        };
        if (existing) { await this.prisma.customer.update({ where: { id: existing.id }, data: payload }); updated++; }
        else { await this.prisma.customer.create({ data: payload }); created++; }
      }
      await this.audit.log({ userId: req.user.sub, action: 'customer.import', entity: 'Customer', entityId: 'import', detail: { created, updated } });
      return { success: true, created, updated };
    } catch (e) {
      throw new BadRequestException(e instanceof Error ? e.message : 'Customer import failed.');
    }
  }

  // ─── FLOOR EXPORT ─────────────────────────────────────────────────────────────
  @Get('export/floor')
  @RequirePermissions('settings.manage')
  async exportFloor() {
    const zones = await this.prisma.floorZone.findMany({
      orderBy: { sortOrder: 'asc' },
      include: {
        resources: {
          include: { ratePlan: { select: { name: true } } },
        },
      },
    });
    return zones.map(z => ({
      name: z.name, nameAr: z.nameAr, sortOrder: z.sortOrder,
      resources: z.resources.map(r => ({
        name: r.name, nameAr: r.nameAr, type: r.type,
        capacity: r.capacity, posX: r.posX, posY: r.posY,
        width: r.width, height: r.height, shape: r.shape,
        rotation: r.rotation, isActive: r.isActive,
        ratePlanName: r.ratePlan?.name ?? null,
      })),
    }));
  }

  // ─── FLOOR IMPORT ─────────────────────────────────────────────────────────────
  @Post('import/floor')
  @RequirePermissions('settings.manage')
  async importFloor(@Req() req: AuthedRequest, @Body() body: ImportedFloorZone[]) {
    if (!Array.isArray(body)) throw new BadRequestException('Payload must be a JSON array of floor zones.');

    try {
      // Get branch id
      const branch = await this.prisma.branch.findFirst();
      if (!branch) throw new BadRequestException('No branch found.');

      // Load all rate plans for lookup
      const ratePlans = await this.prisma.ratePlan.findMany();

      let zonesCreated = 0;
      let resourcesCreated = 0;

      for (const zoneData of body) {
        if (!zoneData.name) continue;

        let zone = await this.prisma.floorZone.findFirst({ where: { name: zoneData.name } });
        if (!zone) {
          zone = await this.prisma.floorZone.create({
            data: { name: zoneData.name, nameAr: zoneData.nameAr ?? null, sortOrder: zoneData.sortOrder ?? 0 },
          });
          zonesCreated++;
        }

        if (!Array.isArray(zoneData.resources)) continue;

        for (const resData of zoneData.resources) {
          if (!resData.name) continue;

          // Resolve rate plan by name
          const ratePlanId = resData.ratePlanName
            ? (ratePlans.find(rp => rp.name.toLowerCase() === resData.ratePlanName!.toLowerCase())?.id ?? null)
            : null;

          const existing = await this.prisma.resource.findFirst({
            where: { name: resData.name, zoneId: zone.id },
          });

          const payload = {
            name: resData.name, nameAr: resData.nameAr ?? null,
            type: resData.type as any,
            capacity: resData.capacity ?? 4,
            posX: resData.posX ?? 0, posY: resData.posY ?? 0,
            width: resData.width ?? 80, height: resData.height ?? 80,
            shape: resData.shape ?? 'rect', rotation: resData.rotation ?? 0,
            isActive: resData.isActive ?? true,
            ratePlanId, zoneId: zone.id, branchId: branch.id,
          };

          if (existing) {
            await this.prisma.resource.update({ where: { id: existing.id }, data: payload });
          } else {
            await this.prisma.resource.create({ data: payload });
            resourcesCreated++;
          }
        }
      }

      await this.audit.log({
        userId: req.user.sub, action: 'floor.import', entity: 'FloorZone', entityId: 'import',
        detail: { zonesCreated, resourcesCreated },
      });
      this.realtime.emitTo('floor', 'floor.changed', {});
      return { success: true, zonesCreated, resourcesCreated };
    } catch (e) {
      throw new BadRequestException(e instanceof Error ? e.message : 'Floor import failed.');
    }
  }

  // ─── SEED BASELINE (stations + printers) ─────────────────────────────────────
  @Post('seed/baseline')
  @RequirePermissions('settings.manage')
  async seedBaseline(@Req() req: AuthedRequest) {
    try {
      // Create printers if none exist
      let kitchenPrinter = await this.prisma.printer.findFirst({ where: { name: 'Kitchen printer' } });
      if (!kitchenPrinter) {
        kitchenPrinter = await this.prisma.printer.create({
          data: { name: 'Kitchen printer', connection: 'PREVIEW', address: 'preview' },
        });
      }
      let barPrinter = await this.prisma.printer.findFirst({ where: { name: 'Bar printer' } });
      if (!barPrinter) {
        barPrinter = await this.prisma.printer.create({
          data: { name: 'Bar printer', connection: 'PREVIEW', address: 'preview' },
        });
      }

      // Create stations if none exist
      let kitchenStation = await this.prisma.station.findFirst({ where: { name: 'Kitchen' } });
      if (!kitchenStation) {
        kitchenStation = await this.prisma.station.create({
          data: { name: 'Kitchen', nameAr: 'المطبخ', printerId: kitchenPrinter.id, sortOrder: 1 },
        });
      }
      let barStation = await this.prisma.station.findFirst({ where: { name: 'Bar' } });
      if (!barStation) {
        barStation = await this.prisma.station.create({
          data: { name: 'Bar', nameAr: 'البار', printerId: barPrinter.id, sortOrder: 2 },
        });
      }
      const expoExists = await this.prisma.station.findFirst({ where: { name: 'Expo' } });
      if (!expoExists) {
        await this.prisma.station.create({ data: { name: 'Expo', sortOrder: 3 } });
      }

      await this.audit.log({ userId: req.user.sub, action: 'admin.seed', entity: 'Station', entityId: 'baseline', detail: {} });
      return { success: true, stations: ['Kitchen', 'Bar', 'Expo'], printers: ['Kitchen printer', 'Bar printer'] };
    } catch (e) {
      throw new BadRequestException(e instanceof Error ? e.message : 'Seed failed.');
    }
  }
}
