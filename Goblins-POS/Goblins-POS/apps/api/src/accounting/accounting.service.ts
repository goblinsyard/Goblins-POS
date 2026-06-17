import { BadRequestException, Injectable, OnModuleInit } from '@nestjs/common';
import { AccountType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';

@Injectable()
export class AccountingService implements OnModuleInit {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async onModuleInit() {
    const coa = [
      // Assets
      { code: '1000', name: 'Assets', nameAr: 'الأصول', type: 'ASSET' as AccountType },
      { code: '1100', name: 'Cash on Hand', nameAr: 'النقدية بالصندوق', type: 'ASSET' as AccountType, parentCode: '1000' },
      { code: '1110', name: 'Cash Drawer / Safe', nameAr: 'درج الكاشير / الخزينة', type: 'ASSET' as AccountType, parentCode: '1100' },
      { code: '1120', name: 'Main Safe', nameAr: 'الخزينة الرئيسية', type: 'ASSET' as AccountType, parentCode: '1100' },
      { code: '1125', name: 'Tips Drawer', nameAr: 'درج البقشيش', type: 'ASSET' as AccountType, parentCode: '1100' },
      { code: '1130', name: 'Custody', nameAr: 'العهدة', type: 'ASSET' as AccountType, parentCode: '1100' },
      { code: '1200', name: 'Bank Accounts', nameAr: 'الحسابات البنكية', type: 'ASSET' as AccountType, parentCode: '1000' },
      { code: '1210', name: 'Main Bank Account', nameAr: 'الحساب البنكي الرئيسي', type: 'ASSET' as AccountType, parentCode: '1200' },
      { code: '1220', name: 'Fawry Account', nameAr: 'حساب فوري', type: 'ASSET' as AccountType, parentCode: '1200' },
      { code: '1300', name: 'Accounts Receivable', nameAr: 'العملاء / المدينون', type: 'ASSET' as AccountType, parentCode: '1000' },
      { code: '1400', name: 'Food & Beverage Inventory', nameAr: 'مخزون الأغذية والمشروبات', type: 'ASSET' as AccountType, parentCode: '1000' },
      { code: '1500', name: 'Prepaid Expenses', nameAr: 'المصروفات المقدمة', type: 'ASSET' as AccountType, parentCode: '1000' },
      { code: '1600', name: 'Equipment & Furniture', nameAr: 'المعدات والأثاث', type: 'ASSET' as AccountType, parentCode: '1000' },
   
      // Liabilities
      { code: '2000', name: 'Liabilities', nameAr: 'الخصوم', type: 'LIABILITY' as AccountType },
      { code: '2100', name: 'Accounts Payable', nameAr: 'الموردون / الدائنون', type: 'LIABILITY' as AccountType, parentCode: '2000' },
      { code: '2200', name: 'Sales Tax (VAT) Payable', nameAr: 'ضريبة القيمة المضافة المستحقة', type: 'LIABILITY' as AccountType, parentCode: '2000' },
      { code: '2300', name: 'Accrued Salaries', nameAr: 'الرواتب المستحقة', type: 'LIABILITY' as AccountType, parentCode: '2000' },
      { code: '2400', name: 'Customer Deposits', nameAr: 'تأمين عملاء', type: 'LIABILITY' as AccountType, parentCode: '2000' },
      { code: '2500', name: 'Tips Payable', nameAr: 'بقشيش مستحق للعامليين', type: 'LIABILITY' as AccountType, parentCode: '2000' },
   
      // Equity
      { code: '3000', name: 'Equity', nameAr: 'حقوق الملكية', type: 'EQUITY' as AccountType },
      { code: '3100', name: "Owner's Capital", nameAr: 'رأس المال', type: 'EQUITY' as AccountType, parentCode: '3000' },
      { code: '3200', name: 'Retained Earnings', nameAr: 'الأرباح المحتجزة', type: 'EQUITY' as AccountType, parentCode: '3000' },
   
      // Revenue
      { code: '4000', name: 'Revenue', nameAr: 'الإيرادات', type: 'REVENUE' as AccountType },
      { code: '4100', name: 'Food & Beverage Sales', nameAr: 'مبيعات الأغذية والمشروبات', type: 'REVENUE' as AccountType, parentCode: '4000' },
      { code: '4200', name: 'PlayStation Services Revenue', nameAr: 'إيرادات بلايستيشن', type: 'REVENUE' as AccountType, parentCode: '4000' },
      { code: '4300', name: 'Billiards Services Revenue', nameAr: 'إيرادات البلياردو', type: 'REVENUE' as AccountType, parentCode: '4000' },
      { code: '4400', name: 'Event Bookings & Room Rental', nameAr: 'حجز الفعاليات وإيجار الغرف', type: 'REVENUE' as AccountType, parentCode: '4000' },
      { code: '4500', name: 'Other Income', nameAr: 'إيرادات أخرى', type: 'REVENUE' as AccountType, parentCode: '4000' },
      { code: '4600', name: 'Service Charge Revenue', nameAr: 'إيرادات الخدمة', type: 'REVENUE' as AccountType, parentCode: '4000' },
   
      // Expenses
      { code: '5000', name: 'Expenses', nameAr: 'المصروفات', type: 'EXPENSE' as AccountType },
      { code: '5100', name: 'Cost of Goods Sold (COGS)', nameAr: 'تكلفة المبيعات', type: 'EXPENSE' as AccountType, parentCode: '5000' },
      { code: '5110', name: 'Food & Beverage Cost', nameAr: 'تكلفة الأغذية والمشروبات', type: 'EXPENSE' as AccountType, parentCode: '5100' },
      { code: '5120', name: 'PlayStation & Billiards Maintenance Cost', nameAr: 'تكلفة صيانة البلايستيشن والبلياردو', type: 'EXPENSE' as AccountType, parentCode: '5100' },
      { code: '5200', name: 'Operating Expenses', nameAr: 'المصاريف التشغيلية', type: 'EXPENSE' as AccountType, parentCode: '5000' },
      { code: '5210', name: 'Salaries & Wages', nameAr: 'الرواتب والأجور', type: 'EXPENSE' as AccountType, parentCode: '5200' },
      { code: '5220', name: 'Rent', nameAr: 'الإيجار', type: 'EXPENSE' as AccountType, parentCode: '5200' },
      { code: '5230', name: 'Utilities', nameAr: 'المنافع العامة', type: 'EXPENSE' as AccountType, parentCode: '5200' },
      { code: '5240', name: 'Marketing & Advertising', nameAr: 'التسويق والإعلان', type: 'EXPENSE' as AccountType, parentCode: '5200' },
      { code: '5250', name: 'Repairs & Maintenance', nameAr: 'الإصلاحات والصيانة', type: 'EXPENSE' as AccountType, parentCode: '5200' },
      { code: '5260', name: 'Supplies', nameAr: 'المستلزمات', type: 'EXPENSE' as AccountType, parentCode: '5200' },
      { code: '5270', name: 'Printing & Stationery', nameAr: 'الطباعة والأدوات المكتبية', type: 'EXPENSE' as AccountType, parentCode: '5200' },
      { code: '5280', name: 'Bank Fees & Commission', nameAr: 'عمولات ومصاريف بنكية', type: 'EXPENSE' as AccountType, parentCode: '5200' },
      { code: '5290', name: 'Miscellaneous Expense', nameAr: 'مصاريف متنوعة', type: 'EXPENSE' as AccountType, parentCode: '5200' },
    ];

    const createdAccounts: Record<string, string> = {};
    for (const a of coa) {
      let acc = await this.prisma.account.findUnique({ where: { code: a.code } });
      if (!acc) {
        const parentId = a.parentCode ? createdAccounts[a.parentCode] : null;
        acc = await this.prisma.account.create({
          data: {
            code: a.code,
            name: a.name,
            nameAr: a.nameAr,
            type: a.type,
            parentAccountId: parentId,
            isPaymentSource: ['1110', '1210', '1220'].includes(a.code),
          },
        });
      } else {
        const parentId = a.parentCode ? createdAccounts[a.parentCode] : null;
        acc = await this.prisma.account.update({
          where: { id: acc.id },
          data: {
            isActive: true,
            isPaymentSource: ['1110', '1210', '1220'].includes(a.code),
            parentAccountId: acc.parentAccountId || parentId,
          },
        });
      }
      createdAccounts[a.code] = acc.id;
    }

    // Auto-link PaymentMethods to the correct accounts
    const cashAccId = createdAccounts['1110'];
    const bankAccId = createdAccounts['1210'];
    const walletAccId = createdAccounts['1220'];

    if (cashAccId) {
      await this.prisma.paymentMethod.updateMany({
        where: { kind: 'CASH', accountId: null },
        data: { accountId: cashAccId },
      });
    }
    if (bankAccId) {
      await this.prisma.paymentMethod.updateMany({
        where: { kind: 'CARD', accountId: null },
        data: { accountId: bankAccId },
      });
    }
    if (walletAccId) {
      await this.prisma.paymentMethod.updateMany({
        where: { kind: 'WALLET', accountId: null },
        data: { accountId: walletAccId },
      });
    }

    // Auto-link ExpenseCategories to the correct accounts
    const expCats = [
      { name: 'Rent', code: '5220' },
      { name: 'Utilities', code: '5230' },
      { name: 'Salaries', code: '5210' },
      { name: 'Marketing', code: '5240' },
      { name: 'Maintenance', code: '5250' },
      { name: 'COGS adjustment', code: '5110' },
    ];
    for (const cat of expCats) {
      const accId = createdAccounts[cat.code];
      if (accId) {
        await this.prisma.expenseCategory.updateMany({
          where: { name: cat.name, accountId: null },
          data: { accountId: accId },
        });
      }
    }
  }


  async accounts() {
    const list = await this.prisma.account.findMany({
      where: { isActive: true },
      orderBy: { code: 'asc' },
    });

    const balances = await this.prisma.journalLine.groupBy({
      by: ['accountId'],
      _sum: {
        debitCents: true,
        creditCents: true,
      },
    });

    const balMap = new Map(
      balances.map((b) => [
        b.accountId,
        (b._sum.debitCents ?? 0) - (b._sum.creditCents ?? 0),
      ]),
    );

    const items = list.map((a) => {
      const balance = balMap.get(a.id) ?? 0;
      return {
        ...a,
        balanceCents: balance,
        subAccounts: [] as any[],
      };
    });

    const map = new Map(items.map((item) => [item.id, item]));
    const roots: typeof items = [];
    for (const item of items) {
      if (item.parentAccountId) {
        const parent = map.get(item.parentAccountId);
        if (parent) {
          parent.subAccounts.push(item);
        } else {
          roots.push(item);
        }
      } else {
        roots.push(item);
      }
    }

    function sumBalances(node: any): number {
      let childSum = 0;
      for (const child of node.subAccounts) {
        childSum += sumBalances(child);
      }
      node.balanceCents += childSum;
      return node.balanceCents;
    }

    for (const root of roots) {
      sumBalances(root);
    }

    return roots;
  }

  async syncOpeningBalanceEntry(tx: any, accountId: string, initialBalanceCents: number) {
    const account = await tx.account.findUniqueOrThrow({ where: { id: accountId } });
    const ref = `Opening Balance: ${account.code}`;

    // 1. Find existing opening balance entry if any
    const existingEntry = await tx.journalEntry.findFirst({
      where: { reference: ref },
    });

    if (initialBalanceCents === 0) {
      if (existingEntry) {
        await tx.journalEntry.delete({ where: { id: existingEntry.id } });
      }
      return;
    }

    // 2. We need Owner's Capital Account (code '3100') as the offset account
    const offsetAccount = await tx.account.findUnique({ where: { code: '3100' } });
    if (!offsetAccount) {
      throw new BadRequestException("Owner's Capital account (3100) must exist to record opening balances.");
    }

    const isNormalDebit = ['ASSET', 'EXPENSE'].includes(account.type);
    
    const accountDebit = isNormalDebit ? initialBalanceCents : 0;
    const accountCredit = isNormalDebit ? 0 : initialBalanceCents;

    const offsetDebit = isNormalDebit ? 0 : initialBalanceCents;
    const offsetCredit = isNormalDebit ? initialBalanceCents : 0;

    const linesData = [
      {
        accountId: account.id,
        debitCents: accountDebit,
        creditCents: accountCredit,
      },
      {
        accountId: offsetAccount.id,
        debitCents: offsetDebit,
        creditCents: offsetCredit,
      },
    ];

    if (existingEntry) {
      await tx.journalLine.deleteMany({ where: { entryId: existingEntry.id } });
      await tx.journalEntry.update({
        where: { id: existingEntry.id },
        data: {
          description: `Opening Balance for ${account.name}`,
          lines: {
            create: linesData,
          },
        },
      });
    } else {
      await tx.journalEntry.create({
        data: {
          description: `Opening Balance for ${account.name}`,
          reference: ref,
          date: new Date(),
          lines: {
            create: linesData,
          },
        },
      });
    }
  }

  async createAccount(
    userId: string,
    params: { code: string; name: string; nameAr?: string; type: AccountType; parentAccountId?: string; initialBalanceCents?: number; isPaymentSource?: boolean },
  ) {
    const existing = await this.prisma.account.findUnique({ where: { code: params.code } });
    if (existing) {
      throw new BadRequestException(`Account code ${params.code} already exists.`);
    }

    let type = params.type;
    if (params.parentAccountId) {
      const parent = await this.prisma.account.findUniqueOrThrow({ where: { id: params.parentAccountId } });
      type = parent.type; // Inherit parent type
    }

    const acc = await this.prisma.$transaction(async (tx) => {
      const created = await tx.account.create({
        data: {
          code: params.code,
          name: params.name,
          nameAr: params.nameAr || null,
          type,
          parentAccountId: params.parentAccountId || null,
          initialBalanceCents: params.initialBalanceCents ?? 0,
          isPaymentSource: type === 'ASSET' ? (params.isPaymentSource ?? false) : false,
        },
      });

      if (params.initialBalanceCents && params.initialBalanceCents > 0) {
        await this.syncOpeningBalanceEntry(tx, created.id, params.initialBalanceCents);
      }

      return created;
    });

    await this.audit.log({
      userId,
      action: 'accounting.account.create',
      entity: 'Account',
      entityId: acc.id,
      detail: { code: acc.code, name: acc.name },
    });

    return acc;
  }

  async updateAccount(
    userId: string,
    id: string,
    params: {
      name?: string;
      nameAr?: string;
      code?: string;
      isActive?: boolean;
      initialBalanceCents?: number;
      isPaymentSource?: boolean;
      parentAccountId?: string | null;
    },
  ) {
    if (params.code) {
      const existing = await this.prisma.account.findFirst({
        where: { code: params.code, id: { not: id } },
      });
      if (existing) {
        throw new BadRequestException(`Account code ${params.code} already exists.`);
      }
    }

    const account = await this.prisma.account.findUnique({
      where: { id },
    });
    if (!account) {
      throw new BadRequestException(`Account not found.`);
    }

    let parentAccountId: string | null | undefined = undefined;
    let type: AccountType | undefined = undefined;

    if (params.parentAccountId !== undefined) {
      if (params.parentAccountId === null || params.parentAccountId === '') {
        parentAccountId = null;
      } else {
        const parent = await this.prisma.account.findUnique({
          where: { id: params.parentAccountId },
        });
        if (!parent) {
          throw new BadRequestException('Parent account not found.');
        }

        if (parent.id === id) {
          throw new BadRequestException('Circular dependency: An account cannot be its own parent.');
        }

        let currentParent = parent;
        while (currentParent.parentAccountId) {
          if (currentParent.parentAccountId === id) {
            throw new BadRequestException('Circular dependency: An account cannot have one of its descendants as a parent.');
          }
          const nextParent = await this.prisma.account.findUnique({
            where: { id: currentParent.parentAccountId },
          });
          if (!nextParent) break;
          currentParent = nextParent;
        }

        parentAccountId = parent.id;
        type = parent.type;
      }
    }

    const recursiveUpdateType = async (tx: any, parentId: string, newType: AccountType) => {
      const children = await tx.account.findMany({ where: { parentAccountId: parentId } });
      for (const child of children) {
        await tx.account.update({
          where: { id: child.id },
          data: { type: newType },
        });
        await recursiveUpdateType(tx, child.id, newType);
      }
    };

    const acc = await this.prisma.$transaction(async (tx) => {
      const finalType = type !== undefined ? type : account.type;
      let isPaymentSource = params.isPaymentSource;
      if (finalType !== 'ASSET') {
        isPaymentSource = false;
      }

      const updated = await tx.account.update({
        where: { id },
        data: {
          name: params.name,
          nameAr: params.nameAr !== undefined ? (params.nameAr || null) : undefined,
          code: params.code,
          isActive: params.isActive,
          initialBalanceCents: params.initialBalanceCents,
          isPaymentSource,
          parentAccountId: parentAccountId !== undefined ? parentAccountId : undefined,
          type: type !== undefined ? type : undefined,
        },
      });

      if (type !== undefined && type !== account.type) {
        await recursiveUpdateType(tx, updated.id, type);
      }

      if (params.initialBalanceCents !== undefined) {
        await this.syncOpeningBalanceEntry(tx, updated.id, params.initialBalanceCents);
      }

      return updated;
    });

    await this.audit.log({
      userId,
      action: 'accounting.account.update',
      entity: 'Account',
      entityId: acc.id,
      detail: { code: acc.code, name: acc.name },
    });

    return acc;
  }

  async ledger(accountId: string) {
    const account = await this.prisma.account.findUniqueOrThrow({ where: { id: accountId } });
    const lines = await this.prisma.journalLine.findMany({
      where: { accountId },
      include: { entry: true },
      orderBy: { entry: { date: 'asc' } },
    });

    let running = 0;
    const formatted = lines.map((l) => {
      const change = l.debitCents - l.creditCents;
      running += change;
      return {
        id: l.id,
        date: l.entry.date,
        description: l.entry.description,
        reference: l.entry.reference,
        debitCents: l.debitCents,
        creditCents: l.creditCents,
        runningBalanceCents: running,
      };
    });

    return {
      account,
      lines: formatted,
    };
  }

  async journalEntries() {
    return this.prisma.journalEntry.findMany({
      include: {
        lines: {
          include: {
            account: { select: { code: true, name: true } },
          },
        },
      },
      orderBy: { date: 'desc' },
      take: 100,
    });
  }

  async createJournalEntry(
    userId: string,
    params: {
      description: string;
      date?: string;
      reference?: string;
      lines: { accountId: string; debitCents: number; creditCents: number }[];
    },
  ) {
    const totalDebit = params.lines.reduce((sum, l) => sum + l.debitCents, 0);
    const totalCredit = params.lines.reduce((sum, l) => sum + l.creditCents, 0);

    if (totalDebit !== totalCredit) {
      throw new BadRequestException('Journal entry does not balance. Total debits must equal total credits.');
    }
    if (totalDebit <= 0) {
      throw new BadRequestException('Journal entry must have a non-zero balanced amount.');
    }

    const entry = await this.prisma.journalEntry.create({
      data: {
        description: params.description,
        reference: params.reference || null,
        date: params.date ? new Date(params.date) : new Date(),
        lines: {
          create: params.lines.map((l) => ({
            accountId: l.accountId,
            debitCents: l.debitCents,
            creditCents: l.creditCents,
          })),
        },
      },
      include: { lines: true },
    });

    await this.audit.log({
      userId,
      action: 'accounting.journal_entry.create',
      entity: 'JournalEntry',
      entityId: entry.id,
      detail: { description: entry.description, amountCents: totalDebit },
    });

    return entry;
  }

  async updateJournalEntry(
    userId: string,
    id: string,
    params: {
      description?: string;
      date?: string;
      reference?: string;
      lines?: { accountId: string; debitCents: number; creditCents: number }[];
    },
  ) {
    return this.prisma.$transaction(async (tx) => {
      const entry = await tx.journalEntry.findUniqueOrThrow({
        where: { id },
        include: { lines: true },
      });

      const finalDescription = params.description ?? entry.description;
      const finalDate = params.date ? new Date(params.date) : entry.date;
      const finalReference = params.reference !== undefined ? (params.reference || null) : entry.reference;

      if (params.lines) {
        const totalDebit = params.lines.reduce((sum, l) => sum + l.debitCents, 0);
        const totalCredit = params.lines.reduce((sum, l) => sum + l.creditCents, 0);

        if (totalDebit !== totalCredit) {
          throw new BadRequestException('Journal entry does not balance. Total debits must equal total credits.');
        }
        if (totalDebit <= 0) {
          throw new BadRequestException('Journal entry must have a non-zero balanced amount.');
        }

        await tx.journalLine.deleteMany({ where: { entryId: id } });

        const updated = await tx.journalEntry.update({
          where: { id },
          data: {
            description: finalDescription,
            date: finalDate,
            reference: finalReference,
            lines: {
              create: params.lines.map((l) => ({
                accountId: l.accountId,
                debitCents: l.debitCents,
                creditCents: l.creditCents,
              })),
            },
          },
          include: { lines: true },
        });

        await this.audit.log({
          userId,
          action: 'accounting.journal_entry.update',
          entity: 'JournalEntry',
          entityId: id,
          detail: { description: finalDescription, amountCents: totalDebit },
        }, tx);

        return updated;
      } else {
        const updated = await tx.journalEntry.update({
          where: { id },
          data: {
            description: finalDescription,
            date: finalDate,
            reference: finalReference,
          },
          include: { lines: true },
        });

        const totalDebit = updated.lines.reduce((sum, l) => sum + l.debitCents, 0);

        await this.audit.log({
          userId,
          action: 'accounting.journal_entry.update',
          entity: 'JournalEntry',
          entityId: id,
          detail: { description: finalDescription, amountCents: totalDebit },
        }, tx);

        return updated;
      }
    });
  }

  async deleteJournalEntry(userId: string, id: string) {
    return this.prisma.$transaction(async (tx) => {
      const entry = await tx.journalEntry.findUniqueOrThrow({
        where: { id },
        include: { lines: true },
      });

      const totalDebit = entry.lines.reduce((sum, l) => sum + l.debitCents, 0);

      await tx.journalEntry.delete({ where: { id } });

      await this.audit.log({
        userId,
        action: 'accounting.journal_entry.delete',
        entity: 'JournalEntry',
        entityId: id,
        detail: { description: entry.description, amountCents: totalDebit },
      }, tx);

      return { success: true };
    });
  }

  // Reports
  async trialBalance() {
    const accounts = await this.prisma.account.findMany({
      where: { isActive: true },
      orderBy: { code: 'asc' },
    });

    const aggregates = await this.prisma.journalLine.groupBy({
      by: ['accountId'],
      _sum: {
        debitCents: true,
        creditCents: true,
      },
    });

    const aggMap = new Map(
      aggregates.map((a) => [
        a.accountId,
        { debit: a._sum.debitCents ?? 0, credit: a._sum.creditCents ?? 0 },
      ]),
    );

    return accounts.map((acc) => {
      const agg = aggMap.get(acc.id) ?? { debit: 0, credit: 0 };
      return {
        id: acc.id,
        code: acc.code,
        name: acc.name,
        nameAr: acc.nameAr,
        type: acc.type,
        debitCents: agg.debit,
        creditCents: agg.credit,
      };
    });
  }

  async balanceSheet() {
    const list = await this.prisma.account.findMany({
      where: { isActive: true, type: { in: ['ASSET', 'LIABILITY', 'EQUITY'] } },
      orderBy: { code: 'asc' },
    });

    const balances = await this.prisma.journalLine.groupBy({
      by: ['accountId'],
      _sum: {
        debitCents: true,
        creditCents: true,
      },
    });

    const balMap = new Map(
      balances.map((b) => [
        b.accountId,
        (b._sum.debitCents ?? 0) - (b._sum.creditCents ?? 0),
      ]),
    );

    const items = list.map((a) => {
      const balance = balMap.get(a.id) ?? 0;
      return {
        id: a.id,
        code: a.code,
        name: a.name,
        nameAr: a.nameAr,
        type: a.type,
        parentAccountId: a.parentAccountId,
        balanceCents: balance,
        subAccounts: [] as any[],
      };
    });

    const map = new Map(items.map((item) => [item.id, item]));
    const roots: typeof items = [];
    for (const item of items) {
      if (item.parentAccountId) {
        const parent = map.get(item.parentAccountId);
        if (parent) {
          parent.subAccounts.push(item);
        } else {
          roots.push(item);
        }
      } else {
        roots.push(item);
      }
    }

    function sumBalances(node: any): number {
      let childSum = 0;
      for (const child of node.subAccounts) {
        childSum += sumBalances(child);
      }
      node.balanceCents += childSum;
      return node.balanceCents;
    }

    for (const root of roots) {
      sumBalances(root);
    }

    const assets = roots.filter((r) => r.type === 'ASSET');
    const liabilities = roots.filter((r) => r.type === 'LIABILITY');
    const equity = roots.filter((r) => r.type === 'EQUITY');

    return {
      assets,
      liabilities,
      equity,
    };
  }

  async pnlReport(from?: Date, to?: Date) {
    const accounts = await this.prisma.account.findMany({
      where: { isActive: true, type: { in: ['REVENUE', 'EXPENSE'] } },
      orderBy: { code: 'asc' },
    });

    const filter: any = {};
    if (from || to) {
      filter.createdAt = {
        gte: from,
        lte: to,
      };
    }

    const aggregates = await this.prisma.journalLine.groupBy({
      by: ['accountId'],
      where: {
        entry: {
          date: {
            gte: from,
            lte: to,
          },
        },
      },
      _sum: {
        debitCents: true,
        creditCents: true,
      },
    });

    const aggMap = new Map(
      aggregates.map((a) => [
        a.accountId,
        (a._sum.debitCents ?? 0) - (a._sum.creditCents ?? 0),
      ]),
    );

    const items = accounts.map((a) => {
      const rawBalance = aggMap.get(a.id) ?? 0;
      // Revenues are usually credit balance, expenses are debit balance.
      // Make revenues positive for representation in P&L
      const balance = a.type === 'REVENUE' ? -rawBalance : rawBalance;
      return {
        id: a.id,
        code: a.code,
        name: a.name,
        nameAr: a.nameAr,
        type: a.type,
        parentAccountId: a.parentAccountId,
        balanceCents: balance,
        subAccounts: [] as any[],
      };
    });

    const map = new Map(items.map((item) => [item.id, item]));
    const roots: typeof items = [];
    for (const item of items) {
      if (item.parentAccountId) {
        const parent = map.get(item.parentAccountId);
        if (parent) {
          parent.subAccounts.push(item);
        } else {
          roots.push(item);
        }
      } else {
        roots.push(item);
      }
    }

    function sumBalances(node: any): number {
      let childSum = 0;
      for (const child of node.subAccounts) {
        childSum += sumBalances(child);
      }
      node.balanceCents += childSum;
      return node.balanceCents;
    }

    for (const root of roots) {
      sumBalances(root);
    }

    const revenues = roots.filter((r) => r.type === 'REVENUE');
    const expenses = roots.filter((r) => r.type === 'EXPENSE');

    const totalRevenue = revenues.reduce((sum, r) => sum + r.balanceCents, 0);
    const totalExpense = expenses.reduce((sum, e) => sum + e.balanceCents, 0);
    const netProfit = totalRevenue - totalExpense;

    return {
      revenues,
      expenses,
      totalRevenue,
      totalExpense,
      netProfit,
    };
  }

  async createCashTransfer(
    userId: string,
    params: {
      sourceAccountId: string;
      targetAccountId: string;
      amountCents: number;
      description: string;
      date?: string;
      reference?: string;
    },
  ) {
    if (params.sourceAccountId === params.targetAccountId) {
      throw new BadRequestException('Source and target accounts must be different.');
    }
    const [source, target] = await Promise.all([
      this.prisma.account.findUniqueOrThrow({ where: { id: params.sourceAccountId } }),
      this.prisma.account.findUniqueOrThrow({ where: { id: params.targetAccountId } }),
    ]);

    if (source.type !== 'ASSET' || target.type !== 'ASSET') {
      throw new BadRequestException('Cash transfers can only be made between Asset accounts.');
    }

    const entry = await this.prisma.journalEntry.create({
      data: {
        description: `Cash Transfer: ${params.description}`,
        reference: params.reference || null,
        date: params.date ? new Date(params.date) : new Date(),
        lines: {
          create: [
            {
              accountId: params.targetAccountId, // Debit target (increases)
              debitCents: params.amountCents,
              creditCents: 0,
            },
            {
              accountId: params.sourceAccountId, // Credit source (decreases)
              debitCents: 0,
              creditCents: params.amountCents,
            },
          ],
        },
      },
      include: { lines: true },
    });

    await this.audit.log({
      userId,
      action: 'accounting.cash_transfer.create',
      entity: 'JournalEntry',
      entityId: entry.id,
      detail: {
        source: source.name,
        target: target.name,
        amountCents: params.amountCents,
        description: params.description,
      },
    });

    return entry;
  }

  async cashTransfers() {
    return this.prisma.journalEntry.findMany({
      where: {
        OR: [
          { description: { startsWith: 'Cash Transfer:' } },
          { description: { startsWith: 'POS Cash Transfer:' } },
        ],
      },
      include: {
        lines: {
          include: {
            account: { select: { code: true, name: true } },
          },
        },
      },
      orderBy: { date: 'desc' },
      take: 100,
    });
  }
}
