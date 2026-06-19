import { BadRequestException, Body, Controller, Delete, Get, Param, Patch, Post, Req } from '@nestjs/common';
import * as argon2 from 'argon2';
import { exec } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs';
import * as path from 'path';
import { Prisma } from '@prisma/client';
import { AuthedRequest, RequirePermissions } from '../auth/auth.guard';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import { RealtimeGateway } from '../realtime/realtime.gateway';
import { AutoBackupService } from './auto-backup.service';

const execAsync = promisify(exec);

/**
 * Back-office administration: menu, rate plans, printers, staff, time clock.
 * Free-form bodies are validated structurally here; all writes are audited.
 */
@Controller('admin')
export class AdminController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly realtime: RealtimeGateway,
    private readonly autoBackup: AutoBackupService,
  ) {}

  // ---------- menu management ----------

  @Post('menu/items')
  @RequirePermissions('menu.manage')
  async createItem(@Req() req: AuthedRequest, @Body() body: {
    categoryId: string; name: string; nameAr?: string; priceCents: number;
    stationId?: string; department?: string; taxRateId?: string; isFavorite?: boolean;
  }) {
    if (!body.name || !body.categoryId || !(body.priceCents > 0)) throw new BadRequestException();
    const item = await this.prisma.menuItem.create({ data: body as never });
    await this.audit.log({ userId: req.user.sub, action: 'menu.item_create', entity: 'MenuItem', entityId: item.id });
    this.realtime.emitTo('pos', 'menu.changed', {});
    return item;
  }

  @Patch('menu/items/:id')
  @RequirePermissions('menu.manage')
  async updateItem(@Req() req: AuthedRequest, @Param('id') id: string, @Body() body: Record<string, unknown>) {
    const allowed = ['name', 'nameAr', 'priceCents', 'categoryId', 'stationId', 'department', 'isActive', 'sortOrder', 'description', 'taxRateId', 'isFavorite'];
    const data = Object.fromEntries(Object.entries(body).filter(([k]) => allowed.includes(k)));
    const before = await this.prisma.menuItem.findUniqueOrThrow({ where: { id } });
    const item = await this.prisma.menuItem.update({ where: { id }, data });
    if (data.priceCents != null && data.priceCents !== before.priceCents) {
      await this.audit.log({
        userId: req.user.sub, action: 'price.override', entity: 'MenuItem', entityId: id,
        detail: { from: before.priceCents, to: data.priceCents },
      });
    }
    await this.audit.log({ userId: req.user.sub, action: 'menu.item_update', entity: 'MenuItem', entityId: id, detail: data as never });
    this.realtime.emitTo('pos', 'menu.changed', {});
    return item;
  }

  @Delete('menu/items/:id')
  @RequirePermissions('menu.manage')
  async deleteItem(@Req() req: AuthedRequest, @Param('id') id: string) {
    try {
      await this.prisma.menuItem.delete({ where: { id } });
      await this.audit.log({ userId: req.user.sub, action: 'menu.item_delete', entity: 'MenuItem', entityId: id });
    } catch {
      await this.prisma.menuItem.update({ where: { id }, data: { isActive: false } });
      await this.audit.log({ userId: req.user.sub, action: 'menu.item_deactivate', entity: 'MenuItem', entityId: id });
    }
    this.realtime.emitTo('pos', 'menu.changed', {});
    return { ok: true };
  }

  @Post('menu/categories')
  @RequirePermissions('menu.manage')
  async createCategory(@Req() req: AuthedRequest, @Body() body: { name: string; nameAr?: string; color?: string; sortOrder?: number; parentCategoryId?: string | null; stationId?: string | null }) {
    if (!body.name) throw new BadRequestException();
    const cat = await this.prisma.category.create({ data: body });
    await this.audit.log({ userId: req.user.sub, action: 'menu.category_create', entity: 'Category', entityId: cat.id });
    this.realtime.emitTo('pos', 'menu.changed', {});
    return cat;
  }

  @Patch('menu/categories/:id')
  @RequirePermissions('menu.manage')
  async updateCategory(
    @Req() req: AuthedRequest,
    @Param('id') id: string,
    @Body() body: { name?: string; nameAr?: string; color?: string; sortOrder?: number; parentCategoryId?: string | null; isActive?: boolean; stationId?: string | null }
  ) {
    if (body.parentCategoryId === id) {
      throw new BadRequestException('A category cannot be its own parent.');
    }
    
    // Check for circular reference loop
    if (body.parentCategoryId) {
      let currentParentId: string | null | undefined = body.parentCategoryId;
      while (currentParentId) {
        if (currentParentId === id) {
          throw new BadRequestException('Circular hierarchy detected.');
        }
        const parentRecord: { parentCategoryId: string | null } | null = await this.prisma.category.findUnique({
          where: { id: currentParentId as string },
          select: { parentCategoryId: true }
        });
        currentParentId = parentRecord?.parentCategoryId;
      }
    }

    const cat = await this.prisma.category.update({
      where: { id },
      data: body,
    });
    await this.audit.log({ userId: req.user.sub, action: 'menu.category_update', entity: 'Category', entityId: id, detail: body as any });
    this.realtime.emitTo('pos', 'menu.changed', {});
    return cat;
  }

  // ---------- rate plans ----------

  @Get('rate-plans')
  @RequirePermissions('rateplan.manage')
  ratePlans() {
    return this.prisma.ratePlan.findMany({ include: { rules: true, resources: { select: { id: true, name: true } } } });
  }

  @Post('rate-plans')
  @RequirePermissions('rateplan.manage')
  async createRatePlan(@Req() req: AuthedRequest, @Body() body: {
    name: string; hourlyCents: number; hourlyMultiCents?: number | null; minimumCents?: number;
    roundToMinutes?: number; roundingMode?: string; graceMinutes?: number;
  }) {
    if (!body.name || body.hourlyCents == null || body.hourlyCents < 0) {
      throw new BadRequestException('Name and a non-negative base rate are required');
    }
    const plan = await this.prisma.ratePlan.create({ data: body as any });
    await this.audit.log({ userId: req.user.sub, action: 'rateplan.create', entity: 'RatePlan', entityId: plan.id });
    return plan;
  }

  @Delete('rate-plans/:id')
  @RequirePermissions('rateplan.manage')
  async deleteRatePlan(@Req() req: AuthedRequest, @Param('id') id: string) {
    const associatedResources = await this.prisma.resource.count({ where: { ratePlanId: id } });
    if (associatedResources > 0) {
      throw new BadRequestException('Cannot delete rate plan because it is assigned to billiard tables or PS rooms');
    }
    await this.prisma.ratePlan.delete({ where: { id } });
    await this.audit.log({ userId: req.user.sub, action: 'rateplan.delete', entity: 'RatePlan', entityId: id });
    return { ok: true };
  }

  @Patch('rate-plans/:id')
  @RequirePermissions('rateplan.manage')
  async updateRatePlan(@Req() req: AuthedRequest, @Param('id') id: string, @Body() body: Record<string, unknown>) {
    const allowed = ['name', 'hourlyCents', 'hourlyMultiCents', 'minimumCents', 'roundToMinutes', 'roundingMode', 'graceMinutes', 'isActive'];
    const data = Object.fromEntries(Object.entries(body).filter(([k]) => allowed.includes(k)));
    const plan = await this.prisma.ratePlan.update({ where: { id }, data });
    await this.audit.log({ userId: req.user.sub, action: 'rateplan.update', entity: 'RatePlan', entityId: id, detail: data as never });
    this.realtime.emitTo('floor', 'floor.refresh', {});
    return plan;
  }

  @Post('rate-plans/:id/rules')
  @RequirePermissions('rateplan.manage')
  async addRule(@Req() req: AuthedRequest, @Param('id') id: string, @Body() body: {
    name: string; daysOfWeek: number[]; startTime: string; endTime: string;
    hourlyCents: number; hourlyMultiCents?: number; priority?: number;
  }) {
    const rule = await this.prisma.rateRule.create({ data: { ...body, ratePlanId: id } });
    await this.audit.log({ userId: req.user.sub, action: 'rateplan.rule_add', entity: 'RateRule', entityId: rule.id });
    return rule;
  }

  @Delete('rate-plans/rules/:ruleId')
  @RequirePermissions('rateplan.manage')
  async deleteRule(@Req() req: AuthedRequest, @Param('ruleId') ruleId: string) {
    await this.prisma.rateRule.delete({ where: { id: ruleId } });
    await this.audit.log({ userId: req.user.sub, action: 'rateplan.rule_delete', entity: 'RateRule', entityId: ruleId });
    return { ok: true };
  }

  // ---------- printers & stations ----------

  @Get('printers')
  @RequirePermissions('settings.manage')
  printers() {
    return this.prisma.printer.findMany({ include: { stations: true } });
  }

  @Post('printers')
  @RequirePermissions('settings.manage')
  async createPrinter(@Req() req: AuthedRequest, @Body() body: { name: string; connection: 'NETWORK' | 'USB' | 'PREVIEW'; address: string; paperWidth?: number }) {
    const printer = await this.prisma.printer.create({ data: body });
    await this.audit.log({ userId: req.user.sub, action: 'printer.create', entity: 'Printer', entityId: printer.id });
    return printer;
  }

  @Post('printers/:id/test')
  @RequirePermissions('settings.manage')
  async testPrinter(@Param('id') id: string) {
    const printer = await this.prisma.printer.findUniqueOrThrow({ where: { id } });
    this.realtime.emitTo('print', 'receipt.print', {
      orderId: `printer-test-${id}`,
      text: `*** PRINTER TEST ***\n${printer.name}\n${new Date().toISOString()}\n`,
      printerAddress: printer.connection === 'NETWORK' ? printer.address : undefined,
    });
    return { sent: true, mode: printer.connection };
  }

  @Patch('printers/:id')
  @RequirePermissions('settings.manage')
  async updatePrinter(
    @Req() req: AuthedRequest,
    @Param('id') id: string,
    @Body() body: { name?: string; connection?: 'NETWORK' | 'USB' | 'PREVIEW'; address?: string; paperWidth?: number },
  ) {
    const printer = await this.prisma.printer.update({
      where: { id },
      data: body,
    });
    await this.audit.log({ userId: req.user.sub, action: 'printer.update', entity: 'Printer', entityId: id, detail: body as any });
    return printer;
  }

  @Delete('printers/:id')
  @RequirePermissions('settings.manage')
  async deletePrinter(@Req() req: AuthedRequest, @Param('id') id: string) {
    await this.prisma.printer.delete({ where: { id } });
    await this.audit.log({ userId: req.user.sub, action: 'printer.delete', entity: 'Printer', entityId: id });
    return { success: true };
  }

  @Get('stations')
  @RequirePermissions('settings.manage')
  stations() {
    return this.prisma.station.findMany({ orderBy: { sortOrder: 'asc' } });
  }

  @Post('stations')
  @RequirePermissions('settings.manage')
  async createStation(@Req() req: AuthedRequest, @Body() body: { name: string; nameAr?: string; kind?: string; sortOrder?: number }) {
    if (!body.name) throw new BadRequestException('Name is required');
    const station = await this.prisma.station.create({
      data: {
        name: body.name,
        nameAr: body.nameAr || null,
        kind: (body.kind as any) ?? 'PREP',
        sortOrder: body.sortOrder ?? 0,
      },
    });
    await this.audit.log({ userId: req.user.sub, action: 'station.create', entity: 'Station', entityId: station.id });
    return station;
  }

  @Delete('stations/:id')
  @RequirePermissions('settings.manage')
  async deleteStation(@Req() req: AuthedRequest, @Param('id') id: string) {
    // Unlink items before deleting
    await this.prisma.menuItem.updateMany({ where: { stationId: id }, data: { stationId: null } });
    await this.prisma.station.delete({ where: { id } });
    await this.audit.log({ userId: req.user.sub, action: 'station.delete', entity: 'Station', entityId: id });
    return { success: true };
  }

  @Patch('stations/:id')
  @RequirePermissions('settings.manage')
  async updateStation(@Req() req: AuthedRequest, @Param('id') id: string, @Body() body: Record<string, unknown>) {
    const allowed = ['name', 'nameAr', 'printerId', 'useKds', 'usePrinter', 'isActive', 'sortOrder'];
    const data = Object.fromEntries(Object.entries(body).filter(([k]) => allowed.includes(k)));
    const station = await this.prisma.station.update({ where: { id }, data });
    await this.audit.log({ userId: req.user.sub, action: 'station.update', entity: 'Station', entityId: id, detail: data as never });
    return station;
  }

  /** Bulk-assign a station to all items matching given departments */
  @Post('stations/:id/assign-departments')
  @RequirePermissions('settings.manage')
  async assignStationToDepartments(
    @Req() req: AuthedRequest,
    @Param('id') id: string,
    @Body() body: { departments: string[] },
  ) {
    if (!body.departments?.length) throw new BadRequestException('departments required');
    const result = await this.prisma.menuItem.updateMany({
      where: { department: { in: body.departments as any[] } },
      data: { stationId: id },
    });
    await this.audit.log({ userId: req.user.sub, action: 'station.bulk_assign', entity: 'Station', entityId: id, detail: { departments: body.departments, count: result.count } as any });
    this.realtime.emitTo('pos', 'menu.changed', {});
    return { updated: result.count };
  }


  /** Bulk-assign category's stationId to all items in this category + sub-categories */
  @Post('menu/categories/:id/apply-station')
  @RequirePermissions('menu.manage')
  async applyStationToCategory(
    @Req() req: AuthedRequest,
    @Param('id') id: string,
    @Body() body: { stationId: string | null },
  ) {
    // Collect all category IDs in the subtree (the category itself + all descendants)
    const allCatIds: string[] = [id];
    const queue = [id];
    while (queue.length) {
      const parentId = queue.shift()!;
      const children = await this.prisma.category.findMany({
        where: { parentCategoryId: parentId },
        select: { id: true },
      });
      for (const child of children) {
        allCatIds.push(child.id);
        queue.push(child.id);
      }
    }

    const result = await this.prisma.menuItem.updateMany({
      where: { categoryId: { in: allCatIds } },
      data: { stationId: body.stationId ?? null },
    });

    await this.audit.log({
      userId: req.user.sub,
      action: 'menu.category_apply_station',
      entity: 'Category',
      entityId: id,
      detail: { stationId: body.stationId, updatedItems: result.count, categories: allCatIds.length } as any,
    });
    this.realtime.emitTo('pos', 'menu.changed', {});
    return { updated: result.count, categories: allCatIds.length };
  }

  // ---------- recipes & ingredients (costing master data) ----------

  @Get('uoms')
  @RequirePermissions('menu.manage')
  uoms() {
    return this.prisma.uom.findMany();
  }

  @Post('ingredients')
  @RequirePermissions('menu.manage')
  async createIngredient(@Req() req: AuthedRequest, @Body() body: {
    name: string; nameAr?: string; uomId: string;
    isPerishable?: boolean; isIntermediate?: boolean; reorderPoint?: number; reorderQty?: number;
  }) {
    if (!body.name || !body.uomId) throw new BadRequestException();
    const ingredient = await this.prisma.ingredient.create({ data: body });
    await this.audit.log({ userId: req.user.sub, action: 'inventory.ingredient_create', entity: 'Ingredient', entityId: ingredient.id });
    return ingredient;
  }

  @Patch('ingredients/:id')
  @RequirePermissions('menu.manage')
  async updateIngredient(
    @Req() req: AuthedRequest,
    @Param('id') id: string,
    @Body() body: {
      name?: string;
      nameAr?: string;
      uomId?: string;
      isPerishable?: boolean;
      isIntermediate?: boolean;
      reorderPoint?: number;
      reorderQty?: number;
      isActive?: boolean;
    },
  ) {
    if (body.name !== undefined && !body.name.trim()) {
      throw new BadRequestException('Name cannot be empty');
    }
    if (body.uomId !== undefined && !body.uomId) {
      throw new BadRequestException('Unit of measure is required');
    }
    const ingredient = await this.prisma.ingredient.update({
      where: { id },
      data: {
        name: body.name !== undefined ? body.name.trim() : undefined,
        nameAr: body.nameAr,
        uomId: body.uomId,
        isPerishable: body.isPerishable,
        isIntermediate: body.isIntermediate,
        reorderPoint: body.reorderPoint,
        reorderQty: body.reorderQty,
        isActive: body.isActive,
      },
    });
    await this.audit.log({
      userId: req.user.sub,
      action: 'inventory.ingredient_update',
      entity: 'Ingredient',
      entityId: id,
      detail: body as any,
    });
    return ingredient;
  }

  @Get('recipes')
  @RequirePermissions('menu.manage')
  recipes() {
    return this.prisma.recipe.findMany({
      include: {
        menuItem: { select: { id: true, name: true } },
        lines: { include: { ingredient: { include: { uom: true } } } },
      },
      orderBy: { name: 'asc' },
    });
  }

  @Post('recipes')
  @RequirePermissions('menu.manage')
  async createRecipe(@Req() req: AuthedRequest, @Body() body: {
    name: string; menuItemId: string;
    yieldQty?: number; deductLocationName?: string; prepInstructions?: string;
    lines: { ingredientId: string; quantity: number; wastePct?: number }[];
  }) {
    if (!body.name || !body.lines?.length || !body.menuItemId) throw new BadRequestException('Name, menu item, and at least one line required');
    const recipe = await this.prisma.recipe.create({
      data: {
        name: body.name,
        menuItemId: body.menuItemId,
        yieldQty: body.yieldQty ?? 1,
        deductLocationName: body.deductLocationName ?? 'Kitchen',
        prepInstructions: body.prepInstructions,
        lines: {
          create: body.lines.map((l) => ({
            ingredientId: l.ingredientId, quantity: l.quantity, wastePct: l.wastePct ?? 0,
          })),
        },
      },
      include: { lines: true },
    });
    await this.audit.log({ userId: req.user.sub, action: 'recipe.create', entity: 'Recipe', entityId: recipe.id });
    return recipe;
  }

  @Patch('recipes/:id')
  @RequirePermissions('menu.manage')
  async updateRecipe(@Req() req: AuthedRequest, @Param('id') id: string, @Body() body: {
    name?: string; yieldQty?: number; deductLocationName?: string; prepInstructions?: string; isActive?: boolean;
    lines?: { ingredientId: string; quantity: number; wastePct?: number }[];
  }) {
    const recipe = await this.prisma.$transaction(async (tx) => {
      if (body.lines) {
        if (!body.lines.length) throw new BadRequestException('Recipe needs at least one line');
        await tx.recipeLine.deleteMany({ where: { recipeId: id } });
        await tx.recipeLine.createMany({
          data: body.lines.map((l) => ({
            recipeId: id, ingredientId: l.ingredientId, quantity: l.quantity, wastePct: l.wastePct ?? 0,
          })),
        });
      }
      return tx.recipe.update({
        where: { id },
        data: {
          name: body.name,
          yieldQty: body.yieldQty,
          deductLocationName: body.deductLocationName,
          prepInstructions: body.prepInstructions,
          isActive: body.isActive,
        },
        include: { lines: { include: { ingredient: true } } },
      });
    });
    await this.audit.log({ userId: req.user.sub, action: 'recipe.update', entity: 'Recipe', entityId: id });
    return recipe;
  }

  @Get('manufacturing-processes')
  @RequirePermissions('menu.manage')
  manufacturingProcesses() {
    return this.prisma.manufacturingProcess.findMany({
      include: {
        outputIngredient: { include: { uom: true } },
        lines: { include: { ingredient: { include: { uom: true } } } },
      },
      orderBy: { name: 'asc' },
    });
  }

  @Post('manufacturing-processes')
  @RequirePermissions('menu.manage')
  async createManufacturingProcess(@Req() req: AuthedRequest, @Body() body: {
    name: string; outputIngredientId: string;
    yieldQty?: number; deductLocationName?: string; prepInstructions?: string;
    lines: { ingredientId: string; quantity: number; wastePct?: number }[];
  }) {
    if (!body.name || !body.lines?.length || !body.outputIngredientId) throw new BadRequestException('Name, output ingredient, and at least one line required');
    const process = await this.prisma.manufacturingProcess.create({
      data: {
        name: body.name,
        outputIngredientId: body.outputIngredientId,
        yieldQty: body.yieldQty ?? 1,
        deductLocationName: body.deductLocationName ?? 'Kitchen',
        prepInstructions: body.prepInstructions,
        lines: {
          create: body.lines.map((l) => ({
            ingredientId: l.ingredientId, quantity: l.quantity, wastePct: l.wastePct ?? 0,
          })),
        },
      },
      include: { lines: true },
    });
    await this.audit.log({ userId: req.user.sub, action: 'manufacturing_process.create', entity: 'ManufacturingProcess', entityId: process.id });
    return process;
  }

  @Patch('manufacturing-processes/:id')
  @RequirePermissions('menu.manage')
  async updateManufacturingProcess(@Req() req: AuthedRequest, @Param('id') id: string, @Body() body: {
    name?: string; yieldQty?: number; deductLocationName?: string; prepInstructions?: string; isActive?: boolean;
    lines?: { ingredientId: string; quantity: number; wastePct?: number }[];
  }) {
    const process = await this.prisma.$transaction(async (tx) => {
      if (body.lines) {
        if (!body.lines.length) throw new BadRequestException('Process needs at least one line');
        await tx.manufacturingProcessLine.deleteMany({ where: { manufacturingProcessId: id } });
        await tx.manufacturingProcessLine.createMany({
          data: body.lines.map((l) => ({
            manufacturingProcessId: id, ingredientId: l.ingredientId, quantity: l.quantity, wastePct: l.wastePct ?? 0,
          })),
        });
      }
      return tx.manufacturingProcess.update({
        where: { id },
        data: {
          name: body.name,
          yieldQty: body.yieldQty,
          deductLocationName: body.deductLocationName,
          prepInstructions: body.prepInstructions,
          isActive: body.isActive,
        },
        include: { lines: { include: { ingredient: true } } },
      });
    });
    await this.audit.log({ userId: req.user.sub, action: 'manufacturing_process.update', entity: 'ManufacturingProcess', entityId: id });
    return process;
  }

  // ---------- floor plan: zones & tables ----------

  @Get('zones')
  @RequirePermissions('settings.manage')
  zones() {
    return this.prisma.floorZone.findMany({
      orderBy: { sortOrder: 'asc' },
      include: {
        resources: {
          orderBy: { name: 'asc' },
          include: { ratePlan: { select: { id: true, name: true } } },
        },
      },
    });
  }

  @Post('zones')
  @RequirePermissions('settings.manage')
  async createZone(@Req() req: AuthedRequest, @Body() body: { name: string; nameAr?: string; sortOrder?: number }) {
    if (!body.name) throw new BadRequestException();
    const zone = await this.prisma.floorZone.create({ data: body });
    await this.audit.log({ userId: req.user.sub, action: 'floor.zone_create', entity: 'FloorZone', entityId: zone.id });
    this.realtime.emitTo('floor', 'floor.refresh', {});
    return zone;
  }

  @Patch('zones/:id')
  @RequirePermissions('settings.manage')
  async updateZone(
    @Req() req: AuthedRequest,
    @Param('id') id: string,
    @Body() body: { name?: string; nameAr?: string; sortOrder?: number }
  ) {
    const allowed = ['name', 'nameAr', 'sortOrder'];
    const data = Object.fromEntries(Object.entries(body).filter(([k]) => allowed.includes(k)));
    const zone = await this.prisma.floorZone.update({ where: { id }, data });
    await this.audit.log({ userId: req.user.sub, action: 'floor.zone_update', entity: 'FloorZone', entityId: id, detail: data as never });
    this.realtime.emitTo('floor', 'floor.refresh', {});
    return zone;
  }

  @Delete('zones/:id')
  @RequirePermissions('settings.manage')
  async deleteZone(@Req() req: AuthedRequest, @Param('id') id: string) {
    const associatedResources = await this.prisma.resource.count({ where: { zoneId: id } });
    if (associatedResources > 0) {
      throw new BadRequestException('Cannot delete zone because it contains tables or rooms');
    }
    await this.prisma.floorZone.delete({ where: { id } });
    await this.audit.log({ userId: req.user.sub, action: 'floor.zone_delete', entity: 'FloorZone', entityId: id });
    this.realtime.emitTo('floor', 'floor.refresh', {});
    return { ok: true };
  }

  @Post('resources')
  @RequirePermissions('settings.manage')
  async createResource(@Req() req: AuthedRequest, @Body() body: {
    zoneId: string; type: 'RESTAURANT_TABLE' | 'BILLIARDS_TABLE' | 'PS_ROOM';
    name: string; nameAr?: string; capacity?: number; shape?: string; ratePlanId?: string;
    posX?: number; posY?: number; width?: number; height?: number;
  }) {
    if (!body.name || !body.zoneId || !body.type) throw new BadRequestException();
    const resource = await this.prisma.resource.create({
      data: { ...body, branchId: req.user.branchId },
    });
    await this.audit.log({ userId: req.user.sub, action: 'floor.resource_create', entity: 'Resource', entityId: resource.id });
    this.realtime.emitTo('floor', 'floor.refresh', {});
    return resource;
  }

  @Patch('resources/:id')
  @RequirePermissions('settings.manage')
  async updateResource(@Req() req: AuthedRequest, @Param('id') id: string, @Body() body: Record<string, unknown>) {
    const allowed = ['name', 'nameAr', 'capacity', 'zoneId', 'type', 'shape', 'ratePlanId', 'isActive'];
    const data = Object.fromEntries(Object.entries(body).filter(([k]) => allowed.includes(k)));
    const resource = await this.prisma.resource.update({ where: { id }, data });
    await this.audit.log({ userId: req.user.sub, action: 'floor.resource_update', entity: 'Resource', entityId: id, detail: data as never });
    this.realtime.emitTo('floor', 'floor.refresh', {});
    return resource;
  }

  // ---------- staff & roles ----------

  @Get('staff')
  @RequirePermissions('staff.manage')
  staff() {
    return this.prisma.user.findMany({
      where: { isActive: true },
      select: {
        id: true,
        name: true,
        email: true,
        phone: true,
        role: { select: { id: true, name: true } },
        salaryType: true,
        baseSalaryCents: true,
        hourlyRateCents: true,
        tipsPoints: true,
        deservesBonus: true,
        createdAt: true,
      },
    });
  }

  @Get('roles')
  @RequirePermissions('staff.manage')
  roles() {
    return this.prisma.role.findMany({ include: { permissions: true } });
  }

  @Post('staff')
  @RequirePermissions('staff.manage')
  async createStaff(@Req() req: AuthedRequest, @Body() body: {
    name: string; roleId: string; email?: string; password?: string; pin?: string;
    tipsPoints?: number; deservesBonus?: boolean;
  }) {
    if (!body.name || !body.roleId) throw new BadRequestException();
    let user;
    try {
      user = await this.prisma.user.create({
        data: {
          branchId: req.user.branchId,
          name: body.name,
          roleId: body.roleId,
          email: body.email || null,
          passwordHash: body.password ? await argon2.hash(body.password) : undefined,
          pinHash: body.pin ? await argon2.hash(body.pin) : undefined,
          tipsPoints: body.tipsPoints ?? 0,
          deservesBonus: body.deservesBonus ?? false,
        },
        select: { id: true, name: true },
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new BadRequestException('This email is already in use by another user.');
      }
      throw error;
    }
    await this.audit.log({ userId: req.user.sub, action: 'staff.create', entity: 'User', entityId: user.id });
    return user;
  }

  @Patch('staff/:id')
  @RequirePermissions('staff.manage')
  async updateStaff(
    @Req() req: AuthedRequest,
    @Param('id') id: string,
    @Body() body: {
      name?: string; roleId?: string; email?: string | null; password?: string; pin?: string; isActive?: boolean;
      tipsPoints?: number; deservesBonus?: boolean;
    },
  ) {
    const data: Record<string, any> = {};
    if (body.name !== undefined) data.name = body.name;
    if (body.roleId !== undefined) data.roleId = body.roleId;
    if (body.email !== undefined) data.email = body.email || null;
    if (body.isActive !== undefined) data.isActive = body.isActive;
    if (body.tipsPoints !== undefined) data.tipsPoints = body.tipsPoints;
    if (body.deservesBonus !== undefined) data.deservesBonus = body.deservesBonus;

    if (body.password) {
      data.passwordHash = await argon2.hash(body.password);
    }
    if (body.pin) {
      data.pinHash = await argon2.hash(body.pin);
    }

    let user;
    try {
      user = await this.prisma.user.update({
        where: { id },
        data,
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new BadRequestException('This email is already in use by another user.');
      }
      throw error;
    }
    await this.audit.log({ userId: req.user.sub, action: 'staff.update', entity: 'User', entityId: id, detail: { name: user.name } as any });
    return user;
  }

  @Delete('staff/:id')
  @RequirePermissions('staff.manage')
  async deleteStaff(@Req() req: AuthedRequest, @Param('id') id: string) {
    if (req.user.sub === id) {
      throw new BadRequestException('You cannot delete your own account.');
    }
    const targetUser = await this.prisma.user.findUniqueOrThrow({ where: { id }, include: { role: true } });
    if (targetUser.role.name === 'Owner') {
      const ownersCount = await this.prisma.user.count({ where: { role: { name: 'Owner' }, isActive: true } });
      if (ownersCount <= 1) {
        throw new BadRequestException('Cannot delete the last Owner account.');
      }
    }
    await this.prisma.user.update({
      where: { id },
      data: { isActive: false },
    });
    await this.audit.log({ userId: req.user.sub, action: 'staff.delete', entity: 'User', entityId: id });
    return { success: true };
  }

  @Patch('roles/:id/permissions')
  @RequirePermissions('staff.manage')
  async setRolePermissions(@Req() req: AuthedRequest, @Param('id') id: string, @Body() body: { permissionIds: string[] }) {
    await this.prisma.$transaction([
      this.prisma.rolePermission.deleteMany({ where: { roleId: id } }),
      this.prisma.rolePermission.createMany({
        data: body.permissionIds.map((p) => ({ roleId: id, permissionId: p })),
      }),
    ]);
    await this.audit.log({
      userId: req.user.sub, action: 'staff.role_permissions', entity: 'Role', entityId: id,
      detail: { count: body.permissionIds.length },
    });
    return this.prisma.role.findUnique({ where: { id }, include: { permissions: true } });
  }

  // ---------- time clock ----------

  @Post('time-clock/in')
  @RequirePermissions('pos.use')
  async clockIn(@Req() req: AuthedRequest) {
    const open = await this.prisma.timeClockEntry.findFirst({
      where: { userId: req.user.sub, clockOut: null },
    });
    if (open) throw new BadRequestException('Already clocked in');
    return this.prisma.timeClockEntry.create({ data: { userId: req.user.sub, clockIn: new Date() } });
  }

  @Post('time-clock/out')
  @RequirePermissions('pos.use')
  async clockOut(@Req() req: AuthedRequest) {
    const open = await this.prisma.timeClockEntry.findFirst({
      where: { userId: req.user.sub, clockOut: null },
    });
    if (!open) throw new BadRequestException('Not clocked in');
    return this.prisma.timeClockEntry.update({ where: { id: open.id }, data: { clockOut: new Date() } });
  }

  @Get('time-clock/hours')
  @RequirePermissions('staff.manage')
  async hours() {
    const entries = await this.prisma.timeClockEntry.findMany({
      where: { clockIn: { gte: new Date(Date.now() - 30 * 86400_000) } },
      include: { user: { select: { name: true } } },
    });
    const byUser = new Map<string, number>();
    for (const e of entries) {
      const out = e.clockOut ?? new Date();
      byUser.set(e.user.name, (byUser.get(e.user.name) ?? 0) + (out.getTime() - e.clockIn.getTime()) / 3600_000);
    }
    return [...byUser.entries()].map(([name, hours]) => ({ name, hours: Math.round(hours * 100) / 100 }));
  }

  // ---------- modifiers & extras ----------

  @Get('modifiers/groups')
  @RequirePermissions('menu.manage')
  async listModifierGroups() {
    return this.prisma.modifierGroup.findMany({
      include: {
        modifiers: { orderBy: { sortOrder: 'asc' } },
        items: { include: { item: true } },
      },
      orderBy: { name: 'asc' },
    });
  }

  @Post('modifiers/groups')
  @RequirePermissions('menu.manage')
  async createModifierGroup(
    @Req() req: AuthedRequest,
    @Body() body: { name: string; nameAr?: string; minSelect?: number; maxSelect?: number },
  ) {
    if (!body.name) throw new BadRequestException('Name is required');
    const group = await this.prisma.modifierGroup.create({
      data: {
        name: body.name,
        nameAr: body.nameAr || null,
        minSelect: body.minSelect ?? 0,
        maxSelect: body.maxSelect ?? 1,
      },
    });
    await this.audit.log({ userId: req.user.sub, action: 'menu.modifier_group_create', entity: 'ModifierGroup', entityId: group.id });
    this.realtime.emitTo('pos', 'menu.changed', {});
    return group;
  }

  @Patch('modifiers/groups/:id')
  @RequirePermissions('menu.manage')
  async updateModifierGroup(
    @Req() req: AuthedRequest,
    @Param('id') id: string,
    @Body() body: { name?: string; nameAr?: string; minSelect?: number; maxSelect?: number; isActive?: boolean },
  ) {
    const data: Record<string, any> = {};
    if (body.name !== undefined) data.name = body.name;
    if (body.nameAr !== undefined) data.nameAr = body.nameAr || null;
    if (body.minSelect !== undefined) data.minSelect = body.minSelect;
    if (body.maxSelect !== undefined) data.maxSelect = body.maxSelect;
    if (body.isActive !== undefined) data.isActive = body.isActive;

    const group = await this.prisma.modifierGroup.update({ where: { id }, data });
    await this.audit.log({ userId: req.user.sub, action: 'menu.modifier_group_update', entity: 'ModifierGroup', entityId: id, detail: data as any });
    this.realtime.emitTo('pos', 'menu.changed', {});
    return group;
  }

  @Patch('modifiers/groups/:id/items')
  @RequirePermissions('menu.manage')
  async linkModifierGroupItems(
    @Req() req: AuthedRequest,
    @Param('id') id: string,
    @Body() body: { itemIds: string[] },
  ) {
    if (!Array.isArray(body.itemIds)) throw new BadRequestException('itemIds array required');
    await this.prisma.$transaction(async (tx) => {
      await tx.itemModifierGroup.deleteMany({ where: { groupId: id } });
      if (body.itemIds.length > 0) {
        await tx.itemModifierGroup.createMany({
          data: body.itemIds.map((itemId) => ({ itemId, groupId: id })),
        });
      }
    });
    await this.audit.log({ userId: req.user.sub, action: 'menu.modifier_group_link', entity: 'ModifierGroup', entityId: id, detail: { itemIds: body.itemIds } as any });
    this.realtime.emitTo('pos', 'menu.changed', {});
    return { success: true };
  }

  @Post('modifiers/groups/:groupId/modifiers')
  @RequirePermissions('menu.manage')
  async createModifierOption(
    @Req() req: AuthedRequest,
    @Param('groupId') groupId: string,
    @Body() body: { name: string; nameAr?: string; priceDeltaCents?: number; sortOrder?: number; exclusionGroup?: string | null },
  ) {
    if (!body.name) throw new BadRequestException('Name is required');
    const modifier = await this.prisma.modifier.create({
      data: {
        groupId,
        name: body.name,
        nameAr: body.nameAr || null,
        priceDeltaCents: body.priceDeltaCents ?? 0,
        sortOrder: body.sortOrder ?? 0,
        exclusionGroup: body.exclusionGroup ?? null,
      },
    });
    await this.audit.log({ userId: req.user.sub, action: 'menu.modifier_create', entity: 'Modifier', entityId: modifier.id });
    this.realtime.emitTo('pos', 'menu.changed', {});
    return modifier;
  }

  @Patch('modifiers/:id')
  @RequirePermissions('menu.manage')
  async updateModifierOption(
    @Req() req: AuthedRequest,
    @Param('id') id: string,
    @Body() body: { name?: string; nameAr?: string; priceDeltaCents?: number; isActive?: boolean; sortOrder?: number; exclusionGroup?: string | null },
  ) {
    const data: Record<string, any> = {};
    if (body.name !== undefined) data.name = body.name;
    if (body.nameAr !== undefined) data.nameAr = body.nameAr || null;
    if (body.priceDeltaCents !== undefined) data.priceDeltaCents = body.priceDeltaCents;
    if (body.isActive !== undefined) data.isActive = body.isActive;
    if (body.sortOrder !== undefined) data.sortOrder = body.sortOrder;
    if (body.exclusionGroup !== undefined) data.exclusionGroup = body.exclusionGroup;

    const modifier = await this.prisma.modifier.update({ where: { id }, data });
    await this.audit.log({ userId: req.user.sub, action: 'menu.modifier_update', entity: 'Modifier', entityId: id, detail: data as any });
    this.realtime.emitTo('pos', 'menu.changed', {});
    return modifier;
  }

  @Delete('modifiers/:id')
  @RequirePermissions('menu.manage')
  async deleteModifierOption(@Req() req: AuthedRequest, @Param('id') id: string) {
    await this.prisma.modifier.delete({ where: { id } });
    await this.audit.log({ userId: req.user.sub, action: 'menu.modifier_delete', entity: 'Modifier', entityId: id });
    this.realtime.emitTo('pos', 'menu.changed', {});
    return { success: true };
  }

  // ---------- combo management ----------

  @Get('menu/combos')
  @RequirePermissions('pos.use')
  async listCombos() {
    return this.prisma.combo.findMany({
      include: {
        lines: {
          include: { item: true },
        },
      },
      orderBy: { name: 'asc' },
    });
  }

  @Post('menu/combos')
  @RequirePermissions('menu.manage')
  async createCombo(
    @Req() req: AuthedRequest,
    @Body() body: { name: string; nameAr?: string; priceCents: number; lines: { itemId: string; quantity: number }[] },
  ) {
    if (!body.name || !(body.priceCents >= 0) || !body.lines?.length) {
      throw new BadRequestException('Name, price and components are required.');
    }
    const combo = await this.prisma.$transaction(async (tx) => {
      return tx.combo.create({
        data: {
          name: body.name,
          nameAr: body.nameAr || null,
          priceCents: body.priceCents,
          lines: {
            create: body.lines.map((l) => ({
              itemId: l.itemId,
              quantity: l.quantity,
            })),
          },
        },
        include: { lines: true },
      });
    });
    await this.audit.log({ userId: req.user.sub, action: 'menu.combo_create', entity: 'Combo', entityId: combo.id });
    this.realtime.emitTo('pos', 'menu.changed', {});
    return combo;
  }

  @Patch('menu/combos/:id')
  @RequirePermissions('menu.manage')
  async updateCombo(
    @Req() req: AuthedRequest,
    @Param('id') id: string,
    @Body() body: { name?: string; nameAr?: string; priceCents?: number; lines?: { itemId: string; quantity: number }[]; isActive?: boolean },
  ) {
    const combo = await this.prisma.$transaction(async (tx) => {
      if (body.lines) {
        if (!body.lines.length) throw new BadRequestException('Combo must have at least one component item.');
        await tx.comboLine.deleteMany({ where: { comboId: id } });
        await tx.comboLine.createMany({
          data: body.lines.map((l) => ({
            comboId: id,
            itemId: l.itemId,
            quantity: l.quantity,
          })),
        });
      }
      return tx.combo.update({
        where: { id },
        data: {
          name: body.name,
          nameAr: body.nameAr,
          priceCents: body.priceCents,
          isActive: body.isActive,
        },
        include: { lines: true },
      });
    });
    await this.audit.log({ userId: req.user.sub, action: 'menu.combo_update', entity: 'Combo', entityId: id });
    this.realtime.emitTo('pos', 'menu.changed', {});
    return combo;
  }

  @Delete('menu/combos/:id')
  @RequirePermissions('menu.manage')
  async deleteCombo(@Req() req: AuthedRequest, @Param('id') id: string) {
    await this.prisma.combo.delete({ where: { id } });
    await this.audit.log({ userId: req.user.sub, action: 'menu.combo_delete', entity: 'Combo', entityId: id });
    this.realtime.emitTo('pos', 'menu.changed', {});
    return { success: true };
  }

  // ---------- database manager ----------

  @Post('backup')
  @RequirePermissions('admin')
  async createBackup(@Req() req: AuthedRequest) {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `goblins-backup-${stamp}.json`;
    const backupsDir = path.join(process.cwd(), 'backups');
    if (!fs.existsSync(backupsDir)) fs.mkdirSync(backupsDir, { recursive: true });

    // Dump every table into one JSON file
    const [
      categories, menuItems, modifierGroups, modifiers,
      zones, resources, ratePlans, rateRules,
      customers, customerGroups,
      suppliers,
      staff, shifts, timeClock,
      sessions, orders, orderItems, orderItemModifiers, payments,
      expenses, expenseCategories,
      accounts, journalEntries, cashMovements,
      taxRates, printers, stations, settings,
      reservations, auditLogs,
      recipes, recipeLines, ingredients, stockMovements,
      purchaseOrders, purchaseOrderLines,
    ] = await Promise.all([
      this.prisma.category.findMany(),
      this.prisma.menuItem.findMany(),
      this.prisma.modifierGroup.findMany(),
      this.prisma.modifier.findMany(),
      this.prisma.floorZone.findMany(),
      this.prisma.resource.findMany(),
      this.prisma.ratePlan.findMany(),
      this.prisma.rateRule.findMany(),
      this.prisma.customer.findMany(),
      this.prisma.customerGroup.findMany(),
      this.prisma.supplier.findMany(),
      this.prisma.user.findMany(),
      this.prisma.shift.findMany(),
      this.prisma.timeClockEntry.findMany(),
      this.prisma.session.findMany(),
      this.prisma.order.findMany(),
      this.prisma.orderItem.findMany(),
      this.prisma.orderItemModifier.findMany(),
      this.prisma.payment.findMany(),
      this.prisma.expense.findMany(),
      this.prisma.expenseCategory.findMany(),
      this.prisma.account.findMany(),
      this.prisma.journalEntry.findMany(),
      this.prisma.cashMovement.findMany(),
      this.prisma.taxRate.findMany(),
      this.prisma.printer.findMany(),
      this.prisma.station.findMany(),
      this.prisma.setting.findMany(),
      this.prisma.reservation.findMany(),
      this.prisma.auditLog.findMany(),
      this.prisma.recipe.findMany(),
      this.prisma.recipeLine.findMany(),
      this.prisma.ingredient.findMany(),
      this.prisma.stockMovement.findMany(),
      this.prisma.purchaseOrder.findMany(),
      this.prisma.purchaseOrderLine.findMany(),
    ]);

    const backup = {
      meta: { version: 2, createdAt: new Date().toISOString(), filename },
      menu: { categories, menuItems, modifierGroups, modifiers },
      floor: { zones, resources, ratePlans, rateRules },
      crm: { customers, customerGroups },
      suppliers,
      hr: { staff, shifts, timeClock },
      transactions: { sessions, orders, orderItems, orderItemModifiers, payments },
      expenses: { expenses, expenseCategories },
      accounting: { accounts, journalEntries, cashMovements },
      inventory: { recipes, recipeLines, ingredients, stockMovements, purchaseOrders, purchaseOrderLines },
      config: { taxRates, printers, stations, settings },
      reservations,
      auditLogs,
    };

    const filePath = path.join(backupsDir, filename);
    fs.writeFileSync(filePath, JSON.stringify(backup, null, 2));

    await this.audit.log({
      userId: req.user.sub, action: 'backup.create', entity: 'System',
      entityId: filename, detail: { filename },
    });

    return { filename };
  }

  @Post('db/backup')
  @RequirePermissions('settings.manage')
  async backupDatabase(@Req() req: AuthedRequest) {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupsDir = path.join(process.cwd(), 'backups');
    if (!fs.existsSync(backupsDir)) {
      fs.mkdirSync(backupsDir, { recursive: true });
    }
    const file = path.join(backupsDir, `goblins-${stamp}.sql`);
    const dbUrl = process.env.DATABASE_URL;
    if (!dbUrl) throw new BadRequestException('DATABASE_URL is not set.');
    
    try {
      await execAsync(`pg_dump "${dbUrl}" --clean --if-exists -f "${file}"`);
      await this.audit.log({ userId: req.user.sub, action: 'db.backup', entity: 'Database', entityId: `backup-${stamp}` });
      
      const files = fs.readdirSync(backupsDir)
        .filter((f) => f.startsWith('goblins-') && f.endsWith('.sql'))
        .sort()
        .reverse();
      return { success: true, files };
    } catch (e) {
      throw new BadRequestException(e instanceof Error ? e.message : 'pg_dump failed');
    }
  }

  @Get('db/backups')
  @RequirePermissions('settings.manage')
  async listBackups() {
    const backupsDir = path.join(process.cwd(), 'backups');
    if (!fs.existsSync(backupsDir)) return { files: [] };
    const files = fs.readdirSync(backupsDir)
      .filter((f) => f.startsWith('goblins-') && f.endsWith('.sql'))
      .sort()
      .reverse();
    return { files };
  }

  @Post('db/restore')
  @RequirePermissions('settings.manage')
  async restoreDatabase(@Req() req: AuthedRequest, @Body() body: { filename: string }) {
    if (!body.filename) throw new BadRequestException('Filename is required');
    const backupsDir = path.join(process.cwd(), 'backups');
    const file = path.join(backupsDir, body.filename);
    if (!fs.existsSync(file) || path.relative(backupsDir, file).includes('..')) {
      throw new BadRequestException('Invalid or non-existent file.');
    }
    const dbUrl = process.env.DATABASE_URL;
    if (!dbUrl) throw new BadRequestException('DATABASE_URL is not set.');

    try {
      await execAsync(`psql "${dbUrl}" -f "${file}"`);
      await this.audit.log({ userId: req.user.sub, action: 'db.restore', entity: 'Database', entityId: body.filename });
      this.realtime.emitTo('pos', 'menu.changed', {});
      this.realtime.emitTo('floor', 'floor.refresh', {});
      return { success: true };
    } catch (e) {
      throw new BadRequestException(e instanceof Error ? e.message : 'psql restore failed');
    }
  }

  @Post('db/reset')
  @RequirePermissions('settings.manage')
  async resetDatabase(@Req() req: AuthedRequest) {
    await this.prisma.$transaction(async (tx) => {
      await tx.pointsTransaction.deleteMany();
      await tx.payment.deleteMany();
      await tx.orderDiscount.deleteMany();
      await tx.ticketItem.deleteMany();
      await tx.ticket.deleteMany();
      await tx.orderItem.deleteMany();
      await tx.prepaidBlock.deleteMany();
      await tx.sessionSegment.deleteMany();
      await tx.session.deleteMany();
      await tx.order.deleteMany();
      await tx.cashMovement.deleteMany();
      await tx.shift.deleteMany();
      await tx.timeClockEntry.deleteMany();
      await tx.stockMovement.deleteMany();
      await tx.stockLevel.updateMany({ data: { quantity: 0 } });
      await tx.productionOrder.deleteMany();
      await tx.reservation.deleteMany();
      await tx.expense.deleteMany();
      await tx.journalLine.deleteMany();
      await tx.journalEntry.deleteMany();
      await tx.auditLog.deleteMany();
    });
    
    await this.audit.log({
      userId: req.user.sub,
      action: 'db.reset',
      entity: 'Database',
      entityId: 'reset',
      detail: { timestamp: new Date().toISOString() },
    });

    this.realtime.emitTo('pos', 'menu.changed', {});
    this.realtime.emitTo('floor', 'floor.refresh', {});
    return { success: true };
  }

  @Post('db/erase-demo')
  @RequirePermissions('settings.manage')
  async eraseDemoData(@Req() req: AuthedRequest) {
    await this.prisma.$transaction(async (tx) => {
      // 1. Delete transactions, orders, and sessions
      await tx.pointsTransaction.deleteMany();
      await tx.prepaidBlock.deleteMany();
      await tx.sessionSegment.deleteMany();
      await tx.session.deleteMany();
      await tx.ticketItem.deleteMany();
      await tx.ticket.deleteMany();
      await tx.orderItemModifier.deleteMany();
      await tx.orderItem.deleteMany();
      await tx.orderDiscount.deleteMany();
      await tx.payment.deleteMany();
      await tx.order.deleteMany();
      await tx.cashMovement.deleteMany();
      await tx.shift.deleteMany();
      await tx.timeClockEntry.deleteMany();
      await tx.productionOrder.deleteMany();
      await tx.reservation.deleteMany();
      await tx.expense.deleteMany();
      
      // 2. Delete inventory history & setup
      await tx.stockMovement.deleteMany();
      await tx.stockLevel.deleteMany();
      await tx.stockCountLine.deleteMany();
      await tx.stockCount.deleteMany();
      await tx.wasteLog.deleteMany();
      await tx.batch.deleteMany();
      await tx.recipeLine.deleteMany();
      await tx.recipe.deleteMany();
      await tx.manufacturingProcessLine.deleteMany();
      await tx.manufacturingProcess.deleteMany();
      await tx.purchaseOrderLine.deleteMany();
      await tx.purchaseOrder.deleteMany();
      await tx.goodsReceipt.deleteMany();
      await tx.supplierInvoice.deleteMany();
      await tx.supplierPriceHistory.deleteMany();
      await tx.supplier.deleteMany();
      await tx.ingredient.deleteMany();
      await tx.storeLocation.deleteMany();
      
      // 3. Delete prep stations, printers, terminals, rates
      await tx.terminal.deleteMany();
      await tx.station.deleteMany();
      await tx.printer.deleteMany();
      await tx.taxRate.deleteMany();

      // 4. Delete menu, pricing setup, combos
      await tx.itemModifierGroup.deleteMany();
      await tx.modifier.deleteMany();
      await tx.modifierGroup.deleteMany();
      await tx.priceSchedule.deleteMany();
      await tx.comboLine.deleteMany();
      await tx.combo.deleteMany();
      await tx.itemCostSnapshot.deleteMany();
      await tx.menuItem.deleteMany();
      await tx.category.deleteMany();

      // 5. Delete floor configuration & rate plans
      await tx.resource.deleteMany();
      await tx.floorZone.deleteMany();
      await tx.rateRule.deleteMany();
      await tx.ratePlan.deleteMany();

      // 6. Delete customer directory & loyalty tiers
      await tx.orderSeatCustomer.deleteMany();
      await tx.customer.deleteMany();
      await tx.loyaltyTier.deleteMany();

      // 7. Delete expense categories
      await tx.expenseCategory.deleteMany();

      // 8. Delete all general ledger transactions
      await tx.journalLine.deleteMany();
      await tx.journalEntry.deleteMany();

      // 9. Reset Chart of Accounts initial balances
      await tx.account.updateMany({
        data: { initialBalanceCents: 0 },
      });
      
      // 10. Delete audit logs except this reset event
      await tx.auditLog.deleteMany();
    });

    await this.audit.log({
      userId: req.user.sub,
      action: 'db.erase-demo',
      entity: 'Database',
      entityId: 'erase-demo',
      detail: { timestamp: new Date().toISOString() },
    });

    this.realtime.emitTo('pos', 'menu.changed', {});
    this.realtime.emitTo('floor', 'floor.refresh', {});
    return { success: true };
  }

  @Get('db/auto-backup/config')
  @RequirePermissions('settings.manage')
  async getAutoBackupConfig() {
    const config = await this.prisma.setting.findUnique({
      where: { key: 'db.autoBackupConfig' },
    });
    return config?.value || { enabled: false, intervalHours: 24, keepCount: 10 };
  }

  @Post('db/auto-backup/config')
  @RequirePermissions('settings.manage')
  async saveAutoBackupConfig(
    @Req() req: AuthedRequest,
    @Body() body: { enabled: boolean; intervalHours: number; keepCount: number },
  ) {
    if (body.intervalHours <= 0 || body.keepCount <= 0) {
      throw new BadRequestException('Interval hours and keep count must be positive numbers.');
    }

    await this.prisma.setting.upsert({
      where: { key: 'db.autoBackupConfig' },
      update: { value: body as any },
      create: { key: 'db.autoBackupConfig', value: body as any },
    });

    await this.autoBackup.initScheduler();
    
    await this.audit.log({
      userId: req.user.sub,
      action: 'db.auto_backup_config_update',
      entity: 'Database',
      entityId: 'auto-backup',
      detail: body,
    });

    return { success: true };
  }

  // ---------- payment methods ----------

  @Get('payment-methods')
  @RequirePermissions('settings.manage')
  paymentMethods() {
    return this.prisma.paymentMethod.findMany({
      include: { account: true },
      orderBy: { sortOrder: 'asc' },
    });
  }

  @Post('payment-methods')
  @RequirePermissions('settings.manage')
  async createPaymentMethod(
    @Req() req: AuthedRequest,
    @Body() body: {
      name: string;
      nameAr?: string | null;
      kind: 'CASH' | 'CARD' | 'WALLET' | 'LOYALTY_POINTS' | 'OTHER';
      opensDrawer?: boolean;
      isActive?: boolean;
      sortOrder?: number;
      accountId?: string | null;
    },
  ) {
    if (!body.name || !body.kind) throw new BadRequestException('Name and kind are required.');
    const method = await this.prisma.paymentMethod.create({
      data: {
        name: body.name,
        nameAr: body.nameAr || null,
        kind: body.kind,
        opensDrawer: body.opensDrawer ?? false,
        isActive: body.isActive ?? true,
        sortOrder: body.sortOrder ?? 0,
        accountId: body.accountId || null,
      },
    });
    await this.audit.log({
      userId: req.user.sub,
      action: 'payment_method.create',
      entity: 'PaymentMethod',
      entityId: method.id,
    });
    this.realtime.emitTo('pos', 'menu.changed', {});
    return method;
  }

  @Patch('payment-methods/:id')
  @RequirePermissions('settings.manage')
  async updatePaymentMethod(
    @Req() req: AuthedRequest,
    @Param('id') id: string,
    @Body() body: {
      name?: string;
      nameAr?: string | null;
      kind?: 'CASH' | 'CARD' | 'WALLET' | 'LOYALTY_POINTS' | 'OTHER';
      opensDrawer?: boolean;
      isActive?: boolean;
      sortOrder?: number;
      accountId?: string | null;
    },
  ) {
    const method = await this.prisma.paymentMethod.update({
      where: { id },
      data: {
        name: body.name,
        nameAr: body.nameAr !== undefined ? (body.nameAr || null) : undefined,
        kind: body.kind,
        opensDrawer: body.opensDrawer,
        isActive: body.isActive,
        sortOrder: body.sortOrder,
        accountId: body.accountId !== undefined ? body.accountId : undefined,
      },
    });
    await this.audit.log({
      userId: req.user.sub,
      action: 'payment_method.update',
      entity: 'PaymentMethod',
      entityId: id,
      detail: body as any,
    });
    this.realtime.emitTo('pos', 'menu.changed', {});
    return method;
  }

  @Delete('payment-methods/:id')
  @RequirePermissions('settings.manage')
  async deletePaymentMethod(@Req() req: AuthedRequest, @Param('id') id: string) {
    const count = await this.prisma.payment.count({
      where: { methodId: id },
    });
    if (count > 0) {
      throw new BadRequestException('Cannot delete this payment method because it has transaction history. Deactivate it instead.');
    }
    await this.prisma.paymentMethod.delete({ where: { id } });
    await this.audit.log({
      userId: req.user.sub,
      action: 'payment_method.delete',
      entity: 'PaymentMethod',
      entityId: id,
    });
    this.realtime.emitTo('pos', 'menu.changed', {});
    return { success: true };
  }
}
