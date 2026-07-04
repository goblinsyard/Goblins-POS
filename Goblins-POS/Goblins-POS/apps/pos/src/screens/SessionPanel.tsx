import { useEffect, useState } from 'react';
import { ArrowLeftRight, ClockPlus, Pause, Play, Square, Tag } from 'lucide-react';
import { api } from '../lib/api';
import { fmtMoney, t } from '../lib/i18n';
import { can, usePos } from '../lib/store';
import type { Order } from '../lib/types';
import { ResourcePicker } from './dialogs/ResourcePicker';

interface LiveSession {
  id: string;
  status: 'RUNNING' | 'PAUSED' | 'STOPPED' | 'CANCELLED';
  isMultiplayer: boolean;
  startedAt: string;
  liveCostCents: number;
  liveMinutes: number;
  prepaidBlocks?: { minutes: number }[];
}

/** Timer strip shown on billiards/PS orders: start, pause/resume, stop, single/multi. */
export function SessionPanel({ order, onChanged }: { order: Order; onChanged: () => void }) {
  const { user, lang } = usePos();
  const [session, setSession] = useState<LiveSession | null>(null);
  const [busy, setBusy] = useState(false);
  const [moving, setMoving] = useState(false);
  const [prepaidOpen, setPrepaidOpen] = useState(false);
  const [prepaidMin, setPrepaidMin] = useState('60');
  const [error, setError] = useState('');

  async function load() {
    if (!order.resourceId) return;
    try {
      const s = await api<LiveSession | null>(`/sessions/by-order/${order.id}`);
      setSession(s);
    } catch {
      setSession(null);
    }
  }

  useEffect(() => {
    void load();
    const t = setInterval(load, 5000);
    return () => clearInterval(t);
    // load is stable enough for this poll loop
  }, [order.id]);

  async function act(fn: () => Promise<unknown>) {
    setBusy(true);
    setError('');
    try {
      await fn();
      await load();
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error');
    } finally {
      setBusy(false);
    }
  }

  const isMulti = order.type === 'PS_ROOM';
  const paid = order.status === 'PAID';

  const ratePlan = order.resource?.ratePlan;

  return (
    <div className="flex flex-col border-b border-goblin-800 bg-goblin-900/70 w-full">
      {ratePlan && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-goblin-800/40 bg-goblin-950/30 px-4 py-2 text-xs text-goblin-300 font-medium select-none">
          <span className="flex items-center gap-1 font-bold text-yellow-500">
            <Tag className="h-3.5 w-3.5" /> {ratePlan.name}
          </span>
          <span className="text-goblin-700 font-normal">|</span>
          <span>
            {lang === 'ar' ? 'سعر الفردي: ' : 'Single Rate: '}
            <strong className="text-goblin-50 font-semibold">{fmtMoney(ratePlan.hourlyCents, lang)}/hr</strong>
          </span>
          {ratePlan.hourlyMultiCents && (
            <>
              <span className="text-goblin-700 font-normal">|</span>
              <span>
                {lang === 'ar' ? 'سعر الزوجي/المتعدد: ' : 'Multiplayer Rate: '}
                <strong className="text-goblin-50 font-semibold">{fmtMoney(ratePlan.hourlyMultiCents, lang)}/hr</strong>
              </span>
            </>
          )}
          {ratePlan.minimumCents > 0 && (
            <>
              <span className="text-goblin-700 font-normal">|</span>
              <span>
                {lang === 'ar' ? 'الحد الأدنى: ' : 'Min Charge: '}
                <strong className="text-goblin-50 font-semibold">{fmtMoney(ratePlan.minimumCents, lang)}</strong>
              </span>
            </>
          )}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3 px-4 py-3 w-full">
        {!session || session.status === 'STOPPED' || session.status === 'CANCELLED' ? (
          !paid && (
            <>
              <button
                disabled={busy}
                onClick={() => act(() => api('/sessions/start', { method: 'POST', body: { orderId: order.id, isMultiplayer: false } }))}
                className="inline-flex items-center gap-1.5 rounded-xl bg-goblin-500 px-5 py-2 font-bold hover:bg-goblin-400 active:scale-95 transition-all shadow"
              >
                <Play className="h-4 w-4" /> {t(lang, 'startSession')}{isMulti ? ` (${t(lang, 'single')})` : ''}
              </button>
              {isMulti && (
                <button
                  disabled={busy}
                  onClick={() => act(() => api('/sessions/start', { method: 'POST', body: { orderId: order.id, isMultiplayer: true } }))}
                  className="inline-flex items-center gap-1.5 rounded-xl bg-goblin-600 px-5 py-2 font-bold hover:bg-goblin-500 active:scale-95 transition-all shadow"
                >
                  <Play className="h-4 w-4" /> {t(lang, 'multiplayer')}
                </button>
              )}
              {session?.status === 'STOPPED' && (
                <span className="text-goblin-300">
                  {session.liveMinutes} {t(lang, 'minutes')} — {fmtMoney(session.liveCostCents, lang)}
                </span>
              )}
            </>
          )
        ) : (
          <>
            <span className={`inline-flex items-center gap-1.5 text-lg font-bold ${session.status === 'PAUSED' ? 'text-amber-300' : 'text-goblin-300'}`}>
              {session.status === 'PAUSED' ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />} {session.liveMinutes} {t(lang, 'minutes')}
            </span>
            <span className="text-xl font-bold text-yellow-300">{fmtMoney(session.liveCostCents, lang)}</span>
            {session.isMultiplayer && <span className="rounded bg-goblin-700 px-2 py-1 text-xs">{t(lang, 'multiplayer')}</span>}
            {session.status === 'RUNNING' ? (
              <button disabled={busy} onClick={() => act(() => api(`/sessions/${session.id}/pause`, { method: 'POST' }))}
                className="rounded-xl bg-goblin-800 px-4 py-2 hover:bg-goblin-700 transition-all">
                {t(lang, 'pauseSession')}
              </button>
            ) : (
              <button disabled={busy} onClick={() => act(() => api(`/sessions/${session.id}/resume`, { method: 'POST' }))}
                className="rounded-xl bg-goblin-600 px-4 py-2 font-semibold hover:bg-goblin-500 transition-all">
                {t(lang, 'resumeSession')}
              </button>
            )}
            {isMulti && session.status === 'RUNNING' && (
              <button disabled={busy}
                onClick={() => act(() => api(`/sessions/${session.id}/set-mode`, { method: 'POST', body: { isMultiplayer: !session.isMultiplayer } }))}
                className="inline-flex items-center gap-1.5 rounded-xl bg-goblin-800 px-4 py-2 text-sm hover:bg-goblin-700 transition-all">
                <ArrowLeftRight className="h-4 w-4" /> {session.isMultiplayer ? t(lang, 'single') : t(lang, 'multiplayer')}
              </button>
            )}
            {(session.prepaidBlocks?.length ?? 0) > 0 && (
              <span className="rounded bg-sky-800 px-2 py-1 text-xs animate-pulse">
                {t(lang, 'prepaidBlock')}: {session.prepaidBlocks!.reduce((a, b) => a + b.minutes, 0)} {t(lang, 'minutes')}
              </span>
            )}
            {can(user, 'payment.take') && (
              <button disabled={busy} onClick={() => setPrepaidOpen(true)}
                className="inline-flex items-center gap-1.5 rounded-xl bg-goblin-800 px-4 py-2 text-sm hover:bg-goblin-700 transition-all">
                <ClockPlus className="h-4 w-4" /> {t(lang, 'addMinutes')}
              </button>
            )}
            {can(user, 'session.transfer') && (
              <button disabled={busy} onClick={() => setMoving(true)}
                className="inline-flex items-center gap-1.5 rounded-xl bg-goblin-800 px-4 py-2 text-sm hover:bg-goblin-700 transition-all">
                <ArrowLeftRight className="h-4 w-4" /> {t(lang, 'moveSession')}
              </button>
            )}
            <button disabled={busy} onClick={() => act(() => api(`/sessions/${session.id}/stop`, { method: 'POST' }))}
              className="ms-auto inline-flex items-center gap-1.5 rounded-xl bg-red-700 px-5 py-2 font-bold hover:bg-red-600 active:scale-95 transition-all shadow">
              <Square className="h-4 w-4 fill-current" /> {t(lang, 'stopSession')}
            </button>
          </>
        )}
        {error && <span className="text-sm text-red-300">{error}</span>}
      </div>

      {moving && session && (
        <ResourcePicker title={t(lang, 'moveSession')} excludeResourceId={order.resourceId} blockActiveSessions
          onPick={(rid) => {
            setMoving(false);
            void act(() => api(`/sessions/${session.id}/transfer`, { method: 'POST', body: { toResourceId: rid } }));
          }}
          onClose={() => setMoving(false)} />
      )}
      {prepaidOpen && session && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70" onClick={() => setPrepaidOpen(false)}>
          <div className="w-full max-w-xs rounded-2xl bg-goblin-900 border border-goblin-800 p-5 text-goblin-50" onClick={(e) => e.stopPropagation()}>
            <h2 className="mb-3 text-lg font-bold">{t(lang, 'addMinutes')}</h2>
            <div className="mb-3 grid grid-cols-3 gap-2">
              {[30, 60, 120].map((m) => (
                <button key={m} onClick={() => setPrepaidMin(String(m))}
                  className={`rounded-xl py-3 font-bold transition-all ${prepaidMin === String(m) ? 'bg-goblin-500 text-white' : 'bg-goblin-950 text-goblin-400 hover:text-white'}`}>
                  {m}
                </button>
              ))}
            </div>
            <input type="number" inputMode="numeric" value={prepaidMin}
              onChange={(e) => setPrepaidMin(e.target.value)}
              className="mb-4 w-full rounded-xl bg-goblin-950 p-3 outline-none border border-goblin-800 focus:border-goblin-600" />
            <div className="flex gap-2">
              <button onClick={() => setPrepaidOpen(false)} className="flex-1 rounded-xl bg-goblin-800 py-3 hover:bg-goblin-700 transition-all">
                {t(lang, 'cancel')}
              </button>
              <button disabled={busy || !(Number(prepaidMin) > 0)}
                onClick={() => {
                  setPrepaidOpen(false);
                  void act(() => api(`/sessions/${session.id}/prepaid`, {
                    method: 'POST', body: { minutes: Math.round(Number(prepaidMin)) },
                  }));
                }}
                className="flex-1 rounded-xl bg-goblin-500 py-3 font-bold hover:bg-goblin-400 disabled:opacity-40 transition-all">
                {t(lang, 'confirm')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
