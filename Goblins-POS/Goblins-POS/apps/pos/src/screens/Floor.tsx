import { useCallback, useEffect, useState } from 'react';
import { priceSession, type RatePlanSpec } from '@goblins/shared';
import { api } from '../lib/api';
import { fmtMoney, t } from '../lib/i18n';
import { can, usePos } from '../lib/store';
import type { FloorResource, FloorZone, OpenOrderSummary, Order } from '../lib/types';
import { CashDrawerDialog, TimeClockDialog } from './dialogs/CashDrawerDialog';
import { ShiftDialogs } from './ShiftDialogs';
import { ReservationsTab } from './ReservationsTab';
import { DisplaySettingsDialog } from './dialogs/DisplaySettingsDialog';

const STATUS_COLORS: Record<string, string> = {
  FREE: 'bg-goblin-600 border-goblin-400',
  OCCUPIED: 'bg-red-700 border-red-500',
  RESERVED: 'bg-amber-600 border-amber-400',
  NEEDS_CLEANING: 'bg-sky-700 border-sky-500',
};

function formatTimeCairo(isoString: string) {
  return new Date(isoString).toLocaleTimeString('en-US', {
    timeZone: 'Africa/Cairo',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
}

function toLocalCairo(epochMs: number) {
  const d = new Date(epochMs);
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Africa/Cairo', weekday: 'short', hour: 'numeric', minute: 'numeric', hour12: false,
  }).formatToParts(d);
  const dow: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  let dayOfWeek = 0, h = 0, m = 0;
  for (const p of parts) {
    if (p.type === 'weekday') dayOfWeek = dow[p.value] ?? 0;
    else if (p.type === 'hour') h = Number(p.value) % 24;
    else if (p.type === 'minute') m = Number(p.value);
  }
  return { dayOfWeek, minutesOfDay: h * 60 + m };
}

function liveCost(res: FloorResource): number | null {
  const session = res.sessions[0];
  if (!session || !res.ratePlan) return null;
  const plan: RatePlanSpec = {
    hourlyCents: res.ratePlan.hourlyCents,
    hourlyMultiCents: res.ratePlan.hourlyMultiCents,
    minimumCents: res.ratePlan.minimumCents,
    roundToMinutes: res.ratePlan.roundToMinutes,
    roundingMode: res.ratePlan.roundingMode as 'nearest' | 'up' | 'down',
    graceMinutes: res.ratePlan.graceMinutes,
    rules: res.ratePlan.rules.map((r) => ({ ...r, daysOfWeek: r.daysOfWeek })),
  };
  const segments = session.segments.map((s) => ({
    startedAt: new Date(s.startedAt).getTime(),
    endedAt: s.endedAt ? new Date(s.endedAt).getTime() : Date.now(),
    isMultiplayer: s.isMultiplayer,
  }));
  try {
    return priceSession(segments, plan, toLocalCairo).totalCents;
  } catch {
    return null;
  }
}

