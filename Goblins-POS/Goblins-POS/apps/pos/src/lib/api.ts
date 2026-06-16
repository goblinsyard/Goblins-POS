/** Tiny API client with JWT handling + auto-refresh. */

let accessToken: string | null = sessionStorage.getItem('pos.accessToken');
let refreshToken: string | null = sessionStorage.getItem('pos.refreshToken');

export function setTokens(access: string | null, refresh: string | null) {
  accessToken = access;
  refreshToken = refresh;
  if (access) sessionStorage.setItem('pos.accessToken', access);
  else sessionStorage.removeItem('pos.accessToken');
  if (refresh) sessionStorage.setItem('pos.refreshToken', refresh);
  else sessionStorage.removeItem('pos.refreshToken');
}

export function hasSession(): boolean {
  return !!accessToken;
}

async function tryRefresh(): Promise<boolean> {
  if (!refreshToken) return false;
  const res = await fetch('/api/auth/refresh', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ refreshToken }),
  });
  if (!res.ok) {
    setTokens(null, null);
    return false;
  }
  const data = await res.json();
  setTokens(data.accessToken, data.refreshToken);
  return true;
}

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

/** Paths safe to queue offline (append-style order building, not money). */
const OFFLINE_QUEUEABLE = [/^\/orders\/[^/]+\/items$/, /^\/kds\/orders\/[^/]+\/send$/];

export async function api<T = unknown>(
  path: string,
  options: { method?: string; body?: unknown } = {},
  retried = false,
): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/api${path}`, {
      method: options.method ?? 'GET',
      headers: {
        'Content-Type': 'application/json',
        ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
      },
      body: options.body != null ? JSON.stringify(options.body) : undefined,
    });
  } catch (err) {
    // network failure — queue order-building mutations for later sync
    if (
      options.method === 'POST' &&
      OFFLINE_QUEUEABLE.some((re) => re.test(path))
    ) {
      const { enqueue } = await import('./offline-queue');
      await enqueue(path, 'POST', options.body);
      throw new ApiError(0, 'OFFLINE_QUEUED');
    }
    throw err;
  }
  if (res.status === 401 && !retried && (await tryRefresh())) {
    return api(path, options, true);
  }
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    const msg = Array.isArray(body.message) ? body.message.join(', ') : (body.message ?? res.statusText);
    throw new ApiError(res.status, msg);
  }
  const text = await res.text();
  return (text ? JSON.parse(text) : null) as T;
}

/** Start background sync of the offline queue (call once at app boot). */
export async function initOfflineSync(onChange?: (remaining: number) => void) {
  const { startOfflineSync } = await import('./offline-queue');
  return startOfflineSync((path, method, body) => api(path, { method, body }), onChange);
}
