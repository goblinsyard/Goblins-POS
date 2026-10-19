/**
 * Regression tests for the Oct-2026 audit fixes:
 *  - discounts can't touch closed orders or items from another order
 *  - orders with item-level discounts still post a balanced journal entry
 *  - changing quantity keeps an item discount
 *  - non-managers don't receive credential settings
 * Runs against a live API + DB (same as the other specs).
 */
import { beforeAll, describe, expect, it } from 'vitest';

const BASE = process.env.API_URL ?? 'http://localhost:3000';

async function call(token: string, path: string, method = 'GET', body?: unknown) {
  const res = await fetch(`${BASE}/api${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: body != null ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

async function pinLogin(roleName: string, pin: string): Promise<string> {
  const users = await (await fetch(`${BASE}/api/auth/pin-users`)).json();
  const u = users.find((x: { role: { name: string } }) => x.role.name === roleName);
  const res = await fetch(`${BASE}/api/auth/login/pin`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userId: u.id, pin }),
  });
  return (await res.json()).accessToken;
}

let owner = '';
let itemId = '';
let cashId = '';

async function newTakeawayWithItem(qty = 1) {
  const order = (await call(owner, '/orders', 'POST', { type: 'TAKEAWAY' })).body;
  const withItem = (await call(owner, `/orders/${order.id}/items`, 'POST', { items: [{ itemId, quantity: qty }] })).body;
  return withItem;
}

describe('discount + accounting integrity', () => {
  beforeAll(async () => {
    owner = await pinLogin('Owner', '9999');
    const shift = (await call(owner, '/shifts/current')).body;
    if (!shift?.id) await call(owner, '/shifts/open', 'POST', { floatCents: 0 });
    const cats = (await call(owner, '/menu')).body as { items?: { id: string; priceCents: number; is86ed: boolean }[] }[];
    itemId = cats.flatMap((c) => c.items ?? []).find((i) => i.priceCents >= 5000 && !i.is86ed)!.id;
    const methods = (await call(owner, '/payment-methods')).body as { id: string; kind: string }[];
    cashId = methods.find((m) => m.kind === 'CASH')!.id;
  });

  it('posts a balanced journal entry for an order with an item-level discount', async () => {
    const order = await newTakeawayWithItem();
    const discounted = (await call(owner, `/orders/${order.id}/discount`, 'POST', {
      kind: 'PERCENT', value: 1000, reasonCode: 'test', orderItemId: order.items[0].id,
    })).body;
    const pay = await call(owner, `/orders/${order.id}/pay`, 'POST', {
      payments: [{ methodId: cashId, amountCents: discounted.totalCents }],
    });
    expect(pay.status).toBe(201);

    const entries = (await call(owner, '/accounting/journal-entries')).body;
    const list = Array.isArray(entries) ? entries : entries.items ?? entries.data ?? [];
    const mine = list.filter((e: { reference?: string }) => e.reference === `Order #${order.id}`);
    expect(mine).toHaveLength(1);
    const lines = mine[0].lines as { debitCents: number; creditCents: number }[];
    const debit = lines.reduce((a, l) => a + l.debitCents, 0);
    const credit = lines.reduce((a, l) => a + l.creditCents, 0);
    expect(debit).toBe(credit);
    expect(debit).toBe(discounted.totalCents);
  });

  it('rejects discounts on a paid order', async () => {
    const order = await newTakeawayWithItem();
    await call(owner, `/orders/${order.id}/pay`, 'POST', { payments: [{ methodId: cashId, amountCents: order.totalCents }] });
    const res = await call(owner, `/orders/${order.id}/discount`, 'POST', { kind: 'FIXED', value: 100, reasonCode: 'test' });
    expect(res.status).toBe(400);
    const after = (await call(owner, `/orders/${order.id}`)).body;
    expect(after.totalCents).toBe(order.totalCents);
  });

  it('rejects discounting an item that belongs to another order', async () => {
    const a = await newTakeawayWithItem();
    const b = await newTakeawayWithItem();
    const res = await call(owner, `/orders/${a.id}/discount`, 'POST', {
      kind: 'PERCENT', value: 10000, reasonCode: 'test', orderItemId: b.items[0].id,
    });
    expect(res.status).toBe(400);
    await call(owner, `/orders/${a.id}/void`, 'POST', { reason: 'test cleanup' });
    await call(owner, `/orders/${b.id}/void`, 'POST', { reason: 'test cleanup' });
  });

  it('keeps an item discount when quantity changes', async () => {
    const order = await newTakeawayWithItem();
    const line = order.items[0];
    await call(owner, `/orders/${order.id}/discount`, 'POST', {
      kind: 'PERCENT', value: 5000, reasonCode: 'test', orderItemId: line.id,
    });
    const after = (await call(owner, `/orders/${order.id}/items/${line.id}/quantity`, 'POST', { quantity: 2 })).body;
    const updated = after.items.find((i: { id: string }) => i.id === line.id);
    const gross = line.unitCents * 2 + line.modifiersCents * 2;
    expect(updated.discountCents).toBe(Math.round(gross / 2));
    expect(updated.lineCents).toBe(gross - updated.discountCents);
    await call(owner, `/orders/${order.id}/void`, 'POST', { reason: 'test cleanup' });
  });

  it('hides credential settings from non-managers', async () => {
    const waiter = await pinLogin('Waiter', '3333');
    const forWaiter = (await call(waiter, '/settings')).body;
    expect(Object.keys(forWaiter).some((k) => /twilio\.(authToken|accountSid)/.test(k))).toBe(false);
    const forOwner = (await call(owner, '/settings')).body;
    expect('twilio.authToken' in forOwner).toBe(true);
  });
});
