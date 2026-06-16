import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { ReceiptsService } from '../receipts/receipts.service';
import { OrdersController, PaymentMethodsController } from './orders.controller';
import { OrdersService } from './orders.service';
import { PaymentsService } from './payments.service';

@Module({
  imports: [AuthModule],
  controllers: [OrdersController, PaymentMethodsController],
  providers: [OrdersService, PaymentsService, ReceiptsService],
  exports: [OrdersService, PaymentsService],
})
export class OrdersModule {}
