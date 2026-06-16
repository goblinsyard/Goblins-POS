import { useState } from 'react';
import { api } from '../../lib/api';
import { fmtMoney, t } from '../../lib/i18n';
import { usePos } from '../../lib/store';
import type { Order } from '../../lib/types';

/** Refund one of the order's payments (manager-gated server-side). */
export function RefundDialog({ order, onDone, onClose }: {
  order: Order;
  onDone: () => void;
  onClose: () => void;
}) {
  const { lang } = usePos();
  const payments = (order.payments ?? []).filter((p) => p.amountCents > 0);
  const [paymentId, setPaymentId] = useState(payments[0]?.id ?? '');
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit() {
    if (!paymentId || !reason.trim()) { setError(t(lang, 'reason')); return; }
    setError(''); setBusy(true);
    try {
      await api('/orders/refund', { method: 'POST', body: { paymentId, reason: reason.trim() } });
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70" onClick={onClose}>
      <div className="w-full max-w-sm rounded-2xl bg-goblin-900 border border-goblin-800 p-5 text-goblin-50" onClick={(e) => e.stopPropagation()}>
        <h2 className="mb-3 text-lg font-bold">{t(lang, 'refund')} — #{order.number}</h2>
        {error && <p className="mb-2 rounded bg-red-900/60 p-2 text-sm text-red-200">{error}</p>}
        <div className="mb-3 space-y-1">
          {payments.map((p) => (
            <button key={p.id} onClick={() => setPaymentId(p.id)}
              className={`flex w-full justify-between rounded-xl p-3 ${p.id === paymentId ? 'bg-goblin-600' : 'bg-goblin-950'}`}>
              <span>{p.method?.name ?? '—'}</span>
              <span>{fmtMoney(p.amountCents, lang)}</span>
            </button>
          ))}
          {!payments.length && <p className="text-sm text-goblin-400">—</p>}
        </div>
        <input type="text" placeholder={t(lang, 'reason')} value={reason}
          onChange={(e) => setReason(e.target.value)}
          className="mb-4 w-full rounded-xl bg-goblin-950 p-3" />
        <div className="flex gap-2">
          <button onClick={onClose} className="flex-1 rounded-xl bg-goblin-800 py-3">{t(lang, 'cancel')}</button>
          <button disabled={busy || !paymentId || !reason.trim()} onClick={() => void submit()}
            className="flex-1 rounded-xl bg-red-700 py-3 font-bold disabled:opacity-40">
            {t(lang, 'refund')}
          </button>
        </div>
      </div>
    </div>
  );
}
