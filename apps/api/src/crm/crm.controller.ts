import { Body, Controller, Get, Header, Param, Patch, Post, Query, Req } from '@nestjs/common';
import { IsArray, IsBoolean, IsInt, IsOptional, IsPositive, IsString, Max, Min } from 'class-validator';
import { AuthedRequest, RequirePermissions } from '../auth/auth.guard';
import { CrmService } from './crm.service';

class CreateCustomerDto {
  @IsString() phone!: string;
  @IsString() name!: string;
  @IsOptional() @IsString() email?: string;
  @IsOptional() @IsString() birthday?: string;
  @IsOptional() @IsArray() tags?: string[];
  @IsOptional() @IsString() notes?: string;
  @IsOptional() @IsString() groupId?: string;
  @IsOptional() @IsBoolean() isActive?: boolean;
  @IsOptional() @IsInt() walletBalanceCents?: number;
}

class UpdateCustomerDto {
  @IsOptional() @IsString() name?: string;
  @IsOptional() @IsString() email?: string;
  @IsOptional() @IsString() birthday?: string;
  @IsOptional() @IsArray() tags?: string[];
  @IsOptional() @IsString() notes?: string;
  @IsOptional() groupId?: string | null;
  @IsOptional() @IsBoolean() isActive?: boolean;
  @IsOptional() @IsInt() walletBalanceCents?: number;
}

class GroupDto {
  @IsString() name!: string;
  @IsOptional() @IsString() nameAr?: string;
  @IsInt() @Min(0) @Max(10000) discountBps!: number;
}

class RedeemDto {
  @IsString() customerId!: string;
  @IsInt() @IsPositive() points!: number;
  @IsString() orderId!: string;
}

class FeedbackDto {
  @IsString() orderId!: string;
  @IsInt() @Min(1) @Max(5) rating!: number;
  @IsOptional() @IsString() comment?: string;
}

class SendCampaignDto {
  @IsString() segment!: 'inactive30' | 'top10pct' | 'birthdayThisWeek' | 'all';
  @IsString() gateway!: 'twilio_sms' | 'twilio_whatsapp' | 'mock_sms' | 'mock_whatsapp';
  @IsString() template!: string;
}

@Controller('crm')
export class CrmController {
  constructor(private readonly crm: CrmService) {}

  @Get('customers/lookup')
  @RequirePermissions('customer.view')
  lookup(@Query('q') q?: string, @Query('phone') phone?: string, @Query('onlyActive') onlyActive?: string) {
    return this.crm.lookup(q ?? phone ?? '', onlyActive === 'true');
  }

  @Get('customers/:id')
  @RequirePermissions('customer.view')
  get(@Param('id') id: string) {
    return this.crm.get(id);
  }

  @Get('customers/:id/pos-flags')
  @RequirePermissions('pos.use')
  posFlags(@Param('id') id: string) {
    return this.crm.posFlags(id);
  }

  @Post('customers')
  @RequirePermissions('customer.manage')
  create(@Req() req: AuthedRequest, @Body() dto: CreateCustomerDto) {
    return this.crm.create({ ...dto, userId: req.user.sub });
  }

  @Patch('customers/:id')
  @RequirePermissions('customer.manage')
  update(@Req() req: AuthedRequest, @Param('id') id: string, @Body() dto: UpdateCustomerDto) {
    return this.crm.update(id, dto, req.user.sub);
  }

  @Post('redeem')
  @RequirePermissions('payment.take')
  redeem(@Req() req: AuthedRequest, @Body() dto: RedeemDto) {
    return this.crm.redeemPoints({ ...dto, userId: req.user.sub });
  }

  @Get('segments/:kind')
  @RequirePermissions('customer.manage')
  segment(@Param('kind') kind: 'inactive30' | 'top10pct' | 'birthdayThisWeek' | 'all') {
    return this.crm.segment(kind);
  }

  @Get('segments/:kind/export')
  @RequirePermissions('customer.manage')
  @Header('Content-Type', 'text/csv')
  segmentCsv(
    @Param('kind') kind: 'inactive30' | 'top10pct' | 'birthdayThisWeek' | 'all',
    @Query('template') template?: string,
  ) {
    return this.crm.segmentCsv(kind, template);
  }

  @Post('feedback')
  @RequirePermissions('pos.use')
  feedback(@Body() dto: FeedbackDto) {
    return this.crm.feedback(dto);
  }

  // ---------- customer groups (auto-applied discounts) ----------

  @Get('groups')
  @RequirePermissions('customer.view')
  groups() {
    return this.crm.groups();
  }

  @Post('groups')
  @RequirePermissions('customer.manage')
  createGroup(@Req() req: AuthedRequest, @Body() dto: GroupDto) {
    return this.crm.createGroup(dto, req.user.sub);
  }

  @Patch('groups/:id')
  @RequirePermissions('customer.manage')
  updateGroup(@Req() req: AuthedRequest, @Param('id') id: string, @Body() body: Record<string, unknown>) {
    return this.crm.updateGroup(id, body, req.user.sub);
  }

  @Post('campaigns/send')
  @RequirePermissions('customer.manage')
  sendCampaign(@Req() req: AuthedRequest, @Body() dto: SendCampaignDto) {
    return this.crm.sendCampaign({ ...dto, userId: req.user.sub });
  }
}
