import { useCallback, useEffect, useRef, useState } from 'react';
import { io, type Socket } from 'socket.io-client';
import { AlertTriangle, Check, Delete, Printer, Undo2 } from 'lucide-react';

// ---------- types ----------
interface Station { id: string; name: string; kind: 'PREP' | 'EXPO' }
interface TicketItem {
  id: string;
  quantity: string;
  orderItem: { description: string; notes?: string | null; modifiers: { name: string }[] };
}
interface Ticket {
  id: string;
  status: 'HELD' | 'NEW' | 'IN_PROGRESS' | 'READY' | 'SERVED';
  course: number;
  firedAt: string;
  recalled: boolean;
  items: TicketItem[];
  order: { number: number; type: string; resource?: { name: string } | null };
  station: { id: string; name: string };
}
interface SessionUser { id: string; name: string; permissions: string[] }

// ---------- api ----------
let token: string | null = sessionStorage.getItem('kds.token');
let refreshToken: string | null = sessionStorage.getItem('kds.refresh');

function setTokens(access: string | null, refresh: string | null) {
  token = access;
  refreshToken = refresh;
  if (access) sessionStorage.setItem('kds.token', access);
  else sessionStorage.removeItem('kds.token');
  if (refresh) sessionStorage.setItem('kds.refresh', refresh);
  else sessionStorage.removeItem('kds.refresh');
}

/** Access tokens expire after 15 min — an always-on monitor must refresh or it silently goes blank. */
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

async function api<T>(path: string, options: { method?: string; body?: unknown } = {}, retried = false): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method: options.method ?? 'GET',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: options.body != null ? JSON.stringify(options.body) : undefined,
  });
  if (res.status === 401 && !retried && !path.startsWith('/auth/') && (await tryRefresh())) {
    return api(path, options, true);
  }
  if (res.status === 401 && !path.startsWith('/auth/')) {
    // session is gone for good — back to the PIN screen
    setTokens(null, null);
    location.reload();
    return new Promise<T>(() => {});
  }
  if (!res.ok) throw new Error((await res.json().catch(() => ({})) as { message?: string }).message ?? res.statusText);
  return res.json() as Promise<T>;
}

// ---------- i18n ----------
const KDS_STRINGS = {
  en: {
    title: 'Goblins KDS', wrongPin: 'Wrong PIN', allDay: 'All day', stations: 'Stations',
    start: 'START', ready: 'READY', serve: 'SERVE', course: 'Course', recalled: 'RECALLED',
    noTickets: 'No open tickets', nothingOutstanding: 'Nothing outstanding 🎉',
  },
  ar: {
    title: 'شاشة المطبخ', wrongPin: 'رقم خاطئ', allDay: 'الإجمالي', stations: 'المحطات',
    start: 'ابدأ', ready: 'جاهز', serve: 'تقديم', course: 'مرحلة', recalled: 'مسترجع',
    noTickets: 'لا توجد طلبات', nothingOutstanding: 'لا يوجد متبقي 🎉',
  },
} as const;
type KdsLang = 'en' | 'ar';
function useLang(): [KdsLang, (l: KdsLang) => void] {
  const [lang, setLangState] = useState<KdsLang>((localStorage.getItem('kds.lang') as KdsLang) ?? 'en');
  const setLang = (l: KdsLang) => {
    localStorage.setItem('kds.lang', l);
    document.documentElement.dir = l === 'ar' ? 'rtl' : 'ltr';
    document.documentElement.lang = l;
    setLangState(l);
  };
  useEffect(() => { document.documentElement.dir = lang === 'ar' ? 'rtl' : 'ltr'; }, [lang]);
  return [lang, setLang];
}

// ---------- beep ----------
function beep() {
  try {
    const ctx = new AudioContext();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.frequency.value = 880;
    gain.gain.value = 0.3;
    osc.start();
    osc.stop(ctx.currentTime + 0.4);
  } catch { /* no audio available */ }
}

function elapsedMin(iso: string): number {
  return Math.floor((Date.now() - new Date(iso).getTime()) / 60_000);
}

/** Always-on monitors never get refreshed by hand — reload automatically when a new build ships. */
function useAutoReloadOnNewVersion() {
  useEffect(() => {
    let initial: string | null = null;
    async function check() {
      try {
        const res = await fetch(location.pathname.replace(/[^/]*$/, '') + 'index.html', { cache: 'no-store' });
        const html = await res.text();
        if (initial === null) initial = html;
        else if (html !== initial) location.reload();
      } catch { /* offline — try again next tick */ }
    }
    void check();
    const t = setInterval(check, 5 * 60_000);
    return () => clearInterval(t);
  }, []);
}

const AGE_COLORS = (min: number) =>
  min >= 15 ? 'border-red-500 bg-red-950' : min >= 8 ? 'border-amber-500 bg-amber-950' : 'border-goblin-600 bg-goblin-900';

