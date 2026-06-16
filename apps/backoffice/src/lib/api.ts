let token: string | null = sessionStorage.getItem('bo.token');

export function setToken(t: string | null) {
  token = t;
  if (t) sessionStorage.setItem('bo.token', t);
  else sessionStorage.removeItem('bo.token');
}

export function hasToken() {
  return !!token;
}

export async function api<T>(path: string, options: { method?: string; body?: unknown } = {}): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method: options.method ?? 'GET',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: options.body != null ? JSON.stringify(options.body) : undefined,
  });
  // expired/invalid session → drop the token and return to the login screen
  if (res.status === 401 && token && !path.startsWith('/auth/')) {
    setToken(null);
    location.reload();
    return new Promise<T>(() => {}); // page is reloading
  }
  if (!res.ok) throw new Error(((await res.json().catch(() => ({}))) as { message?: string }).message ?? res.statusText);
  const text = await res.text();
  try { return JSON.parse(text) as T; } catch { return text as unknown as T; }
}

export const egp = (cents: number) => `${(cents / 100).toLocaleString('en-EG', { maximumFractionDigits: 2 })} EGP`;
export const pct = (bps: number) => `${(bps / 100).toFixed(1)}%`;
export const cairoTime = (iso: string) =>
  new Date(iso).toLocaleString('en-EG', { timeZone: 'Africa/Cairo', dateStyle: 'short', timeStyle: 'short' });

/** Parse an EGP string from an input into integer piasters; null if invalid. */
export function parseEgp(input: string): number | null {
  const n = Number(input);
  return Number.isFinite(n) ? Math.round(n * 100) : null;
}

export async function downloadCsv(path: string, filename: string) {
  const text = await api<string>(path);
  const blob = new Blob([typeof text === 'string' ? text : JSON.stringify(text)], { type: 'text/csv' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
}
