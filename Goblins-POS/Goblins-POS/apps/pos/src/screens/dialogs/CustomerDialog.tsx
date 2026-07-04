import { useEffect, useState } from 'react';
import { Cake, Check, Plus, Star } from 'lucide-react';
import { api } from '../../lib/api';
import { fmtMoney, t } from '../../lib/i18n';
import { can, usePos } from '../../lib/store';
import type { Order } from '../../lib/types';

interface CrmCustomer {
  id: string; name: string; phone: string; pointsBalance: number; visitCount: number;
  tier?: { name: string } | null;
}
interface PosFlags {
  id: string; name: string; tier?: string | null;
  pointsBalance: number; visitCount: number; birthdayThisWeek: boolean;
  group?: { name: string; discountBps: number } | null;
  walletBalanceCents: number;
}

/** Attach a customer to the order, show loyalty flags, redeem points. */
export function CustomerDialog({ order, seat, onChanged, onClose }: {
  order: Order;
  seat?: number;
  onChanged: () => void;
  onClose: () => void;
}) {
  const { user, lang } = usePos();
  const [phone, setPhone] = useState('');
  const [results, setResults] = useState<CrmCustomer[]>([]);
  const [flags, setFlags] = useState<PosFlags | null>(null);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [points, setPoints] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const attached = seat ? (order.seatCustomers?.find((sc) => sc.seat === seat)?.customer ?? null) : (order.customer ?? null);
  const due = order.totalCents - order.paidCents;

  useEffect(() => {
    if (attached) {
      api<PosFlags>(`/crm/customers/${attached.id}/pos-flags`).then(setFlags).catch(() => setFlags(null));
    } else {
      setFlags(null);
    }
  }, [attached]);

  // live search: saved customers show immediately, then filter by name/phone as you type
  useEffect(() => {
    if (attached) return;
    const handle = setTimeout(() => {
      api<CrmCustomer[]>(`/crm/customers/lookup?q=${encodeURIComponent(phone)}&onlyActive=true`)
        .then(setResults)
        .catch((e) => setError(e instanceof Error ? e.message : 'Error'));
    }, phone ? 250 : 0);
    return () => clearTimeout(handle);
  }, [phone, attached]);

  async function run(fn: () => Promise<unknown>, after?: () => void) {
    setError(''); setBusy(true);
    try { await fn(); after?.(); }
    catch (e) { setError(e instanceof Error ? e.message : 'Error'); }
    finally { setBusy(false); }
  }

  const attach = (customerId: string) => run(
    () => seat
      ? api(`/orders/${order.id}/seats/${seat}/customer`, { method: 'POST', body: { customerId } })
      : api(`/orders/${order.id}/customer`, { method: 'POST', body: { customerId } }),
    onChanged,
  );

  const detach = () => run(
    () => seat
      ? api(`/orders/${order.id}/seats/${seat}/customer`, { method: 'POST', body: { customerId: null } })
      : api(`/orders/${order.id}/customer`, { method: 'POST', body: { customerId: null } }),
    onChanged,
  );

  const createAndAttach = () => run(async () => {
    if (!newName.trim() || !phone.trim()) throw new Error(`${t(lang, 'name')} + ${t(lang, 'phone')}`);
    const c = await api<CrmCustomer>('/crm/customers', {
      method: 'POST', body: { name: newName.trim(), phone: phone.trim() },
    });
    if (seat) {
      await api(`/orders/${order.id}/seats/${seat}/customer`, { method: 'POST', body: { customerId: c.id } });
    } else {
      await api(`/orders/${order.id}/customer`, { method: 'POST', body: { customerId: c.id } });
    }
  }, onChanged);

  const redeem = () => run(async () => {
    const n = Math.round(Number(points));
    if (!(n > 0) || !attached) throw new Error(t(lang, 'points'));
    await api('/crm/redeem', { method: 'POST', body: { customerId: attached.id, points: n, orderId: order.id } });
    setPoints('');
  }, onChanged);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70" onClick={onClose}>
      <div className="max-h-[85vh] w-full max-w-md overflow-auto rounded-2xl bg-goblin-900 border border-goblin-800 p-5 text-goblin-50" onClick={(e) => e.stopPropagation()}>
        <h2 className="mb-3 text-lg font-bold">{t(lang, 'customer')}</h2>
        {error && <p className="mb-2 rounded bg-red-900/60 p-2 text-sm text-red-200">{error}</p>}

        {attached ? (
          <div className="space-y-3">
            <div className="rounded-xl bg-goblin-950 p-4">
              <p className="text-lg font-bold">{attached.name}</p>
              <p className="text-sm text-goblin-400">{attached.phone}</p>
              {flags && (
                <p className="mt-2 text-sm text-goblin-300">
                  {flags.group && (
                    <span className="me-2 rounded bg-emerald-700/70 px-2 py-0.5">
                      {flags.group.name} −{(flags.group.discountBps / 100).toFixed(0)}%
                    </span>
                  )}
                  {flags.tier && <span className="me-2 rounded bg-amber-700/60 px-2 py-0.5">{flags.tier}</span>}
                  <b>{flags.pointsBalance}</b> {t(lang, 'points')} · <b>{fmtMoney(flags.walletBalanceCents, lang)}</b> {t(lang, 'wallet')} · {flags.visitCount} {t(lang, 'visits')}
                </p>
              )}
              {flags?.birthdayThisWeek && (
                <p className="mt-2 flex items-center gap-1.5 rounded-lg bg-pink-900/60 px-2 py-1 text-sm text-pink-200"><Cake className="h-4 w-4 shrink-0" /> {t(lang, 'birthdayThisWeek')}</p>
              )}
            </div>
            {!seat && order.status === 'OPEN' && due > 0 && can(user, 'payment.take') && (flags?.pointsBalance ?? 0) > 0 && (
              <div className="rounded-xl bg-goblin-950 p-4">
                <p className="mb-2 text-sm font-semibold">{t(lang, 'redeemPoints')} (1 pt = 1 EGP)</p>
                <div className="flex gap-2">
                  <input type="number" inputMode="numeric" value={points}
                    onChange={(e) => setPoints(e.target.value)}
                    placeholder={String(Math.min(flags?.pointsBalance ?? 0, Math.floor(due / 100)))}
                    className="flex-1 rounded-xl bg-goblin-900 p-3" />
                  <button disabled={busy} onClick={() => void redeem()}
                    className="rounded-xl bg-goblin-500 px-5 font-bold text-white disabled:opacity-40">
                    {t(lang, 'redeemPoints')}
                  </button>
                </div>
              </div>
            )}
            {order.status === 'OPEN' && (
              <button disabled={busy} onClick={() => void detach()} className="w-full rounded-xl bg-goblin-800 py-3 text-sm text-goblin-300">
                {t(lang, 'detach')}
              </button>
            )}
          </div>
        ) : (
          <div className="space-y-3">
            <input type="text" placeholder={`${t(lang, 'search')} — ${t(lang, 'name')} / ${t(lang, 'phone')}`}
              value={phone} autoFocus
              onChange={(e) => setPhone(e.target.value)}
              className="w-full rounded-xl bg-goblin-950 p-3" />
            <div className="max-h-72 space-y-1 overflow-auto">
              {results.map((c) => (
                <button key={c.id} disabled={busy} onClick={() => void attach(c.id)}
                  className="flex w-full justify-between rounded-xl bg-goblin-950 p-3 text-start active:bg-goblin-700">
                  <span>{c.name} <span className="text-goblin-400">{c.phone}</span></span>
                  <span className="text-goblin-300">{c.pointsBalance} {t(lang, 'points')}</span>
                </button>
              ))}
              {!results.length && <p className="p-2 text-sm text-goblin-400">—</p>}
            </div>
            {can(user, 'customer.manage') && (creating ? (
              <div className="space-y-2 rounded-xl bg-goblin-950 p-3">
                <input type="text" placeholder={t(lang, 'name')} value={newName} autoFocus
                  onChange={(e) => setNewName(e.target.value)}
                  className="w-full rounded-xl bg-goblin-900 p-3" />
                <button disabled={busy || !newName.trim() || !phone.trim()} onClick={() => void createAndAttach()}
                  className="w-full inline-flex items-center justify-center gap-1.5 rounded-xl bg-goblin-500 py-3 font-bold text-white disabled:opacity-40">
                  {t(lang, 'newCustomer')} <Check className="h-4 w-4" />
                </button>
              </div>
            ) : (
              <button onClick={() => setCreating(true)} className="w-full inline-flex items-center justify-center gap-1.5 rounded-xl bg-goblin-800 py-3">
                <Plus className="h-4 w-4" /> {t(lang, 'newCustomer')}
              </button>
            ))}
          </div>
        )}
        <button onClick={onClose} className="mt-4 w-full rounded-xl bg-goblin-800 py-3">{t(lang, 'close')}</button>
      </div>
    </div>
  );
}

