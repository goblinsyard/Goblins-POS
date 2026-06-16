/**
 * DoD #2 â€” FULL HAPPY PATH, end to end over HTTP:
 * open shift â†’ seat table â†’ order w/ modifiers â†’ correct KDS station â†’
 * bump to ready â†’ billiards session AND PS session â†’ drinks attached to PS â†’
 * stop sessions â†’ split one bill â†’ pay another mixed cash+card â†’ receipts â†’
 * stock deducted per recipes â†’ close shift with correct Z totals.
 *
 * Requires the API + DB running (docker compose up db; pnpm dev).
 */
import { beforeAll, describe, expect, it } from 'vitest';

const BASE = process.env.API_URL ?? 'http://localhost:3000';
let token = '';

async function api<T>(path: string, options: { method?: string; body?: unknown } = {}): Promise<T> {
  const res = await fetch(`${BASE}/api${path}`, {
    method: options.method ?? 'GET',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: options.body != null ? JSON.stringify(options.body) : undefined,
  });
  if (!res.ok) throw new Error(`${res.status} ${path}: ${JSON.stringify(await res.json().catch(() => ({})))}`);
  const text = await res.text();
  if (!text) return null as T;
  return JSON.parse(text) as T;
}

interface Order {
  id: string; number: number; status: string; totalCents: number; paidCents: number;
  subtotalCents: number;
  items: { id: string; description: string; lineCents: number; isTimeCharge: boolean; status: string }[];
}
interface Ticket { id: string; status: string; stationId: string; station: { name: string } }

let cashId = '', cardId = '';
let shiftId = '';
const totals: number[] = []; // every total we pay, to check the Z report

