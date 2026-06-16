/**
 * DoD #6: a customer earns and redeems loyalty points across two visits.
 *
 * Integration test over HTTP â€” requires the API (and DB) to be running.
 * Earn rate (Goblin tier): 100 bps = 1 point per 100 EGP spent.
 * Redeem rate: 1 point = 1 EGP (100 piasters).
 */
import { beforeAll, describe, expect, it } from 'vitest';

const BASE = process.env.API_URL ?? 'http://localhost:3000';
let token = '';
let cashMethodId = '';

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

interface Order { id: string; totalCents: number; paidCents: number }

async function payFully(orderId: string) {
  const order = await api<Order>(`/orders/${orderId}`);
  const due = order.totalCents - order.paidCents;
  if (due > 0) {
    await api(`/orders/${orderId}/pay`, {
      method: 'POST',
      body: { payments: [{ methodId: cashMethodId, amountCents: due, tenderedCents: due }] },
    });
  }
}

describe('loyalty earn + redeem across two visits (DoD #6)', () => {
  let customerId = '';
  let itemId = '';

  beforeAll(async () => {
    const users = await api<{ id: string; role: { name: string } }[]>('/auth/pin-users');
    const mgr = users.find((u) => u.role.name === 'Manager')!;
    const auth = await api<{ accessToken: string }>('/auth/login/pin', {
      method: 'POST', body: { userId: mgr.id, pin: '1111' },
    });
    token = auth.accessToken;

    const shift = await api<{ id: string } | null>('/shifts/current');
    if (!shift) await api('/shifts/open', { method: 'POST', body: { floatCents: 50000 } });

    const methods = await api<{ id: string; kind: string }[]>('/payment-methods');
    cashMethodId = methods.find((m) => m.kind === 'CASH')!.id;

    const menu = await api<{ name: string; items: { id: string; name: string; priceCents: number }[] }[]>('/menu');
    // Double Trouble Burger: 250 EGP â†’ earns 2 pts (1 pt / 100 EGP, floor)
    itemId = menu.flatMap((c) => c.items).find((i) => i.name === 'Double Trouble Burger')!.id;

    const phone = `+2010${Date.now() % 100000000}`;
    const customer = await api<{ id: string }>('/crm/customers', {
      method: 'POST', body: { phone, name: 'Loyalty Test Customer' },
    });
    customerId = customer.id;
  });

  it('visit 1: earns points on a paid order', async () => {
    const order = await api<Order>('/orders', {
      method: 'POST', body: { type: 'TAKEAWAY', customerId },
    });
    await api(`/orders/${order.id}/items`, {
      method: 'POST', body: { items: [{ itemId, quantity: 1 }] },
    });
    await payFully(order.id);

    const customer = await api<{ pointsBalance: number; visitCount: number; lifetimeCents: number }>(
      `/crm/customers/${customerId}`,
    );
    // takeaway: no service charge â†’ total = 250 * 1.14 = 285 EGP â†’ floor(285/100) = 2 points
    expect(customer.pointsBalance).toBe(2);
    expect(customer.visitCount).toBe(1);
    expect(customer.lifetimeCents).toBeGreaterThan(25000);
  });

  it('visit 2: redeems points as payment credit, then pays the rest', async () => {
    const order = await api<Order>('/orders', {
      method: 'POST', body: { type: 'TAKEAWAY', customerId },
    });
    const withItems = await api<Order>(`/orders/${order.id}/items`, {
      method: 'POST', body: { items: [{ itemId, quantity: 1 }] },
    });

    const redeem = await api<{ creditCents: number; remainingPoints: number }>('/crm/redeem', {
      method: 'POST', body: { customerId, points: 2, orderId: order.id },
    });
    expect(redeem.creditCents).toBe(200); // 2 pts = 2 EGP
    expect(redeem.remainingPoints).toBe(0);

    await payFully(order.id);
    const final = await api<Order & { status: string }>(`/orders/${order.id}`);
    expect(final.status).toBe('PAID');
    expect(final.paidCents).toBe(withItems.totalCents);

    const customer = await api<{ pointsBalance: number; visitCount: number }>(`/crm/customers/${customerId}`);
    expect(customer.visitCount).toBe(2);
    // earned again on visit 2 (2 pts), redeemed 2 â†’ balance 2
    expect(customer.pointsBalance).toBe(2);
  });

  it('rejects redeeming more points than the balance', async () => {
    const order = await api<Order>('/orders', { method: 'POST', body: { type: 'TAKEAWAY', customerId } });
    await api(`/orders/${order.id}/items`, { method: 'POST', body: { items: [{ itemId, quantity: 1 }] } });
    await expect(
      api('/crm/redeem', { method: 'POST', body: { customerId, points: 9999, orderId: order.id } }),
    ).rejects.toThrow(/Insufficient points/);
    // cleanup: pay it so shift can close
    await payFully(order.id);
  });
});
