import { BadRequestException, Body, Controller, Get, Post, Req } from '@nestjs/common';
import { AuthedRequest, RequirePermissions } from '../auth/auth.guard';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import { RealtimeGateway } from '../realtime/realtime.gateway';
import { CostingService } from '../costing/costing.service';

// ─── Import types ─────────────────────────────────────────────────────────────

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

interface ImportedPriceSchedule {
  name: string;
  priceCents: number;
  daysOfWeek: number[];
  startTime: string;
  endTime: string;
  isActive?: boolean;
}

interface ImportedRecipeLine {
  ingredientName: string;
  quantity: number;
  wastePct?: number;
  uomId?: string;          // e.g. "g", "ml", "pc"
  avgCostCents?: number;
  lastCostCents?: number;
}

interface ImportedRecipe {
  name: string;
  yieldQty?: number;
  prepInstructions?: string;
  deductLocationName?: string;
  isActive?: boolean;
  lines: ImportedRecipeLine[];
}

interface ImportedMenuItem {
  name: string;
  nameAr?: string;
  description?: string;
  sku?: string;
  priceCents: number;
  isActive?: boolean;
  isFavorite?: boolean;
  department?: string;
  modifierGroups?: ImportedModifierGroup[];
  priceSchedules?: ImportedPriceSchedule[];
  recipe?: ImportedRecipe | null;
}

