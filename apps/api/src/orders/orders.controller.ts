import { BadRequestException, Body, Controller, Get, Param, Patch, Post, Query, Req } from '@nestjs/common';
import { Type } from 'class-transformer';
import {
  ArrayNotEmpty, IsArray, IsBoolean, IsEnum, IsIn, IsInt, IsNumber, IsOptional,
  IsPositive, IsString, Min, ValidateNested,
} from 'class-validator';
import { OrderType } from '@prisma/client';
import { AuthedRequest, RequirePermissions } from '../auth/auth.guard';
import { OrdersService } from './orders.service';
import { PaymentsService } from './payments.service';
import { ReceiptsService } from '../receipts/receipts.service';

class CreateOrderDto {
  @IsEnum(OrderType) type!: OrderType;
  @IsOptional() @IsString() resourceId?: string;
  @IsOptional() @IsString() customerId?: string;
  @IsOptional() @IsInt() @IsPositive() guestCount?: number;
}

class AddItemDto {
  @IsString() itemId!: string;
  @IsNumber() @IsPositive() quantity!: number;
  @IsOptional() @IsArray() modifierIds?: string[];
  @IsOptional() @IsString() notes?: string;
  @IsOptional() @IsInt() @Min(1) course?: number;
  @IsOptional() @IsInt() @Min(1) seat?: number;
}

class AddItemsDto {
  @IsArray() @ArrayNotEmpty() @ValidateNested({ each: true }) @Type(() => AddItemDto)
  items!: AddItemDto[];
}

class VoidItemDto {
  @IsString() orderItemId!: string;
  @IsString() reason!: string;
  @IsOptional() @IsString() approverPin?: string;
}

class VoidOrderDto {
  @IsString() reason!: string;
}

class DiscountDto {
  @IsIn(['PERCENT', 'FIXED']) kind!: 'PERCENT' | 'FIXED';
  @IsInt() @IsPositive() value!: number;
  @IsString() reasonCode!: string;
  @IsOptional() @IsString() orderItemId?: string;
  @IsOptional() @IsString() approverPin?: string;
}

class SplitDto {
  @IsArray() @ArrayNotEmpty() orderItemIds!: string[];
}

class MergeDto {
  @IsString() targetOrderId!: string;
}

class TransferDto {
  @IsString() toResourceId!: string;
}

class SetCustomerDto {
  @IsOptional() @IsString() customerId?: string | null;
}

class PaymentLineDto {
  @IsString() methodId!: string;
  @IsInt() @IsPositive() amountCents!: number;
  @IsOptional() @IsInt() tenderedCents?: number;
  @IsOptional() @IsInt() @Min(0) tipCents?: number;
  @IsOptional() @IsString() reference?: string;
}

class PayDto {
  @IsArray() @ArrayNotEmpty() @ValidateNested({ each: true }) @Type(() => PaymentLineDto)
  payments!: PaymentLineDto[];
}

class RefundDto {
  @IsString() paymentId!: string;
  @IsString() reason!: string;
  @IsOptional() @IsString() approverPin?: string;
}

class MoveItemDto {
  @IsOptional() @IsInt() @Min(0) seat?: number | null;
  @IsOptional() @IsString() targetOrderId?: string;
}

class SplitTimeDto {
  @IsArray() @ArrayNotEmpty() seats!: number[];
}

class SetSeatCustomerDto {
  @IsOptional() @IsString() customerId?: string | null;
}

class AddComboDto {
  @IsString() comboId!: string;
  @IsOptional() @IsInt() @Min(1) course?: number;
  @IsOptional() @IsInt() @Min(1) seat?: number;
}

class UpdateTaxServiceDto {
  @IsOptional() @IsBoolean() noService?: boolean;
  @IsOptional() @IsBoolean() noVat?: boolean;
  @IsOptional() @IsString() approverPin?: string;
}

class UpdateItemNoteDto {
  @IsString() notes!: string;
}

