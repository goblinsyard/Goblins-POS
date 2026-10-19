import { Module } from '@nestjs/common';
import { ReservationsController } from './reservations.controller';
import { ReservationsService } from './reservations.service';
import { PublicBookingService } from './public-booking.service';

@Module({
  controllers: [ReservationsController],
  providers: [ReservationsService, PublicBookingService],
  exports: [ReservationsService],
})
export class ReservationsModule {}