interface ImportedCategory {
  name: string;
  nameAr?: string;
  sortOrder?: number;
  color?: string;
  isActive?: boolean;
  parentCategoryName?: string | null;
  items?: ImportedMenuItem[];
  // nested children (alternative format)
  subCategories?: ImportedCategory[];
  subcategories?: ImportedCategory[];
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
    private readonly costing: CostingService,
  ) {}

  // ─── Menu Export ─────────────────────────────────────────────────────────────

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
                  include: { modifiers: { orderBy: { sortOrder: 'asc' } } },
                },
              },
            },
            priceSchedules: true,
            recipe: {
              include: {
                lines: {
                  include: {
                    ingredient: {
                      include: { uom: true },
                    },
                  },
                },
              },
            },
          },
        },
        parent: { select: { name: true } },
      },
      orderBy: { sortOrder: 'asc' },
    });

    return categories.map((cat) => ({
      name: cat.name,
      nameAr: cat.nameAr,
      sortOrder: cat.sortOrder,
      color: cat.color,
      isActive: cat.isActive,
      parentCategoryName: (cat as any).parent?.name ?? null,
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
        priceSchedules: item.priceSchedules.map((ps) => ({
          name: ps.name,
          priceCents: ps.priceCents,
          daysOfWeek: ps.daysOfWeek,
          startTime: ps.startTime,
          endTime: ps.endTime,
          isActive: ps.isActive,
        })),
        recipe: item.recipe
          ? {
              name: item.recipe.name,
              yieldQty: Number(item.recipe.yieldQty),
              prepInstructions: item.recipe.prepInstructions,
              deductLocationName: item.recipe.deductLocationName,
              isActive: item.recipe.isActive,
              lines: item.recipe.lines.map((l) => ({
                ingredientName: l.ingredient.name,
                quantity: Number(l.quantity),
                wastePct: Number(l.wastePct),
                uomId: l.ingredient.uom?.id ?? 'pc',
                avgCostCents: Number(l.ingredient.avgCostCents),
                lastCostCents: Number(l.ingredient.lastCostCents),
              })),
            }
          : null,
      })),
    }));
  }

  // ─── Menu Import ─────────────────────────────────────────────────────────────

  @Post('import/menu')
  @RequirePermissions('menu.manage')
  async importMenu(@Req() req: AuthedRequest, @Body() body: any) {
    let clearFirst = false;
    let categories: ImportedCategory[] = [];

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

    // Pre-load all UoMs so we can fall back gracefully
    const allUoms = await this.prisma.uom.findMany();
    const uomById: Record<string, any> = {};
    for (const u of allUoms) uomById[u.id] = u;

    // Helper: find-or-create a UoM (use 'pc' as ultimate fallback)
    const resolveUom = async (uomId?: string): Promise<string> => {
      if (uomId && uomById[uomId]) return uomId;
      // try 'pc'
      if (uomById['pc']) return 'pc';
      // create 'pc' if missing
      await this.prisma.uom.upsert({
        where: { id: 'pc' },
        update: {},
        create: { id: 'pc', label: 'Piece', baseUnit: 'pc', factor: 1 },
      });
      uomById['pc'] = true;
      return 'pc';
    };

    // Helper: find-or-create an ingredient
    const resolveIngredient = async (name: string, uomId: string, line: ImportedRecipeLine): Promise<string> => {
      const existing = await this.prisma.ingredient.findFirst({ where: { name } });
      if (existing) {
        // Update costs if provided
        if (line.avgCostCents != null || line.lastCostCents != null) {
          await this.prisma.ingredient.update({
            where: { id: existing.id },
            data: {
              ...(line.avgCostCents != null ? { avgCostCents: line.avgCostCents } : {}),
              ...(line.lastCostCents != null ? { lastCostCents: line.lastCostCents } : {}),
            },
          });
        }
        return existing.id;
      }
      const created = await this.prisma.ingredient.create({
        data: {
          name,
          uomId,
          avgCostCents: line.avgCostCents ?? 0,
          lastCostCents: line.lastCostCents ?? 0,
        },
      });
      return created.id;
    };

    // Helper: upsert modifier group + modifiers, return group id
    const upsertModifierGroup = async (tx: any, groupData: ImportedModifierGroup): Promise<string> => {
      let group = await tx.modifierGroup.findFirst({ where: { name: groupData.name } });
      if (!group) {
        group = await tx.modifierGroup.create({
          data: {
            name: groupData.name,
            nameAr: groupData.nameAr || null,
            minSelect: groupData.minSelect ?? 0,
            maxSelect: groupData.maxSelect ?? 1,
            isActive: groupData.isActive ?? true,
          },
        });
      } else {
        group = await tx.modifierGroup.update({
          where: { id: group.id },
          data: {
            nameAr: groupData.nameAr || group.nameAr,
            minSelect: groupData.minSelect ?? group.minSelect,
            maxSelect: groupData.maxSelect ?? group.maxSelect,
            isActive: groupData.isActive ?? group.isActive,
          },
        });
      }

      // Upsert modifiers
      if (Array.isArray(groupData.modifiers)) {
        for (let i = 0; i < groupData.modifiers.length; i++) {
          const modData = groupData.modifiers[i];
          const existing = await tx.modifier.findFirst({
            where: { groupId: group.id, name: modData.name },
          });
          if (!existing) {
            await tx.modifier.create({
              data: {
                groupId: group.id,
                name: modData.name,
                nameAr: modData.nameAr || null,
                priceDeltaCents: modData.priceDeltaCents ?? 0,
                isActive: modData.isActive ?? true,
                sortOrder: modData.sortOrder ?? i,
              },
            });
          } else {
            await tx.modifier.update({
              where: { id: existing.id },
              data: {
                nameAr: modData.nameAr || existing.nameAr,
                priceDeltaCents: modData.priceDeltaCents ?? existing.priceDeltaCents,
                isActive: modData.isActive ?? existing.isActive,
                sortOrder: modData.sortOrder ?? existing.sortOrder,
              },
            });
          }
        }
      }

      return group.id;
    };

    // Helper: upsert a category by name, set parentId, return category record
    const upsertCategory = async (tx: any, catData: ImportedCategory, parentId: string | null) => {
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
      } else {
        // Update metadata + parent linkage
        const updateData: any = {
          nameAr: catData.nameAr || category.nameAr,
          sortOrder: catData.sortOrder ?? category.sortOrder,
          color: catData.color || category.color,
          isActive: catData.isActive ?? category.isActive,
        };
        if (parentId !== null) updateData.parentCategoryId = parentId;
        else if (parentId === null && catData.parentCategoryName === null) {
          updateData.parentCategoryId = null; // explicitly top-level
        }
        category = await tx.category.update({ where: { id: category.id }, data: updateData });
      }

      // Upsert items for this category
      if (Array.isArray(catData.items)) {
        for (const itemData of catData.items) {
          if (!itemData.name || itemData.priceCents == null) continue;

          // Resolve station from department
          let stationId: string | null = null;
          if (itemData.department) {
            const dept = itemData.department.toUpperCase();
            if (dept === 'BAR') stationId = barStation?.id ?? null;
            else stationId = kitchenStation?.id ?? null;
          }

          // Find existing item
          const existing = await tx.menuItem.findFirst({
            where: {
              OR: [
                ...(itemData.sku ? [{ sku: itemData.sku }] : []),
                { name: itemData.name, categoryId: category.id },
              ],
            },
          });

          const itemPayload: any = {
            name: itemData.name,
            nameAr: itemData.nameAr || null,
            description: itemData.description || null,
            priceCents: itemData.priceCents,
            sku: itemData.sku || null,
            categoryId: category.id,
            taxRateId: defaultTax?.id || null,
            stationId: stationId,
            isActive: itemData.isActive ?? true,
            isFavorite: itemData.isFavorite ?? false,
            department: itemData.department ?? null,
          };

          let menuItem: any;
          if (!existing) {
            menuItem = await tx.menuItem.create({ data: itemPayload });
          } else {
            menuItem = await tx.menuItem.update({ where: { id: existing.id }, data: itemPayload });
          }

          // ── Modifier groups ──
          if (Array.isArray(itemData.modifierGroups) && itemData.modifierGroups.length > 0) {
            // Remove old links then re-link
            await tx.itemModifierGroup.deleteMany({ where: { itemId: menuItem.id } });
            for (let i = 0; i < itemData.modifierGroups.length; i++) {
              const groupData = itemData.modifierGroups[i];
              const groupId = await upsertModifierGroup(tx, groupData);
              await tx.itemModifierGroup.create({
                data: { itemId: menuItem.id, groupId, sortOrder: i },
              });
            }
          }

          // ── Price schedules ──
          if (Array.isArray(itemData.priceSchedules) && itemData.priceSchedules.length > 0) {
            await tx.priceSchedule.deleteMany({ where: { itemId: menuItem.id } });
            for (const ps of itemData.priceSchedules) {
              await tx.priceSchedule.create({
                data: {
                  itemId: menuItem.id,
                  name: ps.name,
                  priceCents: ps.priceCents,
                  daysOfWeek: ps.daysOfWeek,
                  startTime: ps.startTime,
                  endTime: ps.endTime,
                  isActive: ps.isActive ?? true,
                },
              });
            }
          }

          // ── Recipe ──
          if (itemData.recipe && Array.isArray(itemData.recipe.lines)) {
            const recipeData = itemData.recipe;
            // Upsert recipe record
            let recipe = await tx.recipe.findUnique({ where: { menuItemId: menuItem.id } });
            if (!recipe) {
              recipe = await tx.recipe.create({
                data: {
                  menuItemId: menuItem.id,
                  name: recipeData.name || `${itemData.name} recipe`,
                  yieldQty: recipeData.yieldQty ?? 1,
                  prepInstructions: recipeData.prepInstructions || null,
                  deductLocationName: recipeData.deductLocationName || 'Kitchen',
                  isActive: recipeData.isActive ?? true,
                },
              });
            } else {
              recipe = await tx.recipe.update({
                where: { id: recipe.id },
                data: {
                  name: recipeData.name || recipe.name,
                  yieldQty: recipeData.yieldQty ?? recipe.yieldQty,
                  prepInstructions: recipeData.prepInstructions ?? recipe.prepInstructions,
                  deductLocationName: recipeData.deductLocationName || recipe.deductLocationName,
                  isActive: recipeData.isActive ?? recipe.isActive,
                },
              });
            }

            // Replace recipe lines
            await tx.recipeLine.deleteMany({ where: { recipeId: recipe.id } });
            for (const lineData of recipeData.lines) {
              if (!lineData.ingredientName) continue;
              const resolvedUomId = await resolveUom(lineData.uomId);
              const ingredientId = await resolveIngredient(
                lineData.ingredientName,
                resolvedUomId,
                lineData,
              );
              await tx.recipeLine.create({
                data: {
                  recipeId: recipe.id,
                  ingredientId,
                  quantity: lineData.quantity ?? 1,
                  wastePct: lineData.wastePct ?? 0,
                },
              });
            }
          }
        }
      }

      return category;
    };

    let categoriesCreated = 0;
    let itemsImported = 0;

    if (clearFirst) {
      await this.prisma.menuItem.deleteMany({});
      await this.prisma.category.deleteMany({});
    }

    // ── Pass 1: upsert all categories (without parent links yet) ──
    // Build a name → id map first so we can resolve parents in pass 2
    const catNameToId: Record<string, string> = {};

    for (const catData of categories) {
      if (!catData.name) continue;

      // Create/update top-level (ignore parentCategoryName for now)
      let cat = await this.prisma.category.findFirst({ where: { name: catData.name } });
      if (!cat) {
        cat = await this.prisma.category.create({
          data: {
            name: catData.name,
            nameAr: catData.nameAr || null,
            sortOrder: catData.sortOrder ?? 0,
            color: catData.color || null,
            isActive: catData.isActive ?? true,
          },
        });
        categoriesCreated++;
      } else {
        cat = await this.prisma.category.update({
          where: { id: cat.id },
          data: {
            nameAr: catData.nameAr || cat.nameAr,
            sortOrder: catData.sortOrder ?? cat.sortOrder,
            color: catData.color || cat.color,
            isActive: catData.isActive ?? cat.isActive,
          },
        });
      }
      catNameToId[catData.name] = cat.id;

      // Handle nested subCategories format
      const subs: ImportedCategory[] = catData.subCategories || catData.subcategories || [];
      for (const sub of subs) {
        if (!sub.name) continue;
        let subCat = await this.prisma.category.findFirst({ where: { name: sub.name } });
        if (!subCat) {
          subCat = await this.prisma.category.create({
            data: {
              name: sub.name,
              nameAr: sub.nameAr || null,
              sortOrder: sub.sortOrder ?? 0,
              color: sub.color || null,
              isActive: sub.isActive ?? true,
              parentCategoryId: cat.id,
            },
          });
          categoriesCreated++;
        }
        catNameToId[sub.name] = subCat.id;

        // Level 3
        const subs3: ImportedCategory[] = sub.subCategories || sub.subcategories || [];
        for (const sub3 of subs3) {
          if (!sub3.name) continue;
          let sub3Cat = await this.prisma.category.findFirst({ where: { name: sub3.name } });
          if (!sub3Cat) {
            sub3Cat = await this.prisma.category.create({
              data: {
                name: sub3.name,
                nameAr: sub3.nameAr || null,
                sortOrder: sub3.sortOrder ?? 0,
                color: sub3.color || null,
                isActive: sub3.isActive ?? true,
                parentCategoryId: subCat.id,
              },
            });
            categoriesCreated++;
          }
          catNameToId[sub3.name] = sub3Cat.id;
        }
      }
    }

    // ── Pass 2: wire up parent-child links from parentCategoryName field ──
    for (const catData of categories) {
      if (!catData.name || !catData.parentCategoryName) continue;
      const childId = catNameToId[catData.name];
      const parentId = catNameToId[catData.parentCategoryName];
      if (!childId || !parentId) continue;
      await this.prisma.category.update({
        where: { id: childId },
        data: { parentCategoryId: parentId },
      });
    }

    // ── Pass 3: upsert items (now all categories exist with correct IDs) ──
    for (const catData of categories) {
      if (!catData.name || !Array.isArray(catData.items)) continue;
      const catId = catNameToId[catData.name];
      if (!catId) continue;

      const fakeCatObj = { id: catId, name: catData.name };

      for (const itemData of catData.items) {
        if (!itemData.name || itemData.priceCents == null) continue;
        itemsImported++;

        let stationId: string | null = null;
        if (itemData.department) {
          const dept = itemData.department.toUpperCase();
          if (dept === 'BAR') stationId = barStation?.id ?? null;
          else stationId = kitchenStation?.id ?? null;
        }

        const existing = await this.prisma.menuItem.findFirst({
          where: {
            OR: [
              ...(itemData.sku ? [{ sku: itemData.sku }] : []),
              { name: itemData.name, categoryId: catId },
            ],
          },
        });

        const itemPayload: any = {
          name: itemData.name,
          nameAr: itemData.nameAr || null,
          description: itemData.description || null,
          priceCents: itemData.priceCents,
          sku: itemData.sku || null,
          categoryId: catId,
          taxRateId: defaultTax?.id || null,
          stationId: stationId,
          isActive: itemData.isActive ?? true,
          isFavorite: itemData.isFavorite ?? false,
          department: itemData.department ?? null,
        };

        let menuItem: any;
        if (!existing) {
          menuItem = await this.prisma.menuItem.create({ data: itemPayload });
        } else {
          menuItem = await this.prisma.menuItem.update({ where: { id: existing.id }, data: itemPayload });
        }

        // Modifier groups
        if (Array.isArray(itemData.modifierGroups) && itemData.modifierGroups.length > 0) {
          await this.prisma.itemModifierGroup.deleteMany({ where: { itemId: menuItem.id } });
          for (let i = 0; i < itemData.modifierGroups.length; i++) {
            const groupData = itemData.modifierGroups[i];
            let group = await this.prisma.modifierGroup.findFirst({ where: { name: groupData.name } });
            if (!group) {
              group = await this.prisma.modifierGroup.create({
                data: {
                  name: groupData.name,
                  nameAr: groupData.nameAr || null,
                  minSelect: groupData.minSelect ?? 0,
                  maxSelect: groupData.maxSelect ?? 1,
                  isActive: groupData.isActive ?? true,
                },
              });
            }
            // Upsert modifiers
            if (Array.isArray(groupData.modifiers)) {
              for (let j = 0; j < groupData.modifiers.length; j++) {
                const modData = groupData.modifiers[j];
                const existingMod = await this.prisma.modifier.findFirst({
                  where: { groupId: group.id, name: modData.name },
                });
                if (!existingMod) {
                  await this.prisma.modifier.create({
                    data: {
                      groupId: group.id,
                      name: modData.name,
                      nameAr: modData.nameAr || null,
                      priceDeltaCents: modData.priceDeltaCents ?? 0,
                      isActive: modData.isActive ?? true,
                      sortOrder: modData.sortOrder ?? j,
                    },
                  });
                } else {
                  await this.prisma.modifier.update({
                    where: { id: existingMod.id },
                    data: {
                      priceDeltaCents: modData.priceDeltaCents ?? existingMod.priceDeltaCents,
                      isActive: modData.isActive ?? existingMod.isActive,
                      sortOrder: modData.sortOrder ?? existingMod.sortOrder,
                    },
                  });
                }
              }
            }
            await this.prisma.itemModifierGroup.create({
              data: { itemId: menuItem.id, groupId: group.id, sortOrder: i },
            });
          }
        }

        // Price schedules
        if (Array.isArray(itemData.priceSchedules) && itemData.priceSchedules.length > 0) {
          await this.prisma.priceSchedule.deleteMany({ where: { itemId: menuItem.id } });
          for (const ps of itemData.priceSchedules) {
            await this.prisma.priceSchedule.create({
              data: {
                itemId: menuItem.id,
                name: ps.name,
                priceCents: ps.priceCents,
                daysOfWeek: ps.daysOfWeek,
                startTime: ps.startTime,
                endTime: ps.endTime,
                isActive: ps.isActive ?? true,
              },
            });
          }
        }

        // Recipe
        if (itemData.recipe && Array.isArray(itemData.recipe.lines)) {
          const recipeData = itemData.recipe;
          let recipe = await this.prisma.recipe.findUnique({ where: { menuItemId: menuItem.id } });
          if (!recipe) {
            recipe = await this.prisma.recipe.create({
              data: {
                menuItemId: menuItem.id,
                name: recipeData.name || `${itemData.name} recipe`,
                yieldQty: recipeData.yieldQty ?? 1,
                prepInstructions: recipeData.prepInstructions || null,
                deductLocationName: recipeData.deductLocationName || 'Kitchen',
                isActive: recipeData.isActive ?? true,
              },
            });
          } else {
            recipe = await this.prisma.recipe.update({
              where: { id: recipe.id },
              data: {
                name: recipeData.name || recipe.name,
                yieldQty: recipeData.yieldQty ?? recipe.yieldQty,
                prepInstructions: recipeData.prepInstructions ?? recipe.prepInstructions,
                deductLocationName: recipeData.deductLocationName || recipe.deductLocationName,
                isActive: recipeData.isActive ?? recipe.isActive,
              },
            });
          }

          await this.prisma.recipeLine.deleteMany({ where: { recipeId: recipe.id } });
          for (const lineData of recipeData.lines) {
            if (!lineData.ingredientName) continue;

            // Resolve UoM
            let resolvedUomId = lineData.uomId || 'pc';
            const uomExists = await this.prisma.uom.findUnique({ where: { id: resolvedUomId } });
            if (!uomExists) {
              await this.prisma.uom.upsert({
                where: { id: 'pc' },
                update: {},
                create: { id: 'pc', label: 'Piece', baseUnit: 'pc', factor: 1 },
              });
              resolvedUomId = 'pc';
            }

            // Resolve ingredient
            let ingredient = await this.prisma.ingredient.findFirst({
              where: { name: lineData.ingredientName },
            });
            if (!ingredient) {
              ingredient = await this.prisma.ingredient.create({
                data: {
                  name: lineData.ingredientName,
                  uomId: resolvedUomId,
                  avgCostCents: lineData.avgCostCents ?? 0,
                  lastCostCents: lineData.lastCostCents ?? 0,
                },
              });
            } else if (lineData.avgCostCents != null || lineData.lastCostCents != null) {
              await this.prisma.ingredient.update({
                where: { id: ingredient.id },
                data: {
                  ...(lineData.avgCostCents != null ? { avgCostCents: lineData.avgCostCents } : {}),
                  ...(lineData.lastCostCents != null ? { lastCostCents: lineData.lastCostCents } : {}),
                },
              });
            }

            await this.prisma.recipeLine.create({
              data: {
                recipeId: recipe.id,
                ingredientId: ingredient.id,
                quantity: lineData.quantity ?? 1,
                wastePct: lineData.wastePct ?? 0,
              },
            });
          }
        }
      }

      // Also handle items in nested subcategory format
      const subs: ImportedCategory[] = catData.subCategories || catData.subcategories || [];
      for (const sub of subs) {
        if (!sub.name || !Array.isArray(sub.items)) continue;
        const subId = catNameToId[sub.name];
        if (!subId) continue;
        // Recurse items for sub
        for (const itemData of sub.items) {
          if (!itemData.name || itemData.priceCents == null) continue;
          itemsImported++;
          let stationId: string | null = null;
          if (itemData.department) {
            const dept = itemData.department.toUpperCase();
            stationId = dept === 'BAR' ? barStation?.id ?? null : kitchenStation?.id ?? null;
          }
          const existing = await this.prisma.menuItem.findFirst({
            where: { OR: [...(itemData.sku ? [{ sku: itemData.sku }] : []), { name: itemData.name, categoryId: subId }] },
          });
          const payload: any = {
            name: itemData.name, nameAr: itemData.nameAr || null,
            description: itemData.description || null, priceCents: itemData.priceCents,
            sku: itemData.sku || null, categoryId: subId, taxRateId: defaultTax?.id || null,
            stationId, isActive: itemData.isActive ?? true, isFavorite: itemData.isFavorite ?? false,
            department: itemData.department ?? null,
          };
          if (!existing) await this.prisma.menuItem.create({ data: payload });
          else await this.prisma.menuItem.update({ where: { id: existing.id }, data: payload });
        }
      }
    }

    // ── Trigger costing snapshot so margins are correct immediately ──
    try {
      await this.costing.runSnapshot();
    } catch (_) {
      // non-fatal: costing snapshot failure shouldn't fail the import
    }

    return { categoriesCreated, itemsImported };
  }

  // ─── Customer Export ─────────────────────────────────────────────────────────

  @Get('export/customers')
  @RequirePermissions('customer.manage')
  async exportCustomers() {
    return this.prisma.customer.findMany({
      select: { name: true, phone: true, email: true, birthday: true, tags: true, notes: true },
      orderBy: { name: 'asc' },
    });
  }

  // ─── Customer Import ─────────────────────────────────────────────────────────

  @Post('import/customers')
  @RequirePermissions('customer.manage')
  async importCustomers(@Req() req: AuthedRequest, @Body() body: ImportedCustomer[]) {
    if (!Array.isArray(body)) {
      throw new BadRequestException('Payload must be a JSON array of customers.');
    }

    try {
      let importedCount = 0;

      await this.prisma.$transaction(async (tx) => {
        const defaultTier = await tx.loyaltyTier.findFirst({ orderBy: { sortOrder: 'asc' } });

        for (const custData of body) {
          if (!custData.name || !custData.phone) continue;
          const phone = custData.phone.replace(/\s+/g, '');
          const existing = await tx.customer.findUnique({ where: { phone } });

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
            await tx.customer.update({ where: { id: existing.id }, data: customerPayload });
          } else {
            await tx.customer.create({
              data: { ...customerPayload, phone, tierId: defaultTier?.id || null },
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

  // ─── Fix Category Hierarchy (idempotent) ─────────────────────────────────────

  @Post('fix-category-hierarchy')
  @RequirePermissions('menu.manage')
  async fixCategoryHierarchy() {
    const parentMap: Record<string, string> = {
      'Soup': 'Food', 'Salad': 'Food', 'Appitizers': 'Food', 'Appetizers': 'Food',
      'Sandwiches': 'Food', 'Pasta': 'Food', 'Pizza': 'Food', 'Main Course': 'Food',
      'Side Items': 'Food', 'Food Extras': 'Food',
      'Chicken Sandwiches': 'Sandwiches', 'Meat Sandwiches': 'Sandwiches', 'Sea Food Sandwich': 'Sandwiches',
      'Chicken Main Course': 'Main Course', 'Beef Main Course': 'Main Course', 'Seafood Main Course': 'Main Course',
      'Coffee': 'Drinks', 'Tea & Hot Drinks': 'Drinks', 'Soft Drinks': 'Drinks',
      'Fresh Juices': 'Drinks', 'Smoothies': 'Drinks', 'Cocktails': 'Drinks',
      'Milkshakes': 'Drinks', 'Hot Chocolate': 'Drinks', 'Energy Drinks': 'Drinks',
      'Frappe': 'Drinks', 'Flavor & Soda': 'Drinks', 'Drinks Extras': 'Drinks', 'Matcha': 'Drinks',
      'CREAMY MATCHA': 'Matcha', 'ICED MATCHA LATTE': 'Matcha', 'HOT MATCHA LATTE': 'Matcha',
      'Waffle': 'Desserts', 'Popcorn': 'Desserts', 'Croissants': 'Desserts',
      'Meals': 'Ramadan', 'Ramadan Shoor': 'Ramadan', 'Ramadan Desserts': 'Ramadan',
      'Ramadan Drinks': 'Ramadan', 'Tajen': 'Ramadan', 'Sides': 'Ramadan', 'Soups': 'Ramadan',
      'Foul': 'Ramadan Shoor', 'Eggs': 'Ramadan Shoor', 'Cheese': 'Ramadan Shoor', 'Sohoor Sides': 'Ramadan Shoor',
    };

    const allCategories = await this.prisma.category.findMany();
    const nameToId: Record<string, string> = {};
    for (const c of allCategories) nameToId[c.name] = c.id;

    let fixed = 0;
    const errors: string[] = [];

    for (const [childName, parentName] of Object.entries(parentMap)) {
      const childId = nameToId[childName];
      const parentId = nameToId[parentName];
      if (!childId) { errors.push(`Not found: ${childName}`); continue; }
      if (!parentId) { errors.push(`Parent not found: ${parentName}`); continue; }
      const child = allCategories.find((c) => c.id === childId)!;
      if (child.parentCategoryId === parentId) continue;
      await this.prisma.category.update({ where: { id: childId }, data: { parentCategoryId: parentId } });
      fixed++;
    }

    return { fixed, errors, total: Object.keys(parentMap).length };
  }

  // ─── Floor Layout Export ──────────────────────────────────────────────────────

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

  // ─── Floor Layout Import ──────────────────────────────────────────────────────

  @Post('import/floor')
  @RequirePermissions('settings.manage')
  async importFloor(@Req() req: AuthedRequest, @Body() body: any[]) {
    if (!Array.isArray(body)) throw new BadRequestException('Payload must be an array of zones.');

    const ratePlans = await this.prisma.ratePlan.findMany({ select: { id: true, name: true } });
    const rpMap: Record<string, string> = {};
    for (const rp of ratePlans) rpMap[rp.name.toLowerCase()] = rp.id;

    let zonesCreated = 0;
    let resourcesCreated = 0;

    for (const zoneData of body) {
      if (!zoneData.name) continue;
      const zone = await this.prisma.floorZone.create({
        data: { name: zoneData.name, nameAr: zoneData.nameAr || null, sortOrder: zoneData.sortOrder ?? 0 },
      });
      zonesCreated++;

      for (const res of zoneData.resources ?? []) {
        if (!res.name) continue;
        let ratePlanId: string | null | undefined = undefined;
        if (res.ratePlanName && res.ratePlanName !== 'None') {
          const key = Object.keys(rpMap).find(
            (k) => k.includes(res.ratePlanName.toLowerCase()) || res.ratePlanName.toLowerCase().includes(k),
          );
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