class UpdateItemQuantityDto {
  @IsNumber() @IsPositive() quantity!: number;
}

@Controller('payment-methods')
export class PaymentMethodsController {
  constructor(private readonly orders: OrdersService) {}

  @Get()
  @RequirePermissions('pos.use')
  list() {
    return this.orders.listPaymentMethods();
  }
}

@Controller('orders')
export class OrdersController {
  constructor(
    private readonly orders: OrdersService,
    private readonly payments: PaymentsService,
    private readonly receipts: ReceiptsService,
  ) {}

  @Post()
  @RequirePermissions('order.create')
  create(@Req() req: AuthedRequest, @Body() dto: CreateOrderDto) {
    return this.orders.create({
      userId: req.user.sub,
      branchId: req.user.branchId,
      ...dto,
    });
  }

  @Get('open')
  @RequirePermissions('pos.use')
  listOpen(@Req() req: AuthedRequest) {
    return this.orders.listOpen(req.user.branchId);
  }

  @Get('history')
  @RequirePermissions('pos.use')
  listHistory(
    @Req() req: AuthedRequest,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
    @Query('search') search?: string,
  ) {
    return this.orders.listClosedOrders(req.user.branchId, { startDate, endDate, search });
  }

  @Get(':id')
  @RequirePermissions('pos.use')
  get(@Param('id') id: string) {
    return this.orders.get(id);
  }

  @Post(':id/items')
  @RequirePermissions('order.create')
  addItems(@Req() req: AuthedRequest, @Param('id') id: string, @Body() dto: AddItemsDto) {
    return this.orders.addItems(id, req.user.sub, dto.items);
  }

  @Post(':id/void-item')
  @RequirePermissions('order.void')
  voidItem(@Req() req: AuthedRequest, @Param('id') id: string, @Body() dto: VoidItemDto) {
    return this.orders.voidItem({ orderId: id, userId: req.user.sub, ...dto });
  }

  @Post(':id/void')
  @RequirePermissions('order.void')
  voidOrder(@Req() req: AuthedRequest, @Param('id') id: string, @Body() dto: VoidOrderDto) {
    return this.orders.voidOrder({ orderId: id, userId: req.user.sub, reason: dto.reason });
  }

  @Post(':id/discount')
  @RequirePermissions('discount.apply')
  discount(@Req() req: AuthedRequest, @Param('id') id: string, @Body() dto: DiscountDto) {
    return this.orders.applyDiscount({ orderId: id, userId: req.user.sub, ...dto });
  }

  @Post(':id/split')
  @RequirePermissions('order.split')
  split(@Req() req: AuthedRequest, @Param('id') id: string, @Body() dto: SplitDto) {
    return this.orders.splitByItems({ orderId: id, userId: req.user.sub, orderItemIds: dto.orderItemIds });
  }

  @Post(':id/merge')
  @RequirePermissions('order.split')
  merge(@Req() req: AuthedRequest, @Param('id') id: string, @Body() dto: MergeDto) {
    return this.orders.mergeOrders({
      sourceOrderId: id, targetOrderId: dto.targetOrderId, userId: req.user.sub,
    });
  }

  @Post(':id/transfer')
  @RequirePermissions('order.transfer')
  transfer(@Req() req: AuthedRequest, @Param('id') id: string, @Body() dto: TransferDto) {
    return this.orders.transferOrder({ orderId: id, toResourceId: dto.toResourceId, userId: req.user.sub });
  }

  @Post(':id/abandon')
  @RequirePermissions('pos.use')
  abandon(@Req() req: AuthedRequest, @Param('id') id: string) {
    return this.orders.abandonIfEmpty(id, req.user.sub);
  }

  @Post(':id/customer')
  @RequirePermissions('pos.use')
  setCustomer(@Req() req: AuthedRequest, @Param('id') id: string, @Body() dto: SetCustomerDto) {
    return this.orders.setCustomer({ orderId: id, customerId: dto.customerId ?? null, userId: req.user.sub });
  }

