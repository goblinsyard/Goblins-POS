import { useState } from 'react';
import { api, cairoTime, egp, parseEgp } from '../lib/api';
import { Btn, ErrorBanner, Field, Modal, Pills, Select, Table, TextInput, useLoad } from '../lib/ui';

interface Supplier {
  id: string;
  name: string;
  phone?: string | null;
  email?: string | null;
  taxId?: string | null;
  notes?: string | null;
  isActive?: boolean;
}
interface Ingredient { id: string; name: string; uom: { id: string }; lastCostCents: string | number }
interface PoLine {
  id: string; ingredientId: string; quantity: string | number; receivedQty: string | number;
  unitCostCents: string | number; ingredient: { name: string; uom: { id: string } };
}
interface Po {
  id: string; status: string; createdAt: string; expectedAt?: string | null; notes?: string | null;
  supplier: { name: string }; lines: PoLine[];
}
interface Recipe {
  id: string; name: string; yieldQty: string | number;
  outputIngredient: { name: string; uom: { id: string } };
  lines: { quantity: string | number; ingredient: { name: string; uom: { id: string } } }[];
}
interface ProductionOrder {
  id: string; batchQty: string | number; laborMinutes?: number | null; createdAt: string; notes?: string | null;
  manufacturingProcess: { name: string; outputIngredient: { name: string } };
  producedBy?: { name: string } | null;
}

const qty = (q: string | number) => Number(q).toLocaleString('en-EG', { maximumFractionDigits: 2 });

const SECTIONS = ['purchase orders', 'received purchases', 'suppliers', 'production'] as const;

export function PurchasingView() {
  const [section, setSection] = useState<(typeof SECTIONS)[number]>('purchase orders');
  return (
    <div>
      <div className="mb-4"><Pills value={section} onChange={setSection} options={SECTIONS} /></div>
      {section === 'purchase orders' && <PurchaseOrders />}
      {section === 'received purchases' && <ReceivedPurchases />}
      {section === 'suppliers' && <Suppliers />}
      {section === 'production' && <Production />}
    </div>
  );
}

// ---------- purchase orders ----------

const PO_BADGE: Record<string, string> = {
  SENT: 'bg-blue-100 text-blue-700', PARTIALLY_RECEIVED: 'bg-amber-100 text-amber-700',
  RECEIVED: 'bg-emerald-100 text-emerald-700', CANCELLED: 'bg-slate-100 text-slate-500',
};

