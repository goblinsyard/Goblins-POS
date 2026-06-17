import { Body, Controller, Get, Param, Patch } from '@nestjs/common';
import { IsBoolean } from 'class-validator';
import { RequirePermissions } from '../auth/auth.guard';
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
    return categories;
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
