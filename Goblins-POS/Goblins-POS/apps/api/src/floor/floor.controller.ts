import { Body, Controller, Get, Param, Patch } from '@nestjs/common';
import { IsEnum, IsNumber, IsOptional } from 'class-validator';
import { ResourceStatus } from '@prisma/client';
import { RequirePermissions } from '../auth/auth.guard';
import { PrismaService } from '../prisma/prisma.service';
import { RealtimeGateway } from '../realtime/realtime.gateway';

class UpdateStatusDto {
  @IsEnum(ResourceStatus) status!: ResourceStatus;
}

class UpdateGeometryDto {
  @IsOptional() @IsNumber() posX?: number;
  @IsOptional() @IsNumber() posY?: number;
  @IsOptional() @IsNumber() width?: number;
  @IsOptional() @IsNumber() height?: number;
  @IsOptional() @IsNumber() rotation?: number;
}

@Controller('floor')
export class FloorController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly realtime: RealtimeGateway,
  ) {}

  /** Live floor plan: zones + resources with open order / running session info. */
  @Get()
  @RequirePermissions('pos.use')
  async floor() {
    const zones = await this.prisma.floorZone.findMany({
      orderBy: { sortOrder: 'asc' },
      include: {
        resources: {
          where: { isActive: true },
          include: {
            ratePlan: { include: { rules: { where: { isActive: true } } } },
            orders: {
              where: { status: 'OPEN' },
              select: { id: true, number: true, totalCents: true, guestCount: true, openedAt: true },
            },
            sessions: {
              where: { status: { in: ['RUNNING', 'PAUSED'] } },
              include: { segments: true, prepaidBlocks: true },
            },
            reservations: {
              where: {
                status: { in: ['CONFIRMED', 'PENDING'] },
                startAt: { gte: new Date() },
              },
              orderBy: { startAt: 'asc' },
              take: 1,
              select: {
                id: true,
                startAt: true,
                guestName: true,
                customer: { select: { name: true } },
              },
            },
          },
        },
      },
    });
    return zones;
  }

  @Patch('resources/:id/status')
  @RequirePermissions('pos.use')
  async setStatus(@Param('id') id: string, @Body() dto: UpdateStatusDto) {
    const resource = await this.prisma.resource.update({
      where: { id },
      data: { status: dto.status },
      select: { id: true, status: true },
    });
    this.realtime.emitTo('floor', 'resource.status', resource);
    return resource;
  }

  /** Floor plan editor (back office). */
  @Patch('resources/:id/geometry')
  @RequirePermissions('settings.manage')
  async setGeometry(@Param('id') id: string, @Body() dto: UpdateGeometryDto) {
    const resource = await this.prisma.resource.update({ where: { id }, data: dto });
    this.realtime.emitTo('floor', 'resource.geometry', resource);
    return resource;
  }
}