function PurchaseOrders() {
  const { data: pos, error, reload } = useLoad(() => api<Po[]>('/inventory/purchase-orders'));
  const [createOpen, setCreateOpen] = useState(false);
  const [receiving, setReceiving] = useState<Po | null>(null);

  if (error) return <p className="p-8 text-red-600">{error}</p>;
  return (
    <div className="space-y-4">
      <Btn kind="primary" onClick={() => setCreateOpen(true)}>+ New purchase order</Btn>
      {(pos ?? []).map((po) => (
        <div key={po.id} className="rounded-xl bg-white p-4 shadow">
          <div className="mb-2 flex items-center gap-3">
            <span className="font-semibold text-slate-700">{po.supplier.name}</span>
            <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${PO_BADGE[po.status] ?? 'bg-slate-100'}`}>
              {po.status.replace('_', ' ')}
            </span>
            <span className="text-xs text-slate-400">{cairoTime(po.createdAt)}</span>
            {(po.status === 'SENT' || po.status === 'PARTIALLY_RECEIVED') && (
              <span className="ml-auto"><Btn onClick={() => setReceiving(po)}>Receive</Btn></span>
            )}
          </div>
          <table className="w-full text-sm text-slate-600">
            <tbody>
              {po.lines.map((l) => (
                <tr key={l.id} className="border-t first:border-0">
                  <td className="py-1.5">{l.ingredient.name}</td>
                  <td className="py-1.5">{qty(l.quantity)} {l.ingredient.uom.id}</td>
                  <td className="py-1.5">@ {egp(Number(l.unitCostCents))}</td>
                  <td className="py-1.5 text-slate-400">received {qty(l.receivedQty)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {po.notes && <p className="mt-1 text-xs text-slate-400">{po.notes}</p>}
        </div>
      ))}
      {!pos?.length && <p className="text-sm text-slate-400">No purchase orders yet</p>}
      {createOpen && <NewPoModal onClose={() => setCreateOpen(false)} onDone={() => { setCreateOpen(false); reload(); }} />}
      {receiving && <ReceiveModal po={receiving} onClose={() => setReceiving(null)} onDone={() => { setReceiving(null); reload(); }} />}
    </div>
  );
}

function NewPoModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const { data: suppliers } = useLoad(() => api<Supplier[]>('/inventory/suppliers'));
  const { data: ingredients } = useLoad(() => api<Ingredient[]>('/inventory/ingredients'));
  const [supplierId, setSupplierId] = useState('');
  const [lines, setLines] = useState<{ ingredientId: string; quantity: string; unitCost: string }[]>([
    { ingredientId: '', quantity: '', unitCost: '' },
  ]);
  const [notes, setNotes] = useState('');
  const [err, setErr] = useState('');

  function setLine(i: number, patch: Partial<(typeof lines)[number]>) {
    setLines((cur) => cur.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  }

  async function submit() {
    if (!supplierId) { setErr('Pick a supplier'); return; }
    const parsed = lines
      .filter((l) => l.ingredientId)
      .map((l) => ({ ingredientId: l.ingredientId, quantity: Number(l.quantity), unitCostCents: parseEgp(l.unitCost) ?? 0 }));
    if (!parsed.length || parsed.some((l) => !(l.quantity > 0) || !(l.unitCostCents > 0))) {
      setErr('Every line needs an ingredient, positive quantity and unit cost'); return;
    }
    try {
      await api('/inventory/purchase-orders', { method: 'POST', body: { supplierId, lines: parsed, notes: notes.trim() || undefined } });
      onDone();
    } catch (e) { setErr(e instanceof Error ? e.message : 'Failed'); }
  }

  return (
    <Modal title="New purchase order" onClose={onClose} wide>
      <ErrorBanner message={err} />
      <div className="space-y-3">
        <Field label="Supplier">
          <Select value={supplierId} onChange={setSupplierId} allowEmpty="— pick —"
            options={(suppliers ?? []).map((s) => ({ value: s.id, label: s.name }))} />
        </Field>
        {lines.map((l, i) => (
          <div key={i} className="grid grid-cols-[1fr_110px_130px_32px] items-end gap-2">
            <Field label={i === 0 ? 'Ingredient' : ''}>
              <Select value={l.ingredientId}
                onChange={(v) => {
                  const ing = ingredients?.find((x) => x.id === v);
                  setLine(i, { ingredientId: v, unitCost: ing ? String(Number(ing.lastCostCents) / 100) : l.unitCost });
                }}
                allowEmpty="— pick —"
                options={(ingredients ?? []).map((x) => ({ value: x.id, label: `${x.name} (${x.uom.id})` }))} />
            </Field>
            <Field label={i === 0 ? 'Qty' : ''}>
              <TextInput value={l.quantity} onChange={(v) => setLine(i, { quantity: v })} type="number" />
            </Field>
            <Field label={i === 0 ? 'Unit cost (EGP)' : ''}>
              <TextInput value={l.unitCost} onChange={(v) => setLine(i, { unitCost: v })} type="number" />
            </Field>
            <button onClick={() => setLines((cur) => cur.filter((_, j) => j !== i))}
              className="rounded-lg bg-slate-100 py-2 text-slate-400 hover:bg-red-50 hover:text-red-600">✕</button>
          </div>
        ))}
        <Btn onClick={() => setLines((cur) => [...cur, { ingredientId: '', quantity: '', unitCost: '' }])}>+ Line</Btn>
        <Field label="Notes"><TextInput value={notes} onChange={setNotes} /></Field>
        <Btn kind="primary" onClick={() => void submit()}>Create PO</Btn>
      </div>
    </Modal>
  );
}

function flattenAccounts(nodes: any[], prefix = ''): { value: string; label: string; isPaymentSource: boolean; code: string; balanceCents: number }[] {
  const list: { value: string; label: string; isPaymentSource: boolean; code: string; balanceCents: number }[] = [];
  for (const n of nodes) {
    list.push({
      value: n.id,
      label: `${prefix}${n.code} — ${n.name} (${(n.balanceCents / 100).toFixed(2)} EGP)`,
      isPaymentSource: !!n.isPaymentSource,
      code: n.code,
      balanceCents: n.balanceCents,
    });
    if (n.subAccounts && n.subAccounts.length > 0) {
      list.push(...flattenAccounts(n.subAccounts, prefix + '  '));
    }
  }
  return list;
}

function ReceiveModal({ po, onClose, onDone }: { po: Po; onClose: () => void; onDone: () => void }) {
  const { data: locations } = useLoad(() => api<{ id: string; name: string }[]>('/inventory/locations'));
  const { data: accounts } = useLoad(() => api<any[]>('/accounting/accounts'));
  const [locationId, setLocationId] = useState('');
  const [invoiceNumber, setInvoiceNumber] = useState('');
  const [accountId, setAccountId] = useState('');
  const [entries, setEntries] = useState<Record<string, { quantity: string; expiresAt: string }>>(
    Object.fromEntries(po.lines.map((l) => [
      l.id, { quantity: String(Number(l.quantity) - Number(l.receivedQty)), expiresAt: '' },
    ])),
  );
  const [err, setErr] = useState('');

  const assetAccounts = accounts
    ? flattenAccounts(accounts).filter((a) => a.isPaymentSource)
    : [];

  async function submit() {
    if (!locationId) { setErr('Pick a receiving location'); return; }
    const lines = po.lines
      .map((l) => {
        const entry = entries[l.id];
        return {
          poLineId: l.id,
          quantity: Number(entry?.quantity ?? 0),
          expiresAt: entry?.expiresAt ? new Date(entry.expiresAt).toISOString() : undefined,
        };
      })
      .filter((l) => l.quantity > 0);
    if (!lines.length) { setErr('Nothing to receive'); return; }
    try {
      await api(`/inventory/purchase-orders/${po.id}/receive`, {
        method: 'POST',
        body: {
          locationId,
          lines,
          invoiceNumber: invoiceNumber.trim() || undefined,
          accountId: accountId || undefined,
        },
      });
      onDone();
    } catch (e) { setErr(e instanceof Error ? e.message : 'Failed'); }
  }

  return (
    <Modal title={`Receive — ${po.supplier.name}`} onClose={onClose} wide>
      <ErrorBanner message={err} />
      <div className="space-y-3">
        <div className="grid grid-cols-3 gap-3">
          <Field label="Into location">
            <Select value={locationId} onChange={setLocationId} allowEmpty="— pick —"
              options={(locations ?? []).map((l) => ({ value: l.id, label: l.name }))} />
          </Field>
          <Field label="Invoice # (optional)"><TextInput value={invoiceNumber} onChange={setInvoiceNumber} /></Field>
          <Field label="Payment Account (optional)">
            <Select value={accountId} onChange={setAccountId} allowEmpty="— No auto-payment ledger entry —"
              options={assetAccounts} />
          </Field>
        </div>
        <table className="w-full text-sm">
          <thead className="text-left text-xs uppercase text-slate-400">
            <tr><th className="py-1">Item</th><th className="py-1">Outstanding</th><th className="py-1">Receive</th><th className="py-1">Expiry (optional)</th></tr>
          </thead>
          <tbody>
            {po.lines.map((l) => (
              <tr key={l.id} className="border-t">
                <td className="py-2">{l.ingredient.name}</td>
                <td className="py-2">{qty(Number(l.quantity) - Number(l.receivedQty))} {l.ingredient.uom.id}</td>
                <td className="py-2">
                  <input type="number" value={entries[l.id]?.quantity ?? ''} min={0}
                    onChange={(e) => setEntries((cur) => ({ ...cur, [l.id]: { expiresAt: cur[l.id]?.expiresAt ?? '', quantity: e.target.value } }))}
                    className="w-24 rounded-lg border border-slate-300 p-1.5" />
                </td>
                <td className="py-2">
                  <input type="date" value={entries[l.id]?.expiresAt ?? ''}
                    onChange={(e) => setEntries((cur) => ({ ...cur, [l.id]: { quantity: cur[l.id]?.quantity ?? '', expiresAt: e.target.value } }))}
                    className="rounded-lg border border-slate-300 p-1.5" />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <Btn kind="primary" onClick={() => void submit()}>Receive goods</Btn>
      </div>
    </Modal>
  );
}

// ---------- suppliers ----------

function Suppliers() {
  const { data, reload } = useLoad(() => api<Supplier[]>('/inventory/suppliers?all=true'));
  const [editingSupplier, setEditingSupplier] = useState<Supplier | null>(null);
  const [createOpen, setCreateOpen] = useState(false);

  async function handleDelete(id: string) {
    if (!confirm('Are you sure you want to deactivate this supplier?')) return;
    try {
      await api(`/inventory/suppliers/${id}`, { method: 'DELETE' });
      reload();
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Deactivation failed');
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <h2 className="text-lg font-bold text-slate-700">Suppliers Directory</h2>
        <Btn kind="primary" onClick={() => { setEditingSupplier(null); setCreateOpen(true); }}>+ New supplier</Btn>
      </div>
      <Table
        headers={['Name', 'Phone', 'Email', 'Tax ID', 'Notes', 'Status', 'Actions']}
        rows={(data ?? []).map((s) => [
          s.name,
          s.phone ?? '—',
          s.email ?? '—',
          s.taxId ?? '—',
          s.notes ?? '—',
          s.isActive ? <span className="text-emerald-700 font-semibold">Active</span> : <span className="text-slate-400">Inactive</span>,
          <div key={s.id} className="flex gap-2">
            <Btn onClick={() => { setEditingSupplier(s); setCreateOpen(true); }}>Edit</Btn>
            {s.isActive && <Btn kind="danger" onClick={() => void handleDelete(s.id)}>Deactivate</Btn>}
          </div>,
        ])}
      />
      {createOpen && (
        <SupplierFormModal
          supplier={editingSupplier}
          onClose={() => setCreateOpen(false)}
          onDone={() => { setCreateOpen(false); reload(); }}
        />
      )}
    </div>
  );
}

function SupplierFormModal({ supplier, onClose, onDone }: {
  supplier: Supplier | null; onClose: () => void; onDone: () => void;
}) {
  const [name, setName] = useState(supplier?.name ?? '');
  const [phone, setPhone] = useState(supplier?.phone ?? '');
  const [email, setEmail] = useState(supplier?.email ?? '');
  const [taxId, setTaxId] = useState(supplier?.taxId ?? '');
  const [notes, setNotes] = useState(supplier?.notes ?? '');
  const [isActive, setIsActive] = useState(supplier?.isActive ?? true);
  const [err, setErr] = useState('');

  async function submit() {
    if (!name.trim()) { setErr('Name is required'); return; }
    try {
      const body = {
        name: name.trim(),
        phone: phone.trim() || undefined,
        email: email.trim() || undefined,
        taxId: taxId.trim() || undefined,
        notes: notes.trim() || undefined,
        isActive,
      };
      if (supplier) {
        await api(`/inventory/suppliers/${supplier.id}`, { method: 'PATCH', body });
      } else {
        await api('/inventory/suppliers', { method: 'POST', body });
      }
      onDone();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Submit failed');
    }
  }

  return (
    <Modal title={supplier ? `Edit Supplier: ${supplier.name}` : 'New Supplier'} onClose={onClose}>
      <ErrorBanner message={err} />
      <div className="space-y-3">
        <Field label="Supplier Name"><TextInput value={name} onChange={setName} /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Phone"><TextInput value={phone} onChange={setPhone} /></Field>
          <Field label="Email"><TextInput value={email} onChange={setEmail} type="email" /></Field>
        </div>
        <Field label="Tax Registration ID (Tax ID)"><TextInput value={taxId} onChange={setTaxId} /></Field>
        <Field label="Notes / Terms"><TextInput value={notes} onChange={setNotes} /></Field>
        {supplier && (
          <label className="flex items-center gap-2 text-sm text-slate-700 py-1 cursor-pointer">
            <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} className="rounded text-emerald-700" />
            <span>Active Supplier</span>
          </label>
        )}
        <Btn kind="primary" onClick={() => void submit()}>{supplier ? 'Save changes' : 'Create supplier'}</Btn>
      </div>
    </Modal>
  );
}

// ---------- production ----------

function Production() {
  const { data: recipes, error } = useLoad(() => api<Recipe[]>('/inventory/production/recipes'));
  const { data: log, reload } = useLoad(() => api<ProductionOrder[]>('/inventory/production'));
  const [producing, setProducing] = useState<Recipe | null>(null);

  if (error) return <p className="p-8 text-red-600">{error}</p>;
  return (
    <div className="space-y-6">
      <div>
        <h2 className="mb-2 font-semibold text-slate-700">Producible recipes</h2>
        <Table headers={['Recipe', 'Produces', 'Inputs', '']}
          rows={(recipes ?? []).map((r) => [
            r.name,
            `${r.outputIngredient.name} (${r.outputIngredient.uom.id})`,
            r.lines.map((l) => `${qty(l.quantity)} ${l.ingredient.uom.id} ${l.ingredient.name}`).join(', '),
            <Btn key="p" kind="primary" onClick={() => setProducing(r)}>Produce</Btn>,
          ])} />
      </div>
      <div>
        <h2 className="mb-2 font-semibold text-slate-700">Production log</h2>
        <Table headers={['Time', 'Process', 'Output', 'Batch', 'Labor', 'By']}
          rows={(log ?? []).map((p) => [
            cairoTime(p.createdAt), p.manufacturingProcess.name, p.manufacturingProcess.outputIngredient.name,
            qty(p.batchQty), p.laborMinutes ? `${p.laborMinutes} min` : '—', p.producedBy?.name ?? '—',
          ])} />
      </div>
      {producing && (
        <ProduceModal recipe={producing} onClose={() => setProducing(null)}
          onDone={() => { setProducing(null); reload(); }} />
      )}
    </div>
  );
}

function ProduceModal({ recipe, onClose, onDone }: { recipe: Recipe; onClose: () => void; onDone: () => void }) {
  const [batchQty, setBatchQty] = useState('1');
  const [laborMinutes, setLaborMinutes] = useState('');
  const [notes, setNotes] = useState('');
  const [err, setErr] = useState('');

  async function submit() {
    const n = Number(batchQty);
    if (!(n > 0)) { setErr('Batch quantity must be positive'); return; }
    try {
      await api('/inventory/production', { method: 'POST', body: {
        processId: recipe.id, batchQty: n,
        laborMinutes: laborMinutes ? Math.round(Number(laborMinutes)) : undefined,
        notes: notes.trim() || undefined,
      } });
      onDone();
    } catch (e) { setErr(e instanceof Error ? e.message : 'Failed'); }
  }

  return (
    <Modal title={`Produce — ${recipe.name}`} onClose={onClose}>
      <ErrorBanner message={err} />
      <div className="space-y-3">
        <Field label={`Batch quantity (${recipe.outputIngredient.uom.id} of ${recipe.outputIngredient.name})`}>
          <TextInput value={batchQty} onChange={setBatchQty} type="number" />
        </Field>
        <Field label="Labor minutes (optional)"><TextInput value={laborMinutes} onChange={setLaborMinutes} type="number" /></Field>
        <Field label="Notes"><TextInput value={notes} onChange={setNotes} /></Field>
        <p className="text-xs text-slate-400">
          Consumes per unit: {recipe.lines.map((l) => `${qty(l.quantity)} ${l.ingredient.uom.id} ${l.ingredient.name}`).join(' · ')}
        </p>
        <Btn kind="primary" onClick={() => void submit()}>Produce batch</Btn>
      </div>
    </Modal>
  );
}

interface GoodsReceiptMovement {
  id: string;
  quantity: string | number;
  unitCostCents: string | number;
  ingredient: {
    name: string;
    uom: { id: string };
  };
}

interface GoodsReceipt {
  id: string;
  poId: string | null;
  po: { number: number; supplier: { name: string } } | null;
  receivedAt: string;
  notes: string | null;
  invoiceId: string | null;
  invoice: { number: string; totalCents: number } | null;
  accountId: string | null;
  account: { name: string } | null;
  movements: GoodsReceiptMovement[];
}

function ReceivedPurchases() {
  const { data: receipts, reload } = useLoad(() => api<GoodsReceipt[]>('/inventory/goods-receipts'));
  const [editingReceipt, setEditingReceipt] = useState<GoodsReceipt | null>(null);

  async function handleDelete(id: string) {
    if (!confirm('Are you sure you want to delete and revert this goods receipt? This will reduce stock levels and reset PO received quantities.')) return;
    try {
      await api(`/inventory/goods-receipts/${id}`, { method: 'DELETE' });
      reload();
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Delete failed');
    }
  }

  return (
    <div className="space-y-4">
      <Table
        headers={['Date', 'PO Number', 'Supplier', 'Items Received', 'Payment Account', 'Invoice #', 'Notes', 'Actions']}
        rows={(receipts ?? []).map((r) => [
          new Date(r.receivedAt).toLocaleDateString('en-EG'),
          r.po ? `#${r.po.number}` : '—',
          r.po?.supplier.name ?? '—',
          r.movements.map((m) => `${qty(m.quantity)} ${m.ingredient.uom.id} ${m.ingredient.name}`).join(', '),
          r.account ? r.account.name : <span className="text-slate-400">None</span>,
          r.invoice?.number ?? '—',
          r.notes ?? '—',
          <div key={r.id} className="flex gap-2">
            <Btn onClick={() => setEditingReceipt(r)}>Edit</Btn>
            <Btn kind="danger" onClick={() => void handleDelete(r.id)}>Delete</Btn>
          </div>
        ])}
      />
      {!receipts?.length && <p className="text-sm text-slate-400">No goods receipts found</p>}
      {editingReceipt && (
        <EditReceiptModal
          receipt={editingReceipt}
          onClose={() => setEditingReceipt(null)}
          onDone={() => { setEditingReceipt(null); reload(); }}
        />
      )}
    </div>
  );
}

