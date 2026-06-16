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

describe('Data Import & Export Integration Tests', () => {
  beforeAll(async () => {
    // Authenticate as Owner
    const users = await api<{ id: string; role: { name: string } }[]>('/auth/pin-users');
    const mgr = users.find((u) => u.role.name === 'Owner')!;
    const auth = await api<{ accessToken: string }>('/auth/login/pin', {
      method: 'POST', body: { userId: mgr.id, pin: '9999' },
    });
    token = auth.accessToken;
  });

  it('1. should export current menu catalog and customers list', async () => {
    const menu = await api<any[]>('/admin/export/menu');
    expect(Array.isArray(menu)).toBe(true);
    expect(menu.length).toBeGreaterThan(0);
    expect(menu[0].name).toBeDefined();
    expect(menu[0].items).toBeDefined();

    const customers = await api<any[]>('/admin/export/customers');
    expect(Array.isArray(customers)).toBe(true);
    expect(customers.length).toBeGreaterThan(0);
    expect(customers[0].phone).toBeDefined();
  });

  it('2. should import menu categories, items and modifier groups successfully', async () => {
    const importData = [
      {
        name: 'Goblins Specials',
        nameAr: 'أطباق خاصة',
        items: [
          {
            name: 'Double Cheeseburger',
            priceCents: 15000,
            sku: 'GOBLIN-DBL-CHEESE',
            department: 'RESTAURANT',
            modifierGroups: [
              {
                name: 'Sauces',
                minSelect: 0,
                maxSelect: 3,
                modifiers: [
                  { name: 'Ketchup', priceDeltaCents: 0 },
                  { name: 'Special Sauce', priceDeltaCents: 500 }
                ]
              }
            ]
          }
        ]
      }
    ];

    const result = await api<any>('/admin/import/menu', {
      method: 'POST',
      body: importData
    });

    expect(result.success).toBe(true);
    expect(result.categoriesCreated).toBeGreaterThanOrEqual(0);
    expect(result.itemsImported).toBe(1);

    // Verify item was created
    const menu = await api<any[]>('/admin/export/menu');
    const importedCat = menu.find(c => c.name === 'Goblins Specials')!;
    expect(importedCat).toBeDefined();
    const importedItem = importedCat.items.find((i: any) => i.name === 'Double Cheeseburger')!;
    expect(importedItem).toBeDefined();
    expect(importedItem.sku).toBe('GOBLIN-DBL-CHEESE');
    expect(importedItem.priceCents).toBe(15000);
    expect(importedItem.modifierGroups.length).toBe(1);
    expect(importedItem.modifierGroups[0].name).toBe('Sauces');
    expect(importedItem.modifierGroups[0].modifiers.some((m: any) => m.name === 'Special Sauce')).toBe(true);
  });

  it('3. should import customers and handle duplicates', async () => {
    const importData = [
      { name: 'New Test Customer 1', phone: '+201299999999', email: 'cust1@example.com' },
      { name: 'New Test Customer 2', phone: '+201299999998', tags: ['vip', 'billiards'] }
    ];

    const result = await api<any>('/admin/import/customers', {
      method: 'POST',
      body: importData
    });

    expect(result.success).toBe(true);
    expect(result.importedCount).toBe(2);

    // Patch/update details of customer 1 (should upsert by phone number)
    const updateData = [
      { name: 'New Test Customer 1 (Updated)', phone: '+201299999999', notes: 'Frequent customer' }
    ];

    const result2 = await api<any>('/admin/import/customers', {
      method: 'POST',
      body: updateData
    });
    expect(result2.success).toBe(true);
    expect(result2.importedCount).toBe(1);

    // Verify customer details
    const customers = await api<any[]>('/admin/export/customers');
    const c1 = customers.find(c => c.phone === '+201299999999')!;
    expect(c1).toBeDefined();
    expect(c1.name).toBe('New Test Customer 1 (Updated)');
    expect(c1.notes).toBe('Frequent customer');
  });

  it('4. should erase all demo data and verify database is clean', async () => {
    // Erase demo data
    const result = await api<any>('/admin/db/erase-demo', { method: 'POST' });
    expect(result.success).toBe(true);

    // Verify menu is empty
    const menu = await api<any[]>('/admin/export/menu');
    expect(menu.length).toBe(0);

    // Verify customers are empty
    const customers = await api<any[]>('/admin/export/customers');
    expect(customers.length).toBe(0);
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
