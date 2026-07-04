import { useState } from 'react';
import { api, cairoTime, downloadCsv, egp } from '../lib/api';
import { Btn, ErrorBanner, Field, Modal, Pills, Select, Spinner, Table, TextInput, useLoad } from '../lib/ui';

interface Uom { id: string }
interface Location { id: string; name: string }
interface Level {
  ingredientId: string; locationId: string; quantity: string | number;
  ingredient: { id: string; name: string; uom: Uom; avgCostCents: string | number };
  location: Location;
}
interface LowStock { id: string; name: string; uom: string; reorderPoint: string | number; reorderQty: string | number; totalQty: string | number }
interface ExpiringBatch {
  id: string; lotCode?: string | null; expiresAt: string; remainingQty: string | number;
  ingredient: { name: string; uom: Uom };
}
interface Movement {
  id: string; kind: string; quantity: string | number; unitCostCents: string | number; createdAt: string; note?: string | null;
  ingredient: { name: string }; fromLocation?: { name: string } | null; toLocation?: { name: string } | null;
}
interface StockCount {
  id: string; kind: string; status: string;
  lines: { id: string; ingredientId: string; systemQty: string | number; ingredient: { name: string; uom: Uom } }[];
}

const qty = (q: string | number) => Number(q).toLocaleString('en-EG', { maximumFractionDigits: 2 });

const SECTIONS = ['levels', 'alerts', 'movements', 'counts', 'reports'] as const;

export function InventoryView() {
  const [section, setSection] = useState<(typeof SECTIONS)[number]>('levels');
  return (
    <div>
      <div className="mb-4"><Pills value={section} onChange={setSection} options={SECTIONS} /></div>
      {section === 'levels' && <Levels />}
      {section === 'alerts' && <Alerts />}
      {section === 'movements' && <Movements />}
      {section === 'counts' && <Counts />}
      {section === 'reports' && <InventoryReports />}
    </div>
  );
}

// ---------- levels + stock actions ----------

function Levels() {
  const [locationId, setLocationId] = useState('');
  const { data: locations } = useLoad(() => api<Location[]>('/inventory/locations'));
  const { data: levels, error, reload } = useLoad(
    () => api<Level[]>(`/inventory/levels${locationId ? `?locationId=${locationId}` : ''}`), [locationId]);
  const [action, setAction] = useState<{ kind: 'transfer' | 'waste' | 'adjust'; level: Level } | null>(null);

  if (error) return <p className="p-8 text-red-600">{error}</p>;
  return (
    <div>
      <div className="mb-3 w-64">
        <Select value={locationId} onChange={setLocationId} allowEmpty="All locations"
          options={(locations ?? []).map((l) => ({ value: l.id, label: l.name }))} />
      </div>
      <Table
        headers={['Ingredient', 'Location', 'Qty', 'Unit', 'Avg cost', 'Actions']}
        rows={(levels ?? []).map((l) => [
          l.ingredient.name, l.location.name, qty(l.quantity), l.ingredient.uom.id,
          egp(Number(l.ingredient.avgCostCents)),
          <span key="a" className="flex gap-1">
            <Btn onClick={() => setAction({ kind: 'transfer', level: l })}>Transfer</Btn>
            <Btn onClick={() => setAction({ kind: 'waste', level: l })}>Waste</Btn>
            <Btn onClick={() => setAction({ kind: 'adjust', level: l })}>Adjust</Btn>
          </span>,
        ])}
      />
      {action && (
        <StockActionModal kind={action.kind} level={action.level} locations={locations ?? []}
          onClose={() => setAction(null)} onDone={() => { setAction(null); reload(); }} />
      )}
    </div>
  );
}

