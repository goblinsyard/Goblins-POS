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

describe('Shift Close Cash Variance Accounting Tests', () => {
  let cashAccount: any;
  let miscExpenseAccount: any;
  let otherIncomeAccount: any;

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
    miscExpenseAccount = flatAccounts.find((a) => a.code === '5290')!;
    otherIncomeAccount = flatAccounts.find((a) => a.code === '4500')!;

    expect(cashAccount).toBeDefined();
    expect(miscExpenseAccount).toBeDefined();
    expect(otherIncomeAccount).toBeDefined();
  });

  async function ensureNoOpenShift() {
    const openOrders = await api<any[]>('/orders/open');
    for (const o of openOrders) {
      await api(`/orders/${o.id}/void`, {
        method: 'POST',
        body: { reason: 'e2e cleanup' },
      });
    }

    const shift = await api<any>('/shifts/current');
    if (shift) {
      // Close it with expected cash to avoid leaving it open
      const details = await api<any>(`/shifts/${shift.id}/details`);
      const expected = details.report.cash.expectedCents;
      await api<any>(`/shifts/${shift.id}/close`, {
        method: 'POST',
        body: { countedCents: expected },
      });
    }
  }

  it('should auto-journalize a cash shortage (counted < expected)', async () => {
    await ensureNoOpenShift();

    // 1. Open new shift
    const floatCents = 15000; // 150 EGP
    const shift = await api<any>('/shifts/open', {
      method: 'POST',
      body: { floatCents },
    });
    expect(shift.id).toBeDefined();
    expect(shift.floatCents).toBe(floatCents);

    // 2. Close with a shortage (e.g. counted 13000, shortage of 2000 cents / 20 EGP)
    const countedCents = 13000;
    const closed = await api<any>(`/shifts/${shift.id}/close`, {
      method: 'POST',
      body: { countedCents },
    });
    expect(closed.shift.status).toBe('CLOSED');
    expect(closed.shift.varianceCents).toBe(-2000);

    // 3. Verify Journal Entry was created
    const entries = await api<any[]>('/accounting/journal-entries');
    const entry = entries.find((e) => e.reference === `Shift #${shift.id}`);
    expect(entry).toBeDefined();
    expect(entry.description).toContain('Shift Close Cash Shortage');

    // 4. Verify lines: debit miscellaneous expense (5290) and credit cash drawer (1110)
    const debitLine = entry.lines.find((l: any) => l.accountId === miscExpenseAccount.id)!;
    const creditLine = entry.lines.find((l: any) => l.accountId === cashAccount.id)!;

    expect(debitLine).toBeDefined();
    expect(debitLine.debitCents).toBe(2000);
    expect(debitLine.creditCents).toBe(0);

    expect(creditLine).toBeDefined();
    expect(creditLine.debitCents).toBe(0);
    expect(creditLine.creditCents).toBe(2000);
  });

  it('should auto-journalize a cash overage (counted > expected)', async () => {
    await ensureNoOpenShift();

    // 1. Open new shift
    const floatCents = 20000; // 200 EGP
    const shift = await api<any>('/shifts/open', {
      method: 'POST',
      body: { floatCents },
    });
    expect(shift.id).toBeDefined();

    // 2. Close with an overage (e.g. counted 22500, overage of 2500 cents / 25 EGP)
    const countedCents = 22500;
    const closed = await api<any>(`/shifts/${shift.id}/close`, {
      method: 'POST',
      body: { countedCents },
    });
    expect(closed.shift.status).toBe('CLOSED');
    expect(closed.shift.varianceCents).toBe(2500);

    // 3. Verify Journal Entry was created
    const entries = await api<any[]>('/accounting/journal-entries');
    const entry = entries.find((e) => e.reference === `Shift #${shift.id}`);
    expect(entry).toBeDefined();
    expect(entry.description).toContain('Shift Close Cash Overage');

    // 4. Verify lines: debit cash drawer (1110) and credit other income (4500)
    const debitLine = entry.lines.find((l: any) => l.accountId === cashAccount.id)!;
    const creditLine = entry.lines.find((l: any) => l.accountId === otherIncomeAccount.id)!;

    expect(debitLine).toBeDefined();
    expect(debitLine.debitCents).toBe(2500);
    expect(debitLine.creditCents).toBe(0);

    expect(creditLine).toBeDefined();
    expect(creditLine.debitCents).toBe(0);
    expect(creditLine.creditCents).toBe(2500);
  });

  it('should not create a journal entry when variance is zero', async () => {
    await ensureNoOpenShift();

    // 1. Open new shift
    const floatCents = 10000;
    const shift = await api<any>('/shifts/open', {
      method: 'POST',
      body: { floatCents },
    });
    expect(shift.id).toBeDefined();

    // 2. Close with zero variance (counted 10000)
    const countedCents = 10000;
    const closed = await api<any>(`/shifts/${shift.id}/close`, {
      method: 'POST',
      body: { countedCents },
    });
    expect(closed.shift.status).toBe('CLOSED');
    expect(closed.shift.varianceCents).toBe(0);

    // 3. Verify no Journal Entry exists with reference Shift #id
    const entries = await api<any[]>('/accounting/journal-entries');
    const entry = entries.find((e) => e.reference === `Shift #${shift.id}`);
    expect(entry).toBeUndefined();
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
