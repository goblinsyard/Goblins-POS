import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Req } from '@nestjs/common';
import { Type } from 'class-transformer';
import {
  ArrayNotEmpty, IsArray, IsBoolean, IsIn, IsInt, IsNumber, IsOptional, IsPositive, IsString,
  ValidateNested,
} from 'class-validator';
import { AuthedRequest, RequirePermissions } from '../auth/auth.guard';
import { InventoryService } from './inventory.service';
import { ProductionService } from './production.service';
import { PurchasingService } from './purchasing.service';

class TransferDto {
  @IsString() ingredientId!: string;
  @IsString() fromLocationId!: string;
  @IsString() toLocationId!: string;
  @IsNumber() @IsPositive() quantity!: number;
}

class WasteDto {
  @IsString() ingredientId!: string;
  @IsString() locationId!: string;
  @IsNumber() @IsPositive() quantity!: number;
  @IsString() reason!: string;
}

class AdjustDto {
  @IsString() ingredientId!: string;
  @IsString() locationId!: string;
  @IsNumber() delta!: number;
  @IsString() reason!: string;
}

class StartCountDto {
  @IsString() locationId!: string;
  @IsIn(['FULL', 'SPOT']) kind!: 'FULL' | 'SPOT';
  @IsOptional() @IsArray() ingredientIds?: string[];
}

class CountLineDto {
  @IsString() ingredientId!: string;
  @IsNumber() countedQty!: number;
}

class SubmitCountDto {
  @IsArray() @ArrayNotEmpty() @ValidateNested({ each: true }) @Type(() => CountLineDto)
  lines!: CountLineDto[];
}

class PoLineDto {
  @IsString() ingredientId!: string;
  @IsNumber() @IsPositive() quantity!: number;
  @IsInt() @IsPositive() unitCostCents!: number;
}

class CreatePoDto {
  @IsString() supplierId!: string;
  @IsArray() @ArrayNotEmpty() @ValidateNested({ each: true }) @Type(() => PoLineDto)
  lines!: PoLineDto[];
  @IsOptional() @IsString() expectedAt?: string;
  @IsOptional() @IsString() notes?: string;
}

class ReceiveLineDto {
  @IsString() poLineId!: string;
  @IsNumber() @IsPositive() quantity!: number;
  @IsOptional() @IsInt() unitCostCents?: number;
  @IsOptional() @IsString() expiresAt?: string;
  @IsOptional() @IsString() lotCode?: string;
}

class ReceiveDto {
  @IsString() locationId!: string;
  @IsArray() @ArrayNotEmpty() @ValidateNested({ each: true }) @Type(() => ReceiveLineDto)
  lines!: ReceiveLineDto[];
  @IsOptional() @IsString() invoiceNumber?: string;
  @IsOptional() @IsString() accountId?: string;
}

class UpdateGoodsReceiptDto {
  @IsOptional() @IsString() accountId?: string;
  @IsOptional() @IsString() invoiceNumber?: string;
  @IsOptional() @IsString() notes?: string;
}

class ProduceDto {
  @IsString() processId!: string;
  @IsNumber() @IsPositive() batchQty!: number;
  @IsOptional() @IsInt() laborMinutes?: number;
  @IsOptional() @IsString() notes?: string;
}

class CreateSupplierDto {
  @IsString() name!: string;
  @IsOptional() @IsString() phone?: string;
  @IsOptional() @IsString() email?: string;
  @IsOptional() @IsString() taxId?: string;
  @IsOptional() @IsString() notes?: string;
}

class UpdateSupplierDto {
  @IsOptional() @IsString() name?: string;
  @IsOptional() @IsString() phone?: string;
  @IsOptional() @IsString() email?: string;
  @IsOptional() @IsString() taxId?: string;
  @IsOptional() @IsString() notes?: string;
  @IsOptional() @IsBoolean() isActive?: boolean;
}

@Controller('inventory')
export class InventoryController {
  constructor(
    private readonly inventory: InventoryService,
    private readonly purchasing: PurchasingService,
    private readonly production: ProductionService,
  ) {}

  // views
  @Get('locations') @RequirePermissions('inventory.view')
  locations() { return this.inventory.locations(); }

  @Get('levels') @RequirePermissions('inventory.view')
  levels(@Query('locationId') locationId?: string) { return this.inventory.levels(locationId); }

  @Get('ingredients') @RequirePermissions('inventory.view')
  ingredients() { return this.inventory.ingredients(); }

  @Get('low-stock') @RequirePermissions('inventory.view')
  lowStock() { return this.inventory.lowStock(); }

