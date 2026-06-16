import { beforeAll, describe, expect, it } from 'vitest';

const BASE = process.env.API_URL ?? 'http://localhost:3000';
let managerToken = '';
let cashierToken = '';
let managerPin = '1111'; // from seed
let cashierPin = '2222'; // from seed

async function api<T>(path: string, options: { method?: string; body?: unknown; token?: string } = {}): Promise<T> {
  const currentToken = options.token ?? managerToken;
  const res = await fetch(`${BASE}/api${path}`, {
    method: options.method ?? 'GET',
    headers: {
      'Content-Type': 'application/json',
      ...(currentToken ? { Authorization: `Bearer ${currentToken}` } : {}),
    },
    body: options.body != null ? JSON.stringify(options.body) : undefined,
  });
  if (!res.ok) throw new Error(`${res.status} ${path}: ${JSON.stringify(await res.json().catch(() => ({})))}`);
  const text = await res.text();
  if (!text) return null as T;
  return JSON.parse(text) as T;
}

interface Order {
  id: string;
  number: number;
  status: string;
  subtotalCents: number;
  serviceChargeCents: number;
  taxCents: number;
  totalCents: number;
  noService: boolean;
  noVat: boolean;
  items: {
    id: string;
    description: string;
    quantity: string;
    unitCents: number;
    lineCents: number;
    status: string;
    notes?: string | null;
  }[];
}

