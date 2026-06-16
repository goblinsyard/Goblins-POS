import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Req } from '@nestjs/common';
import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, IsString, Min, IsNumber, IsBoolean } from 'class-validator';
import { AuthedRequest, RequirePermissions } from '../auth/auth.guard';
import { HrService } from './hr.service';

class UpdateStaffSalaryDto {
  @IsOptional() @IsEnum(['MONTHLY', 'HOURLY']) salaryType?: 'MONTHLY' | 'HOURLY';
  @IsOptional() @IsInt() @Min(0) baseSalaryCents?: number;
  @IsOptional() @IsInt() @Min(0) hourlyRateCents?: number;
  @IsOptional() @IsInt() @Min(0) tipsPoints?: number;
  @IsOptional() @IsBoolean() deservesBonus?: boolean;
}

class CreateHrTransactionDto {
  @IsString() staffId!: string;
  @IsEnum(['ADVANCE', 'BONUS', 'DEDUCTION', 'SALARY_PAYMENT', 'TIPS']) type!: 'ADVANCE' | 'BONUS' | 'DEDUCTION' | 'SALARY_PAYMENT' | 'TIPS';
  @IsInt() @Min(1) amountCents!: number;
  @IsOptional() @IsString() notes?: string;
  @IsOptional() @IsString() paymentMethod?: string;
  @IsOptional() @IsString() accountId?: string;
  @IsOptional() @IsString() date?: string;
}

class DistributeTipsDto {
  @IsInt() @Min(1) totalAmountCents!: number;
  @IsString() paymentMethod!: string;
  @IsOptional() @IsString() accountId?: string;
  @IsOptional() @IsString() notes?: string;
}

class DistributeBonusDto {
  @IsString() startDate!: string;
  @IsString() endDate!: string;
  @IsNumber() @Min(0.01) bonusPercentage!: number;
  @IsString() paymentMethod!: string;
  @IsOptional() @IsString() accountId?: string;
  @IsOptional() @IsString() notes?: string;
}

class CreateAttendanceDto {
  @IsString() staffId!: string;
  @IsString() clockIn!: string;
  @IsOptional() @IsString() clockOut?: string;
  @IsOptional() @IsString() note?: string;
}

class UpdateAttendanceDto {
  @IsOptional() @IsString() clockIn?: string;
  @IsOptional() @IsString() clockOut?: string;
  @IsOptional() @IsString() note?: string;
}

@Controller('hr')
export class HrController {
  constructor(private readonly hr: HrService) {}

  @Get('staff')
  @RequirePermissions('staff.manage')
  async staffSummary(@Query('from') from?: string, @Query('to') to?: string) {
    return this.hr.staffSummary(from, to);
  }

  @Patch('staff/:id')
  @RequirePermissions('staff.manage')
  async updateStaffSalary(
    @Req() req: AuthedRequest,
    @Param('id') id: string,
    @Body() dto: UpdateStaffSalaryDto,
  ) {
    return this.hr.updateStaffSalary(req.user.sub, id, dto);
  }

  @Get('transactions')
  @RequirePermissions('staff.manage')
  async listTransactions(
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('userId') userId?: string,
    @Query('type') type?: string,
  ) {
    return this.hr.listTransactions({ from, to, userId, type });
  }

  @Post('transactions')
  @RequirePermissions('staff.manage')
  async createTransaction(@Req() req: AuthedRequest, @Body() dto: CreateHrTransactionDto) {
    return this.hr.createTransaction(req.user.sub, dto);
  }

  @Delete('transactions/:id')
  @RequirePermissions('staff.manage')
  async deleteTransaction(@Req() req: AuthedRequest, @Param('id') id: string) {
    return this.hr.deleteTransaction(req.user.sub, id);
  }

  @Get('attendance')
  @RequirePermissions('staff.manage')
  async listAttendance(
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('userId') userId?: string,
  ) {
    return this.hr.listAttendance({ from, to, userId });
  }

  @Post('attendance')
  @RequirePermissions('staff.manage')
  async createAttendance(@Req() req: AuthedRequest, @Body() dto: CreateAttendanceDto) {
    return this.hr.createAttendance(req.user.sub, dto);
  }

  @Patch('attendance/:id')
  @RequirePermissions('staff.manage')
  async updateAttendance(
    @Req() req: AuthedRequest,
    @Param('id') id: string,
    @Body() dto: UpdateAttendanceDto,
  ) {
    return this.hr.updateAttendance(req.user.sub, id, dto);
  }

  @Delete('attendance/:id')
  @RequirePermissions('staff.manage')
  async deleteAttendance(@Req() req: AuthedRequest, @Param('id') id: string) {
    return this.hr.deleteAttendance(req.user.sub, id);
  }

  @Get('tips/preview')
  @RequirePermissions('staff.manage')
  async getTipsPreview() {
    return this.hr.getTipsPreview();
  }

  @Post('tips/distribute')
  @RequirePermissions('staff.manage')
  async distributeTips(@Req() req: AuthedRequest, @Body() dto: DistributeTipsDto) {
    return this.hr.distributeTips(req.user.sub, dto);
  }

  @Get('bonus/preview')
  @RequirePermissions('staff.manage')
  async getBonusPreview(
    @Query('startDate') startDate: string,
    @Query('endDate') endDate: string,
    @Query('bonusPercentage') bonusPercentageStr: string,
  ) {
    const bonusPercentage = parseFloat(bonusPercentageStr);
    return this.hr.getBonusPreview({ startDate, endDate, bonusPercentage });
  }

  @Post('bonus/distribute')
  @RequirePermissions('staff.manage')
  async distributeBonus(@Req() req: AuthedRequest, @Body() dto: DistributeBonusDto) {
    return this.hr.distributeBonus(req.user.sub, dto);
  }
}
