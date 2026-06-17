import { Body, Controller, Get, Param, Post, Req } from '@nestjs/common';
import { IsIn, IsInt, IsString, Min } from 'class-validator';
import { AuthedRequest, RequirePermissions } from '../auth/auth.guard';
import { ShiftsService } from './shifts.service';

class OpenShiftDto {
  @IsInt() @Min(0) floatCents!: number;
}

class CloseShiftDto {
  @IsInt() @Min(0) countedCents!: number;
}

class CashMovementDto {
  @IsIn(['PAID_IN', 'PAID_OUT', 'PETTY_CASH', 'DRAWER_OPEN', 'CASH_TRANSFER'])
  kind!: 'PAID_IN' | 'PAID_OUT' | 'PETTY_CASH' | 'DRAWER_OPEN' | 'CASH_TRANSFER';
  @IsInt() amountCents!: number;
  @IsString() reason!: string;
}

class ReconcileShiftDto {
  @IsInt() @Min(0) countedCents!: number;
}

@Controller('shifts')
export class ShiftsController {
  constructor(private readonly shifts: ShiftsService) {}

  @Post('open')
  @RequirePermissions('shift.open')
  open(@Req() req: AuthedRequest, @Body() dto: OpenShiftDto) {
    return this.shifts.open({
      branchId: req.user.branchId, userId: req.user.sub, floatCents: dto.floatCents,
    });
  }

  @Get('current')
  @RequirePermissions('pos.use')
  current(@Req() req: AuthedRequest) {
    return this.shifts.current(req.user.branchId);
  }

  @Get(':id/x-report')
  @RequirePermissions('shift.x_report')
  xReport(@Req() req: AuthedRequest, @Param('id') id: string) {
    return this.shifts.xReport(id, req.user.sub);
  }

  @Post(':id/close')
  @RequirePermissions('shift.close')
  close(@Req() req: AuthedRequest, @Param('id') id: string, @Body() dto: CloseShiftDto) {
    return this.shifts.close({ shiftId: id, userId: req.user.sub, countedCents: dto.countedCents });
  }

  @Post(':id/reconcile')
  @RequirePermissions('shift.close')
  reconcile(@Req() req: AuthedRequest, @Param('id') id: string, @Body() dto: ReconcileShiftDto) {
    return this.shifts.reconcileCount({ shiftId: id, userId: req.user.sub, countedCents: dto.countedCents });
  }

  @Post(':id/cash-movement')
  @RequirePermissions('pos.use')
  cashMovement(@Req() req: AuthedRequest, @Param('id') id: string, @Body() dto: CashMovementDto) {
    return this.shifts.cashMovement({ shiftId: id, userId: req.user.sub, ...dto });
  }

  @Get()
  @RequirePermissions('report.view')
  list(@Req() req: AuthedRequest) {
    return this.shifts.list(req.user.branchId);
  }

  @Get(':id/details')
  @RequirePermissions('report.view')
  details(@Req() req: AuthedRequest, @Param('id') id: string) {
    return this.shifts.getDetails(id, req.user.sub);
  }
}