/** Quick star rating after payment. */
export function FeedbackDialog({ orderId, onClose }: { orderId: string; onClose: () => void }) {
  const { lang } = usePos();
  const [rating, setRating] = useState(0);
  const [comment, setComment] = useState('');
  const [sent, setSent] = useState(false);
  const [error, setError] = useState('');

  async function submit() {
    setError('');
    try {
      await api('/crm/feedback', {
        method: 'POST', body: { orderId, rating, comment: comment.trim() || undefined },
      });
      setSent(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error');
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70" onClick={onClose}>
      <div className="w-full max-w-sm rounded-2xl bg-goblin-900 border border-goblin-800 p-5 text-center text-goblin-50" onClick={(e) => e.stopPropagation()}>
        {sent ? (
          <>
            <p className="text-2xl font-bold text-goblin-300">{t(lang, 'thanks')}</p>
            <button onClick={onClose} className="mt-5 w-full rounded-xl bg-goblin-600 py-3 font-semibold text-white">{t(lang, 'close')}</button>
          </>
        ) : (
          <>
            <h2 className="mb-4 text-lg font-bold">{t(lang, 'feedback')}</h2>
            {error && <p className="mb-2 rounded bg-red-900/60 p-2 text-sm text-red-200">{error}</p>}
            <div className="mb-4 flex justify-center gap-2 text-amber-400" dir="ltr">
              {[1, 2, 3, 4, 5].map((n) => (
                <button key={n} onClick={() => setRating(n)} className={n <= rating ? '' : 'opacity-30'}>
                  <Star className={`h-9 w-9 ${n <= rating ? 'fill-current' : ''}`} />
                </button>
              ))}
            </div>
            <input type="text" placeholder={t(lang, 'comment')} value={comment}
              onChange={(e) => setComment(e.target.value)}
              className="mb-4 w-full rounded-xl bg-goblin-950 p-3" />
            <div className="flex gap-2">
              <button onClick={onClose} className="flex-1 rounded-xl bg-goblin-800 py-3">{t(lang, 'cancel')}</button>
              <button disabled={rating === 0} onClick={() => void submit()}
                className="flex-1 rounded-xl bg-goblin-500 py-3 font-bold text-white disabled:opacity-40">
                {t(lang, 'confirm')}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
