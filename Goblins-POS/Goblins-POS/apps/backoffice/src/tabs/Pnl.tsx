import { useEffect, useState } from 'react';
import { api, egp, pct } from '../lib/api';
import { Btn, Card, ErrorBanner, Field, Select, Spinner, Table, TextInput } from '../lib/ui';

interface DeptData {
  revenueCents: number;
  cogsCents: number;
  wasteCents: number;
  grossProfitCents: number;
  directExpensesCents: number;
  allocatedOverheadCents: number;
  totalExpensesCents: number;
  netCents: number;
  marginPctBps: number;
}

interface Pnl {
  allocationMethod: 'revenue' | 'manual';
  allocationRatios: Record<string, number>;
  revenueCents: number;
  cogsCents: number;
  wasteCents: number;
  grossProfitCents: number;
  expensesCents: number;
  netCents: number;
  vatCollectedCents: number;
  serviceChargeCents: number;
  expensesByCategory: Record<string, number>;
  departmentalBreakdown: Record<string, DeptData>;
}

export function PnlView() {
  const [from, setFrom] = useState(new Date(Date.now() - 14 * 86400_000).toISOString().slice(0, 10));
  const [to, setTo] = useState(new Date().toISOString().slice(0, 10));
  
  const [pnl, setPnl] = useState<Pnl | null>(null);
  const [loading, setLoading] = useState(true);
  const [savingSettings, setSavingSettings] = useState(false);
  const [err, setErr] = useState('');

  const [costs, setCosts] = useState<{ name: string; category: string; priceCents: number; costCents: number; costPctBps: number }[]>([]);
  const [me, setMe] = useState<{ name: string; class: string; quantitySold: number; revenueCents: number; unitMarginCents: number }[]>([]);

  // Allocation form state
  const [allocMethod, setAllocMethod] = useState('revenue');
  const [ratioRest, setRatioRest] = useState('40');
  const [ratioBar, setRatioBar] = useState('20');
  const [ratioBill, setRatioBill] = useState('20');
  const [ratioPs, setRatioPs] = useState('20');

  function reloadPnl() {
    setLoading(true);
    api<Pnl>(`/expenses/pnl?from=${encodeURIComponent(new Date(from).toISOString())}&to=${encodeURIComponent(new Date(to).toISOString())}`)
      .then((data) => {
        setPnl(data);
        setLoading(false);
      })
      .catch((e) => {
        setErr(e.message);
        setLoading(false);
      });
  }

  useEffect(() => {
    reloadPnl();
  }, [from, to]);

  useEffect(() => {
    void api<typeof costs>('/costing/items').then(setCosts);
    void api<typeof me>('/costing/menu-engineering').then(setMe);
    void api<Record<string, any>>('/settings').then((s) => {
      setAllocMethod(String(s['expense.allocationMethod'] ?? 'revenue'));
      setRatioRest(String((Number(s['expense.allocationManual.RESTAURANT'] ?? 4000)) / 100));
      setRatioBar(String((Number(s['expense.allocationManual.BAR'] ?? 2000)) / 100));
      setRatioBill(String((Number(s['expense.allocationManual.BILLIARDS'] ?? 2000)) / 100));
      setRatioPs(String((Number(s['expense.allocationManual.PLAYSTATION'] ?? 2000)) / 100));
    });
  }, []);

  async function saveAllocationSettings() {
    setSavingSettings(true);
    setErr('');
    try {
      const restBps = Math.round(Number(ratioRest) * 100);
      const barBps = Math.round(Number(ratioBar) * 100);
      const billBps = Math.round(Number(ratioBill) * 100);
      const psBps = Math.round(Number(ratioPs) * 100);

      if (allocMethod === 'manual' && (isNaN(restBps) || isNaN(barBps) || isNaN(billBps) || isNaN(psBps))) {
        throw new Error('All allocation percentages must be valid numbers');
      }

      await api('/settings', {
        method: 'PUT',
        body: {
          'expense.allocationMethod': allocMethod,
          'expense.allocationManual.RESTAURANT': restBps,
          'expense.allocationManual.BAR': barBps,
          'expense.allocationManual.BILLIARDS': billBps,
          'expense.allocationManual.PLAYSTATION': psBps
        }
      });
      reloadPnl();
    } catch (e: any) {
      setErr(e.message || 'Failed to save settings');
    } finally {
      setSavingSettings(false);
    }
  }

  if (loading && !pnl) return <Spinner />;

  const badge: Record<string, string> = {
    STAR: 'bg-amber-100 text-amber-800',
    PLOWHORSE: 'bg-blue-100 text-blue-800',
    PUZZLE: 'bg-purple-100 text-purple-800',
    DOG: 'bg-red-100 text-red-700',
  };

  const cents = (val: number | undefined) => egp(val ?? 0);
  const depts = ['Restaurant', 'Bar', 'Billiards', 'PlayStation'];

  return (
    <div className="space-y-6">
      {/* Date Range Picker */}
      <div className="flex flex-wrap items-center gap-3 bg-white p-4 rounded-xl shadow-sm">
        <div className="w-44">
          <Field label="From Date">
            <TextInput value={from} onChange={setFrom} type="date" />
          </Field>
        </div>
        <div className="w-44">
          <Field label="To Date">
            <TextInput value={to} onChange={setTo} type="date" />
          </Field>
        </div>
        <div className="ml-auto self-end pb-1">
          <Btn onClick={reloadPnl} disabled={loading}>{loading ? 'Loading…' : 'Refresh'}</Btn>
        </div>
      </div>

      {err && <ErrorBanner message={err} />}

      {pnl && (
        <>
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <Card title="Revenue" value={cents(pnl.revenueCents)} />
            <Card title="COGS" value={cents(pnl.cogsCents)} />
            <Card title="Gross profit" value={cents(pnl.grossProfitCents)} />
            <Card title="Net Profit" value={cents(pnl.netCents)} />
          </div>

          {/* Departmental Allocation spreadsheet */}
          <div className="rounded-xl bg-white p-5 shadow-sm overflow-x-auto">
            <h2 className="mb-3 font-semibold text-slate-700 text-base">Departmental Performance Spreadsheet</h2>
            <table className="w-full text-sm border-collapse text-left">
              <thead>
                <tr className="border-b bg-slate-50 text-slate-500 font-semibold">
                  <th className="p-3">Metrics</th>
                  {depts.map((d) => (
                    <th key={d} className="p-3 text-right">{d}</th>
                  ))}
                  <th className="p-3 text-right font-bold text-slate-800 bg-slate-100 font-mono">Total</th>
                </tr>
              </thead>
              <tbody className="divide-y text-slate-600 font-mono">
                <tr>
                  <td className="p-3 font-medium text-slate-700 font-sans">Revenue</td>
                  {depts.map((d) => (
                    <td key={d} className="p-3 text-right">{cents(pnl.departmentalBreakdown[d]?.revenueCents)}</td>
                  ))}
                  <td className="p-3 text-right font-bold text-slate-800 bg-slate-100">{cents(pnl.revenueCents)}</td>
                </tr>
                <tr>
                  <td className="p-3 font-medium text-slate-700 font-sans">Cost of Goods (COGS)</td>
                  {depts.map((d) => (
                    <td key={d} className="p-3 text-right text-red-600">-{cents(pnl.departmentalBreakdown[d]?.cogsCents)}</td>
                  ))}
                  <td className="p-3 text-right font-bold text-red-600 bg-slate-100">-{cents(pnl.cogsCents)}</td>
                </tr>
                <tr className="bg-emerald-50/50 font-medium">
                  <td className="p-3 text-emerald-800 font-semibold font-sans">Gross Profit</td>
                  {depts.map((d) => (
                    <td key={d} className="p-3 text-right text-emerald-700">{cents(pnl.departmentalBreakdown[d]?.grossProfitCents)}</td>
                  ))}
                  <td className="p-3 text-right font-bold text-emerald-800 bg-emerald-100/80">{cents(pnl.grossProfitCents)}</td>
                </tr>
                <tr>
                  <td className="p-3 font-medium text-slate-700 font-sans">Direct Expenses</td>
                  {depts.map((d) => (
                    <td key={d} className="p-3 text-right text-red-600">-{cents(pnl.departmentalBreakdown[d]?.directExpensesCents)}</td>
                  ))}
                  <td className="p-3 text-right font-bold text-red-600 bg-slate-100">-{cents(Object.values(pnl.departmentalBreakdown).reduce((a, b) => a + b.directExpensesCents, 0))}</td>
                </tr>
                <tr>
                  <td className="p-3 font-medium text-slate-700 font-sans">
                    Allocated Overhead ({pnl.allocationMethod === 'revenue' ? 'Rev Share' : 'Manual'})
                  </td>
                  {depts.map((d) => (
                    <td key={d} className="p-3 text-right text-red-600">
                      -{cents(pnl.departmentalBreakdown[d]?.allocatedOverheadCents)}
                      <span className="text-[10px] text-slate-400 block font-sans">({pct((pnl.allocationRatios[d] ?? 0) * 10000)})</span>
                    </td>
                  ))}
                  <td className="p-3 text-right font-bold text-red-600 bg-slate-100">-{cents(Object.values(pnl.departmentalBreakdown).reduce((a, b) => a + b.allocatedOverheadCents, 0))}</td>
                </tr>
                <tr className="bg-[#fafafa] font-medium">
                  <td className="p-3 font-semibold text-slate-700 font-sans">Total Expenses</td>
                  {depts.map((d) => (
                    <td key={d} className="p-3 text-right text-red-600">-{cents(pnl.departmentalBreakdown[d]?.totalExpensesCents)}</td>
                  ))}
                  <td className="p-3 text-right font-bold text-red-600 bg-slate-100">-{cents(pnl.expensesCents)}</td>
                </tr>
                <tr className="bg-blue-50 font-bold border-t-2 border-blue-200">
                  <td className="p-3 text-blue-800 font-sans">Net Profit / Section</td>
                  {depts.map((d) => (
                    <td key={d} className={`p-3 text-right ${(pnl.departmentalBreakdown[d]?.netCents ?? 0) < 0 ? 'text-red-700' : 'text-blue-700'}`}>
                      {cents(pnl.departmentalBreakdown[d]?.netCents)}
                      <span className="text-[10px] text-slate-500 block font-sans">({pct(pnl.departmentalBreakdown[d]?.marginPctBps ?? 0)})</span>
                    </td>
                  ))}
                  <td className="p-3 text-right text-blue-900 bg-blue-100">{cents(pnl.netCents)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </>
      )}

      {/* Expense Allocation Configuration Panel */}
      <div className="rounded-xl bg-white p-5 shadow-sm max-w-xl">
        <h2 className="mb-3 font-semibold text-slate-700 text-sm uppercase tracking-wider">Overhead Allocation Settings</h2>
        <div className="space-y-4">
          <Field label="Overhead Allocation Method">
            <Select value={allocMethod} onChange={setAllocMethod}
              options={[{ value: 'revenue', label: 'Revenue Share (Dynamic percentage of sales)' }, { value: 'manual', label: 'Manual Percentage (Fixed Square Footage)' }]} />
          </Field>
          
          {allocMethod === 'manual' && (
            <div className="grid grid-cols-4 gap-3 bg-slate-50 p-3 rounded-lg border">
              <Field label="Rest. %">
                <TextInput value={ratioRest} onChange={setRatioRest} type="number" />
              </Field>
              <Field label="Bar %">
                <TextInput value={ratioBar} onChange={setRatioBar} type="number" />
              </Field>
              <Field label="Bill. %">
                <TextInput value={ratioBill} onChange={setRatioBill} type="number" />
              </Field>
              <Field label="PS %">
                <TextInput value={ratioPs} onChange={setRatioPs} type="number" />
              </Field>
            </div>
          )}
          
          <Btn kind="primary" onClick={saveAllocationSettings} disabled={savingSettings}>
            {savingSettings ? 'Saving…' : 'Save Ratios'}
          </Btn>
        </div>
      </div>

      <div>
        <h2 className="mb-2 font-semibold text-slate-700">Menu engineering (30d)</h2>
        <Table headers={['Item', 'Class', 'Sold', 'Revenue', 'Unit margin']}
          rows={me.map((r) => [
            r.name,
            <span key="c" className={`rounded-full px-2 py-0.5 text-xs font-semibold ${badge[r.class]}`}>{r.class}</span>,
            String(r.quantitySold), egp(r.revenueCents), egp(r.unitMarginCents),
          ])} />
      </div>
      <div>
        <h2 className="mb-2 font-semibold text-slate-700">Theoretical item costs</h2>
        <Table headers={['Item', 'Category', 'Price', 'Cost', 'Cost %']}
          rows={costs.map((c) => [c.name, c.category, egp(c.priceCents), egp(c.costCents), pct(c.costPctBps)])} />
      </div>
    </div>
  );
}
