import { useState } from 'react';
import { Square, SquareCheck } from 'lucide-react';
import { api } from '../../lib/api';
import { fmtMoney, t } from '../../lib/i18n';
import { usePos } from '../../lib/store';
import type { Order } from '../../lib/types';

/** Split selected items off into a new bill on the same table. */
export function SplitDialog({ order, onSplit, onClose }: {
  order: Order;
  onSplit: (childOrderId: string) => void;
  onClose: () => void;
}) {
  const { lang } = usePos();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const splittable = order.items.filter((i) => i.status !== 'VOIDED' && !i.isTimeCharge);
  const allSelected = selected.size >= splittable.length && splittable.length > 0;

  function toggle(id: string) {
    setSelected((cur) => {
      const next = new Set(cur);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  async function submit() {
    setError(''); setBusy(true);
    try {
      const res = await api<{ child: { id: string } }>(`/orders/${order.id}/split`, {
        method: 'POST', body: { orderItemIds: [...selected] },
      });
      onSplit(res.child.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70" onClick={onClose}>
      <div className="max-h-[85vh] w-full max-w-md overflow-auto rounded-2xl bg-goblin-900 border border-goblin-800 p-5 text-goblin-50" onClick={(e) => e.stopPropagation()}>
        <h2 className="mb-1 text-lg font-bold">{t(lang, 'splitBill')}</h2>
        <p className="mb-3 text-sm text-goblin-400">{t(lang, 'selectItems')}</p>
        {error && <p className="mb-2 rounded bg-red-900/60 p-2 text-sm text-red-200">{error}</p>}
        <div className="space-y-1">
          {splittable.map((line) => (
            <button key={line.id} onClick={() => toggle(line.id)}
              className={`flex w-full justify-between rounded-xl p-3 text-start ${selected.has(line.id) ? 'bg-goblin-600' : 'bg-goblin-950'}`}>
              <span className="inline-flex items-center gap-1.5">
                {selected.has(line.id) ? <SquareCheck className="h-4 w-4 shrink-0" /> : <Square className="h-4 w-4 shrink-0" />}
                {Number(line.quantity) !== 1 && <b>{Number(line.quantity)}× </b>}
                {line.description}
              </span>
              <span>{fmtMoney(line.lineCents, lang)}</span>
            </button>
          ))}
        </div>
        {allSelected && (
          <p className="mt-2 text-xs text-amber-300">Leave at least one item on this bill.</p>
        )}
        <div className="mt-4 flex gap-2">
          <button onClick={onClose} className="flex-1 rounded-xl bg-goblin-800 py-3">{t(lang, 'cancel')}</button>
          <button disabled={busy || selected.size === 0 || allSelected} onClick={() => void submit()}
            className="flex-1 rounded-xl bg-goblin-500 py-3 font-bold text-white disabled:opacity-40">
            {t(lang, 'splitBill')} ({selected.size})
          </button>
        </div>
      </div>
    </div>
  );
}
