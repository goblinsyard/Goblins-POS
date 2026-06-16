import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Req } from '@nestjs/common';
import { AccountType } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  ArrayNotEmpty, IsArray, IsBoolean, IsInt, IsOptional, IsString, ValidateNested, Min,
} from 'class-validator';
import { AuthedRequest, RequirePermissions } from '../auth/auth.guard';
import { AccountingService } from './accounting.service';

class CreateAccountDto {
  @IsString() code!: string;
  @IsString() name!: string;
  @IsOptional() @IsString() nameAr?: string;
  @IsString() type!: AccountType;
  @IsOptional() @IsString() parentAccountId?: string;
  @IsOptional() @IsInt() initialBalanceCents?: number;
  @IsOptional() @IsBoolean() isPaymentSource?: boolean;
}

class UpdateAccountDto {
  @IsOptional() @IsString() code?: string;
  @IsOptional() @IsString() name?: string;
  @IsOptional() @IsString() nameAr?: string;
  @IsOptional() @IsBoolean() isActive?: boolean;
  @IsOptional() @IsInt() initialBalanceCents?: number;
  @IsOptional() @IsBoolean() isPaymentSource?: boolean;
  @IsOptional() @IsString() parentAccountId?: string | null;
}

class JournalLineDto {
  @IsString() accountId!: string;
  @IsInt() debitCents!: number;
  @IsInt() creditCents!: number;
}

class CreateJournalEntryDto {
  @IsString() description!: string;
  @IsOptional() @IsString() date?: string;
  @IsOptional() @IsString() reference?: string;

  @IsArray()
  @ArrayNotEmpty()
  @ValidateNested({ each: true })
  @Type(() => JournalLineDto)
  lines!: JournalLineDto[];
}

class UpdateJournalEntryDto {
  @IsOptional() @IsString() description?: string;
  @IsOptional() @IsString() date?: string;
  @IsOptional() @IsString() reference?: string;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => JournalLineDto)
  lines?: JournalLineDto[];
}

class CreateCashTransferDto {
  @IsString() sourceAccountId!: string;
  @IsString() targetAccountId!: string;
  @IsInt() @Min(1) amountCents!: number;
  @IsString() description!: string;
  @IsOptional() @IsString() date?: string;
  @IsOptional() @IsString() reference?: string;
}

@Controller('accounting')
export class AccountingController {
  constructor(private readonly accounting: AccountingService) {}

  @Get('accounts')
  @RequirePermissions('accounting.manage')
  accounts() {
    return this.accounting.accounts();
  }

  @Post('accounts')
  @RequirePermissions('accounting.manage')
  createAccount(@Req() req: AuthedRequest, @Body() dto: CreateAccountDto) {
    return this.accounting.createAccount(req.user.sub, dto);
  }

  @Patch('accounts/:id')
  @RequirePermissions('accounting.manage')
  updateAccount(
    @Req() req: AuthedRequest,
    @Param('id') id: string,
    @Body() dto: UpdateAccountDto,
  ) {
    return this.accounting.updateAccount(req.user.sub, id, dto);
  }

  @Get('accounts/:id/ledger')
  @RequirePermissions('accounting.manage')
  ledger(@Param('id') id: string) {
    return this.accounting.ledger(id);
  }

  @Get('journal-entries')
  @RequirePermissions('accounting.manage')
  journalEntries() {
    return this.accounting.journalEntries();
  }

  @Post('journal-entries')
  @RequirePermissions('accounting.manage')
  createJournalEntry(@Req() req: AuthedRequest, @Body() dto: CreateJournalEntryDto) {
    return this.accounting.createJournalEntry(req.user.sub, dto);
  }

  @Patch('journal-entries/:id')
  @RequirePermissions('accounting.manage')
  updateJournalEntry(
    @Req() req: AuthedRequest,
    @Param('id') id: string,
    @Body() dto: UpdateJournalEntryDto,
  ) {
    return this.accounting.updateJournalEntry(req.user.sub, id, dto);
  }

  @Delete('journal-entries/:id')
  @RequirePermissions('accounting.manage')
  deleteJournalEntry(
    @Req() req: AuthedRequest,
    @Param('id') id: string,
  ) {
    return this.accounting.deleteJournalEntry(req.user.sub, id);
  }

  @Get('reports/trial-balance')
  @RequirePermissions('report.financial')
  trialBalance() {
    return this.accounting.trialBalance();
  }

  @Get('reports/balance-sheet')
  @RequirePermissions('report.financial')
  balanceSheet() {
    return this.accounting.balanceSheet();
  }

  @Get('reports/pnl')
  @RequirePermissions('report.financial')
  pnl(@Query('from') from?: string, @Query('to') to?: string) {
    return this.accounting.pnlReport(
      from ? new Date(from) : undefined,
      to ? new Date(to) : undefined,
    );
  }

  @Get('transfers')
  @RequirePermissions('accounting.manage')
  cashTransfers() {
    return this.accounting.cashTransfers();
  }

  @Post('transfers')
  @RequirePermissions('accounting.manage')
  createCashTransfer(@Req() req: AuthedRequest, @Body() dto: CreateCashTransferDto) {
    return this.accounting.createCashTransfer(req.user.sub, dto);
  }
}
