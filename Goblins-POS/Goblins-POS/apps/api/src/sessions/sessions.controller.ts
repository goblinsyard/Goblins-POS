import { Body, Controller, Get, Param, Post, Req } from '@nestjs/common';
import { IsBoolean, IsInt, IsPositive, IsString } from 'class-validator';
import { AuthedRequest, RequirePermissions } from '../auth/auth.guard';
import { SessionsService } from './sessions.service';

class StartDto {
  @IsString() orderId!: string;
  @IsBoolean() isMultiplayer!: boolean;
}

class SetModeDto {
  @IsBoolean() isMultiplayer!: boolean;
}

class TransferDto {
  @IsString() toResourceId!: string;
}

class PrepaidDto {
  @IsInt() @IsPositive() minutes!: number;
}

@Controller('sessions')
export class SessionsController {
  constructor(private readonly sessions: SessionsService) {}

  @Get('by-order/:orderId')
  @RequirePermissions('pos.use')
  byOrder(@Param('orderId') orderId: string) {
    return this.sessions.byOrder(orderId);
  }

  @Post('start')
  @RequirePermissions('session.start')
  start(@Req() req: AuthedRequest, @Body() dto: StartDto) {
    return this.sessions.start({ orderId: dto.orderId, userId: req.user.sub, isMultiplayer: dto.isMultiplayer });
  }

  @Post(':id/pause')
  @RequirePermissions('session.start')
  pause(@Req() req: AuthedRequest, @Param('id') id: string) {
    return this.sessions.pause(id, req.user.sub);
  }

  @Post(':id/resume')
  @RequirePermissions('session.start')
  resume(@Req() req: AuthedRequest, @Param('id') id: string) {
    return this.sessions.resume(id, req.user.sub);
  }

  @Post(':id/set-mode')
  @RequirePermissions('session.start')
  setMode(@Req() req: AuthedRequest, @Param('id') id: string, @Body() dto: SetModeDto) {
    return this.sessions.setMode(id, req.user.sub, dto.isMultiplayer);
  }

  @Post(':id/transfer')
  @RequirePermissions('session.transfer')
  transfer(@Req() req: AuthedRequest, @Param('id') id: string, @Body() dto: TransferDto) {
    return this.sessions.transfer(id, req.user.sub, dto.toResourceId);
  }

  @Post(':id/stop')
  @RequirePermissions('session.stop')
  stop(@Req() req: AuthedRequest, @Param('id') id: string) {
    return this.sessions.stop(id, req.user.sub);
  }

  @Post(':id/prepaid')
  @RequirePermissions('payment.take')
  prepaid(@Req() req: AuthedRequest, @Param('id') id: string, @Body() dto: PrepaidDto) {
    return this.sessions.addPrepaid({ sessionId: id, userId: req.user.sub, minutes: dto.minutes });
  }
}
