/**
 * Offline tolerance: order mutations that fail with a NETWORK error are
 * queued in IndexedDB and replayed in order when connectivity returns.
 * A restaurant cannot stop selling because Wi-Fi dropped.
 *
 * Only idempotent-safe, append-style operations are queued (add items,
 * send to kitchen). Payments and voids intentionally are NOT queued —
 * money operations must be confirmed online.
 */

const DB_NAME = 'goblins-pos-offline';
const STORE = 'queue';

interface QueuedRequest {
  id?: number;
  path: string;
  method: string;
  body: unknown;
  queuedAt: number;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore(STORE, { keyPath: 'id', autoIncrement: true });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function enqueue(path: string, method: string, body: unknown): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).add({ path, method, body, queuedAt: Date.now() } satisfies QueuedRequest);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

export async function queuedCount(): Promise<number> {
  const db = await openDb();
  const count = await new Promise<number>((resolve, reject) => {
    const req = db.transaction(STORE, 'readonly').objectStore(STORE).count();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  db.close();
  return count;
}

async function takeAll(): Promise<QueuedRequest[]> {
  const db = await openDb();
  const items = await new Promise<QueuedRequest[]>((resolve, reject) => {
    const req = db.transaction(STORE, 'readonly').objectStore(STORE).getAll();
    req.onsuccess = () => resolve(req.result as QueuedRequest[]);
    req.onerror = () => reject(req.error);
  });
  db.close();
  return items.sort((a, b) => (a.id ?? 0) - (b.id ?? 0));
}

async function remove(id: number): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

/** Replay the queue in order. Stops at the first network failure (still offline). */
export async function flush(
  send: (path: string, method: string, body: unknown) => Promise<unknown>,
): Promise<{ sent: number; remaining: number }> {
  const items = await takeAll();
  let sent = 0;
  for (const item of items) {
    try {
      await send(item.path, item.method, item.body);
      await remove(item.id!);
      sent++;
    } catch (err) {
      if (err instanceof TypeError) break; // network still down — keep the rest queued
      // 4xx/5xx: the request is invalid now (order paid/voided meanwhile) — drop it
      await remove(item.id!);
    }
  }
  return { sent, remaining: (await queuedCount()) };
}

/** Wire up automatic flushing on reconnect + a safety interval. */
export function startOfflineSync(
  send: (path: string, method: string, body: unknown) => Promise<unknown>,
  onChange?: (remaining: number) => void,
) {
  const run = async () => {
    if (!navigator.onLine) return;
    const res = await flush(send).catch(() => null);
    if (res && onChange) onChange(res.remaining);
  };
  window.addEventListener('online', () => void run());
  const interval = setInterval(() => void run(), 20_000);
  return () => clearInterval(interval);
}
