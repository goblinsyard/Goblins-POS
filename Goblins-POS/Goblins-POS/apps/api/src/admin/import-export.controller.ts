import { BadRequestException, Body, Controller, Get, Post, Req } from '@nestjs/common';
import { AuthedRequest, RequirePermissions } from '../auth/auth.guard';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import { RealtimeGateway } from '../realtime/realtime.gateway';
import { CostingService } from '../costing/costing.service';

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

interface ImportedRecipeLine {
  ingredientName: string;
  ingredientSku?: string;
  uomId?: string;
  avgCostCents?: number;
  lastCostCents?: number;
  quantity: number;
  wastePct?: number;
}

interface ImportedRecipe {
  name: string;
  yieldQty?: number;
  prepInstructions?: string;
  deductLocationName?: string;
  isActive?: boolean;
  lines: ImportedRecipeLine[];
}

interface ImportedPriceSchedule {
  name: string;
  priceCents: number;
  daysOfWeek: number[];
  startTime: string;
  endTime: string;
  isActive?: boolean;
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
  stationName?: string;   // station name to look up on import
  modifierGroups?: ImportedModifierGroup[];
  recipe?: ImportedRecipe;
  priceSchedules?: ImportedPriceSchedule[];
}

interface ImportedCategory {
  name: string;
  nameAr?: string;
  sortOrder?: number;
  color?: string;
  isActive?: boolean;
  parentCategoryName?: string;
  stationName?: string;   // resolved station name for fallback routing
  items?: ImportedMenuItem[];
}

interface ImportedCustomer {
  name: string;
  phone: string;
  email?: string;
  birthday?: string;
  tags?: string[];
  notes?: string;
  groupName?: string;
  groupDiscountBps?: number;
}

interface ImportedResource {
  name: string;
  nameAr?: string;
  type: 'RESTAURANT_TABLE' | 'BILLIARDS_TABLE' | 'PS_ROOM';
  capacity?: number;
  posX?: number;
  posY?: number;
  width?: number;
  height?: number;
  shape?: string;
  rotation?: number;
  isActive?: boolean;
  ratePlanName?: string;
}

interface ImportedZone {
  name: string;
  nameAr?: string;
  sortOrder?: number;
  resources?: ImportedResource[];
}


