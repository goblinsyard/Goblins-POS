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

describe('Payment Method Ledger Linkage Tests', () => {
  beforeAll(async () => {
    // Authenticate as Owner
    const users = await api<{ id: string; role: { name: string } }[]>('/auth/pin-users');
    const mgr = users.find((u) => u.role.name === 'Owner')!;
    const auth = await api<{ accessToken: string }>('/auth/login/pin', {
      method: 'POST', body: { userId: mgr.id, pin: '9999' },
    });
    token = auth.accessToken;
  });

  it('should create a payment method linked to a specific account, pay an order, and verify debit goes to the linked account', async () => {
    // 1. Get Accounts, find seeded Fawry (1220)
    const accounts = await api<any[]>('/accounting/accounts');
    // Helper function to flatten the tree to search by code
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
    const flatAccounts = flatten(accounts);
    const fawryAccount = flatAccounts.find((a) => a.code === '1220')!;
    expect(fawryAccount).toBeDefined();

    // 2. Create linked Payment Method
    const pm = await api<any>('/admin/payment-methods', {
      method: 'POST',
      body: {
        name: 'Linked Fawry Wallet',
        kind: 'WALLET',
        accountId: fawryAccount.id,
        opensDrawer: false,
        isActive: true,
        sortOrder: 88,
      },
    });
    expect(pm.id).toBeDefined();
    expect(pm.accountId).toBe(fawryAccount.id);

    // 3. Ensure a shift is open
    let shift = await api<any>('/shifts/current');
    if (!shift) {
      shift = await api<any>('/shifts/open', { method: 'POST', body: { floatCents: 10000 } });
    }
    expect(shift.id).toBeDefined();

    // Create a customer with enough wallet balance
    const customer = await api<any>('/crm/customers', {
      method: 'POST',
      body: {
        name: 'Test Wallet User',
        phone: '1' + Math.random().toString().slice(2, 11),
        walletBalanceCents: 1000000,
      },
    });
    expect(customer.id).toBeDefined();

    // 4. Create an order
    const order = await api<any>('/orders', {
      method: 'POST',
      body: {
        type: 'TAKEAWAY',
        guestCount: 1,
        customerId: customer.id,
      },
    });
    expect(order.id).toBeDefined();

    // 5. Add an item (Classic Goblin Burger)
    const menu = await api<any[]>('/menu');
    const burger = menu.find((c) => c.name === 'Burgers')!.items.find((i: any) => i.name === 'Classic Goblin Burger')!;
    
    const updatedOrder = await api<any>(`/orders/${order.id}/items`, {
      method: 'POST',
      body: {
        items: [{ itemId: burger.id, quantity: 1 }],
      },
    });
    expect(updatedOrder.totalCents).toBeGreaterThan(0);

    // 6. Pay using our linked payment method
    const payResult = await api<any>(`/orders/${order.id}/pay`, {
      method: 'POST',
      body: {
        payments: [
          {
            methodId: pm.id,
            amountCents: updatedOrder.totalCents,
            tenderedCents: updatedOrder.totalCents,
          },
        ],
      },
    });
    expect(payResult.fullyPaid).toBe(true);

    // 7. Verify journal entry debited the linked account (Fawry), not Bank (1210)
    const journalEntries = await api<any[]>('/accounting/journal-entries');
    const entry = journalEntries.find((e) => e.reference === `Order #${order.id}`)!;
    expect(entry).toBeDefined();

    // Check lines
    const debitLine = entry.lines.find((l: any) => l.debitCents === updatedOrder.totalCents)!;
    expect(debitLine).toBeDefined();
    expect(debitLine.accountId).toBe(fawryAccount.id);
  });

  afterAll(async () => {
    try {
      // Restore database state for subsequent tests
      await execAsync('pnpm.cmd --filter @goblins/api db:seed', { env: { ...process.env, FORCE_RESEED: 'true' } });
    } catch (e) {
      console.error('Failed to re-seed database:', e);
    }
  });
});
