import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class ShiftsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async open(params: { branchId: string; userId: string; terminalId?: string; floatCents: number }) {
    const existing = await this.prisma.shift.findFirst({
      where: { branchId: params.branchId, status: 'OPEN' },
    });
    if (existing) throw new BadRequestException('A shift is already open');
    const shift = await this.prisma.shift.create({
      data: {
        branchId: params.branchId,
        openedById: params.userId,
        terminalId: params.terminalId,
        floatCents: params.floatCents,
      },
    });
    await this.audit.log({
      userId: params.userId, terminalId: params.terminalId,
      action: 'shift.open', entity: 'Shift', entityId: shift.id,
      detail: { floatCents: params.floatCents },
    });
    return shift;
  }

  async current(branchId: string) {
    return this.prisma.shift.findFirst({
      where: { branchId, status: 'OPEN' },
      orderBy: { openedAt: 'desc' },
    });
  }

  /** Build the report payload shared by X (mid-shift) and Z (close). */
  async buildReport(shiftId: string) {
    const shift = await this.prisma.shift.findUnique({
      where: { id: shiftId },
      include: {
        payments: { include: { method: true, order: { select: { type: true } } } },
        cashMovements: true,
        orders: { include: { items: true, discounts: true } },
      },
    });
    if (!shift) throw new NotFoundException();

    const paidOrders = shift.orders.filter((o) => o.status === 'PAID');
    const voided = shift.orders.filter((o) => o.status === 'VOIDED');

    const byMethod: Record<string, { count: number; amountCents: number }> = {};
    for (const p of shift.payments) {
      const key = p.method.name;
      byMethod[key] ??= { count: 0, amountCents: 0 };
      byMethod[key].count++;
      byMethod[key].amountCents += p.amountCents;
    }
    const byDepartment: Record<string, number> = {};
    for (const o of paidOrders) {
      const dept =
        o.type === 'BILLIARDS' ? 'Billiards' : o.type === 'PS_ROOM' ? 'PlayStation' : 'Restaurant';
      byDepartment[dept] = (byDepartment[dept] ?? 0) + o.totalCents;
    }

    const cashSales = shift.payments
      .filter((p) => p.method.kind === 'CASH')
      .reduce((a, p) => a + p.amountCents, 0);
    const cashMoves = shift.cashMovements.reduce((a, m) => a + m.amountCents, 0);
    const expectedCash = shift.floatCents + cashSales + cashMoves;

    const discounts = shift.orders.flatMap((o) => o.discounts);

    return {
      shiftId: shift.id,
      openedAt: shift.openedAt,
      floatCents: shift.floatCents,
      orderCount: paidOrders.length,
      voidedCount: voided.length,
      grossCents: paidOrders.reduce((a, o) => a + o.totalCents, 0),
      subtotalCents: paidOrders.reduce((a, o) => a + o.subtotalCents, 0),
      taxCents: paidOrders.reduce((a, o) => a + o.taxCents, 0),
      serviceChargeCents: paidOrders.reduce((a, o) => a + o.serviceChargeCents, 0),
      discountCents: paidOrders.reduce((a, o) => a + o.discountCents, 0),
      discountCount: discounts.length,
      tipsCents: shift.payments.reduce((a, p) => a + p.tipCents, 0),
      byMethod,
      byDepartment,
      cash: {
        floatCents: shift.floatCents,
        salesCents: cashSales,
        movementsCents: cashMoves,
        expectedCents: expectedCash,
      },
    };
  }

  /** X report — mid-shift snapshot, does not close anything. */
  async xReport(shiftId: string, userId: string) {
    const report = await this.buildReport(shiftId);
    await this.audit.log({
      userId, action: 'shift.x_report', entity: 'Shift', entityId: shiftId,
    });
    return { ...report, kind: 'X' as const, generatedAt: new Date() };
  }

  /** Close shift with blind count → Z report frozen onto the shift row. */
  async close(params: { shiftId: string; userId: string; countedCents: number; terminalId?: string }) {
    const shift = await this.prisma.shift.findUniqueOrThrow({ where: { id: params.shiftId } });
    if (shift.status !== 'OPEN') throw new BadRequestException('Shift already closed');
    const openOrders = await this.prisma.order.count({
      where: { shiftId: params.shiftId, status: 'OPEN' },
    });
    if (openOrders > 0) {
      throw new BadRequestException(`${openOrders} open order(s) must be paid or voided first`);
    }
    const report = await this.buildReport(params.shiftId);
    const variance = params.countedCents - report.cash.expectedCents;
    const z = {
      ...report,
      kind: 'Z' as const,
      countedCents: params.countedCents,
      varianceCents: variance,
      closedAt: new Date(),
    };
    const closed = await this.prisma.$transaction(async (tx) => {
      const closedShift = await tx.shift.update({
        where: { id: params.shiftId },
        data: {
          status: 'CLOSED',
          closedAt: new Date(),
          countedCents: params.countedCents,
          expectedCents: report.cash.expectedCents,
          varianceCents: variance,
          zReport: z as unknown as Prisma.InputJsonValue,
        },
      });

      if (variance !== 0) {
        const cashAccount = await tx.account.findUnique({ where: { code: '1110' } });
        if (!cashAccount) {
          throw new BadRequestException('Cash account (1110) not found in accounting system');
        }

        if (variance < 0) {
          const miscExpenseAccount = await tx.account.findUnique({ where: { code: '5290' } });
          if (!miscExpenseAccount) {
            throw new BadRequestException('Miscellaneous Expense account (5290) not found');
          }
          await tx.journalEntry.create({
            data: {
              description: `Shift Close Cash Shortage: Shift #${params.shiftId}`,
              reference: `Shift #${params.shiftId}`,
              date: new Date(),
              lines: {
                create: [
                  {
                    accountId: miscExpenseAccount.id,
                    debitCents: Math.abs(variance),
                    creditCents: 0,
                  },
                  {
                    accountId: cashAccount.id,
                    debitCents: 0,
                    creditCents: Math.abs(variance),
                  },
                ],
              },
            },
          });
        } else {
          const otherIncomeAccount = await tx.account.findUnique({ where: { code: '4500' } });
          if (!otherIncomeAccount) {
            throw new BadRequestException('Other Income account (4500) not found');
          }
          await tx.journalEntry.create({
            data: {
              description: `Shift Close Cash Overage: Shift #${params.shiftId}`,
              reference: `Shift #${params.shiftId}`,
              date: new Date(),
              lines: {
                create: [
                  {
                    accountId: cashAccount.id,
                    debitCents: Math.abs(variance),
                    creditCents: 0,
                  },
                  {
                    accountId: otherIncomeAccount.id,
                    debitCents: 0,
                    creditCents: Math.abs(variance),
                  },
                ],
              },
            },
          });
        }
      }

      return closedShift;
    });
    await this.audit.log({
      userId: params.userId, terminalId: params.terminalId,
      action: 'shift.close', entity: 'Shift', entityId: params.shiftId,
      detail: { countedCents: params.countedCents, varianceCents: variance },
    });
    return { shift: closed, zReport: z };
  }

  /** Cash drawer movements: paid in/out, petty cash, no-sale drawer open. */
  async cashMovement(params: {
    shiftId: string;
    userId: string;
    kind: 'PAID_IN' | 'PAID_OUT' | 'PETTY_CASH' | 'DRAWER_OPEN' | 'CASH_TRANSFER';
    amountCents: number;
    reason: string;
    terminalId?: string;
  }) {
    const isOut = ['PAID_OUT', 'PETTY_CASH', 'CASH_TRANSFER'].includes(params.kind);
    const resolvedAmount = isOut ? -Math.abs(params.amountCents) : Math.abs(params.amountCents);

    const move = await this.prisma.$transaction(async (tx) => {
      const move = await tx.cashMovement.create({
        data: {
          shiftId: params.shiftId,
          userId: params.userId,
          kind: params.kind,
          amountCents: params.kind === 'DRAWER_OPEN' ? 0 : resolvedAmount,
          reason: params.reason,
        },
      });

      if (params.kind === 'CASH_TRANSFER' && resolvedAmount !== 0) {
        const cashAccount = await tx.account.findUnique({ where: { code: '1110' } });
        const bankAccount = await tx.account.findUnique({ where: { code: '1210' } });
        if (cashAccount && bankAccount) {
          await tx.journalEntry.create({
            data: {
              description: `POS Cash Transfer: ${params.reason}`,
              reference: `Shift #${params.shiftId}`,
              date: new Date(),
              lines: {
                create: [
                  {
                    accountId: bankAccount.id, // Debit Bank
                    debitCents: Math.abs(resolvedAmount),
                    creditCents: 0,
                  },
                  {
                    accountId: cashAccount.id, // Credit Cash Drawer
                    debitCents: 0,
                    creditCents: Math.abs(resolvedAmount),
                  },
                ],
              },
            },
          });
        }
      }

      return move;
    });

    await this.audit.log({
      userId: params.userId, terminalId: params.terminalId,
      action: params.kind === 'DRAWER_OPEN' ? 'drawer.open_no_sale' : 'shift.cash_movement',
      entity: 'CashMovement', entityId: move.id,
      detail: { kind: params.kind, amountCents: move.amountCents, reason: params.reason },
    });
    return move;
  }

  async list(branchId: string) {
    return this.prisma.shift.findMany({
      where: { branchId },
      include: {
        openedBy: { select: { name: true } },
        terminal: { select: { name: true } },
        payments: { select: { tipCents: true } },
      },
      orderBy: { openedAt: 'desc' },
    });
  }

  async getDetails(shiftId: string, _userId: string) {
    const shift = await this.prisma.shift.findUnique({
      where: { id: shiftId },
      include: {
        openedBy: { select: { id: true, name: true } },
        terminal: { select: { id: true, name: true } },
        cashMovements: {
          include: {
            user: { select: { name: true } }
          },
          orderBy: { createdAt: 'asc' }
        }
      },
    });
    if (!shift) throw new NotFoundException('Shift not found');

    let report: any;
    if (shift.status === 'CLOSED' && shift.zReport) {
      report = shift.zReport;
    } else {
      report = await this.buildReport(shiftId);
    }

    return {
      shift,
      report,
    };
  }
}
