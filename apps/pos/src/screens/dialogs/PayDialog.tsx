import { useState } from 'react';
import { api } from '../../lib/api';
import { fmtMoney, t } from '../../lib/i18n';
import { usePos } from '../../lib/store';
import type { Order, PaymentMethod } from '../../lib/types';

interface Line {
  methodId: string;
  amountCents: number;
  tenderedCents?: number;
  tipCents?: number;
}

export function PayDialog({
  order, methods, onPaid, onClose,
}: {
  order: Order;
  methods: PaymentMethod[];
  onPaid: () => void;
  onClose: () => void;
}) {
  const { lang } = usePos();
  const due = order.totalCents - order.paidCents;
  const [lines, setLines] = useState<Line[]>([]);
  const [activeMethod, setActiveMethod] = useState<PaymentMethod | null>(null);
  const [amount, setAmount] = useState('');
  const [tendered, setTendered] = useState('');
  const [tip, setTip] = useState('');
  const [error, setError] = useState('');
  const [result, setResult] = useState<{ changeCents: number } | null>(null);
  const [focusedField, setFocusedField] = useState<'amount' | 'tendered' | 'tip'>('amount');

  function handleKeyPress(key: string) {
    const currentVal = focusedField === 'amount' ? amount : focusedField === 'tendered' ? tendered : tip;
    const setter = focusedField === 'amount' ? setAmount : focusedField === 'tendered' ? setTendered : setTip;

    if (key === 'C') {
      setter('');
    } else if (key === '⌫') {
      setter(currentVal.slice(0, -1));
    } else if (key === '.') {
      if (!currentVal.includes('.')) {
        setter(currentVal + '.');
      }
    } else {
      setter(currentVal + key);
    }
  }

  const allocated = lines.reduce((a, l) => a + l.amountCents, 0);
  const remaining = due - allocated;

  function addLine() {
    if (!activeMethod) return;
    const entered = amount ? Math.round(Number(amount) * 100) : remaining;
    if (entered <= 0) {
      setError(`Max ${fmtMoney(remaining, lang)}`);
      return;
    }
    // paying more than what's due is allowed — the excess becomes a tip
    const cents = Math.min(entered, remaining);
    const overpayTip = entered - cents;
    const line: Line = { methodId: activeMethod.id, amountCents: cents };
    if (activeMethod.kind === 'CASH' && tendered) {
      const tCents = Math.round(Number(tendered) * 100);
      if (tCents < entered) { setError('Tendered < amount'); return; }
      line.tenderedCents = tCents - overpayTip; // change is computed on the bill portion only
    }
    const explicitTip = tip ? Math.round(Number(tip) * 100) : 0;
    if (explicitTip < 0) { setError('Invalid tip'); return; }
    const totalTip = explicitTip + overpayTip;
    if (totalTip > 0) line.tipCents = totalTip;
    setLines([...lines, line]);
    setActiveMethod(null);
    setAmount('');
    setTendered('');
    setTip('');
    setError('');
  }

  async function submit() {
    setError('');
    try {
      const res = await api<{ fullyPaid: boolean; changeCents: number }>(`/orders/${order.id}/pay`, {
        method: 'POST',
        body: { payments: lines },
      });
      if (res.fullyPaid) setResult({ changeCents: res.changeCents });
      else onPaid();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error');
    }
  }

  if (result) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70">
        <div className="rounded-2xl bg-goblin-900 border border-goblin-800 p-8 text-center text-goblin-50">
          <p className="text-2xl font-bold text-goblin-300">{t(lang, 'paid')}</p>
          {result.changeCents > 0 && (
            <p className="mt-3 text-xl">
              {t(lang, 'change')}: <b>{fmtMoney(result.changeCents, lang)}</b>
            </p>
          )}
          <button onClick={onPaid} className="mt-6 w-full rounded-xl bg-goblin-500 px-8 py-3 font-bold text-white">
            {t(lang, 'receipt')}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70" onClick={onClose}>
      <div className="w-full max-w-md rounded-2xl bg-goblin-900 border border-goblin-800 p-5 text-goblin-50" onClick={(e) => e.stopPropagation()}>
        <h2 className="mb-2 text-xl font-bold">{t(lang, 'pay')}</h2>
        <p className="mb-4 text-3xl font-bold text-goblin-300">{fmtMoney(remaining, lang)}</p>
        {error && <p className="mb-2 rounded bg-red-900/60 p-2 text-sm text-red-200">{error}</p>}

        {lines.map((l, i) => {
          const m = methods.find((x) => x.id === l.methodId);
          return (
            <div key={i} className="mb-1 flex justify-between rounded bg-goblin-950 p-2 text-sm">
              <span>
                {m?.name}
                {(l.tipCents ?? 0) > 0 && <span className="ms-2 text-goblin-400">+{t(lang, 'tip')} {fmtMoney(l.tipCents!, lang)}</span>}
              </span>
              <span>
                {fmtMoney(l.amountCents, lang)}
                <button onClick={() => setLines(lines.filter((_, j) => j !== i))} className="ms-2 text-red-400">✕</button>
              </span>
            </div>
          );
        })}

        {remaining > 0 && !activeMethod && (
          <div className="mt-3 grid grid-cols-3 gap-2">
            {methods.map((m) => (
              <button key={m.id} onClick={() => setActiveMethod(m)} className="rounded-xl bg-goblin-800 py-4 font-semibold">
                {lang === 'ar' && m.nameAr ? m.nameAr : m.name}
              </button>
            ))}
          </div>
        )}

        {activeMethod && (
          <div className="mt-3 space-y-2">
            <p className="font-semibold">{activeMethod.name}</p>
            <input
              type="number" inputMode="decimal" placeholder={`${(remaining / 100).toFixed(2)}`}
              value={amount} onChange={(e) => setAmount(e.target.value)}
              onFocus={() => setFocusedField('amount')}
              className={`w-full rounded-xl bg-goblin-950 p-3 border-2 ${focusedField === 'amount' ? 'border-goblin-400' : 'border-transparent'}`}
            />
            {amount && Math.round(Number(amount) * 100) > remaining && (
              <p className="text-sm text-goblin-300">
                + {fmtMoney(Math.round(Number(amount) * 100) - remaining, lang)} {t(lang, 'tip')} ({t(lang, 'autoTip')})
              </p>
            )}
            {activeMethod.kind === 'CASH' && (
              <input
                type="number" inputMode="decimal" placeholder={t(lang, 'tendered')}
                value={tendered} onChange={(e) => setTendered(e.target.value)}
                onFocus={() => setFocusedField('tendered')}
                className={`w-full rounded-xl bg-goblin-950 p-3 border-2 ${focusedField === 'tendered' ? 'border-goblin-400' : 'border-transparent'}`}
              />
            )}
            <input
              type="number" inputMode="decimal" placeholder={`${t(lang, 'tip')} (EGP)`}
              value={tip} onChange={(e) => setTip(e.target.value)}
              onFocus={() => setFocusedField('tip')}
              className={`w-full rounded-xl bg-goblin-950 p-3 border-2 ${focusedField === 'tip' ? 'border-goblin-400' : 'border-transparent'}`}
            />

            {/* Touch Numpad Grid */}
            <div className="grid grid-cols-3 gap-2 mt-4 bg-goblin-950/40 p-3 rounded-2xl border border-goblin-800">
              {['7', '8', '9', '4', '5', '6', '1', '2', '3', 'C', '0', '.'].map((k) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => handleKeyPress(k)}
                  className="rounded-xl bg-goblin-800 py-3 text-lg font-bold hover:bg-goblin-750 active:bg-goblin-600 transition-all shadow-sm"
                >
                  {k}
                </button>
              ))}
              <button
                type="button"
                onClick={() => handleKeyPress('⌫')}
                className="col-span-3 rounded-xl bg-red-900/40 border border-red-800/60 py-2.5 font-bold hover:bg-red-900/60 active:bg-red-800 transition-all text-red-200 text-sm"
              >
                ⌫ {lang === 'ar' ? 'مسح التراجع' : 'Backspace'}
              </button>
            </div>

            <div className="flex gap-2 pt-2">
              <button onClick={() => setActiveMethod(null)} className="flex-1 rounded-xl bg-goblin-800 py-3">
                {t(lang, 'back')}
              </button>
              <button onClick={addLine} className="flex-1 rounded-xl bg-goblin-600 py-3 font-semibold">
                {t(lang, 'add')}
              </button>
            </div>
          </div>
        )}

        <button
          disabled={remaining !== 0 || lines.length === 0}
          onClick={() => void submit()}
          className="mt-4 w-full rounded-xl bg-goblin-500 py-4 text-lg font-bold text-white disabled:opacity-40"
        >
          {t(lang, 'confirm')}
        </button>
      </div>
    </div>
  );
}
