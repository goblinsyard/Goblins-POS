import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

const BASE = process.env.API_URL ?? 'http://localhost:3000';
let token = '';

async function api<T>(path: string, options: { method?: string; body?: unknown } = {}): Promise<T> {
  const res = await fetch(`${BASE}/api${path}`, {
    method: options.method ?? 'GET',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: options.body != null ? JSON.stringify(options.body) : undefined,
  });
  if (!res.ok) {
    throw new Error(`${res.status} ${path}: ${JSON.stringify(await res.json().catch(() => ({})))}`);
  }
  const text = await res.text();
  if (!text) return null as T;
  return JSON.parse(text) as T;
}

function flatten(nodes: any[]): any[] {
  const list: any[] = [];
  for (const n of nodes) {
    list.push(n);
    if (n.subAccounts && n.subAccounts.length > 0) {
      list.push(...flatten(n.subAccounts));
    }
  }
  return list;
}

describe('Staff Tips & Sales Bonus Distribution API Tests', () => {
  let cashAccount: any;
  let tipsAccount: any;
  let wagesAccount: any;

  beforeAll(async () => {
    // Authenticate as Owner
    const users = await api<{ id: string; role: { name: string } }[]>('/auth/pin-users');
    const mgr = users.find((u) => u.role.name === 'Owner')!;
    const auth = await api<{ accessToken: string }>('/auth/login/pin', {
      method: 'POST', body: { userId: mgr.id, pin: '9999' },
    });
    token = auth.accessToken;

    // Get Account IDs
    const accounts = await api<any[]>('/accounting/accounts');
    const flatAccounts = flatten(accounts);
    cashAccount = flatAccounts.find((a) => a.code === '1110')!;
    tipsAccount = flatAccounts.find((a) => a.code === '2500')!;
    wagesAccount = flatAccounts.find((a) => a.code === '5210')!;

    expect(cashAccount).toBeDefined();
    expect(tipsAccount).toBeDefined();
    expect(wagesAccount).toBeDefined();
  });

  it('should manage staff configuration (tipsPoints and deservesBonus)', async () => {
    // 1. Fetch staff
    const staff = await api<any[]>('/admin/staff');
    expect(staff.length).toBeGreaterThan(1);

    const emp1 = staff[0];
    const emp2 = staff[1];

    // 2. Update config via PATCH
    await api(`/hr/staff/${emp1.id}`, {
      method: 'PATCH',
      body: { tipsPoints: 3, deservesBonus: true },
    });

    await api(`/hr/staff/${emp2.id}`, {
      method: 'PATCH',
      body: { tipsPoints: 1, deservesBonus: true },
    });

    // 3. Confirm config in directory
    const updatedStaff = await api<any[]>('/admin/staff');
    const uEmp1 = updatedStaff.find((s) => s.id === emp1.id)!;
    const uEmp2 = updatedStaff.find((s) => s.id === emp2.id)!;

    expect(uEmp1.tipsPoints).toBe(3);
    expect(uEmp1.deservesBonus).toBe(true);
    expect(uEmp2.tipsPoints).toBe(1);
    expect(uEmp2.deservesBonus).toBe(true);
  });

  it('should preview and distribute tips based on points weight with immediate payout', async () => {
    // 1. Manually add tips to Tips Payable (2500) via balanced journal entry
    const initialJournal = await api<any>('/accounting/journal-entries', {
      method: 'POST',
      body: {
        description: 'Collect tips simulation',
        reference: 'TIPS-SIM-01',
        lines: [
          { accountId: cashAccount.id, debitCents: 20000, creditCents: 0 },
          { accountId: tipsAccount.id, debitCents: 0, creditCents: 20000 }, // Credit 200 EGP to Tips Payable
        ],
      },
    });
    expect(initialJournal.id).toBeDefined();

    // 2. Fetch tips preview
    const preview = await api<any>('/hr/tips/preview');
    expect(preview.totalTipsCents).toBeGreaterThanOrEqual(20000);

    const eligible1 = preview.eligibleStaff.find((s: any) => s.tipsPoints === 3)!;
    const eligible2 = preview.eligibleStaff.find((s: any) => s.tipsPoints === 1)!;

    expect(eligible1).toBeDefined();
    expect(eligible2).toBeDefined();

    // With 3:1 ratio out of 20000 cents:
    // eligible1: 3/4 * 20000 = 15000 cents
    // eligible2: 1/4 * 20000 = 5000 cents
    expect(eligible1.shareCents).toBe(15000);
    expect(eligible2.shareCents).toBe(5000);

    // 3. Distribute
    const distResult = await api<any>('/hr/tips/distribute', {
      method: 'POST',
      body: {
        totalAmountCents: 20000,
        paymentMethod: 'CASH',
        notes: 'Integration test tips payout',
      },
    });
    expect(distResult.success).toBe(true);
    expect(distResult.journalEntryId).toBeDefined();

    // 4. Verify Ledger: Tips Payable debited, Cash drawer credited
    const ledger = await api<any>(`/accounting/accounts/${tipsAccount.id}/ledger`);
    const line = ledger.lines.find((l: any) => l.reference === 'TipsDist')!;
    expect(line).toBeDefined();
    expect(line.debitCents).toBe(20000);

    // 5. Verify HR Transactions: earned TIPS and offsetting SALARY_PAYMENT
    const transactions = await api<any[]>('/hr/transactions');
    const emp1TipsTx = transactions.find((t) => t.userId === eligible1.userId && t.type === 'TIPS')!;
    const emp1PayTx = transactions.find((t) => t.userId === eligible1.userId && t.type === 'SALARY_PAYMENT' && t.notes.includes('Tips Cash Payout'))!;

    expect(emp1TipsTx).toBeDefined();
    expect(emp1TipsTx.amountCents).toBe(15000);
    expect(emp1PayTx).toBeDefined();
    expect(emp1PayTx.amountCents).toBe(15000);
  });

  it('should preview and distribute sales bonus based on sales percentage with immediate payout', async () => {
    // 1. Create a shift if not open, and generate some paid sales
    let shift = await api<any>('/shifts/current');
    if (!shift) {
      shift = await api<any>('/shifts/open', { method: 'POST', body: { floatCents: 10000 } });
    }

    const order = await api<any>('/orders', {
      method: 'POST',
      body: { type: 'TAKEAWAY', guestCount: 1 },
    });

    const menu = await api<any[]>('/menu');
    const burger = menu.find((c) => c.name === 'Burgers')!.items.find((i: any) => i.name === 'Classic Goblin Burger')!;
    await api<any>(`/orders/${order.id}/items`, {
      method: 'POST',
      body: { items: [{ itemId: burger.id, quantity: 2 }] },
    });

    const detailedOrder = await api<any>(`/orders/${order.id}`);
    const payResult = await api<any>(`/orders/${order.id}/pay`, {
      method: 'POST',
      body: {
        payments: [
          {
            methodId: (await api<any[]>('/admin/payment-methods')).find((m) => m.kind === 'CASH')!.id,
            amountCents: detailedOrder.totalCents,
            tenderedCents: detailedOrder.totalCents,
          },
        ],
      },
    });
    expect(payResult.fullyPaid).toBe(true);

    const start = new Date(Date.now() - 3600_000).toISOString();
    const end = new Date(Date.now() + 3600_000).toISOString();

    // 2. Fetch bonus preview (e.g. 10% of sales)
    const preview = await api<any>(`/hr/bonus/preview?startDate=${start}&endDate=${end}&bonusPercentage=10`);
    expect(preview.totalNetSalesCents).toBeGreaterThanOrEqual(detailedOrder.subtotalCents);
    expect(preview.bonusPoolCents).toBe(Math.round(preview.totalNetSalesCents * 0.1));
    expect(preview.eligibleStaff.length).toBeGreaterThanOrEqual(2); // The two employees configured in test 1

    const empShare = Math.floor(preview.bonusPoolCents / preview.eligibleStaff.length);
    expect(preview.eligibleStaff[1].shareCents).toBe(empShare);

    // 3. Distribute
    const distResult = await api<any>('/hr/bonus/distribute', {
      method: 'POST',
      body: {
        startDate: start,
        endDate: end,
        bonusPercentage: 10,
        paymentMethod: 'CASH',
        notes: 'Integration test bonus payout',
      },
    });
    expect(distResult.success).toBe(true);
    expect(distResult.journalEntryId).toBeDefined();

    // 4. Verify Ledger: Salaries & Wages (5210) debited, Cash drawer credited
    const ledger = await api<any>(`/accounting/accounts/${wagesAccount.id}/ledger`);
    const line = ledger.lines.find((l: any) => l.reference === 'BonusDist')!;
    expect(line).toBeDefined();
    expect(line.debitCents).toBe(preview.bonusPoolCents);

    // 5. Verify offsetting HR Transactions
    const transactions = await api<any[]>('/hr/transactions');
    const sampleEmp = preview.eligibleStaff[1];
    const empBonusTx = transactions.find((t) => t.userId === sampleEmp.userId && t.type === 'BONUS' && t.journalEntryId === distResult.journalEntryId)!;
    const empPayTx = transactions.find((t) => t.userId === sampleEmp.userId && t.type === 'SALARY_PAYMENT' && t.notes.includes('Bonus Cash Payout') && t.journalEntryId === distResult.journalEntryId)!;

    expect(empBonusTx).toBeDefined();
    expect(empBonusTx.amountCents).toBe(empShare);
    expect(empPayTx).toBeDefined();
    expect(empPayTx.amountCents).toBe(empShare);
  });

  afterAll(async () => {
    try {
      // Re-seed to restore database state for other tests
      await execAsync('pnpm.cmd --filter @goblins/api db:seed', { env: { ...process.env, FORCE_RESEED: 'true' } });
    } catch (e) {
      console.error('Failed to re-seed database:', e);
    }
  });
});
