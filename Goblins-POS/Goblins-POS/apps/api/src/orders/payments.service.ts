import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { changeDue } from '@goblins/shared';
import { AuditService } from '../audit/audit.service';
import { AuthService } from '../auth/auth.service';
import { StockService } from '../inventory/stock.service';
import { PrismaService } from '../prisma/prisma.service';
import { RealtimeGateway } from '../realtime/realtime.gateway';
import { ReceiptsService } from '../receipts/receipts.service';
import { SettingsService } from '../settings/settings.service';

export interface PaymentInput {
  methodId: string;
  amountCents: number;
  tenderedCents?: number; // cash only
  tipCents?: number;
  reference?: string;
}

@Injectable()
export class PaymentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly auth: AuthService,
    private readonly realtime: RealtimeGateway,
    private readonly receipts: ReceiptsService,
    private readonly settings: SettingsService,
    private readonly stock: StockService,
  ) {}

  /**
   * Take one or more payments (split across methods). When the order is fully
   * paid it closes: resource freed, loyalty points earned, stock deduction
   * hook fires (Phase 5 wires the deduction service in).
   */
  async pay(params: { orderId: string; userId: string; payments: PaymentInput[]; terminalId?: string }) {
    const result = await this.prisma.$transaction(async (tx) => {
      const order = await tx.order.findUniqueOrThrow({
        where: { id: params.orderId },
        include: { payments: true, session: true },
      });
      if (order.status !== 'OPEN') throw new BadRequestException('Order is not open');
      if (order.session && order.session.status !== 'STOPPED' && order.session.status !== 'CANCELLED') {
        throw new BadRequestException('Stop the running session before payment');
      }
      const shift = await tx.shift.findFirst({
        where: { branchId: order.branchId, status: 'OPEN' },
        orderBy: { openedAt: 'desc' },
      });
      if (!shift) throw new BadRequestException('No open shift');

      const alreadyPaid = order.payments.reduce((a, p) => a + p.amountCents, 0);
      const due = order.totalCents - alreadyPaid;

      if (due > 0 && !params.payments.length) {
        throw new BadRequestException('No payments given');
      }

      const incoming = params.payments.reduce((a, p) => a + p.amountCents, 0);
      if (incoming > due) {
        throw new BadRequestException(`Overpayment: due ${due}, given ${incoming}`);
      }

      let changeCents = 0;
      let drawerOpens = false;
      for (const p of params.payments) {
        const method = await tx.paymentMethod.findUniqueOrThrow({ where: { id: p.methodId } });
        if (method.kind === 'CASH' && p.tenderedCents != null) {
          changeCents = changeDue(p.amountCents, p.tenderedCents);
        }
        if (method.opensDrawer) drawerOpens = true;

        if (method.kind === 'WALLET') {
          if (!order.customerId) {
            throw new BadRequestException('Wallet payment requires a customer to be attached to the order');
          }
          const customer = await tx.customer.findUniqueOrThrow({ where: { id: order.customerId } });
          if (customer.walletBalanceCents < p.amountCents) {
            throw new BadRequestException('Credit is not enough');
          }
          await tx.customer.update({
            where: { id: order.customerId },
            data: { walletBalanceCents: { decrement: p.amountCents } },
          });
        }

        await tx.payment.create({
          data: {
            orderId: order.id,
            methodId: p.methodId,
            amountCents: p.amountCents,
            tenderedCents: p.tenderedCents,
            changeCents: method.kind === 'CASH' && p.tenderedCents != null ? p.tenderedCents - p.amountCents : 0,
            tipCents: p.tipCents ?? 0,
            reference: p.reference,
            shiftId: shift.id,
          },
        });
      }

      const totalPaid = alreadyPaid + incoming;
      const fullyPaid = totalPaid >= order.totalCents;
      let closed;
      if (fullyPaid) {
        closed = await tx.order.update({
          where: { id: order.id },
          data: { status: 'PAID', paidCents: totalPaid, closedAt: new Date() },
          include: { payments: { include: { method: true } }, session: true },
        });

        // Auto-journalize POS payment
        const debitLines: { accountId: string; debitCents: number; creditCents: number }[] = [];
        const cashAccount = await tx.account.findUnique({ where: { code: '1110' } });
        const bankAccount = await tx.account.findUnique({ where: { code: '1210' } });
        const serviceChargeAccount = await tx.account.findUnique({ where: { code: '4600' } });
        const tipsAccount = await tx.account.findUnique({ where: { code: '2500' } });

        if (cashAccount && bankAccount) {
          for (const p of closed.payments) {
            const accId = p.method.accountId || (p.method.kind === 'CASH' ? cashAccount.id : bankAccount.id);
            debitLines.push({
              accountId: accId,
              debitCents: p.amountCents + p.tipCents,
              creditCents: 0,
            });
          }
        }

        const creditLines: { accountId: string; debitCents: number; creditCents: number }[] = [];
        let revCode = '4100'; // default F&B Sales
        if (order.type === 'BILLIARDS') revCode = '4300';
        else if (order.type === 'PS_ROOM') revCode = '4200';

        const revAccount = await tx.account.findUnique({ where: { code: revCode } });
        const vatAccount = await tx.account.findUnique({ where: { code: '2200' } });

        if (revAccount) {
          const netSales = order.subtotalCents - order.discountCents;
          creditLines.push({
            accountId: revAccount.id,
            debitCents: 0,
            creditCents: netSales,
          });
        }

        if (order.serviceChargeCents > 0 && serviceChargeAccount) {
          creditLines.push({
            accountId: serviceChargeAccount.id,
            debitCents: 0,
            creditCents: order.serviceChargeCents,
          });
        }

        if (order.taxCents > 0 && vatAccount) {
          creditLines.push({
            accountId: vatAccount.id,
            debitCents: 0,
            creditCents: order.taxCents,
          });
        }

        const totalTipsCents = closed.payments.reduce((sum, p) => sum + p.tipCents, 0);
        if (totalTipsCents > 0 && tipsAccount) {
          creditLines.push({
            accountId: tipsAccount.id,
            debitCents: 0,
            creditCents: totalTipsCents,
          });
        }

        const totalDebit = debitLines.reduce((sum, l) => sum + l.debitCents, 0);
        const totalCredit = creditLines.reduce((sum, l) => sum + l.creditCents, 0);

        if (totalDebit > 0 && totalDebit === totalCredit) {
          await tx.journalEntry.create({
            data: {
              description: `Sales Payment for Order #${order.number}`,
              reference: `Order #${order.id}`,
              date: closed.closedAt || new Date(),
              lines: {
                create: [...debitLines, ...creditLines],
              },
            },
          });
        }
        // free the resource if no other open orders sit on it
        if (order.resourceId) {
          const others = await tx.order.count({
            where: { resourceId: order.resourceId, status: 'OPEN', id: { not: order.id } },
          });
          if (others === 0) {
            await tx.resource.update({
              where: { id: order.resourceId },
              data: { status: 'NEEDS_CLEANING' },
            });
          }
        }
        // loyalty earn distributed proportionally based on seat customer assignments
        const activeLines = await tx.orderItem.findMany({
          where: { orderId: order.id, status: { not: 'VOIDED' } },
        });
        const totalLineSum = activeLines.reduce((a, l) => a + l.lineCents, 0);
        if (totalLineSum > 0) {
          const seatCusts = await tx.orderSeatCustomer.findMany({ where: { orderId: order.id } });
          const seatCustomerMap = new Map<number, string>();
          for (const sc of seatCusts) {
            seatCustomerMap.set(sc.seat, sc.customerId);
          }
          const spendByCustomer = new Map<string, number>();
          for (const line of activeLines) {
            const seat = line.seat;
            const custId = (seat && seatCustomerMap.get(seat)) || order.customerId;
            if (custId) {
              spendByCustomer.set(custId, (spendByCustomer.get(custId) || 0) + line.lineCents);
            }
          }
          for (const [custId, customerLineSum] of spendByCustomer.entries()) {
            const customerShareCents = Math.round((customerLineSum / totalLineSum) * order.totalCents);
            if (customerShareCents > 0) {
              await this.earnPoints(tx, custId, order.id, customerShareCents);
            }
          }
        } else if (order.customerId) {
          await this.earnPoints(tx, order.customerId, order.id, order.totalCents);
        }
        // recipe-driven stock deduction for every sold (non-voided) menu item
        const soldItems = await tx.orderItem.findMany({
          where: { orderId: order.id, status: { not: 'VOIDED' }, itemId: { not: null } },
        });
        for (const line of soldItems) {
          await this.stock.deductForSale(tx, line.id, line.itemId!, line.quantity);
        }
      } else {
        closed = await tx.order.update({
          where: { id: order.id },
          data: { paidCents: totalPaid },
          include: { payments: true, session: true },
        });
      }
      return { order: closed, changeCents, drawerOpens, fullyPaid };
    });

    this.realtime.emitTo('pos', 'order.updated', { orderId: params.orderId });
    if (result.fullyPaid) {
      this.realtime.emitTo('floor', 'floor.refresh', {});
      // fire-and-forget receipt print job (preview mode without hardware)
      void this.receipts
        .render(params.orderId)
        .then(async (text) => {
          const receiptPrinter = await this.prisma.printer.findFirst({
            where: { isActive: true, name: { contains: 'Receipt' } },
          });
          this.realtime.emitTo('print', 'receipt.print', {
            orderId: params.orderId,
            text,
            openDrawer: result.drawerOpens,
            printerAddress:
              receiptPrinter?.connection === 'NETWORK' ? receiptPrinter.address : undefined,
          });
        })
        .catch(() => {});
    }
    return result;
  }

  /** Refund a payment — manager gated, audited. */
  async refund(params: {
    paymentId: string;
    userId: string;
    reason: string;
    approverPin?: string;
    terminalId?: string;
  }) {
    let approverId: string | null = null;
    if (params.approverPin) {
      approverId = await this.auth.approveWithPin(params.approverPin, 'payment.refund');
    }
    return this.prisma.$transaction(async (tx) => {
      const payment = await tx.payment.findUniqueOrThrow({
        where: { id: params.paymentId },
        include: { order: true, method: true },
      });
      const existing = await tx.payment.findFirst({ where: { refundOfId: payment.id } });
      if (existing) throw new BadRequestException('Already refunded');
      const refund = await tx.payment.create({
        data: {
          orderId: payment.orderId,
          methodId: payment.methodId,
          amountCents: -payment.amountCents,
          shiftId: payment.shiftId,
          refundOfId: payment.id,
        },
      });
      await tx.order.update({
        where: { id: payment.orderId },
        data: { paidCents: { decrement: payment.amountCents } },
      });
      if (payment.method.kind === 'WALLET' && payment.order.customerId) {
        await tx.customer.update({
          where: { id: payment.order.customerId },
          data: { walletBalanceCents: { increment: payment.amountCents } },
        });
      }
      await this.audit.log(
        {
          userId: params.userId, approverId, terminalId: params.terminalId,
          action: 'payment.refund', entity: 'Payment', entityId: payment.id,
          detail: { amountCents: payment.amountCents, reason: params.reason, orderId: payment.orderId },
        },
        tx,
      );
      return refund;
    });
  }

  private async earnPoints(
    tx: Prisma.TransactionClient,
    customerId: string,
    orderId: string,
    totalCents: number,
  ) {
    const customer = await tx.customer.findUniqueOrThrow({
      where: { id: customerId },
      include: { tier: true },
    });
    const earnRateBps = customer.tier?.earnRateBps ?? 100;
    // points = spend(EGP) * rate/10000 → at 100 bps: 1 point per 100 EGP
    const points = Math.floor((totalCents / 100) * (earnRateBps / 10_000) * 100) / 100;
    const wholePoints = Math.floor(points);
    if (wholePoints > 0) {
      await tx.pointsTransaction.create({
        data: { customerId, orderId, points: wholePoints, kind: 'EARN' },
      });
    }
    const updated = await tx.customer.update({
      where: { id: customerId },
      data: {
        pointsBalance: { increment: wholePoints },
        lifetimeCents: { increment: totalCents },
        visitCount: { increment: 1 },
      },
    });
    // tier upgrade check
    const nextTier = await tx.loyaltyTier.findFirst({
      where: { minLifetimeCents: { lte: updated.lifetimeCents } },
      orderBy: { minLifetimeCents: 'desc' },
    });
    if (nextTier && nextTier.id !== updated.tierId) {
      await tx.customer.update({ where: { id: customerId }, data: { tierId: nextTier.id } });
    }
  }

  async updatePaymentMethod(
    userId: string,
    orderId: string,
    paymentId: string,
    methodId: string,
  ) {
    return this.prisma.$transaction(async (tx) => {
      const payment = await tx.payment.findUniqueOrThrow({
        where: { id: paymentId },
        include: { method: true },
      });

      if (payment.orderId !== orderId) {
        throw new BadRequestException('Payment does not belong to this order');
      }

      const newMethod = await tx.paymentMethod.findUniqueOrThrow({
        where: { id: methodId },
      });

      const updatedPayment = await tx.payment.update({
        where: { id: paymentId },
        data: { methodId },
      });

      const journalEntry = await tx.journalEntry.findFirst({
        where: { reference: `Order #${orderId}` },
        include: { lines: true },
      });

      if (journalEntry) {
        const cashAccount = await tx.account.findUnique({ where: { code: '1110' } });
        const bankAccount = await tx.account.findUnique({ where: { code: '1210' } });

        if (cashAccount && bankAccount) {
          const oldAccId = payment.method.kind === 'CASH' ? cashAccount.id : bankAccount.id;
          const newAccId = newMethod.kind === 'CASH' ? cashAccount.id : bankAccount.id;

          if (oldAccId !== newAccId) {
            const line = journalEntry.lines.find(
              (l) => l.accountId === oldAccId && l.debitCents === (payment.amountCents + payment.tipCents),
            );

            if (line) {
              await tx.journalLine.update({
                where: { id: line.id },
                data: { accountId: newAccId },
              });
            }
          }
        }
      }

      await this.audit.log(
        {
          userId,
          action: 'payment.update_method',
          entity: 'Payment',
          entityId: paymentId,
          detail: {
            orderId,
            oldMethod: payment.method.name,
            newMethod: newMethod.name,
            amountCents: payment.amountCents,
          },
        },
        tx,
      );

      return updatedPayment;
    });
  }
}
