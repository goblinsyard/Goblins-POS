import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class HrService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async staffSummary(from?: string, to?: string) {
    const defaultFrom = from ? new Date(from) : new Date(Date.now() - 30 * 86400_000);
    const defaultTo = to ? new Date(to) : new Date();

    const staff = await this.prisma.user.findMany({
      where: { isActive: true },
      include: {
        role: true,
        timeClocks: {
          where: {
            clockIn: { gte: defaultFrom, lte: defaultTo },
          },
        },
        hrTransactions: {
          where: {
            date: { gte: defaultFrom, lte: defaultTo },
          },
        },
      },
      orderBy: { name: 'asc' },
    });

    return staff.map((user) => {
      // Calculate hours worked
      let hoursWorked = 0;
      for (const tc of user.timeClocks) {
        const outTime = tc.clockOut ?? new Date();
        hoursWorked += (outTime.getTime() - tc.clockIn.getTime()) / 3600_000;
      }
      hoursWorked = Math.round(hoursWorked * 100) / 100;

      // Calculate gross salary
      let grossCents: number;
      if (user.salaryType === 'HOURLY') {
        grossCents = Math.round(hoursWorked * user.hourlyRateCents);
      } else {
        grossCents = user.baseSalaryCents;
      }

      // Sum transactions by type
      let advancesCents = 0;
      let bonusesCents = 0;
      let deductionsCents = 0;
      let paymentsCents = 0;
      let tipsCents = 0;

      for (const tx of user.hrTransactions) {
        if (tx.type === 'ADVANCE') advancesCents += tx.amountCents;
        else if (tx.type === 'BONUS') bonusesCents += tx.amountCents;
        else if (tx.type === 'DEDUCTION') deductionsCents += tx.amountCents;
        else if (tx.type === 'SALARY_PAYMENT') paymentsCents += tx.amountCents;
        else if (tx.type === 'TIPS') tipsCents += tx.amountCents;
      }

      const netDueCents = grossCents + bonusesCents + tipsCents - deductionsCents - advancesCents - paymentsCents;

      return {
        id: user.id,
        name: user.name,
        role: user.role.name,
        salaryType: user.salaryType,
        baseSalaryCents: user.baseSalaryCents,
        hourlyRateCents: user.hourlyRateCents,
        hoursWorked,
        grossCents,
        advancesCents,
        bonusesCents,
        deductionsCents,
        paymentsCents,
        tipsCents,
        netDueCents,
      };
    });
  }

  async updateStaffSalary(
    userId: string,
    id: string,
    params: {
      salaryType?: 'MONTHLY' | 'HOURLY';
      baseSalaryCents?: number;
      hourlyRateCents?: number;
      tipsPoints?: number;
      deservesBonus?: boolean;
    },
  ) {
    const updated = await this.prisma.user.update({
      where: { id },
      data: {
        salaryType: params.salaryType,
        baseSalaryCents: params.baseSalaryCents,
        hourlyRateCents: params.hourlyRateCents,
        tipsPoints: params.tipsPoints,
        deservesBonus: params.deservesBonus,
      },
    });

    await this.audit.log({
      userId,
      action: 'hr.staff.update_salary',
      entity: 'User',
      entityId: id,
      detail: { ...params },
    });

    return updated;
  }

  async listTransactions(params: { from?: string; to?: string; userId?: string; type?: string }) {
    const filter: Prisma.HrTransactionWhereInput = {};
    if (params.userId) filter.userId = params.userId;
    if (params.type) filter.type = params.type as any;
    if (params.from || params.to) {
      filter.date = {
        gte: params.from ? new Date(params.from) : undefined,
        lte: params.to ? new Date(params.to) : undefined,
      };
    }

    return this.prisma.hrTransaction.findMany({
      where: filter,
      include: {
        user: { select: { name: true } },
        journalEntry: {
          include: {
            lines: {
              include: { account: { select: { code: true, name: true } } },
            },
          },
        },
      },
      orderBy: { date: 'desc' },
    });
  }

  async createTransaction(
    userId: string,
    params: {
      staffId: string;
      type: 'ADVANCE' | 'BONUS' | 'DEDUCTION' | 'SALARY_PAYMENT' | 'TIPS';
      amountCents: number;
      notes?: string;
      paymentMethod?: string;
      accountId?: string;
      date?: string;
    },
  ) {
    if (params.amountCents <= 0) {
      throw new BadRequestException('Amount must be positive');
    }

    const txDate = params.date ? new Date(params.date) : new Date();

    const tx = await this.prisma.$transaction(async (prismaTx) => {
      const staff = await prismaTx.user.findUniqueOrThrow({
        where: { id: params.staffId },
      });

      const hrTx = await prismaTx.hrTransaction.create({
        data: {
          userId: params.staffId,
          type: params.type,
          amountCents: params.amountCents,
          date: txDate,
          notes: params.notes || null,
          createdById: userId,
        },
      });

      // Journal Entry logic for cash transactions (ADVANCE or SALARY_PAYMENT)
      if (params.type === 'ADVANCE' || params.type === 'SALARY_PAYMENT') {
        const salariesAccount = await prismaTx.account.findUnique({
          where: { code: '5210' }, // Salaries & Wages
        });

        if (!salariesAccount) {
          throw new BadRequestException('Salaries & Wages account (5210) not found in Chart of Accounts.');
        }

        let creditAccount;
        if (params.accountId) {
          creditAccount = await prismaTx.account.findUnique({ where: { id: params.accountId } });
        } else {
          const creditCode = (params.paymentMethod ?? 'cash').toLowerCase() === 'cash' ? '1110' : '1210';
          creditAccount = await prismaTx.account.findUnique({ where: { code: creditCode } });
        }

        if (creditAccount) {
          const entry = await prismaTx.journalEntry.create({
            data: {
              description: `HR ${params.type === 'ADVANCE' ? 'Advance' : 'Salary Payout'}: ${staff.name} (${params.notes ?? ''})`,
              reference: `HRTransaction #${hrTx.id}`,
              date: txDate,
              lines: {
                create: [
                  {
                    accountId: salariesAccount.id, // Debit Salaries
                    debitCents: params.amountCents,
                    creditCents: 0,
                  },
                  {
                    accountId: creditAccount.id, // Credit Cash/Bank
                    debitCents: 0,
                    creditCents: params.amountCents,
                  },
                ],
              },
            },
          });

          return prismaTx.hrTransaction.update({
            where: { id: hrTx.id },
            data: { journalEntryId: entry.id },
          });
        }
      }

      return hrTx;
    });

    await this.audit.log({
      userId,
      action: `hr.transaction.${params.type.toLowerCase()}`,
      entity: 'HrTransaction',
      entityId: tx.id,
      detail: { staffId: params.staffId, amountCents: params.amountCents, notes: params.notes },
    });

    return tx;
  }

  async deleteTransaction(userId: string, id: string) {
    const tx = await this.prisma.hrTransaction.findUnique({
      where: { id },
    });
    if (!tx) throw new NotFoundException('Transaction not found');

    await this.prisma.$transaction(async (prismaTx) => {
      if (tx.journalEntryId) {
        await prismaTx.journalEntry.delete({
          where: { id: tx.journalEntryId },
        });
      }
      await prismaTx.hrTransaction.delete({
        where: { id },
      });
    });

    await this.audit.log({
      userId,
      action: 'hr.transaction.void',
      entity: 'HrTransaction',
      entityId: id,
      detail: { staffId: tx.userId, amountCents: tx.amountCents, type: tx.type },
    });

    return { success: true };
  }

  // Attendance management endpoints
  async listAttendance(params: { from?: string; to?: string; userId?: string }) {
    const filter: Prisma.TimeClockEntryWhereInput = {};
    if (params.userId) filter.userId = params.userId;
    if (params.from || params.to) {
      filter.clockIn = {
        gte: params.from ? new Date(params.from) : undefined,
        lte: params.to ? new Date(params.to) : undefined,
      };
    }

    return this.prisma.timeClockEntry.findMany({
      where: filter,
      include: {
        user: { select: { name: true } },
      },
      orderBy: { clockIn: 'desc' },
    });
  }

  async createAttendance(
    userId: string,
    params: {
      staffId: string;
      clockIn: string;
      clockOut?: string;
      note?: string;
    },
  ) {
    const entry = await this.prisma.timeClockEntry.create({
      data: {
        userId: params.staffId,
        clockIn: new Date(params.clockIn),
        clockOut: params.clockOut ? new Date(params.clockOut) : null,
        note: params.note || null,
      },
    });

    await this.audit.log({
      userId,
      action: 'hr.attendance.create',
      entity: 'TimeClockEntry',
      entityId: entry.id,
      detail: { staffId: params.staffId, clockIn: params.clockIn, clockOut: params.clockOut },
    });

    return entry;
  }

  async updateAttendance(
    userId: string,
    id: string,
    params: {
      clockIn?: string;
      clockOut?: string;
      note?: string;
    },
  ) {
    const entry = await this.prisma.timeClockEntry.update({
      where: { id },
      data: {
        clockIn: params.clockIn ? new Date(params.clockIn) : undefined,
        clockOut: params.clockOut ? new Date(params.clockOut) : params.clockOut === null ? null : undefined,
        note: params.note !== undefined ? params.note : undefined,
      },
    });

    await this.audit.log({
      userId,
      action: 'hr.attendance.update',
      entity: 'TimeClockEntry',
      entityId: id,
      detail: { ...params },
    });

    return entry;
  }

  async deleteAttendance(userId: string, id: string) {
    const entry = await this.prisma.timeClockEntry.delete({
      where: { id },
    });

    await this.audit.log({
      userId,
      action: 'hr.attendance.delete',
      entity: 'TimeClockEntry',
      entityId: id,
      detail: { staffId: entry.userId, clockIn: entry.clockIn },
    });

    return { success: true };
  }

  async getTipsPreview() {
    const tipsAccount = await this.prisma.account.findUnique({
      where: { code: '2500' },
      include: { journalLines: true },
    });
    if (!tipsAccount) {
      throw new BadRequestException('Tips Payable account (2500) not found');
    }

    const totalTipsCents = tipsAccount.journalLines.reduce(
      (sum, line) => sum + (line.creditCents - line.debitCents),
      0,
    );

    const eligibleStaff = await this.prisma.user.findMany({
      where: { isActive: true, tipsPoints: { gt: 0 } },
      select: { id: true, name: true, tipsPoints: true },
      orderBy: { name: 'asc' },
    });

    const totalPoints = eligibleStaff.reduce((sum, s) => sum + s.tipsPoints, 0);

    if (totalPoints === 0 || totalTipsCents <= 0) {
      return {
        totalTipsCents: Math.max(0, totalTipsCents),
        totalPoints: 0,
        eligibleStaff: eligibleStaff.map((s) => ({
          userId: s.id,
          name: s.name,
          tipsPoints: s.tipsPoints,
          shareCents: 0,
        })),
      };
    }

    let distributedSum = 0;
    const staffShares = eligibleStaff.map((s) => {
      const share = Math.floor(totalTipsCents * (s.tipsPoints / totalPoints));
      distributedSum += share;
      return {
        userId: s.id,
        name: s.name,
        tipsPoints: s.tipsPoints,
        shareCents: share,
      };
    });

    const remainder = totalTipsCents - distributedSum;
    if (remainder > 0 && staffShares.length > 0) {
      const highestIndex = staffShares.reduce(
        (maxIdx, s, idx, arr) => (s.tipsPoints > (arr[maxIdx]?.tipsPoints ?? 0) ? idx : maxIdx),
        0,
      );
      const target = staffShares[highestIndex];
      if (target) {
        target.shareCents += remainder;
      }
    }

    return {
      totalTipsCents,
      totalPoints,
      eligibleStaff: staffShares,
    };
  }

  async distributeTips(
    userId: string,
    params: {
      totalAmountCents: number;
      paymentMethod: string;
      accountId?: string;
      notes?: string;
    },
  ) {
    if (params.totalAmountCents <= 0) {
      throw new BadRequestException('Amount must be positive');
    }

    return this.prisma.$transaction(async (tx) => {
      const preview = await this.getTipsPreview();
      const totalPoints = preview.totalPoints;
      if (totalPoints === 0) {
        throw new BadRequestException('No active employees with tips points found.');
      }

      const eligibleStaff = await tx.user.findMany({
        where: { isActive: true, tipsPoints: { gt: 0 } },
        select: { id: true, name: true, tipsPoints: true },
        orderBy: { name: 'asc' },
      });

      let distributedSum = 0;
      const staffShares = eligibleStaff.map((s) => {
        const share = Math.floor(params.totalAmountCents * (s.tipsPoints / totalPoints));
        distributedSum += share;
        return {
          userId: s.id,
          name: s.name,
          shareCents: share,
        };
      });

      const remainder = params.totalAmountCents - distributedSum;
      if (remainder > 0 && staffShares.length > 0) {
        const highestIndex = eligibleStaff.reduce(
          (maxIdx, s, idx, arr) => (s.tipsPoints > (arr[maxIdx]?.tipsPoints ?? 0) ? idx : maxIdx),
          0,
        );
        const target = staffShares[highestIndex];
        if (target) {
          target.shareCents += remainder;
        }
      }

      const tipsAccount = await tx.account.findUnique({ where: { code: '2500' } });
      if (!tipsAccount) {
        throw new BadRequestException('Tips Payable account (2500) not found');
      }

      let paymentAccount;
      if (params.accountId) {
        paymentAccount = await tx.account.findUnique({ where: { id: params.accountId } });
      } else {
        const code = (params.paymentMethod ?? 'cash').toLowerCase() === 'cash' ? '1110' : '1210';
        paymentAccount = await tx.account.findUnique({ where: { code } });
      }

      if (!paymentAccount) {
        throw new BadRequestException('Payment account not found.');
      }

      const entry = await tx.journalEntry.create({
        data: {
          description: `Tips Distribution payout: ${params.notes ?? ''}`,
          reference: `TipsDist`,
          date: new Date(),
          lines: {
            create: [
              {
                accountId: tipsAccount.id,
                debitCents: params.totalAmountCents,
                creditCents: 0,
              },
              {
                accountId: paymentAccount.id,
                debitCents: 0,
                creditCents: params.totalAmountCents,
              },
            ],
          },
        },
      });

      for (const share of staffShares) {
        if (share.shareCents > 0) {
          await tx.hrTransaction.create({
            data: {
              userId: share.userId,
              type: 'TIPS',
              amountCents: share.shareCents,
              notes: `Tips payout: ${params.notes ?? ''}`,
              createdById: userId,
              journalEntryId: entry.id,
            },
          });

          await tx.hrTransaction.create({
            data: {
              userId: share.userId,
              type: 'SALARY_PAYMENT',
              amountCents: share.shareCents,
              notes: `Immediate Tips Cash Payout (Offset): ${params.notes ?? ''}`,
              createdById: userId,
              journalEntryId: entry.id,
            },
          });
        }
      }

      await this.audit.log({
        userId,
        action: 'hr.tips.distribute',
        entity: 'JournalEntry',
        entityId: entry.id,
        detail: { amountCents: params.totalAmountCents, notes: params.notes },
      }, tx);

      return { success: true, journalEntryId: entry.id };
    });
  }

  async getBonusPreview(params: { startDate: string; endDate: string; bonusPercentage: number }) {
    if (params.bonusPercentage <= 0) {
      throw new BadRequestException('Percentage must be positive');
    }

    const start = new Date(params.startDate);
    const end = new Date(params.endDate);

    const orders = await this.prisma.order.findMany({
      where: {
        status: 'PAID',
        closedAt: { gte: start, lte: end },
      },
      select: { subtotalCents: true, discountCents: true },
    });

    const totalNetSalesCents = orders.reduce((sum, o) => sum + (o.subtotalCents - o.discountCents), 0);
    const bonusPoolCents = Math.round(totalNetSalesCents * (params.bonusPercentage / 100));

    const eligibleStaff = await this.prisma.user.findMany({
      where: { isActive: true, deservesBonus: true },
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    });

    if (eligibleStaff.length === 0 || bonusPoolCents <= 0) {
      return {
        totalNetSalesCents,
        bonusPoolCents,
        eligibleStaff: eligibleStaff.map((s) => ({
          userId: s.id,
          name: s.name,
          shareCents: 0,
        })),
      };
    }

    const rawShare = Math.floor(bonusPoolCents / eligibleStaff.length);
    let distributedSum = 0;
    const staffShares = eligibleStaff.map((s) => {
      distributedSum += rawShare;
      return {
        userId: s.id,
        name: s.name,
        shareCents: rawShare,
      };
    });

    const remainder = bonusPoolCents - distributedSum;
    if (remainder > 0 && staffShares.length > 0) {
      const target = staffShares[0];
      if (target) {
        target.shareCents += remainder;
      }
    }

    return {
      totalNetSalesCents,
      bonusPoolCents,
      eligibleStaff: staffShares,
    };
  }

  async distributeBonus(
    userId: string,
    params: {
      startDate: string;
      endDate: string;
      bonusPercentage: number;
      paymentMethod: string;
      accountId?: string;
      notes?: string;
    },
  ) {
    return this.prisma.$transaction(async (tx) => {
      const preview = await this.getBonusPreview({
        startDate: params.startDate,
        endDate: params.endDate,
        bonusPercentage: params.bonusPercentage,
      });

      if (preview.bonusPoolCents <= 0 || preview.eligibleStaff.length === 0) {
        throw new BadRequestException('No bonus to distribute or no eligible employees.');
      }

      const wagesAccount = await tx.account.findUnique({ where: { code: '5210' } });
      if (!wagesAccount) {
        throw new BadRequestException('Salaries & Wages account (5210) not found');
      }

      let paymentAccount;
      if (params.accountId) {
        paymentAccount = await tx.account.findUnique({ where: { id: params.accountId } });
      } else {
        const code = (params.paymentMethod ?? 'cash').toLowerCase() === 'cash' ? '1110' : '1210';
        paymentAccount = await tx.account.findUnique({ where: { code } });
      }

      if (!paymentAccount) {
        throw new BadRequestException('Payment account not found.');
      }

      const entry = await tx.journalEntry.create({
        data: {
          description: `Sales Bonus payout: ${params.notes ?? ''}`,
          reference: `BonusDist`,
          date: new Date(),
          lines: {
            create: [
              {
                accountId: wagesAccount.id,
                debitCents: preview.bonusPoolCents,
                creditCents: 0,
              },
              {
                accountId: paymentAccount.id,
                debitCents: 0,
                creditCents: preview.bonusPoolCents,
              },
            ],
          },
        },
      });

      for (const share of preview.eligibleStaff) {
        if (share.shareCents > 0) {
          await tx.hrTransaction.create({
            data: {
              userId: share.userId,
              type: 'BONUS',
              amountCents: share.shareCents,
              notes: `Sales Bonus: ${params.notes ?? ''}`,
              createdById: userId,
              journalEntryId: entry.id,
            },
          });

          await tx.hrTransaction.create({
            data: {
              userId: share.userId,
              type: 'SALARY_PAYMENT',
              amountCents: share.shareCents,
              notes: `Immediate Bonus Cash Payout (Offset): ${params.notes ?? ''}`,
              createdById: userId,
              journalEntryId: entry.id,
            },
          });
        }
      }

      await this.audit.log({
        userId,
        action: 'hr.bonus.distribute',
        entity: 'JournalEntry',
        entityId: entry.id,
        detail: { amountCents: preview.bonusPoolCents, notes: params.notes },
      }, tx);

      return { success: true, journalEntryId: entry.id };
    });
  }
}