  @Get('expiring') @RequirePermissions('inventory.view')
  expiring(@Query('days') days?: string) { return this.inventory.expiring(days ? Number(days) : 7); }

  @Get('movements') @RequirePermissions('inventory.view')
  movements(
    @Query('ingredientId') ingredientId?: string,
    @Query('kind') kind?: string,
    @Query('take') take?: string,
  ) {
    return this.inventory.movements({ ingredientId, kind, take: take ? Number(take) : undefined });
  }

  // mutations
  @Post('transfer') @RequirePermissions('inventory.transfer')
  transfer(@Req() req: AuthedRequest, @Body() dto: TransferDto) {
    return this.inventory.transfer({ ...dto, userId: req.user.sub });
  }

  @Post('waste') @RequirePermissions('inventory.waste')
  waste(@Req() req: AuthedRequest, @Body() dto: WasteDto) {
    return this.inventory.logWaste({ ...dto, userId: req.user.sub });
  }

  @Post('adjust') @RequirePermissions('inventory.adjust')
  adjust(@Req() req: AuthedRequest, @Body() dto: AdjustDto) {
    return this.inventory.adjust({ ...dto, userId: req.user.sub });
  }

  @Post('counts') @RequirePermissions('inventory.count')
  startCount(@Req() req: AuthedRequest, @Body() dto: StartCountDto) {
    return this.inventory.startCount({ ...dto, userId: req.user.sub });
  }

  @Post('counts/:id/submit') @RequirePermissions('inventory.count')
  submitCount(@Req() req: AuthedRequest, @Param('id') id: string, @Body() dto: SubmitCountDto) {
    return this.inventory.submitCount({ countId: id, userId: req.user.sub, lines: dto.lines });
  }

  // purchasing
  @Get('suppliers') @RequirePermissions('purchase.manage')
  suppliers(@Query('all') all?: string) { return this.purchasing.suppliers(all === 'true'); }

  @Post('suppliers') @RequirePermissions('purchase.manage')
  createSupplier(@Req() req: AuthedRequest, @Body() dto: CreateSupplierDto) {
    return this.purchasing.createSupplier(req.user.sub, dto);
  }

  @Patch('suppliers/:id') @RequirePermissions('purchase.manage')
  updateSupplier(@Req() req: AuthedRequest, @Param('id') id: string, @Body() dto: UpdateSupplierDto) {
    return this.purchasing.updateSupplier(req.user.sub, id, dto);
  }

  @Delete('suppliers/:id') @RequirePermissions('purchase.manage')
  deleteSupplier(@Req() req: AuthedRequest, @Param('id') id: string) {
    return this.purchasing.deleteSupplier(req.user.sub, id);
  }

  @Get('purchase-orders') @RequirePermissions('purchase.manage')
  listPOs() { return this.purchasing.listPOs(); }

  @Post('purchase-orders') @RequirePermissions('purchase.manage')
  createPO(@Req() req: AuthedRequest, @Body() dto: CreatePoDto) {
    return this.purchasing.createPO({ ...dto, userId: req.user.sub });
  }

  @Post('purchase-orders/:id/receive') @RequirePermissions('purchase.manage')
  receive(@Req() req: AuthedRequest, @Param('id') id: string, @Body() dto: ReceiveDto) {
    return this.purchasing.receive({ poId: id, userId: req.user.sub, ...dto });
  }

  @Get('goods-receipts') @RequirePermissions('purchase.manage')
  listGoodsReceipts() {
    return this.purchasing.listGoodsReceipts();
  }

  @Patch('goods-receipts/:id') @RequirePermissions('purchase.manage')
  updateGoodsReceipt(@Req() req: AuthedRequest, @Param('id') id: string, @Body() dto: UpdateGoodsReceiptDto) {
    return this.purchasing.updateGoodsReceipt(id, req.user.sub, dto);
  }

  @Delete('goods-receipts/:id') @RequirePermissions('purchase.manage')
  deleteGoodsReceipt(@Req() req: AuthedRequest, @Param('id') id: string) {
    return this.purchasing.deleteGoodsReceipt(id, req.user.sub);
  }

  // production
  @Get('production') @RequirePermissions('production.manage')
  productionList() { return this.production.list(); }

  @Get('production/recipes') @RequirePermissions('production.manage')
  producible() { return this.production.producibleRecipes(); }

  @Post('production') @RequirePermissions('production.manage')
  produce(@Req() req: AuthedRequest, @Body() dto: ProduceDto) {
    return this.production.produce({ ...dto, userId: req.user.sub });
  }
}