@Controller('admin')
export class ImportExportController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly realtime: RealtimeGateway,
    private readonly costing: CostingService,
  ) {}

  @Get('export/menu')
  @RequirePermissions('menu.manage')
  async exportMenu() {
    const categories = await this.prisma.category.findMany({
      include: {
        parentCategory: {
          select: {
            name: true,
          },
        },
        station: { select: { name: true } },
        items: {
          include: {
            station: { select: { name: true } },
            priceSchedules: true,
            recipe: {
              include: {
                lines: {
                  include: {
                    ingredient: true,
                  },
                },
              },
            },
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
      parentCategoryName: cat.parentCategory?.name || null,
      stationName: (cat as any).station?.name || null,
      items: cat.items.map((item) => ({
        name: item.name,
        nameAr: item.nameAr,
        description: item.description,
        sku: item.sku,
        priceCents: item.priceCents,
        isActive: item.isActive,
        isFavorite: item.isFavorite,
        department: item.department,
        stationName: (item as any).station?.name || null,
        recipe: item.recipe ? {
          name: item.recipe.name,
          yieldQty: Number(item.recipe.yieldQty),
          prepInstructions: item.recipe.prepInstructions,
          deductLocationName: item.recipe.deductLocationName,
          isActive: item.recipe.isActive,
          lines: item.recipe.lines.map((line) => ({
            ingredientName: line.ingredient.name,
            ingredientSku: line.ingredient.sku || undefined,
            uomId: line.ingredient.uomId,
            avgCostCents: Number(line.ingredient.avgCostCents),
            lastCostCents: Number(line.ingredient.lastCostCents),
            quantity: Number(line.quantity),
            wastePct: Number(line.wastePct),
          })),
        } : null,
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
        priceSchedules: item.priceSchedules ? item.priceSchedules.map((schedule) => ({
          name: schedule.name,
          priceCents: schedule.priceCents,
          daysOfWeek: schedule.daysOfWeek,
          startTime: schedule.startTime,
          endTime: schedule.endTime,
          isActive: schedule.isActive,
        })) : [],
      })),
    }));
  }

  @Get('export/customers')
  @RequirePermissions('customer.manage')
  async exportCustomers() {
    const customers = await this.prisma.customer.findMany({
      select: {
        name: true,
        phone: true,
        email: true,
        birthday: true,
        tags: true,
        notes: true,
        group: {
          select: {
            name: true,
            discountBps: true,
          },
        },
      },
      orderBy: { name: 'asc' },
    });

    return customers.map((c) => ({
      name: c.name,
      phone: c.phone,
      email: c.email,
      birthday: c.birthday,
      tags: c.tags,
      notes: c.notes,
      groupName: c.group?.name || null,
      groupDiscountBps: c.group?.discountBps || null,
    }));
  }

  @Get('export/layout')
  @RequirePermissions('settings.manage')
  async exportLayout() {
    const zones = await this.prisma.floorZone.findMany({
      include: {
        resources: {
          include: {
            ratePlan: {
              select: {
                name: true,
              },
            },
          },
          orderBy: { name: 'asc' },
        },
      },
      orderBy: { sortOrder: 'asc' },
    });

    return zones.map((zone) => ({
      name: zone.name,
      nameAr: zone.nameAr,
      sortOrder: zone.sortOrder,
      resources: zone.resources.map((r) => ({
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
        ratePlanName: r.ratePlan?.name || null,
      })),
    }));
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

      // Pass 1: Create or update all categories (without parent linkage)
      for (const catData of body) {
        if (!catData.name) continue;

        let category = await this.prisma.category.findFirst({
          where: { name: catData.name },
        });

        const catPayload = {
          nameAr: catData.nameAr || null,
          sortOrder: catData.sortOrder ?? 0,
          color: catData.color || null,
          isActive: catData.isActive ?? true,
        };

        if (!category) {
          category = await this.prisma.category.create({
            data: {
              name: catData.name,
              ...catPayload,
            },
          });
          categoriesCreated++;
        } else {
          category = await this.prisma.category.update({
            where: { id: category.id },
            data: catPayload,
          });
        }
      }

      // Pass 1b: Set stationId on each category by stationName
      for (const catData of body) {
        if (!catData.name || !catData.stationName) continue;
        const stationRec = stations.find((s) => s.name.toLowerCase() === catData.stationName!.toLowerCase());
        if (!stationRec) continue;
        const cat = await this.prisma.category.findFirst({ where: { name: catData.name } });
        if (cat) {
          await this.prisma.category.update({
            where: { id: cat.id },
            data: { stationId: stationRec.id },
          });
        }
      }

      // Pass 2: Set parent-child category linkages
      for (const catData of body) {
        if (!catData.name) continue;

        const currentCat = await this.prisma.category.findFirst({
          where: { name: catData.name },
        });

        if (currentCat) {
          if (catData.parentCategoryName) {
            const parentCategory = await this.prisma.category.findFirst({
              where: { name: catData.parentCategoryName },
            });

            if (parentCategory && currentCat.id !== parentCategory.id) {
              await this.prisma.category.update({
                where: { id: currentCat.id },
                data: { parentCategoryId: parentCategory.id },
              });
            }
          } else {
            await this.prisma.category.update({
              where: { id: currentCat.id },
              data: { parentCategoryId: null },
            });
          }
        }
      }

      // Pass 3: Create items, modifier groups, modifiers, recipes, and price schedules
      for (const catData of body) {
        if (!catData.name) continue;

        const category = await this.prisma.category.findFirstOrThrow({
          where: { name: catData.name },
        });

        if (!catData.items || !Array.isArray(catData.items)) continue;

        for (const itemData of catData.items) {
          if (!itemData.name || !(itemData.priceCents >= 0)) continue;

          // Determine routing station: stationName > department > null
          let stationId: string | null = null;
          if (itemData.stationName) {
            const byName = stations.find((s) => s.name.toLowerCase() === itemData.stationName!.toLowerCase());
            if (byName) stationId = byName.id;
          }
          if (!stationId) {
            if (itemData.department === 'BAR') {
              const barStation = stations.find((s) => s.name.toLowerCase().includes('bar'));
              if (barStation) stationId = barStation.id;
            } else if (itemData.department) {
              const kitchenStation = stations.find((s) => s.name.toLowerCase().includes('kitchen'));
              if (kitchenStation) stationId = kitchenStation.id;
            }
          }

          // Find or create Menu Item
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
              data: {
                ...itemPayload,
                categoryId: category.id,
              },
            });
          }
          itemsImported++;

          // Import/update Recipe if specified
          if (itemData.recipe) {
            let recipe = await this.prisma.recipe.findUnique({
              where: { menuItemId: menuItem.id },
            });

            const recipePayload = {
              name: itemData.recipe.name || `${menuItem.name} Recipe`,
              yieldQty: itemData.recipe.yieldQty ?? 1,
              prepInstructions: itemData.recipe.prepInstructions || null,
              deductLocationName: itemData.recipe.deductLocationName ?? 'Kitchen',
              isActive: itemData.recipe.isActive ?? true,
            };

            if (recipe) {
              recipe = await this.prisma.recipe.update({
                where: { id: recipe.id },
                data: recipePayload,
              });
              // Clear old lines before re-inserting
              await this.prisma.recipeLine.deleteMany({
                where: { recipeId: recipe.id },
              });
            } else {
              recipe = await this.prisma.recipe.create({
                data: {
                  ...recipePayload,
                  menuItemId: menuItem.id,
                },
              });
            }

            if (itemData.recipe.lines && Array.isArray(itemData.recipe.lines)) {
              for (const line of itemData.recipe.lines) {
                // Find ingredient by SKU or Name
                let ingredient = await this.prisma.ingredient.findFirst({
                  where: {
                    OR: [
                      ...(line.ingredientSku ? [{ sku: line.ingredientSku }] : []),
                      { name: line.ingredientName },
                    ],
                  },
                });

                if (!ingredient) {
                  // Create ingredient if missing
                  const uomId = line.uomId || 'pc';
                  const uomExists = await this.prisma.uom.findUnique({ where: { id: uomId } });
                  if (!uomExists) {
                    await this.prisma.uom.create({
                      data: { id: uomId, label: uomId, baseUnit: uomId, factor: 1 },
                    });
                  }

                  ingredient = await this.prisma.ingredient.create({
                    data: {
                      name: line.ingredientName,
                      sku: line.ingredientSku || null,
                      uomId: uomId,
                      avgCostCents: line.avgCostCents ?? 0,
                      lastCostCents: line.lastCostCents ?? 0,
                      isActive: true,
                    },
                  });
                } else {
                  // Update costs if they changed
                  const updateData: Record<string, any> = {};
                  if (line.avgCostCents !== undefined && Number(ingredient.avgCostCents) !== line.avgCostCents) {
                    updateData.avgCostCents = line.avgCostCents;
                  }
                  if (line.lastCostCents !== undefined && Number(ingredient.lastCostCents) !== line.lastCostCents) {
                    updateData.lastCostCents = line.lastCostCents;
                  }
                  if (Object.keys(updateData).length > 0) {
                    await this.prisma.ingredient.update({
                      where: { id: ingredient.id },
                      data: updateData,
                    });
                  }
                }

                if (ingredient) {
                  await this.prisma.recipeLine.create({
                    data: {
                      recipeId: recipe.id,
                      ingredientId: ingredient.id,
                      quantity: line.quantity,
                      wastePct: line.wastePct ?? 0,
                    },
                  });
                }
              }
            }
          }

          // Import/update Price Schedules if specified
          if (itemData.priceSchedules && Array.isArray(itemData.priceSchedules)) {
            await this.prisma.priceSchedule.deleteMany({
              where: { itemId: menuItem.id },
            });

            for (const schedule of itemData.priceSchedules) {
              await this.prisma.priceSchedule.create({
                data: {
                  itemId: menuItem.id,
                  name: schedule.name,
                  priceCents: schedule.priceCents,
                  daysOfWeek: schedule.daysOfWeek,
                  startTime: schedule.startTime,
                  endTime: schedule.endTime,
                  isActive: schedule.isActive ?? true,
                },
              });
            }
          }

          // Import/update Modifier Groups if specified
          if (itemData.modifierGroups && Array.isArray(itemData.modifierGroups)) {
            // Clear existing modifier group links for this menu item
            await this.prisma.itemModifierGroup.deleteMany({
              where: { itemId: menuItem.id },
            });

            for (const groupData of itemData.modifierGroups) {
              if (!groupData.name) continue;

              // Find or create Modifier Group
              let modGroup = await this.prisma.modifierGroup.findFirst({
                where: { name: groupData.name },
              });

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
              } else {
                modGroup = await this.prisma.modifierGroup.update({
                  where: { id: modGroup.id },
                  data: {
                    nameAr: groupData.nameAr || null,
                    minSelect: groupData.minSelect ?? 0,
                    maxSelect: groupData.maxSelect ?? 1,
                    isActive: groupData.isActive ?? true,
                  },
                });
              }

              // Link to MenuItem
              await this.prisma.itemModifierGroup.create({
                data: {
                  itemId: menuItem.id,
                  groupId: modGroup.id,
                },
              });

              if (groupData.modifiers && Array.isArray(groupData.modifiers)) {
                for (const modData of groupData.modifiers) {
                  if (!modData.name) continue;

                  // Find or create Modifier
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
                        sortOrder: modData.sortOrder ?? 0,
                      },
                    });
                  }
                }
              }
            }
          }
        }
      }

      // Recalculate theoretical costs and generate item cost snapshots (non-fatal)
      try {
        await this.costing.runSnapshot();
      } catch (snapErr) {
        console.warn('costing.runSnapshot failed after import (non-fatal):', (snapErr as any)?.message);
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
      let importedCount = 0;
      const groupCache = new Map<string, string>(); // groupName -> groupId

      // Find default loyalty tier (one query, outside any transaction)
      const defaultTier = await this.prisma.loyaltyTier.findFirst({
        orderBy: { sortOrder: 'asc' },
      });

      for (const custData of body) {
        if (!custData.name || !custData.phone) continue;

        const phone = custData.phone.replace(/\s+/g, '');

        // Resolve group without transaction
        let groupId: string | null = null;
        if (custData.groupName) {
          if (groupCache.has(custData.groupName)) {
            groupId = groupCache.get(custData.groupName)!;
          } else {
            let group = await this.prisma.customerGroup.findUnique({
              where: { name: custData.groupName },
            });
            if (!group) {
              group = await this.prisma.customerGroup.create({
                data: {
                  name: custData.groupName,
                  discountBps: custData.groupDiscountBps ?? 0,
                },
              });
            } else if (custData.groupDiscountBps != null && custData.groupDiscountBps !== group.discountBps) {
              group = await this.prisma.customerGroup.update({
                where: { id: group.id },
                data: { discountBps: custData.groupDiscountBps },
              });
            }
            groupCache.set(custData.groupName, group.id);
            groupId = group.id;
          }
        }

        const customerPayload = {
          name: custData.name,
          email: custData.email || null,
          birthday: custData.birthday ? new Date(custData.birthday) : null,
          tags: custData.tags || [],
          notes: custData.notes || null,
          groupId,
        };

        const existing = await this.prisma.customer.findUnique({ where: { phone } });

        if (existing) {
          await this.prisma.customer.update({ where: { id: existing.id }, data: customerPayload });
        } else {
          await this.prisma.customer.create({
            data: { ...customerPayload, phone, tierId: defaultTier?.id || null },
          });
        }
        importedCount++;
      }

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

  @Post('import/layout')
  @RequirePermissions('settings.manage')
  async importLayout(@Req() req: AuthedRequest, @Body() body: ImportedZone[]) {
    if (!Array.isArray(body)) {
      throw new BadRequestException('Payload must be a JSON array of zones.');
    }

    try {
      let zonesCreated = 0;
      let tablesImported = 0;

      await this.prisma.$transaction(async (tx) => {
        const branchId = req.user.branchId;

        for (const zoneData of body) {
          if (!zoneData.name) continue;

          // Find or create FloorZone
          let zone = await tx.floorZone.findFirst({
            where: { name: zoneData.name },
          });

          if (!zone) {
            zone = await tx.floorZone.create({
              data: {
                name: zoneData.name,
                nameAr: zoneData.nameAr || null,
                sortOrder: zoneData.sortOrder ?? 0,
              },
            });
            zonesCreated++;
          } else {
            // Update existing zone names/sort order if specified
            zone = await tx.floorZone.update({
              where: { id: zone.id },
              data: {
                nameAr: zoneData.nameAr ?? zone.nameAr,
                sortOrder: zoneData.sortOrder ?? zone.sortOrder,
              },
            });
          }

          if (!zoneData.resources || !Array.isArray(zoneData.resources)) continue;

          for (const resData of zoneData.resources) {
            if (!resData.name || !resData.type) continue;

            // Find ratePlanId by ratePlanName if specified
            let ratePlanId: string | null = null;
            if (resData.ratePlanName) {
              const plan = await tx.ratePlan.findFirst({
                where: { name: resData.ratePlanName },
              });
              ratePlanId = plan?.id || null;
            }

            // Find or create resource by name and zoneId
            const resource = await tx.resource.findFirst({
              where: { name: resData.name, zoneId: zone.id },
            });

            const payload = {
              name: resData.name,
              nameAr: resData.nameAr || null,
              type: resData.type,
              capacity: resData.capacity ?? 4,
              shape: resData.shape ?? 'rect',
              posX: resData.posX ?? 20,
              posY: resData.posY ?? 20,
              width: resData.width ?? 80,
              height: resData.height ?? 80,
              rotation: resData.rotation ?? 0,
              isActive: resData.isActive ?? true,
              ratePlanId,
            };

            if (resource) {
              await tx.resource.update({
                where: { id: resource.id },
                data: payload,
              });
            } else {
              await tx.resource.create({
                data: {
                  ...payload,
                  zoneId: zone.id,
                  branchId,
                },
              });
            }
            tablesImported++;
          }
        }
      });

      await this.audit.log({
        userId: req.user.sub,
        action: 'floor.import',
        entity: 'FloorLayout',
        entityId: 'import',
        detail: { zonesCreated, tablesImported },
      });

      this.realtime.emitTo('floor', 'floor.refresh', {});
      return { success: true, zonesCreated, tablesImported };
    } catch (e) {
      throw new BadRequestException(e instanceof Error ? e.message : 'Layout import failed.');
    }
  }
}
