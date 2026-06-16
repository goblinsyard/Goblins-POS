import { Body, Controller, Get, Param, Post, Query, Req } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { IsInt, IsOptional, IsPositive, IsString } from 'class-validator';
import { ReservationStatus } from '@prisma/client';
import { AuthedRequest, Public, RequirePermissions } from '../auth/auth.guard';
import { ReservationsService } from './reservations.service';

class CreateReservationDto {
  @IsString() resourceId!: string;
  @IsString() startAt!: string;
  @IsString() endAt!: string;
  @IsInt() @IsPositive() partySize!: number;
  @IsOptional() @IsString() customerId?: string;
  @IsOptional() @IsString() guestName?: string;
  @IsOptional() @IsString() guestPhone?: string;
  @IsOptional() @IsInt() depositCents?: number;
  @IsOptional() @IsString() notes?: string;
}

@Controller('reservations')
export class ReservationsController {
  constructor(private readonly reservations: ReservationsService) {}

  @Get('timeline')
  @RequirePermissions('reservation.manage')
  timeline(@Query('from') from?: string, @Query('to') to?: string) {
    const now = new Date();
    return this.reservations.timeline(
      from ? new Date(from) : new Date(now.getTime() - 86400_000),
      to ? new Date(to) : new Date(now.getTime() + 7 * 86400_000),
    );
  }

  @Post()
  @RequirePermissions('reservation.manage')
  create(@Req() req: AuthedRequest, @Body() dto: CreateReservationDto) {
    return this.reservations.create({ ...dto, branchId: req.user.branchId, userId: req.user.sub });
  }

  @Post(':id/status/:status')
  @RequirePermissions('reservation.manage')
  setStatus(
    @Req() req: AuthedRequest,
    @Param('id') id: string,
    @Param('status') status: string,
  ) {
    return this.reservations.setStatus(id, status.toUpperCase() as ReservationStatus, req.user.sub);
  }

  /** Manually run the reservation sweep (also runs on a 1-min cron). */
  @Post('sweep')
  @RequirePermissions('reservation.manage')
  sweep() {
    return this.reservations.sweep();
  }

  /** Public availability for the website booking widget (phase-2 ready). */
  @Public()
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @Get('public/availability')
  publicAvailability(@Query('date') date: string, @Query('type') type?: string) {
    return this.reservations.publicAvailability(date ?? new Date().toISOString().slice(0, 10), type);
  }
}
