/**
 * Tapping the same item again grows one line instead of adding cards (Oct-2026),
 * but never merges into a line that is already in the kitchen or differs.
 */
import { beforeAll, describe, expect, it } from 'vitest';

const BASE = process.env.API_URL ?? 'http://localhost:3000';
let token = '';

async function api<T = any>(path: string, method = 'GET', body?: unknown): Promise<T> {
  const res = await fetch(`${BASE}/api${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: body != null ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${res.status} ${text}`);
  return (text ? JSON.parse(text) : null) as T;
}

describe('same item merges into one line', () => {
  let itemId = '';
  beforeAll(async () => {
    const users = await (await fetch(`${BASE}/api/auth/pin-users`)).json();
    const o = users.find((u: { role: { name: string } }) => u.role.name === 'Owner');
    token = (await (await fetch(`${BASE}/api/auth/login/pin`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ userId: o.id, pin: '9999' }),
    })).json()).accessToken;
    if (!(await api('/shifts/current'))?.id) await api('/shifts/open', 'POST', { floatCents: 0 });
    const cats = await api<{ items?: { id: string; is86ed: boolean; modifierGroups?: unknown[] }[] }[]>('/menu');
    itemId = cats.flatMap((c) => c.items ?? []).find((i) => !i.is86ed && !(i.modifierGroups ?? []).length)!.id;
  });

  it('merges pending taps, keeps sent and noted lines separate', async () => {
    const order = await api('/orders', 'POST', { type: 'TAKEAWAY' });
    await api(`/orders/${order.id}/items`, 'POST', { items: [{ itemId, quantity: 1 }] });
    let o = await api(`/orders/${order.id}/items`, 'POST', { items: [{ itemId, quantity: 1 }] });
    expect(o.items).toHaveLength(1);
    expect(Number(o.items[0].quantity)).toBe(2);
    expect(o.items[0].lineCents).toBe(o.items[0].unitCents * 2);

    o = await api(`/orders/${order.id}/items`, 'POST', { items: [{ itemId, quantity: 1, notes: 'no sugar' }] });
    expect(o.items).toHaveLength(2);

    await api(`/kds/orders/${order.id}/send`, 'POST');
    o = await api(`/orders/${order.id}/items`, 'POST', { items: [{ itemId, quantity: 1 }] });
    expect(o.items).toHaveLength(3); // the kitchen must get a new ticket for the extra one

    await api(`/orders/${order.id}/void`, 'POST', { reason: 'test cleanup' });
  });
});
