import { useState } from 'react';
import { api, egp, parseEgp } from '../lib/api';
import { Btn, ErrorBanner, Field, Modal, Pills, Select, Table, TextInput, useLoad } from '../lib/ui';
import { tr } from '../lib/i18n';

interface ExpenseCategory {
  id: string;
  name: string;
  nameAr?: string | null;
  accountId?: string | null;
  account?: { code: string; name: string } | null;
}
interface Expense {
  id: string;
  categoryId: string;
  description: string;
  amountCents: number;
  paymentMethod: string;
  expenseDate: string;
  isRecurring: boolean;
  category: { id: string; name: string };
  enteredBy?: { name: string } | null;
  accountId?: string | null;
  account?: { name: string } | null;
  department?: string | null;
}
interface VatRow { day: string; netCents: number; vatCents: number; count: number }

const SECTIONS = ['expenses', 'expense categories', 'VAT report'] as const;

export function ExpensesView() {
  const [section, setSection] = useState<(typeof SECTIONS)[number]>('expenses');
  return (
    <div>
      <div className="mb-4"><Pills value={section} onChange={setSection} options={SECTIONS} /></div>
      {section === 'expenses' && <ExpenseList />}
      {section === 'expense categories' && <ExpenseCategories />}
      {section === 'VAT report' && <VatReport />}
    </div>
  );
}

function ExpenseList() {
  const [categoryId, setCategoryId] = useState('');
  const { data: categories } = useLoad(() => api<ExpenseCategory[]>('/expenses/categories'));
  const from = new Date(Date.now() - 30 * 86400_000).toISOString();
  const { data: expenses, reload } = useLoad(
    () => api<Expense[]>(`/expenses?from=${encodeURIComponent(from)}${categoryId ? `&categoryId=${categoryId}` : ''}`),
    [categoryId]);
  const [createOpen, setCreateOpen] = useState(false);
  const [editingExpense, setEditingExpense] = useState<Expense | null>(null);

  async function handleDelete(id: string) {
    if (!confirm(tr('Are you sure you want to delete this expense?'))) return;
    try {
      await api(`/expenses/${id}`, { method: 'DELETE' });
      reload();
    } catch (e) {
      alert(e instanceof Error ? e.message : tr('Delete failed'));
    }
  }

  const total = (expenses ?? []).reduce((a, e) => a + e.amountCents, 0);
  return (
    <div>
      <div className="mb-3 flex items-center gap-2">
        <div className="w-56">
          <Select value={categoryId} onChange={setCategoryId} allowEmpty="All categories"
            options={(categories ?? []).map((c) => ({ value: c.id, label: c.name }))} />
        </div>
        <span className="text-sm text-goblin-300">{tr('Last 30 days · total')} <b>{egp(total)}</b></span>
        <span className="ml-auto"><Btn kind="primary" onClick={() => setCreateOpen(true)}>{tr('+ New expense')}</Btn></span>
      </div>
      <Table headers={[tr('Date'), tr('Category'), tr('Description'), tr('Allocation'), tr('Amount'), tr('Method / Source'), tr('By'), tr('Actions')]}
        rows={(expenses ?? []).map((e) => [
          new Date(e.expenseDate).toLocaleDateString('en-EG'),
          e.category.name,
          <span key="d">{e.description}{e.isRecurring && <span className="ml-1 rounded bg-blue-50 px-1 text-xs text-blue-600">{tr('monthly')}</span>}</span>,
          e.department ? String(e.department).replace('_', ' ') : 'Overhead',
          egp(e.amountCents), e.account ? e.account.name : e.paymentMethod, e.enteredBy?.name ?? '—',
          <div key={e.id} className="flex gap-2">
            <Btn onClick={() => setEditingExpense(e)}>{tr('Edit')}</Btn>
            <Btn kind="danger" onClick={() => void handleDelete(e.id)}>{tr('Delete')}</Btn>
          </div>
        ])} />
      {createOpen && (
        <ExpenseFormModal categories={categories ?? []} onClose={() => setCreateOpen(false)}
          onDone={() => { setCreateOpen(false); reload(); }} />
      )}
      {editingExpense && (
        <ExpenseFormModal categories={categories ?? []} expense={editingExpense} onClose={() => setEditingExpense(null)}
          onDone={() => { setEditingExpense(null); reload(); }} />
      )}
    </div>
  );
}

