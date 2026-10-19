import { BadRequestException, Body, Controller, Headers, Param, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize, ArrayNotEmpty, IsArray, IsInt, IsNumber, IsOptional, IsPositive, IsString, MaxLength, Min,
  ValidateNested,
} from 'class-validator';
import { Public } from '../auth/auth.guard';
import { APP_CHANNELS, AppChannel, IntegrationsService } from './integrations.service';

class IncomingCustomerDto {
  @IsOptional() @IsString() @MaxLength(120) name?: string;
  @IsOptional() @IsString() @MaxLength(30) phone?: string;
  @IsOptional() @IsString() @MaxLength(300) address?: string;
}
class IncomingItemDto {
  @IsOptional() @IsString() @MaxLength(60) sku?: string;
  @IsOptional() @IsString() @MaxLength(160) name?: string;
  @IsNumber() @IsPositive() quantity!: number;
  @IsOptional() @IsInt() @Min(0) unitPriceCents?: number;
  @IsOptional() @IsString() @MaxLength(300) notes?: string;
}
class IncomingOrderDto {
  @IsString() @MaxLength(60) externalRef!: string;
  @IsOptional() @ValidateNested() @Type(() => IncomingCustomerDto) customer?: IncomingCustomerDto;
  @IsArray() @ArrayNotEmpty() @ArrayMaxSize(100) @ValidateNested({ each: true }) @Type(() => IncomingItemDto)
  items!: IncomingItemDto[];
  @IsOptional() @IsString() @MaxLength(500) notes?: string;
}

/**
 * POST /api/integrations/{talabat|elmenus|rabbit}/orders with header
 * `X-Api-Key: <integration.<APP>.apiKey>`. Public (no staff login) but keyed.
 */
@Controller('integrations')
export class IntegrationsController {
  constructor(private readonly integrations: IntegrationsService) {}

  @Public()
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @Post(':channel/orders')
  async receive(
    @Param('channel') channelParam: string,
    @Headers('x-api-key') apiKey: string | undefined,
    @Body() body: IncomingOrderDto,
  ) {
    const channel = channelParam.toUpperCase() as AppChannel;
    if (!APP_CHANNELS.includes(channel)) throw new BadRequestException('Unknown delivery app');
    await this.integrations.checkKey(channel, apiKey);
    return this.integrations.receive(channel, body);
  }
}
