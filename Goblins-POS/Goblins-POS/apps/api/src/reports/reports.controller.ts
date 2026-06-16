import { Controller, Get, Header, Param, Query, Req } from '@nestjs/common';
import { AuthedRequest, RequirePermissions } from '../auth/auth.guard';
import { ReportsService } from './reports.service';

function parseDate(s: string | undefined, fallback: Date): Date {
  if (!s) return fallback;
  // '+' in ISO offsets arrives as a space when not URL-encoded — repair it
  const d = new Date(s.replace(' ', '+'));
  return Number.isNaN(d.getTime()) ? fallback : d;
}

function range(from?: string, to?: string): { from: Date; to: Date } {
  return {
    from: parseDate(from, new Date(Date.now() - 7 * 86400_000)),
    to: parseDate(to, new Date()),
  };
}

@Controller('reports')
export class ReportsController {
  constructor(private readonly reports: ReportsService) {}

  @Get('dashboard')
  @RequirePermissions('report.view')
  dashboard(@Req() req: AuthedRequest) {
    return this.reports.dashboard(req.user.branchId);
  }

  @Get('sales')
  @RequirePermissions('report.view')
  sales(
    @Req() req: AuthedRequest,
    @Query('groupBy') groupBy = 'day',
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    const r = range(from, to);
    return this.reports.sales(req.user.branchId, r.from, r.to, groupBy as never);
  }

  @Get('sales.csv')
  @RequirePermissions('report.view')
  @Header('Content-Type', 'text/csv')
  async salesCsv(
    @Req() req: AuthedRequest,
    @Query('groupBy') groupBy = 'day',
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    const r = range(from, to);
    const rows = await this.reports.sales(req.user.branchId, r.from, r.to, groupBy as never);
    return this.reports.toCsv(rows);
  }

  @Get('utilization')
  @RequirePermissions('report.view')
  utilization(@Query('from') from?: string, @Query('to') to?: string) {
    const r = range(from, to);
    return this.reports.utilization(r.from, r.to);
  }

  @Get('inventory/:kind')
  @RequirePermissions('report.view')
  inventory(
    @Param('kind') kind: 'consumption' | 'variance' | 'waste' | 'prices',
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    const r = range(from, to);
    return this.reports.inventoryReport(kind, r.from, r.to);
  }

  @Get('inventory/:kind.csv')
  @RequirePermissions('report.view')
  @Header('Content-Type', 'text/csv')
  async inventoryCsv(
    @Param('kind') kind: 'consumption' | 'variance' | 'waste' | 'prices',
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    const r = range(from, to);
    const rows = await this.reports.inventoryReport(kind, r.from, r.to);
    return this.reports.toCsv(rows as Record<string, unknown>[]);
  }
}