// ---------- login ----------
function Login({ onDone }: { onDone: (u: SessionUser) => void }) {
  const [users, setUsers] = useState<{ id: string; name: string; role: { name: string } }[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [pin, setPin] = useState('');
  const [err, setErr] = useState(false);

  useEffect(() => {
    void api<typeof users>('/auth/pin-users').then(setUsers);
  }, []);

  async function submit(p: string) {
    try {
      const res = await api<{ accessToken: string; refreshToken: string; user: SessionUser }>('/auth/login/pin', {
        method: 'POST', body: { userId: selected, pin: p },
      });
      setTokens(res.accessToken, res.refreshToken);
      onDone(res.user);
    } catch {
      setErr(true);
      setPin('');
      setTimeout(() => setErr(false), 1000);
    }
  }

  return (
    <div className="flex h-screen items-center justify-center bg-goblin-950 text-white">
      <div className="w-full max-w-sm p-6">
        <h1 className="mb-6 text-center text-2xl font-bold text-goblin-400">Goblins KDS</h1>
        {!selected ? (
          <div className="grid grid-cols-2 gap-2">
            {users.map((u) => (
              <button key={u.id} onClick={() => setSelected(u.id)} className="rounded-xl bg-goblin-800 p-4 font-semibold">
                {u.name}
                <span className="block text-xs text-goblin-400">{u.role.name}</span>
              </button>
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-3 gap-2">
            {err && <p className="col-span-3 text-center text-red-400">Wrong PIN</p>}
            {['1','2','3','4','5','6','7','8','9','⌫','0','✓'].map((k) => (
              <button key={k}
                onClick={() => {
                  if (k === '⌫') setPin(pin.slice(0, -1));
                  else if (k === '✓') void submit(pin);
                  else {
                    const next = pin + k;
                    setPin(next);
                    if (next.length >= 4) void submit(next);
                  }
                }}
                className="rounded-xl bg-goblin-800 p-5 text-xl font-bold active:bg-goblin-700">
                {k === '⌫' ? <Delete className="mx-auto h-6 w-6" /> : k === '✓' ? <Check className="mx-auto h-6 w-6" /> : k}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ---------- main ----------
export function App() {
  const [user, setUser] = useState<SessionUser | null>(null);
  const [stations, setStations] = useState<Station[]>([]);
  const [station, setStation] = useState<Station | null>(null);
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [allDay, setAllDay] = useState<{ description: string; quantity: number }[] | null>(null);
  const [connErr, setConnErr] = useState('');
  const [, force] = useState(0);
  const [lang, setLang] = useLang();
  const t = KDS_STRINGS[lang];
  const socketRef = useRef<Socket | null>(null);
  useAutoReloadOnNewVersion();

  const load = useCallback(async () => {
    if (!station) return;
    try {
      if (station.kind === 'EXPO') setTickets(await api<Ticket[]>('/kds/expo'));
      else setTickets(await api<Ticket[]>(`/kds/stations/${station.id}/tickets`));
      setConnErr('');
    } catch (e) {
      // keep the last good board, but make the failure visible
      setConnErr(e instanceof Error ? e.message : 'Connection lost');
    }
  }, [station]);

  // realtime + polling fallback + elapsed-time repaint
  useEffect(() => {
    if (!station) return;
    void load();
    const room = station.kind === 'EXPO' ? 'expo' : `kds:${station.id}`;
    // Send the current access token on connect AND on every reconnect (auth as
    // a callback re-reads the latest token, which the refresh flow keeps fresh).
    const s = io({
      path: '/ws',
      query: { rooms: room },
      auth: (cb) => cb({ token: token ?? '' }),
    });
    s.on('connect', () => void load()); // re-sync after any reconnect
    s.on('ticket.new', () => { beep(); void load(); });
    s.on('ticket.updated', () => void load());
    socketRef.current = s;
    const poll = setInterval(load, 15_000);
    const repaint = setInterval(() => force((x) => x + 1), 30_000);
    return () => { s.close(); clearInterval(poll); clearInterval(repaint); };
  }, [station, load]);

  // bump-bar: keys 1-9 bump nth ticket
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const n = Number(e.key);
      if (n >= 1 && n <= 9) {
        const t = tickets.filter((t) => t.status !== 'SERVED')[n - 1];
        if (t) void api(`/kds/tickets/${t.id}/bump`, { method: 'POST' }).then(load);
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [tickets, load]);

  useEffect(() => {
    if (user) void api<Station[]>('/kds/stations').then(setStations);
  }, [user]);

  if (!user) return <Login onDone={setUser} />;

  if (!station) {
    return (
      <div className="flex min-h-screen flex-wrap items-center justify-center gap-4 bg-goblin-950 p-6 text-white">
        {stations.map((s) => (
          <button key={s.id} onClick={() => setStation(s)}
            className="rounded-2xl bg-goblin-800 px-10 py-8 text-2xl font-bold active:bg-goblin-600">
            {s.name}
          </button>
        ))}
      </div>
    );
  }

  return (
    <div className="flex h-screen flex-col bg-goblin-950 text-white">
      <header className="flex items-center justify-between border-b border-goblin-800 px-4 py-2">
        <h1 className="text-xl font-bold text-goblin-400">{station.name}</h1>
        <div className="flex gap-2">
          {station.kind === 'PREP' && (
            <button
              onClick={async () => {
                if (allDay) setAllDay(null);
                else setAllDay(await api(`/kds/stations/${station.id}/all-day`));
              }}
              className={`rounded-lg px-4 py-2 ${allDay ? 'bg-goblin-600' : 'bg-goblin-800'}`}
            >
              {t.allDay}
            </button>
          )}
          <button onClick={() => setLang(lang === 'en' ? 'ar' : 'en')} className="rounded-lg bg-goblin-800 px-4 py-2">
            {lang === 'en' ? 'ع' : 'EN'}
          </button>
          <button onClick={() => setStation(null)} className="rounded-lg bg-goblin-800 px-4 py-2">
            {t.stations}
          </button>
        </div>
      </header>

      {connErr && (
        <div className="flex items-center justify-center gap-2 bg-red-900/70 px-4 py-1 text-center text-sm text-red-200">
          <AlertTriangle className="h-4 w-4" /> {connErr}
        </div>
      )}

      {allDay ? (
        <div className="grid flex-1 auto-rows-min grid-cols-2 gap-3 overflow-auto p-4 md:grid-cols-3">
          {allDay.map((row) => (
            <div key={row.description} className="flex items-center justify-between rounded-xl bg-goblin-900 p-4 text-2xl">
              <span>{row.description}</span>
              <span className="font-bold text-goblin-400">×{row.quantity}</span>
            </div>
          ))}
          {!allDay.length && <p className="text-goblin-400">{t.nothingOutstanding}</p>}
        </div>
      ) : (
        <div className="flex flex-1 gap-3 overflow-x-auto p-3">
          {tickets.map((tk, i) => {
            const age = elapsedMin(tk.firedAt);
            return (
              <div key={tk.id}
                className={`flex h-fit min-w-64 max-w-64 flex-col rounded-xl border-2 ${AGE_COLORS(age)} ${tk.status === 'READY' ? 'opacity-80 ring-2 ring-goblin-400' : ''}`}>
                <div className="flex items-center justify-between rounded-t-lg bg-black/40 px-3 py-2">
                  <span className="font-bold">
                    #{tk.order.number} {tk.order.resource?.name ?? tk.order.type}
                  </span>
                  <span className="text-sm text-goblin-300">{i + 1}⃣ {age}m</span>
                </div>
                {tk.course > 1 && <span className="bg-purple-900 px-3 py-0.5 text-xs">{t.course} {tk.course}</span>}
                {tk.recalled && <span className="bg-red-900 px-3 py-0.5 text-xs">{t.recalled}</span>}
                <div className="flex-1 p-3">
                  {tk.items.map((ti) => (
                    <div key={ti.id} className="mb-2">
                      <p className="text-lg font-semibold">
                        {Number(ti.quantity)} × {ti.orderItem.description}
                      </p>
                      {ti.orderItem.modifiers.map((m, j) => (
                        <p key={j} className="ms-4 text-sm text-amber-300">+ {m.name}</p>
                      ))}
                      {ti.orderItem.notes && <p className="ms-4 text-sm italic text-red-300">* {ti.orderItem.notes}</p>}
                    </div>
                  ))}
                </div>
                <div className="flex gap-1 p-2">
                  <button
                    onClick={() => void api(`/kds/tickets/${tk.id}/bump`, { method: 'POST' }).then(load)}
                    className="flex-1 rounded-lg bg-goblin-600 py-3 font-bold active:bg-goblin-600">
                    {tk.status === 'NEW' ? t.start : tk.status === 'IN_PROGRESS' ? t.ready : t.serve}
                  </button>
                  {(tk.status === 'READY' || tk.status === 'IN_PROGRESS') && (
                    <button
                      onClick={() => void api(`/kds/tickets/${tk.id}/recall`, { method: 'POST' }).then(load).catch(() => {})}
                      title={t.recalled}
                      className="inline-flex items-center justify-center rounded-lg bg-goblin-700 px-3 py-3 text-sm">
                      <Undo2 className="h-5 w-5" />
                    </button>
                  )}
                  <button
                    onClick={() => void api(`/kds/tickets/${tk.id}/reprint`, { method: 'POST' }).catch(() => {})}
                    title="Reprint"
                    className="inline-flex items-center justify-center rounded-lg bg-goblin-700 px-3 py-3 text-sm">
                    <Printer className="h-5 w-5" />
                  </button>
                </div>
              </div>
            );
          })}
          {!tickets.length && (
            <div className="flex flex-1 items-center justify-center text-2xl text-goblin-700">
              {t.noTickets}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
