import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { AdminModule } from './admin/admin.module';
import { AuditModule } from './audit/audit.module';
import { AuthModule } from './auth/auth.module';
import { CostingModule } from './costing/costing.module';
import { CrmModule } from './crm/crm.module';
import { ExpensesModule } from './expenses/expenses.module';
import { FloorModule } from './floor/floor.module';
import { InventoryModule } from './inventory/inventory.module';
import { KdsModule } from './kds/kds.module';
import { MenuModule } from './menu/menu.module';
import { DisplayModule } from './display/display.module';
import { OrdersModule } from './orders/orders.module';
import { PrismaModule } from './prisma/prisma.module';
import { RealtimeModule } from './realtime/realtime.module';
import { ReportsModule } from './reports/reports.module';
import { ReservationsModule } from './reservations/reservations.module';
import { SettingsModule } from './settings/settings.module';
import { SessionsModule } from './sessions/sessions.module';
import { ShiftsModule } from './shifts/shifts.module';
import { AccountingModule } from './accounting/accounting.module';
import { HrModule } from './hr/hr.module';
import { NotifyModule } from './notify/notify.module';
import { IntegrationsModule } from './integrations/integrations.module';

@Module({
  imports: [
    PrismaModule,
    AuthModule,
    AuditModule,
    RealtimeModule,
    SettingsModule,
    MenuModule,
    DisplayModule,
    FloorModule,
    OrdersModule,
    ShiftsModule,
    SessionsModule,
    KdsModule,
    InventoryModule,
    CostingModule,
    ExpensesModule,
    CrmModule,
    ReservationsModule,
    ReportsModule,
    AdminModule,
    AccountingModule,
    HrModule,
    NotifyModule,
    IntegrationsModule,
    ScheduleModule.forRoot(),
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 300 }]),
  ],

  providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule {}
