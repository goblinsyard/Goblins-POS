import { BadRequestException, Injectable } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { Prisma, Department } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import { SettingsService } from '../settings/settings.service';

const D = Prisma.Decimal;

@Injectable()
export class ExpensesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly settings: SettingsService,
  ) {}

  async categories() {
    return this.prisma.expenseCategory.findMany({
      include: { account: true },
      orderBy: { name: 'asc' }
    });
  }

  async createCategory(userId: string, params: { name: string; nameAr?: string; accountId?: string }) {
    const c = await this.prisma.expenseCategory.create({
      data: {
        name: params.name,
        nameAr: params.nameAr,
        accountId: params.accountId || null,
      },
    });
    await this.audit.log({
      userId, action: 'expense.category.create', entity: 'ExpenseCategory', entityId: c.id,
      detail: { name: c.name },
    });
    return c;
  }

  async updateCategory(userId: string, id: string, params: { name?: string; nameAr?: string; accountId?: string }) {
    const c = await this.prisma.expenseCategory.update({
      where: { id },
      data: {
        name: params.name,
        nameAr: params.nameAr,
        accountId: params.accountId !== undefined ? (params.accountId || null) : undefined,
      },
    });
    await this.audit.log({
      userId, action: 'expense.category.update', entity: 'ExpenseCategory', entityId: c.id,
      detail: { name: c.name },
    });
    return c;
  }

  async deleteCategory(userId: string, id: string) {
    const count = await this.prisma.expense.count({ where: { categoryId: id } });
    if (count > 0) {
      throw new BadRequestException('Cannot delete category because it is used by existing expenses. Delete or reassign those expenses first.');
    }
    const c = await this.prisma.expenseCategory.delete({
      where: { id },
    });
    await this.audit.log({
      userId, action: 'expense.category.delete', entity: 'ExpenseCategory', entityId: c.id,
      detail: { name: c.name },
    });
    return c;
  }

  async list(params: { from?: Date; to?: Date; categoryId?: string }) {
    return this.prisma.expense.findMany({
      where: {
        categoryId: params.categoryId,
        expenseDate: { gte: params.from, lte: params.to },
      },
      include: { category: { include: { account: true } }, enteredBy: { select: { name: true } }, account: true },
      orderBy: { expenseDate: 'desc' },
    });
  }

  async create(params: {
    branchId: string;
    userId: string;
    categoryId: string;
    description: string;
    amountCents: number;
    paymentMethod?: string;
    expenseDate?: string;
    department?: string;
    isRecurring?: boolean;
    recurrence?: string;
    attachmentUrl?: string;
    accountId?: string;
  }) {
    if (params.amountCents <= 0) throw new BadRequestException('Amount must be positive');
    
    const expense = await this.prisma.$transaction(async (tx) => {
      const exp = await tx.expense.create({
        data: {
          branchId: params.branchId,
          categoryId: params.categoryId,
          description: params.description,
          amountCents: params.amountCents,
          paymentMethod: params.paymentMethod ?? 'cash',
          expenseDate: params.expenseDate ? new Date(params.expenseDate) : new Date(),
          department: params.department ? (params.department as Department) : null,
          isRecurring: params.isRecurring ?? false,
          recurrence: params.recurrence,
          attachmentUrl: params.attachmentUrl,
          enteredById: params.userId,
          accountId: params.accountId || null,
        },
        include: { category: true },
      });

      // Auto-journalize if category has account linked
      if (exp.category.accountId) {
        let creditAccount;
        if (params.accountId) {
          creditAccount = await tx.account.findUnique({ where: { id: params.accountId } });
        } else {
          const creditCode = (params.paymentMethod ?? 'cash').toLowerCase() === 'cash' ? '1110' : '1210';
          creditAccount = await tx.account.findUnique({ where: { code: creditCode } });
        }

        if (creditAccount) {
          await tx.journalEntry.create({
            data: {
              description: `Expense: ${params.description}`,
              reference: `Expense #${exp.id}`,
              date: exp.expenseDate,
              lines: {
                create: [
                  {
                    accountId: exp.category.accountId,
                    debitCents: params.amountCents,
                    creditCents: 0,
                  },
                  {
                    accountId: creditAccount.id,
                    debitCents: 0,
                    creditCents: params.amountCents,
                  }
                ]
              }
            }
          });
        }
      }
      return exp;
    });

    await this.audit.log({
      userId: params.userId, action: 'expense.create', entity: 'Expense', entityId: expense.id,
      detail: { amountCents: params.amountCents, category: expense.category.name, department: params.department },
    });
    return expense;
  }

  /** Daily P&L: revenue by department − COGS (actual deductions) − expenses. */
  async dailyPnl(branchId: string, from: Date, to: Date) {
    const orders = await this.prisma.order.findMany({
      where: { branchId, status: 'PAID', closedAt: { gte: from, lte: to } },
      include: {
        items: {
          include: { item: true }
        }
      }
    });

    type DeptKey = 'Restaurant' | 'Bar' | 'Billiards' | 'PlayStation';
    const keys: DeptKey[] = ['Restaurant', 'Bar', 'Billiards', 'PlayStation'];

    const byDept: Record<DeptKey, number> = {
      Restaurant: 0,
      Bar: 0,
      Billiards: 0,
      PlayStation: 0
    };

    function mapDept(d: Department | string): DeptKey {
      if (d === 'BAR') return 'Bar';
      if (d === 'BILLIARDS') return 'Billiards';
      if (d === 'PLAYSTATION') return 'PlayStation';
      return 'Restaurant';
    }

    for (const o of orders) {
      for (const item of o.items) {
        if (item.status === 'VOIDED') continue;
        let d: Department = 'RESTAURANT';
        if (item.isTimeCharge) {
          d = o.type === 'BILLIARDS' ? 'BILLIARDS' : 'PLAYSTATION';
        } else if (item.item?.department) {
          d = item.item.department;
        }
        const key = mapDept(d);
        byDept[key] = (byDept[key] ?? 0) + item.lineCents;
      }
    }
    const revenue = Object.values(byDept).reduce((a, b) => a + b, 0);

    const deductions = await this.prisma.stockMovement.findMany({
      where: { kind: { in: ['SALE_DEDUCTION', 'WASTE'] }, createdAt: { gte: from, lte: to } },
      include: {
        orderItem: {
          include: { item: true }
        }
      }
    });

    const cogsByDept: Record<DeptKey, number> = { Restaurant: 0, Bar: 0, Billiards: 0, PlayStation: 0 };
    const wasteByDept: Record<DeptKey, number> = { Restaurant: 0, Bar: 0, Billiards: 0, PlayStation: 0 };
    let totalCogs = 0;
    let totalWaste = 0;

    for (const m of deductions) {
      const v = new D(m.quantity).mul(new D(m.unitCostCents)).toNumber();
      let d: Department = 'RESTAURANT';
      if (m.orderItem?.isTimeCharge) {
        d = m.orderItem.orderId ? 'BILLIARDS' : 'PLAYSTATION';
      } else if (m.orderItem?.item?.department) {
        d = m.orderItem.item.department;
      }
      const key = mapDept(d);

      if (m.kind === 'WASTE') {
        wasteByDept[key] = (wasteByDept[key] ?? 0) + v;
        totalWaste += v;
      } else {
        cogsByDept[key] = (cogsByDept[key] ?? 0) + v;
        totalCogs += v;
      }
    }

    const expenses = await this.prisma.expense.findMany({
      where: { branchId, expenseDate: { gte: from, lte: to } },
      include: { category: true },
    });

    const directExpByDept: Record<DeptKey, number> = { Restaurant: 0, Bar: 0, Billiards: 0, PlayStation: 0 };
    let overheadCents = 0;
    const expByCat: Record<string, number> = {};

    for (const e of expenses) {
      expByCat[e.category.name] = (expByCat[e.category.name] ?? 0) + e.amountCents;
      if (e.department) {
        const key = mapDept(e.department);
        directExpByDept[key] = (directExpByDept[key] ?? 0) + e.amountCents;
      } else {
        overheadCents += e.amountCents;
      }
    }
    const totalExpenses = Object.values(expByCat).reduce((a, b) => a + b, 0);

    const allocationMethod = await this.settings.get('expense.allocationMethod' as any).catch(() => 'revenue');
    const factors: Record<DeptKey, number> = { Restaurant: 0, Bar: 0, Billiards: 0, PlayStation: 0 };

    if (allocationMethod === 'revenue') {
      if (revenue > 0) {
        for (const key of keys) {
          factors[key] = byDept[key] / revenue;
        }
      } else {
        for (const key of keys) {
          factors[key] = 0.25;
        }
      }
    } else {
      const rRest = Number(await this.settings.get('expense.allocationManual.RESTAURANT' as any).catch(() => 4000));
      const rBar = Number(await this.settings.get('expense.allocationManual.BAR' as any).catch(() => 2000));
      const rBill = Number(await this.settings.get('expense.allocationManual.BILLIARDS' as any).catch(() => 2000));
      const rPs = Number(await this.settings.get('expense.allocationManual.PLAYSTATION' as any).catch(() => 2000));
      const sum = rRest + rBar + rBill + rPs || 10000;

      factors.Restaurant = rRest / sum;
      factors.Bar = rBar / sum;
      factors.Billiards = rBill / sum;
      factors.PlayStation = rPs / sum;
    }

    const allocatedOverheadByDept: Record<DeptKey, number> = { Restaurant: 0, Bar: 0, Billiards: 0, PlayStation: 0 };
    const netByDept: Record<DeptKey, number> = { Restaurant: 0, Bar: 0, Billiards: 0, PlayStation: 0 };
    const totalExpByDept: Record<DeptKey, number> = { Restaurant: 0, Bar: 0, Billiards: 0, PlayStation: 0 };

    for (const key of keys) {
      allocatedOverheadByDept[key] = Math.round(overheadCents * factors[key]);
      totalExpByDept[key] = directExpByDept[key] + allocatedOverheadByDept[key];
      netByDept[key] = byDept[key] - Math.round(cogsByDept[key]) - totalExpByDept[key];
    }

    return {
      from,
      to,
      allocationMethod,
      allocationRatios: factors,
      revenueByDepartment: byDept,
      revenueCents: revenue,
      serviceChargeCents: orders.reduce((a, o) => a + o.serviceChargeCents, 0),
      vatCollectedCents: orders.reduce((a, o) => a + o.taxCents, 0),
      cogsCents: Math.round(totalCogs),
      wasteCents: Math.round(totalWaste),
      grossProfitCents: revenue - Math.round(totalCogs),
      expensesByCategory: expByCat,
      expensesCents: totalExpenses,
      netCents: revenue - Math.round(totalCogs) - totalExpenses,

      departmentalBreakdown: keys.reduce((acc, key) => {
        acc[key] = {
          revenueCents: byDept[key],
          cogsCents: Math.round(cogsByDept[key]),
          wasteCents: Math.round(wasteByDept[key]),
          grossProfitCents: byDept[key] - Math.round(cogsByDept[key]),
          directExpensesCents: directExpByDept[key],
          allocatedOverheadCents: allocatedOverheadByDept[key],
          totalExpensesCents: totalExpByDept[key],
          netCents: netByDept[key],
          marginPctBps: byDept[key] > 0 ? Math.round((netByDept[key] / byDept[key]) * 10000) : 0
        };
        return acc;
      }, {} as Record<DeptKey, any>)
    };
  }

  /** VAT report scaffold (Egyptian tax): output VAT by day for a period. */
  async vatReport(branchId: string, from: Date, to: Date) {
    const orders = await this.prisma.order.findMany({
      where: { branchId, status: 'PAID', closedAt: { gte: from, lte: to } },
      select: { closedAt: true, subtotalCents: true, serviceChargeCents: true, taxCents: true },
    });
    const byDay = new Map<string, { netCents: number; vatCents: number; count: number }>();
    for (const o of orders) {
      const day = o.closedAt!.toISOString().slice(0, 10);
      const row = byDay.get(day) ?? { netCents: 0, vatCents: 0, count: 0 };
      row.netCents += o.subtotalCents + o.serviceChargeCents;
      row.vatCents += o.taxCents;
      row.count++;
      byDay.set(day, row);
    }
    return [...byDay.entries()]
      .map(([day, v]) => ({ day, ...v }))
      .sort((a, b) => a.day.localeCompare(b.day));
  }

  /** Materialize recurring expenses on the 1st of each month. */
  @Cron('0 6 1 * *')
  async materializeRecurring() {
    const templates = await this.prisma.expense.findMany({
      where: { isRecurring: true, recurrence: 'monthly' },
      distinct: ['categoryId', 'description'],
      orderBy: { expenseDate: 'desc' },
    });
    for (const t of templates) {
      const startOfMonth = new Date();
      startOfMonth.setDate(1);
      startOfMonth.setHours(0, 0, 0, 0);
      const exists = await this.prisma.expense.findFirst({
        where: { description: t.description, categoryId: t.categoryId, expenseDate: { gte: startOfMonth } },
      });
      if (!exists) {
        await this.prisma.expense.create({
          data: {
            branchId: t.branchId, categoryId: t.categoryId, description: t.description,
            amountCents: t.amountCents, paymentMethod: t.paymentMethod,
            expenseDate: new Date(), isRecurring: true, recurrence: 'monthly',
            enteredById: t.enteredById,
          },
        });
      }
    }
  }

  async update(id: string, userId: string, params: {
    categoryId?: string;
    description?: string;
    amountCents?: number;
    paymentMethod?: string;
    expenseDate?: string;
    department?: string;
    isRecurring?: boolean;
    recurrence?: string;
    attachmentUrl?: string;
    accountId?: string;
  }) {
    await this.prisma.expense.findUniqueOrThrow({
      where: { id },
      include: { category: true }
    });

    if (params.amountCents !== undefined && params.amountCents <= 0) {
      throw new BadRequestException('Amount must be positive');
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      const exp = await tx.expense.update({
        where: { id },
        data: {
          categoryId: params.categoryId,
          description: params.description,
          amountCents: params.amountCents,
          paymentMethod: params.paymentMethod !== undefined ? params.paymentMethod : undefined,
          expenseDate: params.expenseDate ? new Date(params.expenseDate) : undefined,
          department: params.department !== undefined ? (params.department as Department || null) : undefined,
          isRecurring: params.isRecurring,
          recurrence: params.recurrence !== undefined ? params.recurrence : undefined,
          attachmentUrl: params.attachmentUrl !== undefined ? params.attachmentUrl : undefined,
          accountId: params.accountId !== undefined ? (params.accountId || null) : undefined,
        },
        include: { category: true },
      });

      // Manage auto-journalization
      const ref = `Expense #${exp.id}`;
      const oldEntry = await tx.journalEntry.findFirst({
        where: { reference: ref }
      });
      if (oldEntry) {
        await tx.journalEntry.delete({ where: { id: oldEntry.id } });
      }

      if (exp.category.accountId) {
        let creditAccount;
        if (exp.accountId) {
          creditAccount = await tx.account.findUnique({ where: { id: exp.accountId } });
        } else {
          const creditCode = (exp.paymentMethod ?? 'cash').toLowerCase() === 'cash' ? '1110' : '1210';
          creditAccount = await tx.account.findUnique({ where: { code: creditCode } });
        }

        if (creditAccount) {
          await tx.journalEntry.create({
            data: {
              description: `Expense: ${exp.description}`,
              reference: ref,
              date: exp.expenseDate,
              lines: {
                create: [
                  {
                    accountId: exp.category.accountId,
                    debitCents: exp.amountCents,
                    creditCents: 0,
                  },
                  {
                    accountId: creditAccount.id,
                    debitCents: 0,
                    creditCents: exp.amountCents,
                  }
                ]
              }
            }
          });
        }
      }

      return exp;
    });

    await this.audit.log({
      userId, action: 'expense.update', entity: 'Expense', entityId: updated.id,
      detail: { amountCents: updated.amountCents, category: updated.category.name, department: updated.department },
    });
    return updated;
  }

  async delete(id: string, userId: string) {
    const existing = await this.prisma.expense.findUniqueOrThrow({
      where: { id },
      include: { category: true }
    });

    await this.prisma.$transaction(async (tx) => {
      const ref = `Expense #${id}`;
      const entry = await tx.journalEntry.findFirst({
        where: { reference: ref }
      });
      if (entry) {
        await tx.journalEntry.delete({ where: { id: entry.id } });
      }

      await tx.expense.delete({ where: { id } });
    });

    await this.audit.log({
      userId, action: 'expense.delete', entity: 'Expense', entityId: id,
      detail: { amountCents: existing.amountCents, description: existing.description },
    });
    return { success: true };
  }
}
