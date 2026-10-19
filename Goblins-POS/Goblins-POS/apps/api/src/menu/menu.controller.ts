import { Body, Controller, Get, Param, Patch } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { IsBoolean } from 'class-validator';
import { Public, RequirePermissions } from '../auth/auth.guard';
import { PrismaService } from '../prisma/prisma.service';
import { RealtimeGateway } from '../realtime/realtime.gateway';

class Set86Dto {
  @IsBoolean() is86ed!: boolean;
}

@Controller('menu')
export class MenuController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly realtime: RealtimeGateway,
  ) {}

  /** Full menu for POS: categories with items, modifier groups, price schedules. */
  @Get()
  @RequirePermissions('pos.use')
  async fullMenu() {
    const categories = await this.prisma.category.findMany({
      where: { isActive: true },
      orderBy: { sortOrder: 'asc' },
      include: {
        station: { select: { id: true, name: true } },
        items: {
          where: { isActive: true },
          orderBy: { sortOrder: 'asc' },
          include: {
            station: { select: { id: true, name: true } },
            taxRate: true,
            priceSchedules: { where: { isActive: true } },
            modifierGroups: {
              include: {
                group: {
                  include: { modifiers: { where: { isActive: true }, orderBy: { sortOrder: 'asc' } } },
                },
              },
            },
          },
        },
      },
    });
    const stock = await this.stockFlags();
    return categories.map((c) => ({
      ...c,
      items: c.items.map((i) => ({ ...i, stock: stock.get(i.id) ?? null })),
    }));
  }

  /**
   * Per-item stock warning from the recipe: OUT when an ingredient has less on hand
   * than one portion needs, LOW when it is at or under its reorder point. Only
   * ingredients with a reorder point are tracked, so untracked stock never flags.
   */
  private async stockFlags(): Promise<Map<string, 'OUT' | 'LOW'>> {
    const [recipes, levels] = await Promise.all([
      this.prisma.recipe.findMany({
        where: { isActive: true },
        select: {
          menuItemId: true,
          lines: { select: { quantity: true, ingredient: { select: { id: true, reorderPoint: true } } } },
        },
      }),
      this.prisma.stockLevel.groupBy({ by: ['ingredientId'], _sum: { quantity: true } }),
    ]);
    const onHand = new Map(levels.map((l) => [l.ingredientId, Number(l._sum.quantity ?? 0)]));
    const flags = new Map<string, 'OUT' | 'LOW'>();
    for (const r of recipes) {
      let flag: 'OUT' | 'LOW' | null = null;
      for (const line of r.lines) {
        const reorder = Number(line.ingredient.reorderPoint);
        if (!(reorder > 0)) continue;
        const have = onHand.get(line.ingredient.id) ?? 0;
        if (have < Number(line.quantity)) { flag = 'OUT'; break; }
        if (have <= reorder) flag = 'LOW';
      }
      if (flag) flags.set(r.menuItemId, flag);
    }
    return flags;
  }

  /**
   * Public menu for the website and a table QR menu: active categories and items
   * with prices and pictures only (no stations, costs or internal fields).
   */
  @Public()
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @Get('public')
  async publicMenu() {
    const categories = await this.prisma.category.findMany({
      where: { isActive: true },
      orderBy: { sortOrder: 'asc' },
      select: {
        id: true, name: true, nameAr: true, color: true, parentCategoryId: true,
        items: {
          where: { isActive: true },
          orderBy: { sortOrder: 'asc' },
          select: {
            id: true, name: true, nameAr: true, description: true, priceCents: true, imageUrl: true, is86ed: true,
            modifierGroups: {
              where: { group: { isActive: true } },
              select: {
                group: {
                  select: {
                    name: true, nameAr: true, minSelect: true, maxSelect: true,
                    modifiers: {
                      where: { isActive: true },
                      orderBy: { sortOrder: 'asc' },
                      select: { name: true, nameAr: true, priceDeltaCents: true },
                    },
                  },
                },
              },
            },
          },
        },
      },
    });
    // hide internal categories (e.g. staff meals) by naming convention
    return categories.filter((c) => !/staff/i.test(c.name));
  }

  /** 86 an item — pushes live to all POS + KDS instantly. */
  @Patch('items/:id/86')
  @RequirePermissions('menu.86')
  async set86(@Param('id') id: string, @Body() dto: Set86Dto) {
    const item = await this.prisma.menuItem.update({
      where: { id },
      data: { is86ed: dto.is86ed },
      select: { id: true, name: true, is86ed: true },
    });
    this.realtime.emitTo('menu', 'item.86', item);
    this.realtime.emitTo('pos', 'item.86', item);
    return item;
  }
}
