import { Body, Controller, Get, Param, Post, Query, Req } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { IsIn, IsInt, IsOptional, IsPositive, IsString, Matches, Max, MaxLength, Min } from 'class-validator';
import { ReservationStatus } from '@prisma/client';
import { AuthedRequest, Public, RequirePermissions } from '../auth/auth.guard';
import { ReservationsService } from './reservations.service';
import { PublicBookingService } from './public-booking.service';

class PublicBookDto {
  @IsOptional() @IsIn(['BILLIARDS_TABLE', 'PS_ROOM', 'RESTAURANT_TABLE']) type?: string;
  @IsOptional() @IsString() @MaxLength(40) resourceId?: string;
  @Matches(/^\d{4}-\d{2}-\d{2}$/) date!: string;
  @Matches(/^\d{2}:\d{2}$/) time!: string;
  @IsInt() @Min(15) @Max(720) durationMinutes!: number;
  @IsString() @MaxLength(80) name!: string;
  @IsString() @MaxLength(20) phone!: string;
  @IsInt() @Min(1) @Max(20) partySize!: number;
  @IsOptional() @IsString() @MaxLength(300) notes?: string;
}

class DepositReceivedDto {
  @IsString() @MaxLength(80) reference!: string;
}

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
  constructor(
    private readonly reservations: ReservationsService,
    private readonly booking: PublicBookingService,
  ) {}

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

  /** Staff: the InstaPay / wallet deposit for an online booking arrived. */
  @Post(':id/deposit-received')
  @RequirePermissions('reservation.manage')
  depositReceived(@Req() req: AuthedRequest, @Param('id') id: string, @Body() dto: DepositReceivedDto) {
    return this.booking.confirmDeposit(id, dto.reference, req.user.sub);
  }

  // ---------- public website booking (no login; rate-limited) ----------

  @Public()
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @Get('public/config')
  publicConfig() {
    return this.booking.config();
  }

  @Public()
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @Get('public/availability')
  publicAvailability(@Query('date') date?: string, @Query('type') type?: string) {
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Cairo' }).format(new Date());
    return this.booking.availability(date ?? today, type);
  }

  @Public()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('public/book')
  publicBook(@Body() dto: PublicBookDto) {
    return this.booking.book(dto);
  }

  @Public()
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @Get('public/booking/:code')
  publicStatus(@Param('code') code: string) {
    return this.booking.status(code);
  }
}