function StockActionModal({ kind, level, locations, onClose, onDone }: {
  kind: 'transfer' | 'waste' | 'adjust'; level: Level; locations: Location[];
  onClose: () => void; onDone: () => void;
}) {
  const [amount, setAmount] = useState('');
  const [toLocationId, setToLocationId] = useState(locations.find((l) => l.id !== level.locationId)?.id ?? '');
  const [reason, setReason] = useState('');
  const [err, setErr] = useState('');
  const titles = { transfer: 'Transfer stock', waste: 'Log waste', adjust: 'Adjust stock' };

  async function submit() {
    const n = Number(amount);
    if (!Number.isFinite(n) || n === 0) { setErr('Enter a non-zero quantity'); return; }
    try {
      if (kind === 'transfer') {
        if (n < 0) { setErr('Quantity must be positive'); return; }
        await api('/inventory/transfer', { method: 'POST', body: {
          ingredientId: level.ingredientId, fromLocationId: level.locationId, toLocationId, quantity: n,
        } });
      } else if (kind === 'waste') {
        if (n < 0) { setErr('Quantity must be positive'); return; }
        if (!reason.trim()) { setErr('Reason is required'); return; }
        await api('/inventory/waste', { method: 'POST', body: {
          ingredientId: level.ingredientId, locationId: level.locationId, quantity: n, reason: reason.trim(),
        } });
      } else {
        if (!reason.trim()) { setErr('Reason is required'); return; }
        await api('/inventory/adjust', { method: 'POST', body: {
          ingredientId: level.ingredientId, locationId: level.locationId, delta: n, reason: reason.trim(),
        } });
      }
      onDone();
    } catch (e) { setErr(e instanceof Error ? e.message : 'Failed'); }
  }

  return (
    <Modal title={`${titles[kind]} — ${level.ingredient.name}`} onClose={onClose}>
      <ErrorBanner message={err} />
      <p className="mb-3 text-sm text-goblin-300">
        At {level.location.name}: <b>{qty(level.quantity)} {level.ingredient.uom.id}</b>
      </p>
      <div className="space-y-3">
        <Field label={kind === 'adjust' ? `Delta (${level.ingredient.uom.id}, +/-)` : `Quantity (${level.ingredient.uom.id})`}>
          <TextInput value={amount} onChange={setAmount} type="number" />
        </Field>
        {kind === 'transfer' && (
          <Field label="To location">
            <Select value={toLocationId} onChange={setToLocationId}
              options={locations.filter((l) => l.id !== level.locationId).map((l) => ({ value: l.id, label: l.name }))} />
          </Field>
        )}
        {kind !== 'transfer' && (
          <Field label="Reason"><TextInput value={reason} onChange={setReason} /></Field>
        )}
        <Btn kind="primary" onClick={() => void submit()}>Confirm</Btn>
      </div>
    </Modal>
  );
}

// ---------- alerts ----------

function Alerts() {
  const { data: low } = useLoad(() => api<LowStock[]>('/inventory/low-stock'));
  const { data: expiring } = useLoad(() => api<ExpiringBatch[]>('/inventory/expiring?days=7'));
  return (
    <div className="space-y-6">
      <div>
        <h2 className="mb-2 font-semibold text-goblin-100">Low stock (at/below reorder point)</h2>
        <Table headers={['Ingredient', 'On hand', 'Reorder point', 'Suggested order']}
          rows={(low ?? []).map((l) => [
            l.name, `${qty(l.totalQty)} ${l.uom}`, qty(l.reorderPoint), qty(l.reorderQty),
          ])} />
      </div>
      <div>
        <h2 className="mb-2 font-semibold text-goblin-100">Expiring within 7 days</h2>
        <Table headers={['Ingredient', 'Lot', 'Remaining', 'Expires']}
          rows={(expiring ?? []).map((b) => [
            b.ingredient.name, b.lotCode ?? '—', `${qty(b.remainingQty)} ${b.ingredient.uom.id}`,
            new Date(b.expiresAt).toLocaleDateString('en-EG'),
          ])} />
      </div>
    </div>
  );
}

// ---------- movements ----------

const MOVE_KINDS = ['ALL', 'RECEIPT', 'TRANSFER', 'WASTE', 'SALE_DEDUCTION', 'PRODUCTION_IN', 'PRODUCTION_OUT', 'COUNT_ADJUSTMENT'] as const;

function Movements() {
  const [kind, setKind] = useState<(typeof MOVE_KINDS)[number]>('ALL');
  const { data } = useLoad(
    () => api<Movement[]>(`/inventory/movements?take=100${kind !== 'ALL' ? `&kind=${kind}` : ''}`), [kind]);
  return (
    <div>
      <div className="mb-3"><Pills value={kind} onChange={setKind}
        options={MOVE_KINDS.map((k) => ({ value: k, label: k.replace('_', ' ').toLowerCase() }))} /></div>
      <Table headers={['Time', 'Kind', 'Ingredient', 'Qty', 'From', 'To', 'Note']}
        rows={(data ?? []).map((m) => [
          cairoTime(m.createdAt), m.kind.replace('_', ' '), m.ingredient.name, qty(m.quantity),
          m.fromLocation?.name ?? '—', m.toLocation?.name ?? '—', m.note ?? '',
        ])} />
    </div>
  );
}

// ---------- physical counts ----------

