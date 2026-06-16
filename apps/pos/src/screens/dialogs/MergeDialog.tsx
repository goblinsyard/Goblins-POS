import { useEffect, useState } from 'react';
import { api } from '../../lib/api';
import { fmtMoney, t } from '../../lib/i18n';
import { usePos } from '../../lib/store';
import type { OpenOrderSummary } from '../../lib/types';

/** Merge this order's items into another open order. */
export function MergeDialog({ sourceOrderId, onMerged, onClose }: {
  sourceOrderId: string;
  onMerged: (targetOrderId: string) => void;
  onClose: () => void;
}) {
  const { lang } = usePos();
  const [orders, setOrders] = useState<OpenOrderSummary[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void api<OpenOrderSummary[]>('/orders/open').then((all) => setOrders(all.filter((o) => o.id !== sourceOrderId)));
  }, [sourceOrderId]);

  async function merge(targetOrderId: string) {
    setError(''); setBusy(true);
    try {
      await api(`/orders/${sourceOrderId}/merge`, { method: 'POST', body: { targetOrderId } });
      onMerged(targetOrderId);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70" onClick={onClose}>
      <div className="max-h-[85vh] w-full max-w-md overflow-auto rounded-2xl bg-goblin-900 border border-goblin-800 p-5 text-goblin-50" onClick={(e) => e.stopPropagation()}>
        <h2 className="mb-1 text-lg font-bold">{t(lang, 'mergeInto')}</h2>
        <p className="mb-3 text-sm text-goblin-400">{t(lang, 'selectOrder')}</p>
        {error && <p className="mb-2 rounded bg-red-900/60 p-2 text-sm text-red-200">{error}</p>}
        <div className="space-y-1">
          {orders.map((o) => (
            <button key={o.id} disabled={busy} onClick={() => void merge(o.id)}
              className="flex w-full justify-between rounded-xl bg-goblin-950 p-3 text-start active:bg-goblin-700">
              <span>
                #{o.number} · {o.resource?.name ?? o.type.replace('_', ' ')}
                {o.customer && <span className="text-goblin-400"> · {o.customer.name}</span>}
              </span>
              <span>{fmtMoney(o.totalCents, lang)}</span>
            </button>
          ))}
          {!orders.length && <p className="text-sm text-goblin-400">—</p>}
        </div>
        <button onClick={onClose} className="mt-4 w-full rounded-xl bg-goblin-800 py-3">{t(lang, 'cancel')}</button>
      </div>
    </div>
  );
}
