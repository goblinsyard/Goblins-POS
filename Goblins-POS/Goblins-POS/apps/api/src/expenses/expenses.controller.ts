import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Req } from '@nestjs/common';
import { IsBoolean, IsInt, IsOptional, IsPositive, IsString } from 'class-validator';
import { AuthedRequest, RequirePermissions } from '../auth/auth.guard';
import { ExpensesService } from './expenses.service';

class CreateExpenseDto {
  @IsString() categoryId!: string;
  @IsString() description!: string;
  @IsInt() @IsPositive() amountCents!: number;
  @IsOptional() @IsString() paymentMethod?: string;
  @IsOptional() @IsString() expenseDate?: string;
  @IsOptional() @IsString() department?: string;
  @IsOptional() @IsBoolean() isRecurring?: boolean;
  @IsOptional() @IsString() recurrence?: string;
  @IsOptional() @IsString() attachmentUrl?: string;
  @IsOptional() @IsString() accountId?: string;
}

class UpdateExpenseDto {
  @IsOptional() @IsString() categoryId?: string;
  @IsOptional() @IsString() description?: string;
  @IsOptional() @IsInt() @IsPositive() amountCents?: number;
  @IsOptional() @IsString() paymentMethod?: string;
  @IsOptional() @IsString() expenseDate?: string;
  @IsOptional() @IsString() department?: string;
  @IsOptional() @IsBoolean() isRecurring?: boolean;
  @IsOptional() @IsString() recurrence?: string;
  @IsOptional() @IsString() attachmentUrl?: string;
  @IsOptional() @IsString() accountId?: string;
}

class CreateCategoryDto {
  @IsString() name!: string;
  @IsOptional() @IsString() nameAr?: string;
  @IsOptional() @IsString() accountId?: string;
}

class UpdateCategoryDto {
  @IsOptional() @IsString() name?: string;
  @IsOptional() @IsString() nameAr?: string;
  @IsOptional() @IsString() accountId?: string;
}

@Controller('expenses')
export class ExpensesController {
  constructor(private readonly expenses: ExpensesService) {}

  @Get('categories')
  @RequirePermissions('expense.manage')
  categories() {
    return this.expenses.categories();
  }

  @Post('categories')
  @RequirePermissions('expense.manage')
  createCategory(@Req() req: AuthedRequest, @Body() dto: CreateCategoryDto) {
    return this.expenses.createCategory(req.user.sub, dto);
  }

  @Patch('categories/:id')
  @RequirePermissions('expense.manage')
  updateCategory(@Req() req: AuthedRequest, @Param('id') id: string, @Body() dto: UpdateCategoryDto) {
    return this.expenses.updateCategory(req.user.sub, id, dto);
  }

  @Delete('categories/:id')
  @RequirePermissions('expense.manage')
  deleteCategory(@Req() req: AuthedRequest, @Param('id') id: string) {
    return this.expenses.deleteCategory(req.user.sub, id);
  }

  @Get()
  @RequirePermissions('expense.manage')
  list(@Query('from') from?: string, @Query('to') to?: string, @Query('categoryId') categoryId?: string) {
    return this.expenses.list({
      from: from ? new Date(from) : undefined,
      to: to ? new Date(to) : undefined,
      categoryId,
    });
  }

  @Post()
  @RequirePermissions('expense.manage')
  create(@Req() req: AuthedRequest, @Body() dto: CreateExpenseDto) {
    return this.expenses.create({ ...dto, branchId: req.user.branchId, userId: req.user.sub });
  }

  @Patch(':id')
  @RequirePermissions('expense.manage')
  update(@Req() req: AuthedRequest, @Param('id') id: string, @Body() dto: UpdateExpenseDto) {
    return this.expenses.update(id, req.user.sub, dto);
  }

  @Delete(':id')
  @RequirePermissions('expense.manage')
  delete(@Req() req: AuthedRequest, @Param('id') id: string) {
    return this.expenses.delete(id, req.user.sub);
  }

  @Get('pnl')
  @RequirePermissions('report.financial')
  pnl(@Req() req: AuthedRequest, @Query('from') from?: string, @Query('to') to?: string) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return this.expenses.dailyPnl(
      req.user.branchId,
      from ? new Date(from) : today,
      to ? new Date(to) : new Date(),
    );
  }

  @Get('vat-report')
  @RequirePermissions('report.financial')
  vat(@Req() req: AuthedRequest, @Query('from') from?: string, @Query('to') to?: string) {
    const monthStart = new Date();
    monthStart.setDate(1);
    monthStart.setHours(0, 0, 0, 0);
    return this.expenses.vatReport(
      req.user.branchId,
      from ? new Date(from) : monthStart,
      to ? new Date(to) : new Date(),
    );
  }
}