function Counts() {
  const { data: locations } = useLoad(() => api<Location[]>('/inventory/locations'));
  const [locationId, setLocationId] = useState('');
  const [count, setCount] = useState<StockCount | null>(null);
  const [entries, setEntries] = useState<Record<string, string>>({});
  const [err, setErr] = useState('');
  const [result, setResult] = useState('');

  async function start() {
    if (!locationId) { setErr('Pick a location'); return; }
    setErr(''); setResult('');
    try {
      const c = await api<StockCount>('/inventory/counts', { method: 'POST', body: { locationId, kind: 'FULL' } });
      setCount(c);
      setEntries(Object.fromEntries(c.lines.map((l) => [l.ingredientId, String(Number(l.systemQty))])));
    } catch (e) { setErr(e instanceof Error ? e.message : 'Failed'); }
  }

  async function submit() {
    if (!count) return;
    const lines = count.lines.map((l) => ({ ingredientId: l.ingredientId, countedQty: Number(entries[l.ingredientId] ?? 0) }));
    if (lines.some((l) => !Number.isFinite(l.countedQty) || l.countedQty < 0)) { setErr('All counted quantities must be valid'); return; }
    try {
      await api(`/inventory/counts/${count.id}/submit`, { method: 'POST', body: { lines } });
      setCount(null);
      setResult('Count posted — variances applied to stock.');
    } catch (e) { setErr(e instanceof Error ? e.message : 'Failed'); }
  }

  if (!count) {
    return (
      <div className="max-w-md space-y-3">
        <ErrorBanner message={err} />
        {result && <p className="rounded-lg bg-goblin-700 p-2 text-sm text-goblin-500">{result}</p>}
        <Field label="Location">
          <Select value={locationId} onChange={setLocationId} allowEmpty="— pick —"
            options={(locations ?? []).map((l) => ({ value: l.id, label: l.name }))} />
        </Field>
        <Btn kind="primary" onClick={() => void start()}>Start full count</Btn>
        <p className="text-xs text-goblin-400">Starting a count snapshots system quantities; enter what you actually counted, then post. Variances are adjusted automatically and audited.</p>
      </div>
    );
  }

  return (
    <div>
      <ErrorBanner message={err} />
      <div className="overflow-hidden rounded-xl bg-goblin-900 shadow">
        <table className="w-full text-sm">
          <thead className="bg-goblin-800 text-left text-goblin-300">
            <tr><th className="p-3">Ingredient</th><th className="p-3">System</th><th className="p-3">Counted</th><th className="p-3">Variance</th></tr>
          </thead>
          <tbody>
            {count.lines.map((l) => {
              const counted = Number(entries[l.ingredientId] ?? 0);
              const variance = counted - Number(l.systemQty);
              return (
                <tr key={l.id} className="border-t">
                  <td className="p-3">{l.ingredient.name}</td>
                  <td className="p-3">{qty(l.systemQty)} {l.ingredient.uom.id}</td>
                  <td className="p-3">
                    <input type="number" value={entries[l.ingredientId] ?? ''} min={0}
                      onChange={(e) => setEntries((cur) => ({ ...cur, [l.ingredientId]: e.target.value }))}
                      className="w-28 rounded-lg border border-goblin-700 p-1.5" />
                  </td>
                  <td className={`p-3 ${variance === 0 ? 'text-goblin-400' : variance < 0 ? 'text-red-600' : 'text-goblin-500'}`}>
                    {variance > 0 ? '+' : ''}{qty(variance)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="mt-3 flex gap-2">
        <Btn kind="primary" onClick={() => void submit()}>Post count</Btn>
        <Btn onClick={() => setCount(null)}>Discard</Btn>
      </div>
    </div>
  );
}

// ---------- inventory reports ----------

const REPORT_KINDS = ['consumption', 'variance', 'waste', 'prices'] as const;

function InventoryReports() {
  const [kind, setKind] = useState<(typeof REPORT_KINDS)[number]>('consumption');
  const from = new Date(Date.now() - 7 * 86400_000).toISOString();
  const { data } = useLoad(
    () => api<Record<string, unknown>[]>(`/reports/inventory/${kind}?from=${encodeURIComponent(from)}`), [kind]);

  const rows = data ?? [];
  const headers = Object.keys(rows[0] ?? {});
  const cell = (v: unknown): string => {
    if (v == null) return '—';
    if (typeof v === 'object') return (v as { name?: string }).name ?? JSON.stringify(v);
    if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(v)) return cairoTime(v);
    if (typeof v === 'number' || (typeof v === 'string' && v !== '' && !Number.isNaN(Number(v)))) {
      return Number(v).toLocaleString('en-EG', { maximumFractionDigits: 2 });
    }
    return String(v);
  };
  return (
    <div>
      <div className="mb-3 flex items-center gap-2">
        <Pills value={kind} onChange={setKind} options={REPORT_KINDS} />
        <button onClick={() => void downloadCsv(`/reports/inventory/${kind}.csv?from=${encodeURIComponent(from)}`, `inventory-${kind}.csv`)}
          className="ml-auto rounded-lg bg-goblin-900 px-3 py-1.5 text-sm text-white">
          Export CSV
        </button>
      </div>
      <p className="mb-2 text-xs text-goblin-400">Last 7 days</p>
      {!data ? <Spinner /> : (
        <Table headers={headers.length ? headers : ['—']}
          rows={rows.map((r) => headers.map((h) => cell(r[h])))} />
      )}
    </div>
  );
}
