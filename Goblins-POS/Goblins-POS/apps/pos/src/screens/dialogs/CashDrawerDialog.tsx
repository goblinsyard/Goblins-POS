import { useState } from 'react';
import { Check, Timer } from 'lucide-react';
import { api } from '../../lib/api';
import { t, type TKey } from '../../lib/i18n';
import { usePos } from '../../lib/store';

const KINDS: { kind: 'PAID_IN' | 'PAID_OUT' | 'PETTY_CASH' | 'DRAWER_OPEN' | 'CASH_TRANSFER'; label: TKey }[] = [
  { kind: 'PAID_IN', label: 'paidIn' },
  { kind: 'PAID_OUT', label: 'paidOut' },
  { kind: 'PETTY_CASH', label: 'pettyCash' },
  { kind: 'CASH_TRANSFER', label: 'cashTransfer' },
  { kind: 'DRAWER_OPEN', label: 'openDrawer' },
];

/** Cash drawer movements: paid in/out, petty cash, no-sale drawer open. */
export function CashDrawerDialog({ shiftId, onClose }: { shiftId: string; onClose: () => void }) {
  const { lang } = usePos();
  const [kind, setKind] = useState<(typeof KINDS)[number]['kind']>('PAID_IN');
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);

  const needsAmount = kind !== 'DRAWER_OPEN';

  async function submit() {
    setError('');
    const cents = needsAmount ? Math.round(Number(amount) * 100) : 0;
    if (needsAmount && !(cents > 0)) { setError(t(lang, 'amount')); return; }
    if (!reason.trim()) { setError(t(lang, 'reason')); return; }
    try {
      await api(`/shifts/${shiftId}/cash-movement`, {
        method: 'POST', body: { kind, amountCents: cents, reason: reason.trim() },
      });
      setDone(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error');
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70" onClick={onClose}>
      <div className="w-full max-w-sm rounded-2xl bg-goblin-900 border border-goblin-800 p-5 text-goblin-50" onClick={(e) => e.stopPropagation()}>
        <h2 className="mb-3 text-lg font-bold">{t(lang, 'cashDrawer')}</h2>
        {done ? (
          <>
            <p className="flex items-center justify-center rounded-lg bg-goblin-700 p-3 font-semibold"><Check className="h-5 w-5" /></p>
            <button onClick={onClose} className="mt-4 w-full rounded-xl bg-goblin-600 py-3 font-semibold text-white">{t(lang, 'close')}</button>
          </>
        ) : (
          <>
            {error && <p className="mb-2 rounded bg-red-900/60 p-2 text-sm text-red-200">{error}</p>}
            <div className="mb-3 grid grid-cols-2 gap-2">
              {KINDS.map((k) => (
                <button key={k.kind} onClick={() => setKind(k.kind)}
                  className={`rounded-xl p-3 text-sm font-semibold ${kind === k.kind ? 'bg-goblin-600' : 'bg-goblin-950'} ${k.kind === 'DRAWER_OPEN' ? 'col-span-2' : ''}`}>
                  {t(lang, k.label)}
                </button>
              ))}
            </div>
            {needsAmount && (
              <input type="number" inputMode="decimal" placeholder={t(lang, 'amount')} value={amount}
                onChange={(e) => setAmount(e.target.value)}
                className="mb-2 w-full rounded-xl bg-goblin-950 p-3" />
            )}
            <input type="text" placeholder={t(lang, 'reason')} value={reason}
              onChange={(e) => setReason(e.target.value)}
              className="mb-4 w-full rounded-xl bg-goblin-950 p-3" />
            <div className="flex gap-2">
              <button onClick={onClose} className="flex-1 rounded-xl bg-goblin-800 py-3">{t(lang, 'cancel')}</button>
              <button onClick={() => void submit()} className="flex-1 rounded-xl bg-goblin-500 py-3 font-bold text-white">
                {t(lang, 'confirm')}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/** Clock in / clock out for the logged-in staff member. */
export function TimeClockDialog({ onClose }: { onClose: () => void }) {
  const { lang } = usePos();
  const [msg, setMsg] = useState('');
  const [error, setError] = useState('');

  async function punch(dir: 'in' | 'out') {
    setError(''); setMsg('');
    try {
      await api(`/admin/time-clock/${dir}`, { method: 'POST' });
      setMsg(`✓ ${t(lang, dir === 'in' ? 'clockIn' : 'clockOut')}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error');
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70" onClick={onClose}>
      <div className="w-full max-w-sm rounded-2xl bg-goblin-900 border border-goblin-800 p-5 text-goblin-50" onClick={(e) => e.stopPropagation()}>
        <h2 className="mb-3 flex items-center text-lg font-bold"><Timer className="h-5 w-5" /></h2>
        {error && <p className="mb-2 rounded bg-red-900/60 p-2 text-sm text-red-200">{error}</p>}
        {msg && <p className="mb-2 rounded bg-goblin-700 p-2 text-sm">{msg}</p>}
        <div className="flex gap-2">
          <button onClick={() => void punch('in')} className="flex-1 rounded-xl bg-goblin-600 py-4 font-bold text-white">
            {t(lang, 'clockIn')}
          </button>
          <button onClick={() => void punch('out')} className="flex-1 rounded-xl bg-goblin-800 py-4 font-bold">
            {t(lang, 'clockOut')}
          </button>
        </div>
        <button onClick={onClose} className="mt-3 w-full rounded-xl bg-goblin-950 py-3 text-goblin-300">{t(lang, 'close')}</button>
      </div>
    </div>
  );
}
