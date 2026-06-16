import { Body, Controller, Get, Param, Post, Req } from '@nestjs/common';
import { IsInt, Min } from 'class-validator';
import { AuthedRequest, RequirePermissions } from '../auth/auth.guard';
import { KdsService } from './kds.service';

class FireCourseDto {
  @IsInt() @Min(2) course!: number;
}

@Controller('kds')
export class KdsController {
  constructor(private readonly kds: KdsService) {}

  @Get('stations')
  @RequirePermissions('kds.use')
  stations() {
    return this.kds.stations();
  }

  @Get('stations/:id/tickets')
  @RequirePermissions('kds.use')
  stationTickets(@Param('id') id: string) {
    return this.kds.stationTickets(id);
  }

  @Get('stations/:id/all-day')
  @RequirePermissions('kds.use')
  allDay(@Param('id') id: string) {
    return this.kds.allDay(id);
  }

  @Get('expo')
  @RequirePermissions('kds.use')
  expo() {
    return this.kds.expo();
  }

  @Post('orders/:orderId/send')
  @RequirePermissions('order.create')
  send(@Req() req: AuthedRequest, @Param('orderId') orderId: string) {
    return this.kds.send(orderId, req.user.sub);
  }

  @Post('orders/:orderId/fire')
  @RequirePermissions('order.create')
  fire(@Req() req: AuthedRequest, @Param('orderId') orderId: string, @Body() dto: FireCourseDto) {
    return this.kds.fireCourse(orderId, dto.course, req.user.sub);
  }

  @Post('tickets/:id/bump')
  @RequirePermissions('kds.bump')
  bump(@Req() req: AuthedRequest, @Param('id') id: string) {
    return this.kds.bump(id, req.user.sub);
  }

  @Post('tickets/:id/recall')
  @RequirePermissions('kds.bump')
  recall(@Req() req: AuthedRequest, @Param('id') id: string) {
    return this.kds.recall(id, req.user.sub);
  }

  @Post('tickets/:id/reprint')
  @RequirePermissions('kds.use')
  reprint(@Param('id') id: string) {
    return this.kds.reprint(id);
  }
}
