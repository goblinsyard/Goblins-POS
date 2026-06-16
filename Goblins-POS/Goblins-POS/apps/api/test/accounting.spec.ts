import { beforeAll, describe, expect, it } from 'vitest';

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

describe('Accounting & Suppliers Integration Tests', () => {
  beforeAll(async () => {
    // Authenticate as Manager/Owner
    const users = await api<{ id: string; role: { name: string } }[]>('/auth/pin-users');
    const mgr = users.find((u) => u.role.name === 'Owner')!;
    const auth = await api<{ accessToken: string }>('/auth/login/pin', {
      method: 'POST', body: { userId: mgr.id, pin: '9999' },
    });
    token = auth.accessToken;
  });

  it('1. should fetch Chart of Accounts tree structures', async () => {
    const accounts = await api<any[]>('/accounting/accounts');
    expect(accounts.length).toBeGreaterThan(0);
    // Find Assets root account
    const assets = accounts.find(a => a.code === '1000');
    expect(assets).toBeDefined();
    expect(assets.type).toBe('ASSET');
    expect(assets.subAccounts.length).toBeGreaterThan(0);
  });

  it('2. should reject posting unbalanced journal entries', async () => {
    const accounts = await api<any[]>('/accounting/accounts');
    const flat = flatten(accounts);
    const safe = flat.find(a => a.code === '1110')!;
    const rentExp = flat.find(a => a.code === '5220')!;

    await expect(
      api('/accounting/journal-entries', {
        method: 'POST',
        body: {
          description: 'Unbalanced Rent Payment',
          lines: [
            { accountId: rentExp.id, debitCents: 50000, creditCents: 0 },
            { accountId: safe.id, debitCents: 0, creditCents: 45000 } // difference of 5000 piasters
          ]
        }
      })
    ).rejects.toThrow(/does not balance/);
  });

  it('3. should post a balanced manual journal entry', async () => {
    const accounts = await api<any[]>('/accounting/accounts');
    const flat = flatten(accounts);
    const safe = flat.find(a => a.code === '1110')!;
    const rentExp = flat.find(a => a.code === '5220')!;

    const entry = await api<any>('/accounting/journal-entries', {
      method: 'POST',
      body: {
        description: 'Balanced Rent Payment',
        reference: 'VOUCH-999',
        lines: [
          { accountId: rentExp.id, debitCents: 50000, creditCents: 0 },
          { accountId: safe.id, debitCents: 0, creditCents: 50000 }
        ]
      }
    });

    expect(entry.id).toBeDefined();
    expect(entry.lines.length).toBe(2);

    // Verify ledger updates
    const ledger = await api<any>(`/accounting/accounts/${safe.id}/ledger`);
    expect(ledger.lines.length).toBeGreaterThan(0);
    const lastLine = ledger.lines[ledger.lines.length - 1];
    expect(lastLine.reference).toBe('VOUCH-999');
    expect(lastLine.creditCents).toBe(50000);
  });

  it('4. should fetch Trial Balance, Balance Sheet, and P&L reports', async () => {
    const tb = await api<any[]>('/accounting/reports/trial-balance');
    expect(tb.length).toBeGreaterThan(0);
    const safeTb = tb.find(a => a.code === '1110')!;
    expect(safeTb.creditCents).toBeGreaterThan(0);

    const bs = await api<any>('/accounting/reports/balance-sheet');
    expect(bs.assets.length).toBeGreaterThan(0);
    expect(bs.liabilities.length).toBeGreaterThan(0);

    const pnl = await api<any>('/accounting/reports/pnl');
    expect(pnl.expenses.length).toBeGreaterThan(0);
    expect(pnl.totalExpense).toBeGreaterThan(0);
  });

  it('5. should auto-journalize expenses mapped to accounts', async () => {
    // Fetch categories to get an account-linked category
    const categories = await api<any[]>('/expenses/categories');
    const utilitiesCategory = categories.find(c => c.name === 'Utilities')!;
    expect(utilitiesCategory.accountId).toBeDefined();

    // Create an expense
    const expense = await api<any>('/expenses', {
      method: 'POST',
      body: {
        categoryId: utilitiesCategory.id,
        description: 'E2E Electricity bill test',
        amountCents: 15000,
        paymentMethod: 'cash',
      }
    });

    expect(expense.id).toBeDefined();

    // Verify ledger contains the auto-journal entry
    const ledger = await api<any>(`/accounting/accounts/${utilitiesCategory.accountId}/ledger`);
    const line = ledger.lines.find((l: any) => l.description.includes('E2E Electricity bill test'));
    expect(line).toBeDefined();
    expect(line.debitCents).toBe(15000);
  });

  it('6. should post and retrieve a cash transfer between asset accounts', async () => {
    const accounts = await api<any[]>('/accounting/accounts');
    const flat = flatten(accounts);
    const safe = flat.find(a => a.code === '1110')!;
    const bank = flat.find(a => a.code === '1210')!;

    // Make transfer
    const transfer = await api<any>('/accounting/transfers', {
      method: 'POST',
      body: {
        sourceAccountId: safe.id,
        targetAccountId: bank.id,
        amountCents: 20000,
        description: 'Test Safe Drop to Bank',
        reference: 'SLIP-001',
      }
    });

    expect(transfer.id).toBeDefined();
    expect(transfer.lines.length).toBe(2);

    // Retrieve transfers list and find it
    const list = await api<any[]>('/accounting/transfers');
    const found = list.find((t) => t.id === transfer.id);
    expect(found).toBeDefined();
    expect(found.description).toContain('Test Safe Drop to Bank');
  });

  it('7. should perform full CRUD operations on payment methods', async () => {
    // 1. Create
    const pm = await api<any>('/admin/payment-methods', {
      method: 'POST',
      body: {
        name: 'Instapay Wallet',
        nameAr: 'إنستاباي',
        kind: 'WALLET',
        opensDrawer: false,
        isActive: true,
        sortOrder: 10,
      }
    });
    expect(pm.id).toBeDefined();
    expect(pm.name).toBe('Instapay Wallet');
    expect(pm.kind).toBe('WALLET');

    // 2. Read (All)
    let methods = await api<any[]>('/admin/payment-methods');
    let found = methods.find((m) => m.id === pm.id);
    expect(found).toBeDefined();

    // 3. Update
    const updated = await api<any>(`/admin/payment-methods/${pm.id}`, {
      method: 'PATCH',
      body: {
        name: 'Instapay Wallet Egypt',
        opensDrawer: true,
      }
    });
    expect(updated.name).toBe('Instapay Wallet Egypt');
    expect(updated.opensDrawer).toBe(true);

    // 4. Delete
    await api(`/admin/payment-methods/${pm.id}`, { method: 'DELETE' });

    // Verify deleted
    methods = await api<any[]>('/admin/payment-methods');
    found = methods.find((m) => m.id === pm.id);
    expect(found).toBeUndefined();
  });

  it('8. should set and edit the initial balance on cash/bank accounts', async () => {
    const code = `122${Math.floor(100 + Math.random() * 900)}`;
    // 1. Create a custom asset account with an initial balance
    const customAccount = await api<any>('/accounting/accounts', {
      method: 'POST',
      body: {
        code,
        name: 'Fawry Cash Account',
        type: 'ASSET',
        initialBalanceCents: 150000, // 1,500 EGP
      }
    });

    expect(customAccount.id).toBeDefined();
    expect(customAccount.initialBalanceCents).toBe(150000);

    // Verify dynamic balance in Chart of Accounts matches initial balance
    let accounts = await api<any[]>('/accounting/accounts');
    let flat = flatten(accounts);
    let found = flat.find(a => a.id === customAccount.id)!;
    expect(found.balanceCents).toBe(150000);

    // Verify opening balance journal entry
    let entries = await api<any[]>('/accounting/journal-entries');
    let openingEntry = entries.find(e => e.reference === `Opening Balance: ${code}`)!;
    expect(openingEntry).toBeDefined();
    expect(openingEntry.lines.length).toBe(2);

    const targetLine = openingEntry.lines.find((l: any) => l.accountId === customAccount.id)!;
    expect(targetLine.debitCents).toBe(150000);

    // 2. Update initial balance
    const updatedAccount = await api<any>(`/accounting/accounts/${customAccount.id}`, {
      method: 'PATCH',
      body: {
        initialBalanceCents: 100000, // 1,000 EGP
      }
    });
    expect(updatedAccount.initialBalanceCents).toBe(100000);

    // Verify updated balance in tree
    accounts = await api<any[]>('/accounting/accounts');
    flat = flatten(accounts);
    found = flat.find(a => a.id === customAccount.id)!;
    expect(found.balanceCents).toBe(100000);

    // Verify updated opening balance journal entry
    entries = await api<any[]>('/accounting/journal-entries');
    openingEntry = entries.find(e => e.reference === `Opening Balance: ${code}`)!;
    const updatedLine = openingEntry.lines.find((l: any) => l.accountId === customAccount.id)!;
    expect(updatedLine.debitCents).toBe(100000);
  });

  it('9. should edit and delete manual journal entries', async () => {
    const accounts = await api<any[]>('/accounting/accounts');
    const flat = flatten(accounts);
    const safe = flat.find(a => a.code === '1110')!;
    const rentExp = flat.find(a => a.code === '5220')!;

    // Create entry
    const entry = await api<any>('/accounting/journal-entries', {
      method: 'POST',
      body: {
        description: 'Voucher #1',
        reference: 'V-1',
        lines: [
          { accountId: rentExp.id, debitCents: 20000, creditCents: 0 },
          { accountId: safe.id, debitCents: 0, creditCents: 20000 }
        ]
      }
    });

    expect(entry.id).toBeDefined();

    // Edit entry
    const updated = await api<any>(`/accounting/journal-entries/${entry.id}`, {
      method: 'PATCH',
      body: {
        description: 'Voucher #1 Edited',
        reference: 'V-1-E',
        lines: [
          { accountId: rentExp.id, debitCents: 30000, creditCents: 0 },
          { accountId: safe.id, debitCents: 0, creditCents: 30000 }
        ]
      }
    });

    expect(updated.description).toBe('Voucher #1 Edited');
    expect(updated.reference).toBe('V-1-E');
    expect(updated.lines.find((l: any) => l.accountId === rentExp.id).debitCents).toBe(30000);

    // Delete entry
    await api(`/accounting/journal-entries/${entry.id}`, { method: 'DELETE' });

    // Verify deleted
    const entries = await api<any[]>('/accounting/journal-entries');
    const found = entries.find(e => e.id === entry.id);
    expect(found).toBeUndefined();
  });

  it('10. should view closed orders and allow editing their payment methods', async () => {
    // 1. Get history of closed orders
    const history = await api<any[]>('/orders/history');
    expect(history.length).toBeGreaterThan(0);
    const order = history[0];
    const payment = order.payments[0];
    expect(payment).toBeDefined();

    // Get active payment methods
    const methods = await api<any[]>('/admin/payment-methods');
    const otherMethod = methods.find(m => m.id !== payment.methodId && m.isActive)!;
    expect(otherMethod).toBeDefined();

    // 2. Edit payment method of order payment
    const updatedPayment = await api<any>(`/orders/${order.id}/payments/${payment.id}`, {
      method: 'PATCH',
      body: { methodId: otherMethod.id }
    });

    expect(updatedPayment.methodId).toBe(otherMethod.id);
  });

  it('11. should record an expense with a custom payment account', async () => {
    const code = `123${Math.floor(100 + Math.random() * 900)}`;
    // Create custom Asset account
    const payAccount = await api<any>('/accounting/accounts', {
      method: 'POST',
      body: { code, name: 'Custom Wallet Account', type: 'ASSET' }
    });

    // Fetch Utilities category to use
    const categories = await api<any[]>('/expenses/categories');
    const utilitiesCategory = categories.find(c => c.name === 'Utilities')!;

    // Create expense linked to custom payment account
    const expense = await api<any>('/expenses', {
      method: 'POST',
      body: {
        categoryId: utilitiesCategory.id,
        description: 'Wallet paid internet bill',
        amountCents: 25000,
        accountId: payAccount.id,
      }
    });

    expect(expense.id).toBeDefined();
    expect(expense.accountId).toBe(payAccount.id);

    // Verify auto-journalization credits the custom payment account (1230)
    const ledger = await api<any>(`/accounting/accounts/${payAccount.id}/ledger`);
    const line = ledger.lines.find((l: any) => l.description.includes('Wallet paid internet bill'));
    expect(line).toBeDefined();
    expect(line.creditCents).toBe(25000);
  });

  it('12. should receive a purchase order with a custom payment account and auto-journalize', async () => {
    const code = `124${Math.floor(100 + Math.random() * 900)}`;
    // 1. Create custom payment account
    const payAccount = await api<any>('/accounting/accounts', {
      method: 'POST',
      body: { code, name: 'Safe Cashier Box 2', type: 'ASSET' }
    });

    // 2. Fetch suppliers and ingredients to make a PO
    const suppliers = await api<any[]>('/inventory/suppliers');
    const ingredients = await api<any[]>('/inventory/ingredients');
    const locations = await api<any[]>('/inventory/locations');

    const supplier = suppliers[0];
    const ingredient = ingredients[0];
    const location = locations[0];

    // Create PO
    const po = await api<any>('/inventory/purchase-orders', {
      method: 'POST',
      body: {
        supplierId: supplier.id,
        lines: [{ ingredientId: ingredient.id, quantity: 10, unitCostCents: 5000 }] // 50 EGP each
      }
    });

    expect(po.id).toBeDefined();
    const poLine = po.lines[0];

    // 3. Receive goods with custom payment account
    const receipt = await api<any>(`/inventory/purchase-orders/${po.id}/receive`, {
      method: 'POST',
      body: {
        locationId: location.id,
        accountId: payAccount.id,
        lines: [{ poLineId: poLine.id, quantity: 10, unitCostCents: 5000 }]
      }
    });

    expect(receipt.id).toBeDefined();
    expect(receipt.accountId).toBe(payAccount.id);

    // Verify journal entry: debits Inventory (1400) and credits Custom Payment Account (1240)
    const ledger = await api<any>(`/accounting/accounts/${payAccount.id}/ledger`);
    const line = ledger.lines.find((l: any) => l.description.includes(`PO Receipt: ${supplier.name}`));
    expect(line).toBeDefined();
    expect(line.creditCents).toBe(50000); // 10 * 5000 = 50,000 cents
  });

  it('13. should support editing and deleting expenses', async () => {
    // 1. Fetch Utilities category to use
    const categories = await api<any[]>('/expenses/categories');
    const utilitiesCategory = categories.find(c => c.name === 'Utilities')!;

    // 2. Create expense
    const expense = await api<any>('/expenses', {
      method: 'POST',
      body: {
        categoryId: utilitiesCategory.id,
        description: 'Temporary trash bags',
        amountCents: 5000,
        paymentMethod: 'cash',
      }
    });
    expect(expense.id).toBeDefined();

    // Verify ledger contains the auto-journal entry
    let ledger = await api<any>(`/accounting/accounts/${utilitiesCategory.accountId}/ledger`);
    let line = ledger.lines.find((l: any) => l.description.includes('Temporary trash bags'));
    expect(line).toBeDefined();
    expect(line.debitCents).toBe(5000);

    // 3. Edit expense
    const updated = await api<any>(`/expenses/${expense.id}`, {
      method: 'PATCH',
      body: {
        description: 'Temporary trash bags - Bulk',
        amountCents: 7500,
      }
    });
    expect(updated.description).toBe('Temporary trash bags - Bulk');
    expect(updated.amountCents).toBe(7500);

    // Verify updated ledger entry
    ledger = await api<any>(`/accounting/accounts/${utilitiesCategory.accountId}/ledger`);
    line = ledger.lines.find((l: any) => l.description.includes('Temporary trash bags - Bulk'));
    expect(line).toBeDefined();
    expect(line.debitCents).toBe(7500);

    // 4. Delete expense
    await api(`/expenses/${expense.id}`, { method: 'DELETE' });

    // Verify deleted from ledger
    ledger = await api<any>(`/accounting/accounts/${utilitiesCategory.accountId}/ledger`);
    line = ledger.lines.find((l: any) => l.description.includes('Temporary trash bags'));
    expect(line).toBeUndefined();
  });

  it('14. should support editing and deleting/reverting received purchases', async () => {
    // 1. Create two custom payment accounts
    const code1 = `124${Math.floor(100 + Math.random() * 900)}`;
    const code2 = `124${Math.floor(100 + Math.random() * 900)}`;
    const payAccount1 = await api<any>('/accounting/accounts', {
      method: 'POST',
      body: { code: code1, name: 'PO Cash Account 1', type: 'ASSET' }
    });
    const payAccount2 = await api<any>('/accounting/accounts', {
      method: 'POST',
      body: { code: code2, name: 'PO Cash Account 2', type: 'ASSET' }
    });

    const suppliers = await api<any[]>('/inventory/suppliers');
    const ingredients = await api<any[]>('/inventory/ingredients');
    const locations = await api<any[]>('/inventory/locations');
    const supplier = suppliers[0];
    const ingredient = ingredients[0];
    const location = locations[0];

    // Get current stock level
    const levelsBefore = await api<any[]>(`/inventory/levels?locationId=${location.id}`);
    const levelBefore = levelsBefore.find(l => l.ingredientId === ingredient.id)?.quantity ?? 0;

    // Create PO
    const po = await api<any>('/inventory/purchase-orders', {
      method: 'POST',
      body: {
        supplierId: supplier.id,
        lines: [{ ingredientId: ingredient.id, quantity: 5, unitCostCents: 4000 }]
      }
    });
    const poLine = po.lines[0];

    // 2. Receive goods against PO with payAccount1
    const receipt = await api<any>(`/inventory/purchase-orders/${po.id}/receive`, {
      method: 'POST',
      body: {
        locationId: location.id,
        accountId: payAccount1.id,
        invoiceNumber: 'INV-101',
        lines: [{ poLineId: poLine.id, quantity: 5, unitCostCents: 4000 }]
      }
    });
    expect(receipt.id).toBeDefined();

    // Verify stock level increased by 5
    let levelsAfter = await api<any[]>(`/inventory/levels?locationId=${location.id}`);
    let levelAfter = levelsAfter.find(l => l.ingredientId === ingredient.id)?.quantity ?? 0;
    expect(Number(levelAfter)).toBe(Number(levelBefore) + 5);

    // Verify ledger of payAccount1 has PO Receipt credit
    let ledger1 = await api<any>(`/accounting/accounts/${payAccount1.id}/ledger`);
    let creditLine1 = ledger1.lines.find((l: any) => l.reference === `GoodsReceipt #${receipt.id}`);
    expect(creditLine1).toBeDefined();
    expect(creditLine1.creditCents).toBe(20000); // 5 * 4000

    // 3. Edit GoodsReceipt (change payment account to payAccount2, and change invoice number)
    const updatedReceipt = await api<any>(`/inventory/goods-receipts/${receipt.id}`, {
      method: 'PATCH',
      body: {
        accountId: payAccount2.id,
        invoiceNumber: 'INV-101-MOD',
        notes: 'Corrected payment account'
      }
    });
    expect(updatedReceipt.accountId).toBe(payAccount2.id);

    // Verify ledger of payAccount1 is empty and ledger of payAccount2 has the credit line
    ledger1 = await api<any>(`/accounting/accounts/${payAccount1.id}/ledger`);
    creditLine1 = ledger1.lines.find((l: any) => l.reference === `GoodsReceipt #${receipt.id}`);
    expect(creditLine1).toBeUndefined();

    let ledger2 = await api<any>(`/accounting/accounts/${payAccount2.id}/ledger`);
    let creditLine2 = ledger2.lines.find((l: any) => l.reference === `GoodsReceipt #${receipt.id}`);
    expect(creditLine2).toBeDefined();
    expect(creditLine2.creditCents).toBe(20000);

    // 4. Delete and revert GoodsReceipt
    const deleteRes = await api<any>(`/inventory/goods-receipts/${receipt.id}`, {
      method: 'DELETE'
    });
    expect(deleteRes.success).toBe(true);

    // Verify stock level reverted back to levelBefore
    levelsAfter = await api<any[]>(`/inventory/levels?locationId=${location.id}`);
    levelAfter = levelsAfter.find(l => l.ingredientId === ingredient.id)?.quantity ?? 0;
    expect(Number(levelAfter)).toBe(Number(levelBefore));

    // Verify ledger of payAccount2 has credit line deleted
    ledger2 = await api<any>(`/accounting/accounts/${payAccount2.id}/ledger`);
    creditLine2 = ledger2.lines.find((l: any) => l.reference === `GoodsReceipt #${receipt.id}`);
    expect(creditLine2).toBeUndefined();

    // Verify PO status reverted back to SENT
    const revertedPo = await api<any>(`/inventory/purchase-orders`);
    const poCheck = revertedPo.find((p: any) => p.id === po.id);
    expect(poCheck.status).toBe('SENT');
  });

  it('15. should support creating and patching accounts with isPaymentSource', async () => {
    const code = `125${Math.floor(100 + Math.random() * 900)}`;
    // 1. Create with isPaymentSource: true
    const payAccount = await api<any>('/accounting/accounts', {
      method: 'POST',
      body: { code, name: 'Custom Safe Wallet', type: 'ASSET', isPaymentSource: true }
    });
    expect(payAccount.id).toBeDefined();
    expect(payAccount.isPaymentSource).toBe(true);

    // 2. Fetch and confirm
    const accounts = await api<any[]>('/accounting/accounts');
    const flat = flatten(accounts);
    const found = flat.find(a => a.id === payAccount.id)!;
    expect(found.isPaymentSource).toBe(true);

    // 3. Patch to isPaymentSource: false
    const patched = await api<any>(`/accounting/accounts/${payAccount.id}`, {
      method: 'PATCH',
      body: { isPaymentSource: false }
    });
    expect(patched.isPaymentSource).toBe(false);

    // Verify fetched again
    const accounts2 = await api<any[]>('/accounting/accounts');
    const flat2 = flatten(accounts2);
    const found2 = flat2.find(a => a.id === payAccount.id)!;
    expect(found2.isPaymentSource).toBe(false);
  });

  it('16. should support updating parentAccountId and block circular dependencies', async () => {
    const codeA = `126${Math.floor(100 + Math.random() * 900)}`;
    const codeB = `127${Math.floor(100 + Math.random() * 900)}`;

    // 1. Create two root accounts
    const accA = await api<any>('/accounting/accounts', {
      method: 'POST',
      body: { code: codeA, name: 'Account A', type: 'ASSET' }
    });
    const accB = await api<any>('/accounting/accounts', {
      method: 'POST',
      body: { code: codeB, name: 'Account B', type: 'LIABILITY' }
    });

    expect(accA.parentAccountId).toBeNull();
    expect(accB.parentAccountId).toBeNull();

    // 2. Set Acc B's parent to Acc A
    const updatedB = await api<any>(`/accounting/accounts/${accB.id}`, {
      method: 'PATCH',
      body: { parentAccountId: accA.id }
    });
    expect(updatedB.parentAccountId).toBe(accA.id);
    expect(updatedB.type).toBe('ASSET'); // Type inherits from parent A

    // 3. Try to set Acc A's parent to Acc B (Circular Dependency)
    await expect(
      api(`/accounting/accounts/${accA.id}`, {
        method: 'PATCH',
        body: { parentAccountId: accB.id }
      })
    ).rejects.toThrow(/Circular dependency/);

    // 4. Try to set Acc A's parent to itself (Circular Dependency)
    await expect(
      api(`/accounting/accounts/${accA.id}`, {
        method: 'PATCH',
        body: { parentAccountId: accA.id }
      })
    ).rejects.toThrow(/Circular dependency/);
  });
});