describe('E2E happy path (DoD #2)', () => {
  let tableId = '', billiardsId = '', psId = '';
  let burgerId = '', mojitoId = '', colaId = '', extraCheeseId = '';
  let mojitoBaseBarQty = 0;
  let barLocationId = '';

  beforeAll(async () => {
    const users = await api<{ id: string; role: { name: string } }[]>('/auth/pin-users');
    const mgr = users.find((u) => u.role.name === 'Manager')!;
    token = (await api<{ accessToken: string }>('/auth/login/pin', {
      method: 'POST', body: { userId: mgr.id, pin: '1111' },
    })).accessToken;

    // close any stale shift so Z totals are exactly ours
    const stale = await api<{ id: string; floatCents: number } | null>('/shifts/current');
    if (stale) {
      const open = await api<Order[]>('/orders/open');
      for (const o of open) {
        for (const i of o.items.filter((x) => x.status !== 'VOIDED')) {
          await api(`/orders/${o.id}/void-item`, { method: 'POST', body: { orderItemId: i.id, reason: 'e2e cleanup' } });
        }
        await api(`/orders/${o.id}/void`, { method: 'POST', body: { reason: 'e2e cleanup' } });
      }
      const x = await api<{ cash: { expectedCents: number } }>(`/shifts/${stale.id}/x-report`);
      await api(`/shifts/${stale.id}/close`, { method: 'POST', body: { countedCents: x.cash.expectedCents } });
    }

    const methods = await api<{ id: string; kind: string }[]>('/payment-methods');
    cashId = methods.find((m) => m.kind === 'CASH')!.id;
    cardId = methods.find((m) => m.kind === 'CARD')!.id;
  });

  it('1. opens a shift with a 500 EGP float', async () => {
    const shift = await api<{ id: string }>('/shifts/open', { method: 'POST', body: { floatCents: 50000 } });
    shiftId = shift.id;
    expect(shiftId).toBeTruthy();
  });

  it('2. loads floor & menu, finds free resources', async () => {
    interface Zone { name: string; resources: { id: string; name: string; orders: unknown[]; sessions: unknown[] }[] }
    const floor = await api<Zone[]>('/floor');
    const free = (z: string) => floor.find((x) => x.name === z)!.resources.find((r) => !r.orders.length && !r.sessions.length)!;
    tableId = free('Main hall').id;
    billiardsId = free('Billiards lounge').id;
    psId = free('PS rooms').id;

    interface Cat { name: string; items: { id: string; name: string; modifierGroups: { group: { name: string; modifiers: { id: string; name: string }[] } }[] }[] }
    const menu = await api<Cat[]>('/menu');
    const find = (cat: string, item: string) => menu.find((c) => c.name === cat)!.items.find((i) => i.name === item)!;
    const burger = find('Burgers', 'Classic Goblin Burger');
    burgerId = burger.id;
    extraCheeseId = burger.modifierGroups
      .flatMap((g) => g.group.modifiers).find((m) => m.name === 'Extra cheese')!.id;
    mojitoId = find('Mocktails', 'Virgin Mojito').id;
    colaId = find('Soft drinks', 'Cola').id;
    expect(tableId && billiardsId && psId && burgerId).toBeTruthy();
  });

  it('3. snapshots bar stock of the mojito-base intermediate', async () => {
    const locs = await api<{ id: string; name: string }[]>('/inventory/locations');
    barLocationId = locs.find((l) => l.name === 'Bar')!.id;
    const readQty = async () => {
      const levels = await api<{ ingredientId: string; quantity: string; ingredient: { name: string } }[]>(
        `/inventory/levels?locationId=${barLocationId}`,
      );
      return Number(levels.find((l) => l.ingredient.name.startsWith('Mojito base'))?.quantity ?? 0);
    };
    mojitoBaseBarQty = await readQty();
    // each run consumes 400 ml — replenish via a production batch so the test is rerunnable
    if (mojitoBaseBarQty <= 200) {
      const recipes = await api<{ id: string; name: string }[]>('/inventory/production/recipes');
      const mojitoRecipe = recipes.find((r) => r.name.startsWith('Mojito base'))!;
      await api('/inventory/production', {
        method: 'POST',
        body: { processId: mojitoRecipe.id, batchQty: 2000, notes: 'e2e replenish' },
      });
      mojitoBaseBarQty = await readQty();
    }
    expect(mojitoBaseBarQty).toBeGreaterThan(200);
  });

  let dineInId = '';
  it('4. seats a table, orders burger w/ extra cheese + 2 mojitos', async () => {
    const order = await api<Order>('/orders', { method: 'POST', body: { type: 'DINE_IN', resourceId: tableId, guestCount: 2 } });
    dineInId = order.id;
    const updated = await api<Order>(`/orders/${dineInId}/items`, {
      method: 'POST',
      body: { items: [
        { itemId: burgerId, quantity: 1, modifierIds: [extraCheeseId], notes: 'no pickles' },
        { itemId: mojitoId, quantity: 2 },
      ] },
    });
    // burger 180+15 + mojito 85*2 = 365 subtotal
    expect(updated.subtotalCents).toBe(36500);

    const history = await api<any[]>('/orders/history');
    const mine = history.find((h) => h.id === dineInId);
    expect(mine).toBeDefined();
    expect(mine!.status).toBe('OPEN');
  });

  it('5. sends to kitchen â€” items land on the CORRECT stations', async () => {
    const tickets = await api<Ticket[]>(`/kds/orders/${dineInId}/send`, { method: 'POST' });
    expect(tickets).toHaveLength(2);
    const stations = tickets.map((t) => t.station.name).sort();
    expect(stations).toEqual(['Bar', 'Kitchen']); // burger â†’ kitchen, mojitos â†’ bar
  });

  it('6. bumps the kitchen ticket to READY', async () => {
    interface Station { id: string; name: string }
    const stations = await api<Station[]>('/kds/stations');
    const kitchen = stations.find((s) => s.name === 'Kitchen')!;
    const tickets = await api<Ticket[]>(`/kds/stations/${kitchen.id}/tickets`);
    const mine = tickets.find((t) => t.status === 'NEW')!;
    await api(`/kds/tickets/${mine.id}/bump`, { method: 'POST' }); // IN_PROGRESS
    const ready = await api<Ticket>(`/kds/tickets/${mine.id}/bump`, { method: 'POST' });
    expect(ready.status).toBe('READY');
  });

  let billiardsOrderId = '', billiardsSessionId = '';
  let psOrderId = '', psSessionId = '';
  it('7. starts a billiards session AND a PS room session', async () => {
    const bo = await api<Order>('/orders', { method: 'POST', body: { type: 'BILLIARDS', resourceId: billiardsId } });
    billiardsOrderId = bo.id;
    const bs = await api<{ id: string }>('/sessions/start', { method: 'POST', body: { orderId: bo.id, isMultiplayer: false } });
    billiardsSessionId = bs.id;

    const po = await api<Order>('/orders', { method: 'POST', body: { type: 'PS_ROOM', resourceId: psId } });
    psOrderId = po.id;
    const ps = await api<{ id: string }>('/sessions/start', { method: 'POST', body: { orderId: po.id, isMultiplayer: true } });
    psSessionId = ps.id;
    expect(billiardsSessionId && psSessionId).toBeTruthy();
  });

  it('8. attaches drinks to the PS session order', async () => {
    const updated = await api<Order>(`/orders/${psOrderId}/items`, {
      method: 'POST', body: { items: [{ itemId: colaId, quantity: 2 }] },
    });
    expect(updated.items.some((i) => i.description === 'Cola')).toBe(true);
  });

  it('9. stops both sessions â€” combined bills get time charges', async () => {
    await api(`/sessions/${billiardsSessionId}/stop`, { method: 'POST' });
    await api(`/sessions/${psSessionId}/stop`, { method: 'POST' });
    const bo = await api<Order>(`/orders/${billiardsOrderId}`);
    const po = await api<Order>(`/orders/${psOrderId}`);
    expect(bo.items.some((i) => i.isTimeCharge)).toBe(true);
    expect(po.items.some((i) => i.isTimeCharge)).toBe(true);
    // short sessions bill the configured minimums (billiards 30, PS 20 EGP)
    expect(bo.items.find((i) => i.isTimeCharge)!.lineCents).toBe(3000);
    expect(po.items.find((i) => i.isTimeCharge)!.lineCents).toBe(2000);
  });

  it('10. splits the dine-in bill by items', async () => {
    const order = await api<Order>(`/orders/${dineInId}`);
    const mojitoLine = order.items.find((i) => i.description === 'Virgin Mojito')!;
    const split = await api<{ source: Order; child: Order }>(`/orders/${dineInId}/split`, {
      method: 'POST', body: { orderItemIds: [mojitoLine.id] },
    });
    expect(split.child.items ?? []).toBeDefined();
    // child should carry the 2 mojitos = 170 subtotal
    const child = await api<Order>(`/orders/${split.child.id}`);
    expect(child.subtotalCents).toBe(17000);
    // pay the child fully in cash
    await payFully(child.id, 'cash');
  });

  it('11. pays the remaining dine-in with MIXED cash + card', async () => {
    const order = await api<Order>(`/orders/${dineInId}`);
    const due = order.totalCents - order.paidCents;
    const half = Math.floor(due / 2);
    const res = await api<{ fullyPaid: boolean }>(`/orders/${dineInId}/pay`, {
      method: 'POST',
      body: { payments: [
        { methodId: cashId, amountCents: half, tenderedCents: half },
        { methodId: cardId, amountCents: due - half, reference: 'E2E-AUTH' },
      ] },
    });
    expect(res.fullyPaid).toBe(true);
    totals.push(order.totalCents);
  });

  it('12. pays both session bills; receipts render', async () => {
    await payFully(billiardsOrderId, 'cash');
    await payFully(psOrderId, 'cash');
    for (const id of [dineInId, billiardsOrderId, psOrderId]) {
      const receipt = await api<{ text: string }>(`/orders/${id}/receipt`);
      expect(receipt.text).toContain('TOTAL');
      expect(receipt.text).toContain('Goblins Yard');
    }
  });

  it('13. stock was deducted per recipes (mojito base âˆ’400 ml for 2 mojitos)', async () => {
    const levels = await api<{ ingredientId: string; quantity: string; ingredient: { name: string } }[]>(
      `/inventory/levels?locationId=${barLocationId}`,
    );
    const now = Number(levels.find((l) => l.ingredient.name.startsWith('Mojito base'))?.quantity ?? 0);
    expect(mojitoBaseBarQty - now).toBeCloseTo(400, 1); // 2 Ã— 200 ml
  });

  it('14. closes the shift â€” Z report totals match what we paid', async () => {
    const x = await api<{ grossCents: number; orderCount: number; cash: { expectedCents: number } }>(
      `/shifts/${shiftId}/x-report`,
    );
    const sum = totals.reduce((a, b) => a + b, 0);
    expect(x.grossCents).toBe(sum);
    expect(x.orderCount).toBe(4); // child split + dine-in + billiards + PS

    const z = await api<{ zReport: { varianceCents: number; grossCents: number } }>(`/shifts/${shiftId}/close`, {
      method: 'POST', body: { countedCents: x.cash.expectedCents },
    });
    expect(z.zReport.varianceCents).toBe(0);
    expect(z.zReport.grossCents).toBe(sum);
  });

  it('15. lists shifts and fetches details for the closed shift', async () => {
    const list = await api<{ id: string; status: string }[]>('/shifts');
    expect(list.length).toBeGreaterThan(0);
    const found = list.find((s) => s.id === shiftId);
    expect(found).toBeDefined();
    expect(found!.status).toBe('CLOSED');

    const details = await api<{ shift: { status: string }; report: { grossCents: number } }>(`/shifts/${shiftId}/details`);
    expect(details.shift.status).toBe('CLOSED');
    expect(details.report.grossCents).toBe(totals.reduce((a, b) => a + b, 0));
  });
});

async function payFully(orderId: string, kind: 'cash' | 'card') {
  const order = await api<Order>(`/orders/${orderId}`);
  const due = order.totalCents - order.paidCents;
  if (due <= 0) return;
  await api(`/orders/${orderId}/pay`, {
    method: 'POST',
    body: { payments: [{ methodId: kind === 'cash' ? cashId : cardId, amountCents: due, ...(kind === 'cash' ? { tenderedCents: due } : {}) }] },
  });
  totals.push(order.totalCents);
}
