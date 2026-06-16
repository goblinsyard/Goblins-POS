import { Global, Module } from '@nestjs/common';
import { InventoryController } from './inventory.controller';
import { InventoryService } from './inventory.service';
import { ProductionService } from './production.service';
import { PurchasingService } from './purchasing.service';
import { StockService } from './stock.service';

@Global() // StockService is consumed by payments (sale deduction) & costing
@Module({
  controllers: [InventoryController],
  providers: [InventoryService, StockService, PurchasingService, ProductionService],
  exports: [StockService, InventoryService],
})
export class InventoryModule {}
