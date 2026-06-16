import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { IsNotEmpty, IsString } from 'class-validator';
import { Throttle } from '@nestjs/throttler';
import { AuthService } from './auth.service';
import { Public } from './auth.guard';

class PasswordLoginDto {
  @IsString() @IsNotEmpty() email!: string;
  @IsString() @IsNotEmpty() password!: string;
}

class PinLoginDto {
  @IsString() @IsNotEmpty() userId!: string;
  @IsString() @IsNotEmpty() pin!: string;
}

class RefreshDto {
  @IsString() @IsNotEmpty() refreshToken!: string;
}

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('login')
  login(@Body() dto: PasswordLoginDto) {
    return this.auth.loginPassword(dto.email, dto.password);
  }

  @Public()
  @Throttle({ default: { limit: 15, ttl: 60_000 } })
  @Post('login/pin')
  loginPin(@Body() dto: PinLoginDto) {
    return this.auth.loginPin(dto.userId, dto.pin);
  }

  @Public()
  @Get('pin-users')
  pinUsers(@Query('branchId') branchId?: string) {
    return this.auth.pinUsers(branchId);
  }

  @Public()
  @Post('refresh')
  refresh(@Body() dto: RefreshDto) {
    return this.auth.refresh(dto.refreshToken);
  }

  @Public()
  @Post('logout')
  logout(@Body() dto: RefreshDto) {
    return this.auth.logout(dto.refreshToken);
  }
}
