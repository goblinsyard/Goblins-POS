import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { fmtMoney, t } from '../lib/i18n';
import { can, usePos } from '../lib/store';
import type { Shift } from '../lib/types';

interface Report {
  orderCount: number;
  grossCents: number;
  discountCents: number;
  taxCents: number;
  serviceChargeCents: number;
  tipsCents: number;
  voidedCount: number;
  byMethod: Record<string, { count: number; amountCents: number }>;
  byDepartment: Record<string, number>;
  cash: { floatCents: number; salesCents: number; movementsCents: number; expectedCents: number };
  varianceCents?: number;
}

export function ShiftDialogs({ kind, onClose }: { kind: 'open' | 'close' | 'x'; onClose: () => void }) {
  const { shift, lang, refreshShift, user } = usePos();
  const [amount, setAmount] = useState('');
  const [report, setReport] = useState<Report | null>(null);
  const [tipsPreview, setTipsPreview] = useState<number | null>(null);
  const [error, setError] = useState('');
  const [counts, setCounts] = useState<Record<number, string>>({
    200: '',
    100: '',
    50: '',
    20: '',
    10: '',
    5: '',
    1: '',
  });

  function updateCount(denom: number, val: string) {
    const nextCounts = { ...counts, [denom]: val };
    setCounts(nextCounts);
    let total = 0;
    for (const [d, countStr] of Object.entries(nextCounts)) {
      const c = parseInt(countStr || '0', 10);
      if (!isNaN(c) && c > 0) {
        total += Number(d) * c;
      }
    }
    setAmount(total > 0 ? String(total) : '');
  }

  useEffect(() => {
    if (shift && (kind === 'x' || kind === 'close')) {
      api<Report>(`/shifts/${shift.id}/x-report`)
        .then((r) => {
          if (kind === 'x') {
            setReport(r);
          } else {
            setTipsPreview(r.tipsCents);
          }
        })
        .catch((e) => setError(String(e.message)));
    }
  }, [kind, shift]);

  async function submit() {
    setError('');
    try {
      const cents = Math.round(Number(amount || '0') * 100);
      if (kind === 'open') {
        await api<Shift>('/shifts/open', { method: 'POST', body: { floatCents: cents } });
        await refreshShift();
        onClose();
      } else if (kind === 'close' && shift) {
        const res = await api<{ zReport: Report }>(`/shifts/${shift.id}/close`, {
          method: 'POST',
          body: { countedCents: cents },
        });
        setReport(res.zReport);
        await refreshShift();
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error');
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70" onClick={onClose}>
      <div
        className="max-h-[90vh] w-full max-w-md overflow-auto rounded-2xl bg-goblin-900 p-6 text-goblin-50 border border-goblin-800"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="mb-4 text-xl font-bold">
          {t(lang, kind === 'open' ? 'openShift' : kind === 'close' ? 'closeShift' : 'xReport')}
        </h2>
        {error && <p className="mb-3 rounded bg-red-900/60 p-2 text-red-200">{error}</p>}

        {report ? (
          <div className="space-y-1 font-mono text-sm">
            {!can(user, 'report.view') ? (
              <>
                <div className="rounded-xl bg-goblin-850 p-4 text-center border border-goblin-700/50 mb-3">
                  <div className="text-xs uppercase text-goblin-400 tracking-wider mb-1 font-semibold">
                    {kind === 'x'
                      ? (lang === 'ar' ? 'البقشيش المجموع حالياً' : 'Current Tips Collected')
                      : (lang === 'ar' ? 'البقشيش المراد نقله' : 'Tips to Move Out')}
                  </div>
                  <div className="text-2xl font-bold text-emerald-400 font-sans">
                    {fmtMoney(report.tipsCents, lang)}
                  </div>
                </div>
                <p className="text-xs text-goblin-400 text-center mb-4 leading-relaxed">
                  {kind === 'x'
                    ? (lang === 'ar'
                      ? 'هذا هو تقرير الوردية المؤقت. المبلغ المعروض يمثل إجمالي البقشيش الذي تم تحصيله حتى الآن.'
                      : 'This is a mid-shift report. The amount shown represents total tips collected so far.')
                    : (lang === 'ar'
                      ? 'تم إغلاق الوردية بنجاح. يرجى نقل هذا المبلغ إلى درج البقشيش.'
                      : 'Shift closed successfully. Please move this amount to the tips drawer.')}
                </p>
              </>
            ) : (
              <>
                <Row k="Orders" v={String(report.orderCount)} />
                <Row k="Gross" v={fmtMoney(report.grossCents, lang)} />
                <Row k="Service" v={fmtMoney(report.serviceChargeCents, lang)} />
                <Row k="VAT" v={fmtMoney(report.taxCents, lang)} />
                <Row k="Discounts" v={fmtMoney(report.discountCents, lang)} />
                <Row k="Tips" v={fmtMoney(report.tipsCents, lang)} />
                <Row k="Voids" v={String(report.voidedCount)} />
                <hr className="border-goblin-700" />
                {Object.entries(report.byDepartment).map(([k, v]) => (
                  <Row key={k} k={k} v={fmtMoney(v, lang)} />
                ))}
                <hr className="border-goblin-700" />
                {Object.entries(report.byMethod).map(([k, v]) => (
                  <Row key={k} k={`${k} (${v.count})`} v={fmtMoney(v.amountCents, lang)} />
                ))}
                <hr className="border-goblin-700" />
                <Row k="Float" v={fmtMoney(report.cash.floatCents, lang)} />
                <Row k="Expected cash" v={fmtMoney(report.cash.expectedCents, lang)} />
                {report.varianceCents != null && (
                  <Row
                    k="Variance"
                    v={fmtMoney(report.varianceCents, lang)}
                    cls={report.varianceCents === 0 ? 'text-goblin-300' : 'text-red-400'}
                  />
                )}
              </>
            )}
            <button onClick={onClose} className="mt-4 w-full rounded-xl bg-goblin-600 py-3 font-semibold text-white">
              {t(lang, 'close')}
            </button>
          </div>
        ) : (
          kind !== 'x' && (
            <>
              {kind === 'close' && tipsPreview !== null && (
                <div className="mb-4 rounded-xl bg-emerald-950/40 p-4 border border-emerald-800/40">
                  <div className="text-xs uppercase text-emerald-400 font-semibold tracking-wider mb-1">
                    {lang === 'ar' ? 'البقشيش المراد نقله' : 'Tips to Move Out'}
                  </div>
                  <div className="text-xl font-bold text-white font-mono">
                    {fmtMoney(tipsPreview, lang)}
                  </div>
                  <p className="text-[10px] text-emerald-300/80 mt-1 leading-normal">
                    {lang === 'ar'
                      ? 'يرجى إخراج هذا المبلغ من الدرج وضعه في درج البقشيش قبل عد الكاش.'
                      : 'Please remove this amount from the till and place it in the tips drawer before counting.'}
                  </p>
                </div>
              )}
              <label className="mb-2 block text-sm text-goblin-300">
                {t(lang, kind === 'open' ? 'float' : 'countedCash')}
              </label>
              <input
                autoFocus
                type="number"
                inputMode="decimal"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                className="mb-4 w-full rounded-xl bg-goblin-950 p-3 text-xl text-goblin-50 font-bold focus:outline-none focus:ring-2 focus:ring-goblin-500"
              />

              <div className="mb-4 rounded-xl border border-goblin-700/40 bg-goblin-950/30 p-4">
                <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-goblin-400">
                  {lang === 'ar' ? 'حاسبة الفئات الورقية' : 'Denomination Calculator'}
                </h3>
                <div className="grid grid-cols-2 gap-2">
                  {[200, 100, 50, 20, 10, 5, 1].map((denom) => (
                    <div key={denom} className="flex items-center gap-2 rounded-lg bg-goblin-900/50 p-2 border border-goblin-800/40">
                      <span className="w-16 text-xs font-semibold text-goblin-300 font-mono">{denom} EGP</span>
                      <span className="text-xs text-goblin-600">×</span>
                      <input
                        type="number"
                        min="0"
                        placeholder="0"
                        value={counts[denom] ?? ''}
                        onChange={(e) => updateCount(denom, e.target.value)}
                        className="w-full rounded bg-goblin-950/80 p-1 text-center text-xs font-semibold font-mono text-goblin-50 focus:outline-none focus:ring-1 focus:ring-goblin-600"
                      />
                    </div>
                  ))}
                </div>
                {Object.values(counts).some(v => v !== '') && (
                  <button
                    type="button"
                    onClick={() => {
                      setCounts({ 200: '', 100: '', 50: '', 20: '', 10: '', 5: '', 1: '' });
                      setAmount('');
                    }}
                    className="mt-3 block text-right text-xs text-red-400 hover:text-red-300 font-medium cursor-pointer bg-transparent border-0 p-0"
                  >
                    {lang === 'ar' ? 'مسح الفئات' : 'Clear Counts'}
                  </button>
                )}
              </div>

              <div className="flex gap-2">
                <button onClick={onClose} className="flex-1 rounded-xl bg-goblin-800 py-3">
                  {t(lang, 'cancel')}
                </button>
                <button onClick={() => void submit()} className="flex-1 rounded-xl bg-goblin-600 py-3 font-semibold text-white">
                  {t(lang, 'confirm')}
                </button>
              </div>
            </>
          )
        )}
      </div>
    </div>
  );
}

function Row({ k, v, cls = '' }: { k: string; v: string; cls?: string }) {
  return (
    <div className={`flex justify-between ${cls}`}>
      <span className="text-goblin-300">{k}</span>
      <span>{v}</span>
    </div>
  );
}