function ExpenseFormModal({ categories, expense, onClose, onDone }: {
  categories: ExpenseCategory[]; expense?: Expense | null; onClose: () => void; onDone: () => void;
}) {
  const { data: accounts } = useLoad(() => api<any[]>('/accounting/accounts'));
  const [categoryId, setCategoryId] = useState(expense?.categoryId ?? expense?.category?.id ?? '');
  const [description, setDescription] = useState(expense?.description ?? '');
  const [amount, setAmount] = useState(expense ? String(expense.amountCents / 100) : '');
  const [accountId, setAccountId] = useState(expense?.accountId ?? '');
  const [date, setDate] = useState(expense ? new Date(expense.expenseDate).toISOString().slice(0, 10) : new Date().toISOString().slice(0, 10));
  const [department, setDepartment] = useState(expense?.department ?? '');
  const [recurring, setRecurring] = useState(expense?.isRecurring ?? false);
  const [err, setErr] = useState('');

  const assetAccounts = accounts
    ? flattenAccounts(accounts).filter((a) => a.isPaymentSource)
    : [];

  async function submit() {
    const amountCents = parseEgp(amount);
    if (!categoryId || !description.trim() || amountCents == null || amountCents <= 0) {
      setErr(tr('Category, description and a positive amount are required')); return;
    }
    try {
      const body = {
        categoryId, description: description.trim(), amountCents,
        accountId: accountId || null,
        paymentMethod: accountId ? undefined : 'cash',
        expenseDate: date,
        department: department || null,
        isRecurring: recurring, recurrence: recurring ? 'monthly' : undefined,
      };
      if (expense) {
        await api(`/expenses/${expense.id}`, { method: 'PATCH', body });
      } else {
        await api('/expenses', { method: 'POST', body });
      }
      onDone();
    } catch (e) { setErr(e instanceof Error ? e.message : tr('Failed')); }
  }

  return (
    <Modal title={expense ? tr('Edit expense') : tr('New expense')} onClose={onClose}>
      <ErrorBanner message={err} />
      <div className="space-y-3">
        <Field label={tr('Category')}>
          <Select value={categoryId} onChange={setCategoryId} allowEmpty="— pick —"
            options={categories.map((c) => ({ value: c.id, label: c.name }))} />
        </Field>
        <Field label={tr('Description')}><TextInput value={description} onChange={setDescription} /></Field>
        <Field label={tr('Allocation')}>
          <Select value={department} onChange={setDepartment} allowEmpty="Overhead / Shared"
            options={[
              { value: 'RESTAURANT', label: tr('Restaurant') },
              { value: 'BAR', label: tr('Bar') },
              { value: 'BILLIARDS', label: tr('Billiards') },
              { value: 'PLAYSTATION', label: tr('PlayStation') }
            ]} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label={tr('Amount (EGP)')}><TextInput value={amount} onChange={setAmount} type="number" /></Field>
          <Field label={tr('Date')}><TextInput value={date} onChange={setDate} type="date" /></Field>
        </div>
        <Field label={tr('Payment Account / Source')}>
          <Select value={accountId} onChange={setAccountId} allowEmpty="— pick account (e.g. Safe, Fawry, Bank) —"
            options={assetAccounts} />
        </Field>
        <label className="flex items-center gap-2 text-sm text-goblin-200">
          <input type="checkbox" checked={recurring} onChange={(e) => setRecurring(e.target.checked)} />
          {tr('Recurring monthly (auto-created on the 1st)')}
        </label>
        <Btn kind="primary" onClick={() => void submit()}>{expense ? tr('Save changes') : tr('Record expense')}</Btn>
      </div>
    </Modal>
  );
}

function VatReport() {
  const monthStart = new Date();
  monthStart.setDate(1);
  const { data } = useLoad(() => api<VatRow[]>(`/expenses/vat-report?from=${encodeURIComponent(monthStart.toISOString())}`));
  const rows = data ?? [];
  const totalNet = rows.reduce((a, r) => a + r.netCents, 0);
  const totalVat = rows.reduce((a, r) => a + r.vatCents, 0);
  return (
    <div>
      <p className="mb-2 text-sm text-goblin-300">
        {tr('This month · net')} <b>{egp(totalNet)}</b> {tr('· output VAT')} <b>{egp(totalVat)}</b>
      </p>
      <Table headers={[tr('Day'), tr('Orders'), tr('Net (subtotal+service)'), tr('VAT collected')]}
        rows={rows.map((r) => [r.day, String(r.count), egp(r.netCents), egp(r.vatCents)])} />
    </div>
  );
}