export function Floor() {
  const { user, shift, lang, refreshShift, openOrder, logout } = usePos();
  const [zones, setZones] = useState<FloorZone[]>([]);
  const [showBookings, setShowBookings] = useState(false);
  const [tick, setTick] = useState(0);
  const [shiftDialog, setShiftDialog] = useState<'open' | 'close' | 'x' | null>(null);
  const [pending, setPending] = useState<FloorResource | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [clockOpen, setClockOpen] = useState(false);
  const [choosing, setChoosing] = useState<FloorResource | null>(null); // table with several bills
  const [openList, setOpenList] = useState<OpenOrderSummary[] | null>(null);

  const [activeView, setActiveView] = useState<'map' | 'tabs' | 'reservations'>('map');
  const [newTabOpen, setNewTabOpen] = useState(false);
  const [openTabsOrders, setOpenTabsOrders] = useState<OpenOrderSummary[]>([]);
  const [displaySettingsOpen, setDisplaySettingsOpen] = useState(false);

  const load = useCallback(() => {
    api<FloorZone[]>('/floor').then(setZones).catch(() => {});
  }, []);

  const loadTabs = useCallback(() => {
    api<OpenOrderSummary[]>('/orders/open').then((orders) => {
      setOpenTabsOrders(orders.filter((o) => !o.resource));
    }).catch(() => {});
  }, []);

  useEffect(() => {
    load();
    loadTabs();
    void refreshShift();
    // shift state must poll too — it may be opened/closed from another terminal
    const poll = setInterval(() => { load(); loadTabs(); void refreshShift(); }, 10_000);
    const timer = setInterval(() => setTick((x) => x + 1), 30_000); // refresh live costs
    return () => { clearInterval(poll); clearInterval(timer); };
  }, [load, loadTabs, refreshShift]);
  void tick;

  async function tapResource(res: FloorResource) {
    if (!shift) return;
    if (res.orders.length > 1) {
      setChoosing(res);
      return;
    }
    const open = res.orders[0];
    if (open) {
      openOrder(open.id);
      return;
    }
    if (res.status === 'NEEDS_CLEANING') {
      setPending(res);
      return;
    }
    // free table/room → start order (sessions start from the order screen for billiards/PS)
    const type =
      res.type === 'BILLIARDS_TABLE' ? 'BILLIARDS' : res.type === 'PS_ROOM' ? 'PS_ROOM' : 'DINE_IN';
    const order = await api<Order>('/orders', {
      method: 'POST',
      body: { type, resourceId: res.id },
    });
    openOrder(order.id);
    load();
  }

  async function takeaway() {
    const order = await api<Order>('/orders', { method: 'POST', body: { type: 'TAKEAWAY' } });
    openOrder(order.id);
  }

  return (
    <div className="flex h-screen flex-col bg-goblin-950 text-goblin-50">
      <header className="flex flex-col gap-2 border-b border-goblin-800 px-4 py-2.5 sm:flex-row sm:items-center sm:justify-between">
        <h1 className="text-xl font-bold text-goblin-300">{t(lang, 'appName')}</h1>
        <div className="flex flex-wrap items-center gap-2 justify-center sm:justify-end">
          {shift ? (
            <>
              <button onClick={takeaway} className="rounded-xl bg-goblin-600 px-4 py-2 font-semibold active:bg-goblin-500">
                {t(lang, 'takeaway')}
              </button>
              <button
                onClick={() => void api<OpenOrderSummary[]>('/orders/open').then(setOpenList)}
                className="rounded-xl bg-goblin-800 px-4 py-2">
                📋 {t(lang, 'openOrders')}
              </button>
              <button onClick={() => setDrawerOpen(true)} className="rounded-xl bg-goblin-800 px-4 py-2">
                💵 {t(lang, 'cashDrawer')}
              </button>
              {can(user, 'shift.x_report') && (
                <button onClick={() => setShiftDialog('x')} className="rounded-xl bg-goblin-800 px-4 py-2">
                  {t(lang, 'xReport')}
                </button>
              )}
              {can(user, 'shift.close') && (
                <button onClick={() => setShiftDialog('close')} className="rounded-xl bg-goblin-800 px-4 py-2">
                  {t(lang, 'closeShift')}
                </button>
              )}
            </>
          ) : (
            can(user, 'shift.open') && (
              <button onClick={() => setShiftDialog('open')} className="rounded-xl bg-goblin-600 px-4 py-2 font-semibold">
                {t(lang, 'openShift')}
              </button>
            )
          )}
          <button onClick={() => setClockOpen(true)} className="rounded-xl bg-goblin-900 px-3 py-2" title={t(lang, 'clockIn')}>
            ⏱
          </button>
          <button
            onClick={() => setDisplaySettingsOpen(true)}
            className="rounded-xl bg-goblin-900 px-3 py-2 hover:bg-goblin-800 transition-colors"
            title={lang === 'ar' ? 'إعدادات العرض' : 'Display Settings'}
          >
            🎨
          </button>
          <span className="mx-2 text-goblin-400">{user?.name}</span>
          <button onClick={logout} className="rounded-xl bg-goblin-900 px-3 py-2 text-goblin-300">
            {t(lang, 'logout')}
          </button>
        </div>
      </header>

      {shift && (
        <div className="flex bg-goblin-900 border-b border-goblin-800">
          <button
            onClick={() => setActiveView('map')}
            className={`flex-1 py-3 text-center font-semibold border-b-2 transition-all ${
              activeView === 'map' ? 'border-goblin-400 bg-goblin-950/20 text-white font-bold' : 'border-transparent text-goblin-400 hover:text-white'
            }`}
          >
            🗺 {lang === 'ar' ? 'خريطة الصالات' : 'Floor Map'}
          </button>
          <button
            onClick={() => {
              setActiveView('tabs');
              loadTabs();
            }}
            className={`flex-1 py-3 text-center font-semibold border-b-2 transition-all ${
              activeView === 'tabs' ? 'border-goblin-400 bg-goblin-950/20 text-white font-bold' : 'border-transparent text-goblin-400 hover:text-white'
            }`}
          >
            👤 {lang === 'ar' ? 'الحسابات المفتوحة' : 'Open Tabs'}
          </button>
          <button
            onClick={() => setActiveView('reservations')}
            className={`flex-1 py-3 text-center font-semibold border-b-2 transition-all ${
              activeView === 'reservations' ? 'border-goblin-400 bg-goblin-950/20 text-white font-bold' : 'border-transparent text-goblin-400 hover:text-white'
            }`}
          >
            📅 {t(lang, 'reservations')}
          </button>
        </div>
      )}

      {!shift && (
        <div className="bg-amber-900/60 px-4 py-2 text-center text-amber-200">{t(lang, 'noShift')}</div>
      )}

      <main className="flex-1 overflow-auto p-4">
        {activeView === 'reservations' ? (
          <ReservationsTab zones={zones} />
        ) : activeView === 'tabs' ? (
          <div className="space-y-4">
            <div className="flex justify-between items-center">
              <h2 className="text-lg font-bold text-goblin-300">
                {lang === 'ar' ? 'الحسابات النشطة' : 'Active Open Tabs'} ({openTabsOrders.length})
              </h2>
              <button
                onClick={() => setNewTabOpen(true)}
                className="rounded-xl bg-goblin-600 px-5 py-2.5 font-bold hover:bg-goblin-500 transition-all shadow-md"
              >
                + {lang === 'ar' ? 'فتح حساب جديد' : 'Open New Tab'}
              </button>
            </div>
            
            <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-4 animate-fade-in">
              {openTabsOrders.map((o) => (
                <button
                  key={o.id}
                  onClick={() => openOrder(o.id)}
                  className="flex flex-col rounded-2xl bg-goblin-900 p-4 border border-goblin-800 text-start hover:border-goblin-600 hover:bg-goblin-850 active:scale-95 transition-all shadow"
                >
                  <span className="text-xs text-goblin-400 font-mono">#{o.number}</span>
                  <span className="text-base font-bold mt-1 text-white truncate w-full">
                    👤 {o.customer?.name || 'Walk-in'}
                  </span>
                  <span className="text-sm font-semibold mt-2 text-goblin-300">
                    {fmtMoney(o.totalCents, lang)}
                  </span>
                </button>
              ))}
              {openTabsOrders.length === 0 && (
                <p className="col-span-full py-8 text-center text-goblin-400">
                  {lang === 'ar' ? 'لا يوجد حسابات مفتوحة حالياً.' : 'No active open tabs.'}
                </p>
              )}
            </div>
          </div>
        ) : (
          <>
            <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between bg-goblin-900/30 p-3 rounded-2xl border border-goblin-800/50">
              <span className="text-xs text-goblin-400 font-medium">
                {lang === 'ar' ? 'انقر فوق أي طاولة/غرفة لبدء تشغيلها أو لإدارتها.' : 'Tap any table/room to start or manage it.'}
              </span>
              <button
                onClick={() => setShowBookings(!showBookings)}
                className={`rounded-xl px-4 py-2 text-xs font-bold transition-all border select-none active:scale-95 ${
                  showBookings
                    ? 'bg-amber-600 border-amber-400 text-white shadow'
                    : 'bg-goblin-900 border-goblin-800 text-goblin-300 hover:text-white'
                }`}
              >
                📅 {lang === 'ar' ? 'عرض الحجوزات القادمة' : 'Show Next Bookings'}
              </button>
            </div>

            {zones.map((zone) => (
              <section key={zone.id} className="mb-6">
                <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-goblin-400">
                  {lang === 'ar' && zone.nameAr ? zone.nameAr : zone.name}
                </h2>
                <div className="overflow-x-auto pb-2">
                  <div className="relative" style={{ minHeight: zoneHeight(zone), minWidth: zoneWidth(zone) }}>
                    {zone.resources.map((res) => {
                      const cost = liveCost(res);
                      const session = res.sessions[0];
                      const nextRes = res.reservations?.[0];
                      const isVip = res.type === 'PS_ROOM' && res.ratePlan?.name.toUpperCase().includes('VIP');
                      return (
                        <button
                          key={res.id}
                          onClick={() => void tapResource(res)}
                          disabled={!shift}
                          className={`absolute flex flex-col items-center justify-center border-2 p-1 text-sm font-semibold shadow-lg transition-transform active:scale-95 disabled:opacity-40 ${STATUS_COLORS[res.status]} ${res.shape === 'circle' ? 'rounded-full' : 'rounded-xl'}`}
                          style={{ left: res.posX, top: res.posY, width: res.width, height: res.height }}
                        >
                          {isVip && (
                            <span className="absolute -top-2.5 -right-1.5 z-10 flex items-center gap-0.5 bg-gradient-to-r from-amber-500 via-yellow-450 to-yellow-300 text-black text-[9px] font-extrabold px-1.5 py-0.5 rounded-full shadow-md border border-yellow-250 select-none">
                              👑 {lang === 'ar' ? 'في إي بي' : 'VIP'}
                            </span>
                          )}
                          <span>{lang === 'ar' && (res as { nameAr?: string }).nameAr ? (res as { nameAr?: string }).nameAr : res.name}</span>
                          {res.orders.length === 1 && (
                            <span className="text-xs font-normal">{fmtMoney(res.orders[0]!.totalCents, lang)}</span>
                          )}
                          {res.orders.length > 1 && (
                            <span className="text-xs font-normal">
                              {res.orders.length} ▸ {fmtMoney(res.orders.reduce((a, o) => a + o.totalCents, 0), lang)}
                            </span>
                          )}
                          {session && cost != null && (
                            <span className="text-xs font-bold text-yellow-300">
                              {session.status === 'PAUSED' ? '⏸ ' : '▶ '}
                              {fmtMoney(cost, lang)}
                            </span>
                          )}
                          {showBookings && nextRes && (
                            <span className="mt-1 rounded bg-black/40 px-1 py-0.5 text-[10px] font-bold text-amber-200 border border-amber-400/20 max-w-full truncate">
                              📅 {formatTimeCairo(nextRes.startAt)} · {nextRes.customer?.name || nextRes.guestName}
                            </span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                </div>
              </section>
            ))}
          </>
        )}
      </main>

      {shiftDialog && (
        <ShiftDialogs kind={shiftDialog} onClose={() => { setShiftDialog(null); void refreshShift(); }} />
      )}

      {drawerOpen && shift && <CashDrawerDialog shiftId={shift.id} onClose={() => setDrawerOpen(false)} />}
      {clockOpen && <TimeClockDialog onClose={() => setClockOpen(false)} />}
      {displaySettingsOpen && <DisplaySettingsDialog onClose={() => setDisplaySettingsOpen(false)} />}

      {openList && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70" onClick={() => setOpenList(null)}>
          <div className="max-h-[85vh] w-full max-w-md overflow-auto rounded-2xl bg-goblin-900 p-5" onClick={(e) => e.stopPropagation()}>
            <h2 className="mb-3 text-lg font-bold">{t(lang, 'openOrders')} ({openList.length})</h2>
            <div className="space-y-2">
              {openList.map((o) => (
                <button key={o.id}
                  onClick={() => { setOpenList(null); openOrder(o.id); }}
                  className="flex w-full items-center justify-between rounded-xl bg-goblin-800 p-4 text-start active:bg-goblin-600">
                  <span>
                    <b>#{o.number}</b>
                    <span className="ms-2 text-goblin-300">{o.resource?.name ?? o.type.replace('_', ' ')}</span>
                    {o.customer && <span className="ms-2 text-sm text-goblin-400">{o.customer.name}</span>}
                  </span>
                  <span className="font-semibold">{fmtMoney(o.totalCents, lang)}</span>
                </button>
              ))}
              {!openList.length && <p className="text-goblin-400">—</p>}
            </div>
            <button onClick={() => setOpenList(null)} className="mt-3 w-full rounded-xl bg-goblin-800 py-3">
              {t(lang, 'close')}
            </button>
          </div>
        </div>
      )}

      {choosing && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70" onClick={() => setChoosing(null)}>
          <div className="w-full max-w-sm rounded-2xl bg-goblin-900 p-5" onClick={(e) => e.stopPropagation()}>
            <h2 className="mb-3 text-lg font-bold">{choosing.name}</h2>
            <div className="space-y-2">
              {choosing.orders.map((o) => (
                <button key={o.id}
                  onClick={() => { setChoosing(null); openOrder(o.id); }}
                  className="flex w-full justify-between rounded-xl bg-goblin-800 p-4 active:bg-goblin-600">
                  <span className="font-semibold">#{o.number}</span>
                  <span>{fmtMoney(o.totalCents, lang)}</span>
                </button>
              ))}
              <button
                onClick={async () => {
                  const type = choosing.type === 'BILLIARDS_TABLE' ? 'BILLIARDS' : choosing.type === 'PS_ROOM' ? 'PS_ROOM' : 'DINE_IN';
                  const order = await api<Order>('/orders', { method: 'POST', body: { type, resourceId: choosing.id } });
                  setChoosing(null);
                  openOrder(order.id);
                }}
                className="w-full rounded-xl bg-goblin-600 p-4 font-semibold">
                + {t(lang, 'newOrder')}
              </button>
            </div>
          </div>
        </div>
      )}

      {pending && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70" onClick={() => setPending(null)}>
          <div className="rounded-2xl bg-goblin-900 p-6" onClick={(e) => e.stopPropagation()}>
            <p className="mb-4 text-lg">{pending.name}</p>
            <button
              className="w-full rounded-xl bg-goblin-600 px-6 py-3 font-semibold"
              onClick={async () => {
                await api(`/floor/resources/${pending.id}/status`, { method: 'PATCH', body: { status: 'FREE' } });
                setPending(null);
                load();
              }}
            >
              {t(lang, 'markClean')}
            </button>
          </div>
        </div>
      )}
      {newTabOpen && (
        <NewTabDialog
          onClose={() => setNewTabOpen(false)}
          onCreated={(orderId) => {
            setNewTabOpen(false);
            openOrder(orderId);
          }}
        />
      )}
    </div>
  );
}

interface NewTabDialogProps {
  onClose: () => void;
  onCreated: (orderId: string) => void;
}

function NewTabDialog({ onClose, onCreated }: NewTabDialogProps) {
  const { lang } = usePos();
  const [q, setQ] = useState('');
  const [results, setResults] = useState<any[]>([]);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [newPhone, setNewPhone] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const handle = setTimeout(() => {
      if (!q.trim()) {
        setResults([]);
        return;
      }
      api<any[]>(`/crm/customers/lookup?q=${encodeURIComponent(q)}&onlyActive=true`)
        .then(setResults)
        .catch((e) => setError(e instanceof Error ? e.message : 'Error'));
    }, 250);
    return () => clearTimeout(handle);
  }, [q]);

  async function selectCustomer(customerId: string) {
    setError('');
    setBusy(true);
    try {
      const order = await api<any>('/orders', {
        method: 'POST',
        body: { type: 'DINE_IN', customerId },
      });
      onCreated(order.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error starting tab');
    } finally {
      setBusy(false);
    }
  }

  async function createCustomerAndSelect() {
    if (!newName.trim() || !newPhone.trim()) {
      setError('Name and phone are required');
      return;
    }
    setError('');
    setBusy(true);
    try {
      const customer = await api<any>('/crm/customers', {
        method: 'POST',
        body: { name: newName.trim(), phone: newPhone.trim() },
      });
      const order = await api<any>('/orders', {
        method: 'POST',
        body: { type: 'DINE_IN', customerId: customer.id },
      });
      onCreated(order.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error creating customer');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 animate-fade-in" onClick={onClose}>
      <div className="w-full max-w-md bg-goblin-900 rounded-2xl p-5 text-white" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-lg font-bold mb-3">Open New Tab</h2>
        {error && <p className="mb-2 bg-red-900/60 p-2 text-sm text-red-200 rounded">{error}</p>}

        {creating ? (
          <div className="space-y-3">
            <input
              type="text"
              placeholder={lang === 'ar' ? 'الاسم' : 'Name'}
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              className="w-full rounded-xl bg-goblin-950 p-3 border border-goblin-800"
            />
            <input
              type="text"
              placeholder={lang === 'ar' ? 'رقم الهاتف' : 'Phone'}
              value={newPhone}
              onChange={(e) => setNewPhone(e.target.value)}
              className="w-full rounded-xl bg-goblin-950 p-3 border border-goblin-800"
            />
            <div className="flex gap-2">
              <button onClick={() => setCreating(false)} className="flex-1 rounded-xl bg-goblin-800 py-3">
                {lang === 'ar' ? 'تراجع' : 'Back'}
              </button>
              <button disabled={busy} onClick={createCustomerAndSelect} className="flex-1 rounded-xl bg-goblin-500 py-3 font-bold">
                {lang === 'ar' ? 'إنشاء وتفعيل' : 'Create & Open'}
              </button>
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            <input
              type="text"
              placeholder={lang === 'ar' ? 'ابحث بالاسم أو رقم الهاتف...' : 'Search by name or phone...'}
              value={q}
              onChange={(e) => setQ(e.target.value)}
              className="w-full rounded-xl bg-goblin-950 p-3 border border-goblin-800"
            />
            <div className="max-h-60 overflow-auto space-y-1">
              {results.map((c) => (
                <button
                  key={c.id}
                  disabled={busy}
                  onClick={() => selectCustomer(c.id)}
                  className="w-full flex justify-between p-3 rounded-xl bg-goblin-950 hover:bg-goblin-800 text-start"
                >
                  <span>{c.name} <span className="text-goblin-400 text-sm">{c.phone}</span></span>
                  <span className="text-goblin-300">{c.pointsBalance} pts</span>
                </button>
              ))}
              {q.trim() && results.length === 0 && <p className="p-2 text-sm text-goblin-400">No customers found</p>}
            </div>
            <button onClick={() => setCreating(true)} className="w-full rounded-xl bg-goblin-800 py-3">
              + {lang === 'ar' ? 'زبون جديد' : 'New Customer'}
            </button>
            <button onClick={onClose} className="w-full rounded-xl bg-goblin-800 py-3 text-sm">
              {lang === 'ar' ? 'إلغاء' : 'Cancel'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function zoneHeight(zone: FloorZone): number {
  return Math.max(...zone.resources.map((r) => r.posY + r.height), 100) + 20;
}

function zoneWidth(zone: FloorZone): number {
  if (!zone.resources.length) return 320;
  return Math.max(...zone.resources.map((r) => r.posX + r.width), 320) + 20;
}
