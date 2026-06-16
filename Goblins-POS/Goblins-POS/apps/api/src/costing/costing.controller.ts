import { Controller, Get, Post, Query } from '@nestjs/common';
import { RequirePermissions } from '../auth/auth.guard';
import { CostingService } from './costing.service';

@Controller('costing')
export class CostingController {
  constructor(private readonly costing: CostingService) {}

  @Get('items')
  @RequirePermissions('report.financial')
  itemCosts() {
    return this.costing.itemCosts();
  }

  @Get('summary')
  @RequirePermissions('report.financial')
  summary(@Query('from') from?: string, @Query('to') to?: string) {
    return this.costing.costSummary(
      from ? new Date(from) : new Date(Date.now() - 86400_000),
      to ? new Date(to) : new Date(),
    );
  }

  @Get('menu-engineering')
  @RequirePermissions('report.financial')
  menuEngineering(@Query('days') days?: string) {
    return this.costing.menuEngineering(days ? Number(days) : 30);
  }

  @Post('snapshot')
  @RequirePermissions('report.financial')
  snapshot() {
    return this.costing.runSnapshot();
  }
}
