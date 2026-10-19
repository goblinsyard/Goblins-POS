/**
 * Delivery channels and online booking (Oct-2026). Runs against a live API + DB
 * like the other specs. Settings changed here are restored afterwards.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const BASE = process.env.API_URL ?? 'http://localhost:3000';
let owner = '';
let itemId = '';
let original: Record<string, unknown> = {};

async function call(path: string, method = 'GET', body?: unknown, headers: Record<string, string> = {}) {
  const res = await fetch(`${BASE}/api${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(owner ? { Authorization: `Bearer ${owner}` } : {}), ...headers },
    body: body != null ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

const cairoDate = (offsetDays = 0) => {
  const d = new Date(Date.now() + offsetDays * 86_400_000);
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Cairo' }).format(d);
};

describe('delivery channels', () => {
  beforeAll(async () => {
    const users = await (await fetch(`${BASE}/api/auth/pin-users`)).json();
    const o = users.find((u: { role: { name: string } }) => u.role.name === 'Owner');
    owner = (await (await fetch(`${BASE}/api/auth/login/pin`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ userId: o.id, pin: '9999' }),
    })).json()).accessToken;
    original = (await call('/settings')).body;
    if (!(await call('/shifts/current')).body?.id) await call('/shifts/open', 'POST', { floatCents: 0 });
    type Row = { id: string; priceCents: number; is86ed: boolean; name: string; modifierGroups?: unknown[] };
    const cats = (await call('/menu')).body as { items?: Row[] }[];
    const item = cats.flatMap((c) => c.items ?? []).find((i) => i.priceCents >= 5000 && !i.is86ed && !(i.modifierGroups ?? []).length)!;
    itemId = item.id;
  });

  afterAll(async () => {
    await call('/settings', 'PUT', {
      'delivery.commissionBps.TALABAT': original['delivery.commissionBps.TALABAT'] ?? 0,
      'integration.TALABAT.apiKey': original['integration.TALABAT.apiKey'] ?? '',
    });
  });

  it('delivery orders carry the channel and never get a service charge', async () => {
    const ref = `T-${Date.now()}`;
    const order = (await call('/orders', 'POST', { type: 'DELIVERY', channel: 'TALABAT', externalRef: ref })).body;
    const withItem = (await call(`/orders/${order.id}/items`, 'POST', { items: [{ itemId, quantity: 1 }] })).body;
    expect(withItem.channel).toBe('TALABAT');
    expect(withItem.serviceChargeCents).toBe(0);
    const dup = await call('/orders', 'POST', { type: 'DELIVERY', channel: 'TALABAT', externalRef: ref });
    expect(dup.status).toBe(400);
    await call(`/orders/${order.id}/void`, 'POST', { reason: 'test cleanup' });
  });

  it('only delivery orders can come from an app', async () => {
    const res = await call('/orders', 'POST', { type: 'TAKEAWAY', channel: 'TALABAT' });
    expect(res.status).toBe(400);
  });

  it('the app integration needs the right key and is idempotent', async () => {
    await call('/settings', 'PUT', { 'integration.TALABAT.apiKey': 'spec-key-0123456789' });
    const cats = (await call('/menu')).body as { items?: { id: string; name: string }[] }[];
    const name = cats.flatMap((c) => c.items ?? []).find((i) => i.id === itemId)!.name;
    const body = { externalRef: `PUSH-${Date.now()}`, items: [{ name, quantity: 1 }] };
    expect((await call('/integrations/talabat/orders', 'POST', body, { 'X-Api-Key': 'wrong' })).status).toBe(401);
    const first = await call('/integrations/talabat/orders', 'POST', body, { 'X-Api-Key': 'spec-key-0123456789' });
    expect(first.status).toBe(201);
    const again = await call('/integrations/talabat/orders', 'POST', body, { 'X-Api-Key': 'spec-key-0123456789' });
    expect(again.body.duplicate).toBe(true);
    expect(again.body.orderId).toBe(first.body.orderId);
    await call(`/orders/${first.body.orderId}/void`, 'POST', { reason: 'test cleanup' });
  });
});

describe('online booking', () => {
  const created: string[] = [];
  afterAll(async () => {
    const timeline = (await call('/reservations/timeline')).body as { id: string; bookingCode?: string }[];
    for (const r of timeline.filter((t) => t.bookingCode && created.includes(t.bookingCode))) {
      await call(`/reservations/${r.id}/status/cancelled`, 'POST');
    }
  });

  it('publishes config without secrets', async () => {
    const cfg = (await call('/reservations/public/config')).body;
    expect(cfg.types.length).toBeGreaterThan(0);
    expect(JSON.stringify(cfg)).not.toMatch(/twilio|apiKey|authToken/i);
  });

  it('books, blocks the slot, and confirms the deposit', async () => {
    const cfg = (await call('/reservations/public/config')).body;
    const type = cfg.types.find((t: { count: number }) => t.count > 0).type;
    const date = cairoDate(3);
    const booked = await call('/reservations/public/book', 'POST', {
      type, date, time: cfg.openTime, durationMinutes: 60, name: 'Spec Guest', phone: '01099999999', partySize: 2,
    });
    expect(booked.status).toBe(201);
    created.push(booked.body.code);

    const avail = (await call(`/reservations/public/availability?date=${date}&type=${type}`)).body;
    const busy = avail.resources.flatMap((r: { busy: unknown[] }) => r.busy);
    expect(busy.length).toBeGreaterThan(0);

    if (booked.body.depositCents > 0) {
      const timeline = (await call(`/reservations/timeline?to=${new Date(Date.now() + 5 * 86_400_000).toISOString()}`)).body;
      const r = timeline.find((t: { bookingCode?: string }) => t.bookingCode === booked.body.code);
      const ok = await call(`/reservations/${r.id}/deposit-received`, 'POST', { reference: 'SPEC-REF' });
      expect(ok.status).toBe(201);
      const status = (await call(`/reservations/public/booking/${booked.body.code}`)).body;
      expect(status.status).toBe('CONFIRMED');
      expect(status.depositStatus).toBe('RECEIVED');
    }
  });

  it('rejects invalid phone numbers', async () => {
    const res = await call('/reservations/public/book', 'POST', {
      date: cairoDate(3), time: '20:00', durationMinutes: 60, name: 'X Y', phone: '12345', partySize: 2,
    });
    expect(res.status).toBe(400);
  });
});
