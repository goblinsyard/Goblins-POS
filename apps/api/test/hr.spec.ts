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

describe('HR & Payroll Module Integration Tests', () => {
  let staffMemberId = '';

  beforeAll(async () => {
    // Authenticate as Owner
    const users = await api<{ id: string; role: { name: string } }[]>('/auth/pin-users');
    const owner = users.find((u) => u.role.name === 'Owner')!;
    const auth = await api<{ accessToken: string }>('/auth/login/pin', {
      method: 'POST', body: { userId: owner.id, pin: '9999' },
    });
    token = auth.accessToken;

    // Get an active staff member id
    const staffList = await api<any[]>('/admin/staff');
    expect(staffList.length).toBeGreaterThan(0);
    staffMemberId = staffList[0].id;
  });

  it('1. should update staff salary settings', async () => {
    const updated = await api<any>(`/hr/staff/${staffMemberId}`, {
      method: 'PATCH',
      body: {
        salaryType: 'HOURLY',
        baseSalaryCents: 450000, // 4,500 EGP
        hourlyRateCents: 5000,   // 50 EGP
      }
    });

    expect(updated.id).toBe(staffMemberId);
    expect(updated.salaryType).toBe('HOURLY');
    expect(updated.baseSalaryCents).toBe(450000);
    expect(updated.hourlyRateCents).toBe(5000);
  });

  it('2. should manage attendance logs manually', async () => {
    // 1. Create manual attendance log
    const now = new Date();
    const clockInStr = new Date(now.getTime() - 4 * 3600_000).toISOString(); // 4 hours ago
    const clockOutStr = now.toISOString();

    const entry = await api<any>('/hr/attendance', {
      method: 'POST',
      body: {
        staffId: staffMemberId,
        clockIn: clockInStr,
        clockOut: clockOutStr,
        note: 'E2E test manual fix'
      }
    });

    expect(entry.id).toBeDefined();
    expect(entry.userId).toBe(staffMemberId);
    expect(entry.note).toBe('E2E test manual fix');

    // 2. List attendance logs
    const list = await api<any[]>('/hr/attendance');
    const found = list.find(e => e.id === entry.id);
    expect(found).toBeDefined();
    expect(found.user.name).toBeDefined();

    // 3. Update attendance log
    const updated = await api<any>(`/hr/attendance/${entry.id}`, {
      method: 'PATCH',
      body: {
        note: 'E2E test manual fix edited'
      }
    });
    expect(updated.note).toBe('E2E test manual fix edited');

    // 4. Delete attendance log
    await api(`/hr/attendance/${entry.id}`, { method: 'DELETE' });

    const list2 = await api<any[]>('/hr/attendance');
    expect(list2.find(e => e.id === entry.id)).toBeUndefined();
  });

  it('3. should post HR transactions and generate journal entries', async () => {
    // 1. Create a Solfah (Advance)
    const tx = await api<any>('/hr/transactions', {
      method: 'POST',
      body: {
        staffId: staffMemberId,
        type: 'ADVANCE',
        amountCents: 100000, // 1000 EGP
        notes: 'June Solfa Test',
        paymentMethod: 'cash'
      }
    });

    expect(tx.id).toBeDefined();
    expect(tx.type).toBe('ADVANCE');
    expect(tx.amountCents).toBe(100000);
    expect(tx.journalEntryId).toBeDefined();

    // Verify bookkeeping entries: debit Salaries (5210) and credit Cash safe (1110)
    const entries = await api<any[]>('/accounting/journal-entries');
    const journalEntry = entries.find(e => e.id === tx.journalEntryId);
    expect(journalEntry).toBeDefined();
    expect(journalEntry.lines.length).toBe(2);

    const debitLine = journalEntry.lines.find((l: any) => l.debitCents === 100000);
    const creditLine = journalEntry.lines.find((l: any) => l.creditCents === 100000);
    expect(debitLine).toBeDefined();
    expect(creditLine).toBeDefined();

    // 2. Fetch staff payroll summary
    const summary = await api<any[]>('/hr/staff');
    const staffSum = summary.find(s => s.id === staffMemberId);
    expect(staffSum).toBeDefined();
    expect(staffSum.advancesCents).toBeGreaterThanOrEqual(100000);

    // 3. Void/Delete the Solfah transaction
    const delRes = await api<any>(`/hr/transactions/${tx.id}`, { method: 'DELETE' });
    expect(delRes.success).toBe(true);

    // Verify journal entry deleted
    const entriesAfter = await api<any[]>('/accounting/journal-entries');
    expect(entriesAfter.find(e => e.id === tx.journalEntryId)).toBeUndefined();
  });
});
