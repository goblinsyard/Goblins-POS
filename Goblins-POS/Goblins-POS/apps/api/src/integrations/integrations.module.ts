import { Module } from '@nestjs/common';
import { KdsModule } from '../kds/kds.module';
import { OrdersModule } from '../orders/orders.module';
import { IntegrationsController } from './integrations.controller';
import { IntegrationsService } from './integrations.service';

@Module({
  imports: [OrdersModule, KdsModule],
  controllers: [IntegrationsController],
  providers: [IntegrationsService],
})
export class IntegrationsModule {}