describe('POS Service/VAT Overrides, Item Notes, and Qty Updates E2E', () => {
  let orderId = '';
  let itemId = ''; // burger ID
  let orderItemId = '';

  beforeAll(async () => {
    // 1. Get tokens
    const users = await api<{ id: string; role: { name: string } }[]>('/auth/pin-users', { token: '' });
    const mgr = users.find((u) => u.role.name === 'Manager')!;
    const cash = users.find((u) => u.role.name === 'Cashier')!;

    managerToken = (await api<{ accessToken: string }>('/auth/login/pin', {
      method: 'POST', body: { userId: mgr.id, pin: managerPin }, token: '',
    })).accessToken;

    cashierToken = (await api<{ accessToken: string }>('/auth/login/pin', {
      method: 'POST', body: { userId: cash.id, pin: cashierPin }, token: '',
    })).accessToken;

    // Ensure we have a current open shift
    const currentShift = await api<any>('/shifts/current');
    if (!currentShift) {
      await api('/shifts/open', { method: 'POST', body: { floatCents: 50000 } });
    }

    // Get a menu item
    const menu = await api<any[]>('/menu');
    const burger = menu.find((c) => c.name === 'Burgers')!.items[0];
    itemId = burger.id;
  });

  it('creates an order and adds a burger', async () => {
    const order = await api<Order>('/orders', {
      method: 'POST',
      body: { type: 'DINE_IN' },
    });
    orderId = order.id;
    expect(orderId).toBeTruthy();

    const updated = await api<Order>(`/orders/${orderId}/items`, {
      method: 'POST',
      body: { items: [{ itemId, quantity: 1 }] },
    });
    expect(updated.items).toHaveLength(1);
    orderItemId = updated.items[0].id;
    expect(orderItemId).toBeTruthy();
    expect(updated.noService).toBe(false);
    expect(updated.noVat).toBe(false);
    expect(updated.serviceChargeCents).toBeGreaterThan(0);
    expect(updated.taxCents).toBeGreaterThan(0);
  });

  it('updates item note', async () => {
    const noteText = 'No onions, extra sauce';
    const updated = await api<Order>(`/orders/${orderId}/items/${orderItemId}/note`, {
      method: 'POST',
      body: { notes: noteText },
    });
    const item = updated.items.find((i) => i.id === orderItemId)!;
    expect(item.notes).toBe(noteText);
  });

  it('updates pending item quantity', async () => {
    const updated = await api<Order>(`/orders/${orderId}/items/${orderItemId}/quantity`, {
      method: 'POST',
      body: { quantity: 3 },
    });
    const item = updated.items.find((i) => i.id === orderItemId)!;
    expect(Number(item.quantity)).toBe(3);
  });

  it('increases quantity of sent item (creates new pending item)', async () => {
    // Send to KDS/kitchen
    await api(`/kds/orders/${orderId}/send`, { method: 'POST' });

    // Verify item is now SENT
    let order = await api<Order>(`/orders/${orderId}`);
    let item = order.items.find((i) => i.id === orderItemId)!;
    expect(item.status).toBe('SENT');

    // Increase quantity from 3 to 5 (added 2)
    order = await api<Order>(`/orders/${orderId}/items/${orderItemId}/quantity`, {
      method: 'POST',
      body: { quantity: 5 },
    });

    // Should now have two items: the sent one (qty 3) and a new pending one (qty 2)
    expect(order.items).toHaveLength(2);
    const sentItem = order.items.find((i) => i.id === orderItemId)!;
    expect(Number(sentItem.quantity)).toBe(3);
    expect(sentItem.status).toBe('SENT');

    const pendingItem = order.items.find((i) => i.id !== orderItemId)!;
    expect(Number(pendingItem.quantity)).toBe(2);
    expect(pendingItem.status).toBe('PENDING');
  });

  it('fails to decrease quantity of sent item', async () => {
    await expect(
      api<Order>(`/orders/${orderId}/items/${orderItemId}/quantity`, {
        method: 'POST',
        body: { quantity: 2 },
      })
    ).rejects.toThrow();
  });

  it('toggles service and VAT by Manager directly (has permission)', async () => {
    // Toggle service OFF
    let order = await api<Order>(`/orders/${orderId}/tax-service`, {
      method: 'POST',
      body: { noService: true },
      token: managerToken,
    });
    expect(order.noService).toBe(true);
    expect(order.serviceChargeCents).toBe(0);

    // Toggle service back ON
    order = await api<Order>(`/orders/${orderId}/tax-service`, {
      method: 'POST',
      body: { noService: false },
      token: managerToken,
    });
    expect(order.noService).toBe(false);
    expect(order.serviceChargeCents).toBeGreaterThan(0);

    // Toggle VAT OFF
    order = await api<Order>(`/orders/${orderId}/tax-service`, {
      method: 'POST',
      body: { noVat: true },
      token: managerToken,
    });
    expect(order.noVat).toBe(true);
    expect(order.taxCents).toBe(0);
  });

  it('fails to toggle service/VAT by Cashier directly (lacks permission)', async () => {
    await expect(
      api<Order>(`/orders/${orderId}/tax-service`, {
        method: 'POST',
        body: { noService: true },
        token: cashierToken,
      })
    ).rejects.toThrow('Manager PIN is required');
  });

  it('toggles service/VAT by Cashier with Manager PIN bypass', async () => {
    // Cashier sends manager PIN ('1111') to toggle service OFF
    const order = await api<Order>(`/orders/${orderId}/tax-service`, {
      method: 'POST',
      body: { noService: true, approverPin: managerPin },
      token: cashierToken,
    });
    expect(order.noService).toBe(true);
    expect(order.serviceChargeCents).toBe(0);
  });

  it('records table info in audit logs during creation and transfers', async () => {
    // 1. Get free tables
    interface Zone { name: string; resources: { id: string; name: string; orders: unknown[]; sessions: unknown[] }[] }
    const floor = await api<Zone[]>('/floor');
    const mainHall = floor.find((x) => x.name === 'Main hall')!;
    const freeTables = mainHall.resources.filter((r) => !r.orders.length && !r.sessions.length);
    expect(freeTables.length).toBeGreaterThanOrEqual(2);
    const tableA = freeTables[0];
    const tableB = freeTables[1];

    // 2. Create order on table A
    const order = await api<Order>('/orders', {
      method: 'POST',
      body: { type: 'DINE_IN', resourceId: tableA.id },
    });
    expect(order.id).toBeTruthy();

    // 3. Add burger
    const updated = await api<Order>(`/orders/${order.id}/items`, {
      method: 'POST',
      body: { items: [{ itemId, quantity: 1 }] },
    });
    const orderItemId = updated.items[0].id;

    // 4. Update item note (this creates an audit entry for OrderItem)
    await api(`/orders/${order.id}/items/${orderItemId}/note`, {
      method: 'POST',
      body: { notes: 'Extra hot' },
    });

    // 5. Transfer to table B
    await api(`/orders/${order.id}/transfer`, {
      method: 'POST',
      body: { toResourceId: tableB.id },
      token: managerToken,
    });

    // 6. Query audit logs
    const logs = await api<{ action: string; entityId: string; detail?: any }[]>('/audit?take=50');
    
    // Find order transfer log
    const transferLog = logs.find((l) => l.action === 'order.transfer' && l.entityId === order.id);
    expect(transferLog).toBeTruthy();
    expect(transferLog?.detail?.fromResourceName).toBe(tableA.name);
    expect(transferLog?.detail?.toResourceName).toBe(tableB.name);

    // Find note update log
    const noteLog = logs.find((l) => l.action === 'order.update_item_note' && l.entityId === orderItemId);
    expect(noteLog).toBeTruthy();
    expect(noteLog?.detail?.resourceName).toBe(tableA.name);
  });
});