  @Post(':id/pay')
  @RequirePermissions('payment.take')
  pay(@Req() req: AuthedRequest, @Param('id') id: string, @Body() dto: PayDto) {
    return this.payments.pay({ orderId: id, userId: req.user.sub, payments: dto.payments });
  }

  @Post('refund')
  @RequirePermissions('payment.refund')
  refund(@Req() req: AuthedRequest, @Body() dto: RefundDto) {
    return this.payments.refund({ userId: req.user.sub, ...dto });
  }

  @Get(':id/receipt')
  @RequirePermissions('pos.use')
  async receipt(@Param('id') id: string, @Query('reprint') reprint?: string) {
    const text = await this.receipts.render(id, { reprint: reprint === 'true' });
    return { text };
  }

  @Post(':id/items/:orderItemId/move')
  @RequirePermissions('order.create')
  moveItem(
    @Req() req: AuthedRequest,
    @Param('id') id: string,
    @Param('orderItemId') orderItemId: string,
    @Body() dto: MoveItemDto,
  ) {
    return this.orders.moveOrderItem(id, orderItemId, req.user.sub, dto);
  }

  @Post(':id/items/:orderItemId/split-time')
  @RequirePermissions('order.create')
  splitTime(
    @Req() req: AuthedRequest,
    @Param('id') id: string,
    @Param('orderItemId') orderItemId: string,
    @Body() dto: SplitTimeDto,
  ) {
    return this.orders.splitTimeCharge(id, orderItemId, req.user.sub, dto.seats);
  }

  @Post(':id/seats/:seat/customer')
  @RequirePermissions('pos.use')
  setSeatCustomer(
    @Req() req: AuthedRequest,
    @Param('id') id: string,
    @Param('seat') seatStr: string,
    @Body() dto: SetSeatCustomerDto,
  ) {
    const seat = parseInt(seatStr, 10);
    if (isNaN(seat) || seat <= 0) throw new BadRequestException('Invalid seat number');
    return this.orders.setSeatCustomer({ orderId: id, seat, customerId: dto.customerId ?? null, userId: req.user.sub });
  }

  @Post(':id/combos')
  @RequirePermissions('order.create')
  addCombo(
    @Req() req: AuthedRequest,
    @Param('id') id: string,
    @Body() dto: AddComboDto,
  ) {
    return this.orders.addCombo(id, req.user.sub, dto);
  }

  @Post(':id/tax-service')
  @RequirePermissions('pos.use')
  updateTaxService(
    @Req() req: AuthedRequest,
    @Param('id') id: string,
    @Body() dto: UpdateTaxServiceDto,
  ) {
    return this.orders.updateTaxService({
      orderId: id,
      userId: req.user.sub,
      ...dto,
    });
  }

  @Post(':id/items/:orderItemId/note')
  @RequirePermissions('order.create')
  updateItemNote(
    @Req() req: AuthedRequest,
    @Param('id') id: string,
    @Param('orderItemId') orderItemId: string,
    @Body() dto: UpdateItemNoteDto,
  ) {
    return this.orders.updateItemNote(id, orderItemId, req.user.sub, dto.notes);
  }

  @Post(':id/items/:orderItemId/quantity')
  @RequirePermissions('order.create')
  updateItemQuantity(
    @Req() req: AuthedRequest,
    @Param('id') id: string,
    @Param('orderItemId') orderItemId: string,
    @Body() dto: UpdateItemQuantityDto,
  ) {
    return this.orders.updateItemQuantity(id, orderItemId, req.user.sub, dto.quantity);
  }

  @Patch(':id/payments/:paymentId')
  @RequirePermissions('payment.take')
  updatePaymentMethod(
    @Req() req: AuthedRequest,
    @Param('id') id: string,
    @Param('paymentId') paymentId: string,
    @Body() dto: { methodId: string },
  ) {
    return this.payments.updatePaymentMethod(req.user.sub, id, paymentId, dto.methodId);
  }
}