function EditReceiptModal({ receipt, onClose, onDone }: {
  receipt: GoodsReceipt; onClose: () => void; onDone: () => void;
}) {
  const { data: accounts } = useLoad(() => api<any[]>('/accounting/accounts'));
  const [accountId, setAccountId] = useState(receipt.accountId ?? '');
  const [invoiceNumber, setInvoiceNumber] = useState(receipt.invoice?.number ?? '');
  const [notes, setNotes] = useState(receipt.notes ?? '');
  const [err, setErr] = useState('');

  const assetAccounts = accounts
    ? flattenAccounts(accounts).filter((a) => a.isPaymentSource)
    : [];

  async function submit() {
    try {
      await api(`/inventory/goods-receipts/${receipt.id}`, {
        method: 'PATCH',
        body: {
          accountId: accountId || null,
          invoiceNumber: invoiceNumber.trim() || null,
          notes: notes.trim() || null,
        },
      });
      onDone();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Submit failed');
    }
  }

  return (
    <Modal title={`Edit Goods Receipt: ${receipt.po ? `PO #${receipt.po.number}` : receipt.id}`} onClose={onClose}>
      <ErrorBanner message={err} />
      <div className="space-y-3">
        <Field label="Payment Account">
          <Select value={accountId} onChange={setAccountId} allowEmpty="— No auto-payment ledger entry —"
            options={assetAccounts} />
        </Field>
        <Field label="Invoice Number"><TextInput value={invoiceNumber} onChange={setInvoiceNumber} /></Field>
        <Field label="Notes"><TextInput value={notes} onChange={setNotes} /></Field>
        <Btn kind="primary" onClick={() => void submit()}>Save changes</Btn>
      </div>
    </Modal>
  );
}