function ExpenseCategories() {
  const { data: categories, reload } = useLoad(() => api<ExpenseCategory[]>('/expenses/categories'));
  const { data: accounts } = useLoad(() => api<any[]>('/accounting/accounts'));
  const [editingCategory, setEditingCategory] = useState<ExpenseCategory | null>(null);
  const [createOpen, setCreateOpen] = useState(false);

  const flatAccounts = accounts ? flattenAccounts(accounts) : [];

  async function handleDelete(id: string) {
    if (!confirm(tr('Are you sure you want to delete this category?'))) return;
    try {
      await api(`/expenses/categories/${id}`, { method: 'DELETE' });
      reload();
    } catch (e) {
      alert(e instanceof Error ? e.message : tr('Delete failed'));
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <h2 className="text-lg font-bold text-goblin-100">{tr('Expense Categories')}</h2>
        <Btn kind="primary" onClick={() => { setEditingCategory(null); setCreateOpen(true); }}>{tr('+ New category')}</Btn>
      </div>
      <Table
        headers={[tr('Name'), tr('Arabic Name'), tr('Linked Account'), tr('Actions')]}
        rows={(categories ?? []).map((c) => [
          c.name,
          c.nameAr ?? '—',
          c.account ? `${c.account.code} — ${c.account.name}` : <span className="text-goblin-400">{tr('Not linked (no ledger tracking)')}</span>,
          <div key={c.id} className="flex gap-2">
            <Btn onClick={() => { setEditingCategory(c); setCreateOpen(true); }}>{tr('Edit')}</Btn>
            <Btn kind="danger" onClick={() => void handleDelete(c.id)}>{tr('Delete')}</Btn>
          </div>,
        ])}
      />
      {createOpen && (
        <CategoryFormModal
          category={editingCategory}
          flatAccounts={flatAccounts}
          onClose={() => setCreateOpen(false)}
          onDone={() => { setCreateOpen(false); reload(); }}
        />
      )}
    </div>
  );
}

function CategoryFormModal({ category, flatAccounts, onClose, onDone }: {
  category: ExpenseCategory | null; flatAccounts: { value: string; label: string }[]; onClose: () => void; onDone: () => void;
}) {
  const [name, setName] = useState(category?.name ?? '');
  const [nameAr, setNameAr] = useState(category?.nameAr ?? '');
  const [accountId, setAccountId] = useState(category?.accountId ?? '');
  const [err, setErr] = useState('');

  async function submit() {
    if (!name.trim()) { setErr(tr('Name is required')); return; }
    try {
      const body = {
        name: name.trim(),
        nameAr: nameAr.trim() || undefined,
        accountId: accountId || undefined,
      };
      if (category) {
        await api(`/expenses/categories/${category.id}`, { method: 'PATCH', body });
      } else {
        await api('/expenses/categories', { method: 'POST', body });
      }
      onDone();
    } catch (e) {
      setErr(e instanceof Error ? e.message : tr('Submit failed'));
    }
  }

  return (
    <Modal title={category ? `${tr('Edit Category:')} ${category.name}` : tr('New Category')} onClose={onClose}>
      <ErrorBanner message={err} />
      <div className="space-y-3">
        <Field label={tr('Category Name (English)')}><TextInput value={name} onChange={setName} /></Field>
        <Field label={tr('Category Name (Arabic)')}><TextInput value={nameAr} onChange={setNameAr} /></Field>
        <Field label={tr('Linked Ledger Account (Chart of Accounts)')}>
          <Select value={accountId} onChange={setAccountId} allowEmpty="— No tracking account —" options={flatAccounts} />
        </Field>
        <Btn kind="primary" onClick={() => void submit()}>{category ? tr('Save changes') : tr('Create category')}</Btn>
      </div>
    </Modal>
  );
}

function flattenAccounts(nodes: any[], prefix = ''): { value: string; label: string; isPaymentSource: boolean; code: string; balanceCents: number }[] {
  const list: { value: string; label: string; isPaymentSource: boolean; code: string; balanceCents: number }[] = [];
  for (const n of nodes) {
    list.push({
      value: n.id,
      label: `${prefix}${n.code} — ${n.name} (${(n.balanceCents / 100).toFixed(2)} ${tr('EGP)')}`,
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
