import { useState, useMemo, useEffect, useRef } from 'react';
import { api, egp, parseEgp } from '../lib/api';
import { Btn, ErrorBanner, Field, Modal, Pills, Select, Table, TextInput, useLoad, Spinner } from '../lib/ui';

interface Account {
  id: string;
  code: string;
  name: string;
  nameAr?: string | null;
  type: 'ASSET' | 'LIABILITY' | 'EQUITY' | 'REVENUE' | 'EXPENSE';
  parentAccountId?: string | null;
  balanceCents: number;
  initialBalanceCents?: number;
  isPaymentSource?: boolean;
  subAccounts: Account[];
}

interface JournalLine {
  id: string;
  accountId?: string;
  debitCents: number;
  creditCents: number;
  account: { code: string; name: string };
}

interface JournalEntry {
  id: string;
  date: string;
  description: string;
  reference?: string | null;
  lines: JournalLine[];
}

interface LedgerLine {
  id: string;
  date: string;
  description: string;
  reference?: string | null;
  debitCents: number;
  creditCents: number;
  runningBalanceCents: number;
}

interface LedgerResponse {
  account: { code: string; name: string; type: string };
  lines: LedgerLine[];
}

const SECTIONS = ['chart of accounts', 'journal entries', 'cash transfers', 'account ledger', 'financial reports', 'close shift wizard'] as const;
const ACCOUNT_TYPES = [
  { value: 'ASSET', label: 'Asset (الأصول)' },
  { value: 'LIABILITY', label: 'Liability (الخصوم)' },
  { value: 'EQUITY', label: 'Equity (حقوق الملكية)' },
  { value: 'REVENUE', label: 'Revenue (الإيرادات)' },
  { value: 'EXPENSE', label: 'Expense (المصروفات)' },
];

export function AccountingView() {
  const [section, setSection] = useState<(typeof SECTIONS)[number]>('chart of accounts');
  return (
    <div className="space-y-4">
      <div className="mb-4"><Pills value={section} onChange={setSection} options={SECTIONS} /></div>
      {section === 'chart of accounts' && <ChartOfAccounts />}
      {section === 'journal entries' && <JournalEntriesList />}
      {section === 'cash transfers' && <CashTransfers />}
      {section === 'account ledger' && <AccountLedger />}
      {section === 'financial reports' && <FinancialReports />}
      {section === 'close shift wizard' && <CloseShiftWizard />}
    </div>
  );
}

// ---------- Formatting Helper ----------
function fmtBalance(cents: number, type: string) {
  const isCreditNormal = ['LIABILITY', 'EQUITY', 'REVENUE'].includes(type);
  const normalCents = isCreditNormal ? -cents : cents;
  const amount = egp(Math.abs(normalCents));
  const sign = normalCents >= 0 ? (isCreditNormal ? 'Cr' : 'Dr') : (isCreditNormal ? 'Dr' : 'Cr');
  return `${amount} (${sign})`;
}

// ---------- Chart of Accounts ----------
function ChartOfAccounts() {
  const { data: accounts, reload } = useLoad(() => api<Account[]>('/accounting/accounts'));
  const [createOpen, setCreateOpen] = useState(false);
  const [editingAccount, setEditingAccount] = useState<Account | null>(null);

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <div>
          <h2 className="text-lg font-bold text-slate-700">Chart of Accounts</h2>
          <p className="text-xs text-slate-400">Hierarchical list of Asset, Liability, Equity, Revenue, and Expense accounts.</p>
        </div>
        <Btn kind="primary" onClick={() => { setEditingAccount(null); setCreateOpen(true); }}>+ New Account</Btn>
      </div>

      <div className="rounded-xl bg-white p-4 shadow overflow-hidden">
        <div className="grid grid-cols-[120px_1fr_150px_180px_100px] border-b pb-2 text-xs font-bold uppercase tracking-wider text-slate-400">
          <span>Code</span>
          <span>Account Name</span>
          <span>Type</span>
          <span className="text-right">Balance</span>
          <span className="text-right">Actions</span>
        </div>
        <div className="divide-y text-sm">
          {(accounts ?? []).map((acc) => (
            <AccountRow key={acc.id} account={acc} depth={0} onEdit={(a) => { setEditingAccount(a); setCreateOpen(true); }} />
          ))}
          {!accounts?.length && <p className="p-4 text-slate-400">No accounts found.</p>}
        </div>
      </div>

      {createOpen && (
        <AccountFormModal
          account={editingAccount}
          rawAccounts={accounts ?? []}
          onClose={() => setCreateOpen(false)}
          onDone={() => { setCreateOpen(false); reload(); }}
        />
      )}
    </div>
  );
}

function AccountRow({ account, depth, onEdit }: { account: Account; depth: number; onEdit: (a: Account) => void }) {
  const [expanded, setExpanded] = useState(true);
  const hasChildren = account.subAccounts && account.subAccounts.length > 0;

  return (
    <div className="w-full">
      <div className="grid grid-cols-[120px_1fr_150px_180px_100px] py-2.5 items-center hover:bg-slate-50">
        <span className="font-mono font-semibold text-slate-500">{account.code}</span>
        <span className="flex items-center gap-1 font-semibold text-slate-800" style={{ paddingLeft: `${depth * 20}px` }}>
          {hasChildren && (
            <button onClick={() => setExpanded(!expanded)} className="text-slate-400 hover:text-slate-600 focus:outline-none w-4 text-left">
              {expanded ? '▼' : '►'}
            </button>
          )}
          {!hasChildren && <span className="w-4 inline-block" />}
          <span>{account.name}</span>
          {account.nameAr && <span className="text-xs text-slate-400 font-normal">({account.nameAr})</span>}
        </span>
        <span className="text-xs font-semibold uppercase text-slate-400">{account.type}</span>
        <span className="text-right font-mono font-semibold text-slate-700">{fmtBalance(account.balanceCents, account.type)}</span>
        <span className="text-right">
          <Btn kind="ghost" onClick={() => onEdit(account)}>Edit</Btn>
        </span>
      </div>
      {hasChildren && expanded && (
        <div className="w-full divide-y divide-slate-100">
          {account.subAccounts.map((sub) => (
            <AccountRow key={sub.id} account={sub} depth={depth + 1} onEdit={onEdit} />
          ))}
        </div>
      )}
    </div>
  );
}

function getDescendantIds(acc: Account): string[] {
  const ids: string[] = [];
  if (acc.subAccounts) {
    for (const sub of acc.subAccounts) {
      ids.push(sub.id);
      ids.push(...getDescendantIds(sub));
    }
  }
  return ids;
}

function AccountFormModal({ account, rawAccounts, onClose, onDone }: {
  account: Account | null; rawAccounts: Account[]; onClose: () => void; onDone: () => void;
}) {
  const [code, setCode] = useState(account?.code ?? '');
  const [name, setName] = useState(account?.name ?? '');
  const [nameAr, setNameAr] = useState(account?.nameAr ?? '');
  const [type, setType] = useState<any>(account?.type ?? 'ASSET');
  const [parentAccountId, setParentAccountId] = useState(account?.parentAccountId ?? '');
  const [initialBalance, setInitialBalance] = useState(account?.initialBalanceCents ? String(account.initialBalanceCents / 100) : '');
  const [isPaymentSource, setIsPaymentSource] = useState(account?.isPaymentSource ?? false);
  const [err, setErr] = useState('');

  // 1. Build a map of account types
  const accountTypesMap = useMemo(() => {
    const map = new Map<string, 'ASSET' | 'LIABILITY' | 'EQUITY' | 'REVENUE' | 'EXPENSE'>();
    const traverse = (list: Account[]) => {
      for (const a of list) {
        map.set(a.id, a.type);
        if (a.subAccounts) traverse(a.subAccounts);
      }
    };
    traverse(rawAccounts);
    return map;
  }, [rawAccounts]);

  // 2. Identify excluded IDs (the account itself and its descendants)
  const excludedIds = useMemo(() => {
    if (!account) return [];
    return [account.id, ...getDescendantIds(account)];
  }, [account]);

  // 3. Filter flat list of parent options
  const parentOptions = useMemo(() => {
    const fullFlat = flattenAccounts(rawAccounts);
    return fullFlat.filter(o => !excludedIds.includes(o.value));
  }, [rawAccounts, excludedIds]);

  // 4. Dynamically determine the active type
  const activeType = useMemo(() => {
    if (parentAccountId) {
      return accountTypesMap.get(parentAccountId) ?? 'ASSET';
    }
    return account ? account.type : type;
  }, [parentAccountId, type, account, accountTypesMap]);

  async function submit() {
    if (!code.trim() || !name.trim()) {
      setErr('Account code and name are required'); return;
    }
    try {
      if (account) {
        const body = {
          code: code.trim(),
          name: name.trim(),
          nameAr: nameAr.trim() || undefined,
          initialBalanceCents: initialBalance ? parseEgp(initialBalance) : 0,
          isPaymentSource: activeType === 'ASSET' ? isPaymentSource : false,
          parentAccountId: parentAccountId || null,
        };
        await api(`/accounting/accounts/${account.id}`, { method: 'PATCH', body });
      } else {
        const body = {
          code: code.trim(),
          name: name.trim(),
          nameAr: nameAr.trim() || undefined,
          type,
          parentAccountId: parentAccountId || undefined,
          initialBalanceCents: initialBalance ? parseEgp(initialBalance) : 0,
          isPaymentSource: type === 'ASSET' ? isPaymentSource : false,
        };
        await api('/accounting/accounts', { method: 'POST', body });
      }
      onDone();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Submit failed');
    }
  }

  return (
    <Modal title={account ? `Edit Account: ${account.name}` : 'New Account'} onClose={onClose}>
      <ErrorBanner message={err} />
      <div className="space-y-3">
        <Field label="Account Code (e.g. 1110, 5225)"><TextInput value={code} onChange={setCode} /></Field>
        <Field label="Account Name (English)"><TextInput value={name} onChange={setName} /></Field>
        <Field label="Account Name (Arabic - Optional)"><TextInput value={nameAr} onChange={setNameAr} /></Field>
        {!account && !parentAccountId && (
          <Field label="Account Type">
            <Select value={type} onChange={setType} options={ACCOUNT_TYPES} />
          </Field>
        )}
        <Field label="Parent Account (Inherits Type)">
          <Select value={parentAccountId} onChange={setParentAccountId} allowEmpty="— Root Account (No parent) —" options={parentOptions} />
        </Field>
        {activeType === 'ASSET' && (
          <>
            <Field label="Initial Balance (EGP)">
              <TextInput value={initialBalance} onChange={setInitialBalance} type="number" />
            </Field>
            <label className="flex items-center gap-2 text-sm text-slate-700 py-1 cursor-pointer font-semibold">
              <input type="checkbox" checked={isPaymentSource} onChange={(e) => setIsPaymentSource(e.target.checked)} className="rounded text-emerald-700" />
              <span>Is Payment Source (can be selected as payment account in Expenses/Purchasing)</span>
            </label>
          </>
        )}
        <Btn kind="primary" onClick={() => void submit()}>{account ? 'Save changes' : 'Create account'}</Btn>
      </div>
    </Modal>
  );
}

// ---------- Journal Entries ----------
function isManualEntry(entry: JournalEntry) {
  const ref = entry.reference || '';
  const desc = entry.description || '';
  if (ref.startsWith('Opening Balance:') || ref.startsWith('Order #') || ref.startsWith('GoodsReceipt #') || ref.startsWith('Shift #') || ref.startsWith('Expense #')) {
    return false;
  }
  if (desc.startsWith('POS Cash Transfer:') || desc.startsWith('Cash Transfer:') || desc.startsWith('Expense:')) {
    return false;
  }
  return true;
}

function JournalEntriesList() {
  const { data: entries, reload } = useLoad(() => api<JournalEntry[]>('/accounting/journal-entries'));
  const { data: accounts } = useLoad(() => api<Account[]>('/accounting/accounts'));
  const [createOpen, setCreateOpen] = useState(false);
  const [editingEntry, setEditingEntry] = useState<JournalEntry | null>(null);

  const flatAccounts = accounts ? flattenAccounts(accounts) : [];

  async function handleDelete(id: string) {
    if (!confirm('Are you sure you want to delete this journal entry? This action is irreversible.')) return;
    try {
      await api(`/accounting/journal-entries/${id}`, { method: 'DELETE' });
      reload();
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Delete failed');
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <div>
          <h2 className="text-lg font-bold text-slate-700">Journal Entries</h2>
          <p className="text-xs text-slate-400">Browse financial transactions or post a new double-entry manual journal voucher.</p>
        </div>
        <Btn kind="primary" onClick={() => { setEditingEntry(null); setCreateOpen(true); }}>+ New Entry</Btn>
      </div>

      <div className="space-y-4">
        {(entries ?? []).map((entry) => {
          const sumDebit = entry.lines.reduce((a, l) => a + l.debitCents, 0);
          return (
            <div key={entry.id} className="rounded-xl bg-white p-4 shadow space-y-3">
              <div className="flex justify-between items-center border-b pb-2 text-xs">
                <div className="flex items-center gap-2">
                  <span className="font-bold text-slate-700">{new Date(entry.date).toLocaleDateString('en-EG')}</span>
                  {entry.reference && <span className="bg-slate-100 px-1.5 py-0.5 rounded text-slate-500 font-mono">Ref: {entry.reference}</span>}
                </div>
                <div className="flex items-center gap-2">
                  <span className="font-mono text-slate-400">Debit Sum: {egp(sumDebit)}</span>
                  {isManualEntry(entry) && (
                    <div className="flex gap-1 ml-2">
                      <Btn onClick={() => { setEditingEntry(entry); setCreateOpen(true); }}>Edit</Btn>
                      <Btn kind="danger" onClick={() => void handleDelete(entry.id)}>Delete</Btn>
                    </div>
                  )}
                </div>
              </div>
              <p className="text-sm font-semibold text-slate-800">{entry.description}</p>
              <table className="w-full text-xs text-slate-600 border-collapse">
                <thead>
                  <tr className="text-left font-bold text-slate-400">
                    <th className="py-1">Account</th>
                    <th className="py-1 text-right w-32">Debit (Dr)</th>
                    <th className="py-1 text-right w-32">Credit (Cr)</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {entry.lines.map((line) => (
                    <tr key={line.id} className="hover:bg-slate-50">
                      <td className="py-1 font-mono">{line.account.code} — {line.account.name}</td>
                      <td className="py-1 text-right font-mono text-emerald-700">{line.debitCents > 0 ? egp(line.debitCents) : ''}</td>
                      <td className="py-1 text-right font-mono text-slate-700">{line.creditCents > 0 ? egp(line.creditCents) : ''}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          );
        })}
        {!entries?.length && <p className="text-sm text-slate-400">No journal entries found.</p>}
      </div>

      {createOpen && (
        <JournalEntryFormModal
          entry={editingEntry}
          flatAccounts={flatAccounts}
          onClose={() => { setCreateOpen(false); setEditingEntry(null); }}
          onDone={() => { setCreateOpen(false); setEditingEntry(null); reload(); }}
        />
      )}
    </div>
  );
}

function JournalEntryFormModal({ flatAccounts, onClose, onDone, entry }: {
  flatAccounts: { value: string; label: string }[]; onClose: () => void; onDone: () => void; entry?: JournalEntry | null;
}) {
  const [description, setDescription] = useState(entry?.description ?? '');
  const [reference, setReference] = useState(entry?.reference ?? '');
  const [date, setDate] = useState((entry?.date ? new Date(entry.date) : new Date()).toISOString().slice(0, 10));
  const [lines, setLines] = useState<{ accountId: string; debit: string; credit: string }[]>(
    entry
      ? entry.lines.map((l) => ({
          accountId: l.accountId || (l as any).accountId || '',
          debit: l.debitCents > 0 ? String(l.debitCents / 100) : '',
          credit: l.creditCents > 0 ? String(l.creditCents / 100) : '',
        }))
      : [
          { accountId: '', debit: '', credit: '' },
          { accountId: '', debit: '', credit: '' },
        ]
  );
  const [err, setErr] = useState('');

  function setLine(i: number, patch: Partial<(typeof lines)[number]>) {
    setLines((cur) => cur.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  }

  const parsedLines = lines.map((l) => ({
    accountId: l.accountId,
    debitCents: parseEgp(l.debit) ?? 0,
    creditCents: parseEgp(l.credit) ?? 0,
  }));

  const totalDebit = parsedLines.reduce((sum, l) => sum + l.debitCents, 0);
  const totalCredit = parsedLines.reduce((sum, l) => sum + l.creditCents, 0);
  const isBalanced = totalDebit === totalCredit && totalDebit > 0;

  async function submit() {
    if (!description.trim()) { setErr('Description is required'); return; }
    if (!isBalanced) {
      setErr(`Debit and Credit sums must balance. Current Debit: ${egp(totalDebit)}, Credit: ${egp(totalCredit)}`);
      return;
    }
    const finalLines = parsedLines.filter((l) => l.accountId && (l.debitCents > 0 || l.creditCents > 0));
    if (finalLines.length < 2) {
      setErr('Journal entry needs at least 2 lines with accounts and values.');
      return;
    }

    try {
      if (entry) {
        await api(`/accounting/journal-entries/${entry.id}`, {
          method: 'PATCH',
          body: { description: description.trim(), date, reference: reference.trim() || undefined, lines: finalLines },
        });
      } else {
        await api('/accounting/journal-entries', {
          method: 'POST',
          body: { description: description.trim(), date, reference: reference.trim() || undefined, lines: finalLines },
        });
      }
      onDone();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Submit failed');
    }
  }

  return (
    <Modal title={entry ? "Edit Journal Entry" : "New Journal Entry"} onClose={onClose} wide>
      <ErrorBanner message={err} />
      <div className="space-y-4">
        <Field label="Description / Narration"><TextInput value={description} onChange={setDescription} /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Date"><TextInput value={date} onChange={setDate} type="date" /></Field>
          <Field label="Reference # (e.g. Voucher, Check ID)"><TextInput value={reference} onChange={setReference} /></Field>
        </div>

        <div className="space-y-2 border-t pt-3">
          <div className="grid grid-cols-[1fr_130px_130px_32px] gap-2 text-xs font-bold text-slate-400">
            <span>Ledger Account</span>
            <span className="text-right">Debit (Dr)</span>
            <span className="text-right">Credit (Cr)</span>
            <span></span>
          </div>

          {lines.map((l, i) => (
            <div key={i} className="grid grid-cols-[1fr_130px_130px_32px] gap-2 items-center">
              <Select
                value={l.accountId}
                onChange={(val) => setLine(i, { accountId: val })}
                allowEmpty="— pick account —"
                options={flatAccounts}
              />
              <TextInput
                value={l.debit}
                onChange={(val) => setLine(i, { debit: val, credit: val ? '' : l.credit })}
                type="number"
                placeholder="0.00"
              />
              <TextInput
                value={l.credit}
                onChange={(val) => setLine(i, { credit: val, debit: val ? '' : l.debit })}
                type="number"
                placeholder="0.00"
              />
              <button
                onClick={() => setLines((cur) => cur.filter((_, j) => j !== i))}
                className="rounded-lg bg-slate-100 py-2 text-slate-400 hover:bg-red-50 hover:text-red-600 focus:outline-none"
              >
                ✕
              </button>
            </div>
          ))}

          <div className="flex gap-2">
            <Btn onClick={() => setLines((cur) => [...cur, { accountId: '', debit: '', credit: '' }])}>+ Add Line</Btn>
          </div>
        </div>

        <div className="flex justify-between items-center border-t pt-3 text-sm font-semibold">
          <div className="flex gap-4">
            <span className="text-emerald-700">Total Debit: {egp(totalDebit)}</span>
            <span className="text-slate-700">Total Credit: {egp(totalCredit)}</span>
          </div>
          {totalDebit > 0 && (
            <span className={isBalanced ? 'text-emerald-600' : 'text-red-600'}>
              {isBalanced ? '✓ Balanced' : `✗ Difference: ${egp(Math.abs(totalDebit - totalCredit))}`}
            </span>
          )}
        </div>

        <Btn kind="primary" onClick={() => void submit()} disabled={!isBalanced}>
          Post Journal Voucher
        </Btn>
      </div>
    </Modal>
  );
}

// ---------- Account Ledger ----------
function AccountLedger() {
  const { data: accounts } = useLoad(() => api<Account[]>('/accounting/accounts'));
  const [selectedAccountId, setSelectedAccountId] = useState('');
  const { data: ledger } = useLoad(
    () => (selectedAccountId ? api<LedgerResponse>(`/accounting/accounts/${selectedAccountId}/ledger`) : Promise.resolve(null)),
    [selectedAccountId],
  );

  const flatAccounts = accounts ? flattenAccounts(accounts) : [];

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-bold text-slate-700">Account Ledger</h2>
        <p className="text-xs text-slate-400">View statement of accounts and transaction ledgers for any account.</p>
      </div>

      <div className="w-96">
        <Field label="Select Account">
          <Select value={selectedAccountId} onChange={setSelectedAccountId} allowEmpty="— pick account —" options={flatAccounts} />
        </Field>
      </div>

      {ledger && (
        <div className="rounded-xl bg-white p-4 shadow space-y-4">
          <div className="flex justify-between border-b pb-2">
            <h3 className="font-bold text-slate-800">{ledger.account.code} — {ledger.account.name}</h3>
            <span className="text-xs font-semibold text-slate-400 uppercase">Type: {ledger.account.type}</span>
          </div>

          <Table
            headers={['Date', 'Description', 'Reference', 'Debit (Dr)', 'Credit (Cr)', 'Running Balance']}
            rows={ledger.lines.map((l) => [
              new Date(l.date).toLocaleDateString('en-EG'),
              l.description,
              l.reference ?? '—',
              l.debitCents > 0 ? <span className="text-emerald-700 font-mono">{egp(l.debitCents)}</span> : '—',
              l.creditCents > 0 ? <span className="text-slate-700 font-mono">{egp(l.creditCents)}</span> : '—',
              <span key="bal" className="font-semibold font-mono text-slate-700">{fmtBalance(l.runningBalanceCents, ledger.account.type)}</span>,
            ])}
          />
          {ledger.lines.length === 0 && <p className="text-sm text-slate-400 text-center py-4">No ledger postings for this account yet.</p>}
        </div>
      )}
    </div>
  );
}

// ---------- Financial Reports ----------
const REPORT_TABS = ['trial balance', 'balance sheet', 'profit & loss'] as const;

function FinancialReports() {
  const [reportTab, setReportTab] = useState<(typeof REPORT_TABS)[number]>('trial balance');
  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-bold text-slate-700">Financial Statements & Reports</h2>
        <p className="text-xs text-slate-400">Generate standard business balance sheets, trial balances, and income statements.</p>
      </div>
      <div className="flex gap-2">
        <Pills value={reportTab} onChange={setReportTab} options={REPORT_TABS} />
      </div>
      {reportTab === 'trial balance' && <TrialBalanceReport />}
      {reportTab === 'balance sheet' && <BalanceSheetReport />}
      {reportTab === 'profit & loss' && <PnlReport />}
    </div>
  );
}

function TrialBalanceReport() {
  const { data } = useLoad(() => api<any[]>('/accounting/reports/trial-balance'));

  const totalDebit = (data ?? []).reduce((sum, a) => sum + a.debitCents, 0);
  const totalCredit = (data ?? []).reduce((sum, a) => sum + a.creditCents, 0);

  return (
    <div className="rounded-xl bg-white p-4 shadow space-y-4">
      <h3 className="font-bold text-slate-800 border-b pb-2">Trial Balance Statement</h3>
      <Table
        headers={['Account Code', 'Account Name', 'Type', 'Debit (Dr)', 'Credit (Cr)']}
        rows={(data ?? []).map((a) => [
          a.code,
          a.name,
          a.type,
          a.debitCents > 0 ? egp(a.debitCents) : '—',
          a.creditCents > 0 ? egp(a.creditCents) : '—',
        ])}
      />
      <div className="flex justify-end gap-12 border-t pt-3 font-bold text-slate-800 text-sm">
        <span>Total Debit: <span className="text-emerald-700">{egp(totalDebit)}</span></span>
        <span>Total Credit: <span className="text-slate-700">{egp(totalCredit)}</span></span>
      </div>
    </div>
  );
}

function BalanceSheetReport() {
  const { data } = useLoad(() => api<any>('/accounting/reports/balance-sheet'));

  if (!data) return null;

  function renderReportRow(acc: any, depth = 0): React.ReactNode[] {
    const rowsList: any[] = [];
    rowsList.push([
      <span key="name" className="font-semibold text-slate-700" style={{ paddingLeft: `${depth * 20}px` }}>{acc.code} — {acc.name}</span>,
      <span key="bal" className="font-mono text-slate-700 font-semibold">{fmtBalance(acc.balanceCents, acc.type)}</span>,
    ]);
    for (const sub of acc.subAccounts) {
      rowsList.push(...renderReportRow(sub, depth + 1));
    }
    return rowsList;
  }

  const assetRows = data.assets.flatMap((r: any) => renderReportRow(r));
  const liabilityRows = data.liabilities.flatMap((r: any) => renderReportRow(r));
  const equityRows = data.equity.flatMap((r: any) => renderReportRow(r));

  const totalAssets = data.assets.reduce((sum: number, r: any) => sum + r.balanceCents, 0);
  const totalLiabilities = data.liabilities.reduce((sum: number, r: any) => sum + r.balanceCents, 0);
  const totalEquity = data.equity.reduce((sum: number, r: any) => sum + r.balanceCents, 0);

  return (
    <div className="rounded-xl bg-white p-4 shadow space-y-6">
      <h3 className="font-bold text-slate-800 border-b pb-2">Balance Sheet (Statement of Financial Position)</h3>

      <div className="space-y-4">
        <div>
          <h4 className="font-bold text-sm text-emerald-800 mb-2 border-b border-emerald-100 pb-1">Assets</h4>
          <Table headers={['Account', 'Balance']} rows={assetRows} />
          <div className="text-right font-bold text-slate-800 text-sm mt-2">
            Total Assets: <span className="font-mono">{fmtBalance(totalAssets, 'ASSET')}</span>
          </div>
        </div>

        <div>
          <h4 className="font-bold text-sm text-slate-800 mb-2 border-b border-slate-100 pb-1 font-mono">Liabilities</h4>
          <Table headers={['Account', 'Balance']} rows={liabilityRows} />
          <div className="text-right font-bold text-slate-800 text-sm mt-2">
            Total Liabilities: <span className="font-mono">{fmtBalance(totalLiabilities, 'LIABILITY')}</span>
          </div>
        </div>

        <div>
          <h4 className="font-bold text-sm text-slate-800 mb-2 border-b border-slate-100 pb-1 font-mono">Equity</h4>
          <Table headers={['Account', 'Balance']} rows={equityRows} />
          <div className="text-right font-bold text-slate-800 text-sm mt-2">
            Total Equity: <span className="font-mono">{fmtBalance(totalEquity, 'EQUITY')}</span>
          </div>
        </div>
      </div>

      <div className="border-t pt-4 flex justify-between items-center text-sm font-bold border-double border-t-4">
        <span className="text-emerald-700">Total Assets: {fmtBalance(totalAssets, 'ASSET')}</span>
        <span className="text-slate-800">Liabilities + Equity: {fmtBalance(totalLiabilities + totalEquity, 'LIABILITY')}</span>
        <span className={Math.abs(totalAssets - (totalLiabilities + totalEquity)) === 0 ? 'text-emerald-600' : 'text-red-600'}>
          {Math.abs(totalAssets - (totalLiabilities + totalEquity)) === 0 ? '✓ Equation Balances' : `✗ Discrepancy: ${egp(Math.abs(totalAssets - (totalLiabilities + totalEquity)))}`}
        </span>
      </div>
    </div>
  );
}

function PnlReport() {
  const [from, setFrom] = useState(new Date(Date.now() - 30 * 86400_000).toISOString().slice(0, 10));
  const [to, setTo] = useState(new Date().toISOString().slice(0, 10));
  const { data } = useLoad(
    () => api<any>(`/accounting/reports/pnl?from=${encodeURIComponent(new Date(from).toISOString())}&to=${encodeURIComponent(new Date(to).toISOString())}`),
    [from, to],
  );

  if (!data) return null;

  function renderReportRow(acc: any, depth = 0): React.ReactNode[] {
    const rowsList: any[] = [];
    rowsList.push([
      <span key="name" className="font-semibold text-slate-700" style={{ paddingLeft: `${depth * 20}px` }}>{acc.code} — {acc.name}</span>,
      <span key="bal" className="font-mono font-semibold text-slate-700">{egp(acc.balanceCents)}</span>,
    ]);
    for (const sub of acc.subAccounts) {
      rowsList.push(...renderReportRow(sub, depth + 1));
    }
    return rowsList;
  }

  const revenueRows = data.revenues.flatMap((r: any) => renderReportRow(r));
  const expenseRows = data.expenses.flatMap((r: any) => renderReportRow(r));

  return (
    <div className="rounded-xl bg-white p-4 shadow space-y-6">
      <div className="flex justify-between items-center border-b pb-2">
        <h3 className="font-bold text-slate-800">Profit & Loss Statement (Income Statement)</h3>
        <div className="flex items-center gap-2 text-xs">
          <span>From</span>
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="rounded border p-1" />
          <span>To</span>
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="rounded border p-1" />
        </div>
      </div>

      <div className="space-y-4">
        <div>
          <h4 className="font-bold text-sm text-emerald-800 mb-2 border-b border-emerald-100 pb-1">Operating Revenues</h4>
          <Table headers={['Account', 'Amount']} rows={revenueRows} />
          <div className="text-right font-bold text-slate-800 text-sm mt-2">
            Total Revenue: {egp(data.totalRevenue)}
          </div>
        </div>

        <div>
          <h4 className="font-bold text-sm text-red-800 mb-2 border-b border-red-100 pb-1">Operating Expenses</h4>
          <Table headers={['Account', 'Amount']} rows={expenseRows} />
          <div className="text-right font-bold text-slate-800 text-sm mt-2">
            Total Expenses: {egp(data.totalExpense)}
          </div>
        </div>
      </div>

      <div className="border-t pt-4 flex justify-between items-center text-sm font-bold border-double border-t-4">
        <span>Operating Profit / Loss</span>
        <span className={data.netProfit >= 0 ? 'text-emerald-700 font-mono text-base' : 'text-red-700 font-mono text-base'}>
          {data.netProfit >= 0 ? 'Net Income: ' : 'Net Loss: '} {egp(data.netProfit)}
        </span>
      </div>
    </div>
  );
}

function flattenAccounts(nodes: any[], prefix = ''): { value: string; label: string; code: string; balanceCents: number }[] {
  const list: { value: string; label: string; code: string; balanceCents: number }[] = [];
  for (const n of nodes) {
    list.push({
      value: n.id,
      label: `${prefix}${n.code} — ${n.name} (${(n.balanceCents / 100).toFixed(2)} EGP)`,
      code: n.code,
      balanceCents: n.balanceCents,
    });
    if (n.subAccounts && n.subAccounts.length > 0) {
      list.push(...flattenAccounts(n.subAccounts, prefix + '  '));
    }
  }
  return list;
}

// ---------- cash transfers ----------

interface CashTransfer {
  id: string;
  date: string;
  description: string;
  reference?: string | null;
  lines: {
    id: string;
    debitCents: number;
    creditCents: number;
    account: { code: string; name: string };
  }[];
}

function CashTransfers() {
  const { data: transfers, reload } = useLoad(() => api<CashTransfer[]>('/accounting/transfers'));
  const { data: accounts } = useLoad(() => api<Account[]>('/accounting/accounts'));
  const [createOpen, setCreateOpen] = useState(false);

  const flatAssetAccounts = accounts ? flattenAssetAccounts(accounts) : [];

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <div>
          <h2 className="text-lg font-bold text-slate-700">Cash Transfers</h2>
          <p className="text-xs text-slate-400 font-normal">Record and review movements of cash between bank accounts, drawers, and safes.</p>
        </div>
        <Btn kind="primary" onClick={() => setCreateOpen(true)}>+ New Cash Transfer</Btn>
      </div>

      <div className="space-y-4">
        {(transfers ?? []).map((t) => {
          const debitLine = t.lines.find((l) => l.debitCents > 0);
          const creditLine = t.lines.find((l) => l.creditCents > 0);
          const amount = debitLine ? debitLine.debitCents : (creditLine ? creditLine.creditCents : 0);

          return (
            <div key={t.id} className="rounded-xl bg-white p-4 shadow space-y-3">
              <div className="flex justify-between items-center border-b pb-2 text-xs">
                <div className="flex items-center gap-2">
                  <span className="font-bold text-slate-700">{new Date(t.date).toLocaleDateString('en-EG')}</span>
                  {t.reference && <span className="bg-slate-100 px-1.5 py-0.5 rounded text-slate-500 font-mono">Ref: {t.reference}</span>}
                </div>
                <span className="font-mono text-emerald-700 font-bold text-sm">{egp(amount)}</span>
              </div>
              <p className="text-sm font-semibold text-slate-800">{t.description}</p>
              
              <div className="grid grid-cols-2 gap-4 text-xs bg-slate-50 rounded-lg p-3">
                <div>
                  <span className="block text-slate-400 font-semibold uppercase tracking-wider mb-1">Source (Credit)</span>
                  <span className="font-mono text-slate-700">
                    {creditLine ? `${creditLine.account.code} — ${creditLine.account.name}` : '—'}
                  </span>
                </div>
                <div>
                  <span className="block text-emerald-600 font-semibold uppercase tracking-wider mb-1">Target (Debit)</span>
                  <span className="font-mono text-emerald-800 font-semibold">
                    {debitLine ? `${debitLine.account.code} — ${debitLine.account.name}` : '—'}
                  </span>
                </div>
              </div>
            </div>
          );
        })}
        {!transfers?.length && <p className="text-sm text-slate-400">No cash transfers found.</p>}
      </div>

      {createOpen && (
        <CashTransferFormModal
          flatAssetAccounts={flatAssetAccounts}
          onClose={() => setCreateOpen(false)}
          onDone={() => { setCreateOpen(false); reload(); }}
        />
      )}
    </div>
  );
}

function CashTransferFormModal({ flatAssetAccounts, onClose, onDone }: {
  flatAssetAccounts: { value: string; label: string }[]; onClose: () => void; onDone: () => void;
}) {
  const [sourceAccountId, setSourceAccountId] = useState('');
  const [targetAccountId, setTargetAccountId] = useState('');
  const [amount, setAmount] = useState('');
  const [description, setDescription] = useState('');
  const [reference, setReference] = useState('');
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [err, setErr] = useState('');

  async function submit() {
    if (!sourceAccountId || !targetAccountId) {
      setErr('Both source and target accounts are required'); return;
    }
    if (sourceAccountId === targetAccountId) {
      setErr('Source and target accounts must be different'); return;
    }
    const cents = parseEgp(amount);
    if (!cents || cents <= 0) {
      setErr('Enter a valid positive transfer amount'); return;
    }
    if (!description.trim()) {
      setErr('Description is required'); return;
    }

    try {
      await api('/accounting/transfers', {
        method: 'POST',
        body: {
          sourceAccountId,
          targetAccountId,
          amountCents: cents,
          description: description.trim(),
          reference: reference.trim() || undefined,
          date,
        },
      });
      onDone();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Submit failed');
    }
  }

  return (
    <Modal title="New Cash Transfer" onClose={onClose}>
      <ErrorBanner message={err} />
      <div className="space-y-4">
        <Field label="From Account (Source)">
          <Select value={sourceAccountId} onChange={setSourceAccountId} allowEmpty="— pick source account —" options={flatAssetAccounts} />
        </Field>
        <Field label="To Account (Target)">
          <Select value={targetAccountId} onChange={setTargetAccountId} allowEmpty="— pick target account —" options={flatAssetAccounts} />
        </Field>
        <Field label="Amount (EGP)"><TextInput value={amount} onChange={setAmount} placeholder="0.00" type="number" /></Field>
        <Field label="Description / Narration"><TextInput value={description} onChange={setDescription} placeholder="e.g. Safe drop, bank deposit" /></Field>
        
        <div className="grid grid-cols-2 gap-3">
          <Field label="Date"><TextInput value={date} onChange={setDate} type="date" /></Field>
          <Field label="Reference # (optional)"><TextInput value={reference} onChange={setReference} placeholder="e.g. Check ID, Slip #" /></Field>
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <Btn onClick={onClose}>Cancel</Btn>
          <Btn kind="primary" onClick={() => void submit()}>Record Transfer</Btn>
        </div>
      </div>
    </Modal>
  );
}

function flattenAssetAccounts(nodes: any[], prefix = ''): { value: string; label: string; code: string; balanceCents: number }[] {
  const list: { value: string; label: string; code: string; balanceCents: number }[] = [];
  for (const n of nodes) {
    if (n.type === 'ASSET') {
      list.push({
        value: n.id,
        label: `${prefix}${n.code} — ${n.name} (${(n.balanceCents / 100).toFixed(2)} EGP)`,
        code: n.code,
        balanceCents: n.balanceCents,
      });
    }
    if (n.subAccounts && n.subAccounts.length > 0) {
      list.push(...flattenAssetAccounts(n.subAccounts, prefix + '  '));
    }
  }
  return list;
}

function findAccountByCode(nodes: Account[], code: string): Account | null {
  for (const n of nodes) {
    if (n.code === code) return n;
    if (n.subAccounts && n.subAccounts.length > 0) {
      const found = findAccountByCode(n.subAccounts, code);
      if (found) return found;
    }
  }
  return null;
}

function CloseShiftWizard() {
  const { data: shifts, error: shiftsError, reload: reloadShifts } = useLoad(() => api<any[]>('/shifts'));
  const { data: accounts, error: accountsError, reload: reloadAccounts } = useLoad(() => api<Account[]>('/accounting/accounts'));
  const { data: transfers, reload: reloadTransfers } = useLoad(() => api<any[]>('/accounting/transfers'));

  const [step1Status, setStep1Status] = useState<'pending' | 'skipped' | 'success'>('pending');
  const [step3Status, setStep3Status] = useState<'pending' | 'skipped' | 'success'>('pending');

  const [step1Amount, setStep1Amount] = useState('');
  const [step2Amount, setStep2Amount] = useState('');
  const [step3Amount, setStep3Amount] = useState('');

  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const [isReconciling, setIsReconciling] = useState(false);
  const [newCountedAmount, setNewCountedAmount] = useState('');
  const [reconcileError, setReconcileError] = useState('');
  const [reconcileLoading, setReconcileLoading] = useState(false);

  async function submitReconciliation() {
    if (!lastClosedShift) return;
    setReconcileError('');
    setReconcileLoading(true);
    try {
      const cents = parseEgp(newCountedAmount);
      if (cents === null || cents < 0) {
        throw new Error('Please enter a valid non-negative count amount.');
      }
      await api(`/shifts/${lastClosedShift.id}/reconcile`, {
        method: 'POST',
        body: { countedCents: cents },
      });
      setIsReconciling(false);
      await reloadShifts();
      await reloadAccounts();
    } catch (e) {
      setReconcileError(e instanceof Error ? e.message : 'Reconciliation failed');
    } finally {
      setReconcileLoading(false);
    }
  }

  const cashDrawerAcc = useMemo(() => (accounts ? findAccountByCode(accounts, '1110') : null), [accounts]);
  const mainSafeAcc = useMemo(() => (accounts ? findAccountByCode(accounts, '1120') : null), [accounts]);
  const tipsDrawerAcc = useMemo(() => (accounts ? findAccountByCode(accounts, '1125') : null), [accounts]);
  const custodyAcc = useMemo(() => (accounts ? findAccountByCode(accounts, '1130') : null), [accounts]);

  const lastClosedShift = useMemo(() => {
    if (!shifts) return null;
    return shifts.find((s) => s.status === 'CLOSED');
  }, [shifts]);

  const tipsCents = useMemo(() => {
    if (!lastClosedShift) return 0;
    let zReportObj = lastClosedShift.zReport;
    if (typeof zReportObj === 'string') {
      try {
        zReportObj = JSON.parse(zReportObj);
      } catch (e) {
        zReportObj = null;
      }
    }
    return zReportObj?.tipsCents ?? 0;
  }, [lastClosedShift]);

  const step1Posted = useMemo(() => {
    if (!transfers || !lastClosedShift) return false;
    const matchStr = `Shift #${lastClosedShift.id.slice(-6)}`;
    return transfers.some((t) => t.description.includes(matchStr) && t.description.toLowerCase().includes('tips'));
  }, [transfers, lastClosedShift]);

  const step2Posted = useMemo(() => {
    if (!transfers || !lastClosedShift) return false;
    const matchStr = `Shift #${lastClosedShift.id.slice(-6)}`;
    return transfers.some((t) => t.description.includes(matchStr) && t.description.toLowerCase().includes('remaining'));
  }, [transfers, lastClosedShift]);

  useEffect(() => {
    if (lastClosedShift) {
      setStep1Amount(String(tipsCents / 100));
    }
  }, [lastClosedShift, tipsCents]);

  useEffect(() => {
    if (cashDrawerAcc) {
      if (step1Posted) {
        setStep2Amount(String(cashDrawerAcc.balanceCents / 100));
      } else {
        const expectedRemaining = Math.max(0, cashDrawerAcc.balanceCents - tipsCents);
        setStep2Amount(String(expectedRemaining / 100));
      }
    }
  }, [cashDrawerAcc, tipsCents, step1Posted]);

  useEffect(() => {
    if (custodyAcc) {
      setStep3Amount(String(custodyAcc.balanceCents / 100));
    }
  }, [custodyAcc]);

  const step1StatusState = useMemo(() => {
    if (step1Posted) return 'success';
    if (tipsCents === 0) return 'skipped';
    return step1Status;
  }, [step1Posted, tipsCents, step1Status]);

  const step2StatusState = useMemo(() => {
    if (step2Posted) return 'success';
    return 'pending';
  }, [step2Posted]);

  const step3StatusState = useMemo(() => {
    if (custodyAcc && custodyAcc.balanceCents === 0) return 'skipped';
    return step3Status;
  }, [custodyAcc, step3Status]);

  if (shiftsError || accountsError) {
    return <ErrorBanner message={shiftsError || accountsError} />;
  }

  if (!shifts || !accounts) {
    return <Spinner />;
  }

  if (!lastClosedShift) {
    return (
      <div className="rounded-xl bg-white p-6 shadow text-center">
        <p className="text-slate-500 font-medium font-sans">No closed shifts found in the system.</p>
        <p className="text-xs text-slate-400 mt-1 font-sans">Please close a shift in the POS first before using the Close Shift Wizard.</p>
      </div>
    );
  }

  async function postTransfer(step: number, sourceId: string, targetId: string, amountStr: string, desc: string) {
    setError('');
    setLoading(true);
    try {
      const cents = parseEgp(amountStr);
      if (!cents || cents <= 0) {
        throw new Error('Please enter a valid positive transfer amount.');
      }
      await api('/accounting/transfers', {
        method: 'POST',
        body: {
          sourceAccountId: sourceId,
          targetAccountId: targetId,
          amountCents: cents,
          description: desc,
          date: new Date().toISOString().slice(0, 10),
        },
      });

      await reloadAccounts();
      await reloadTransfers();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Transfer failed');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-6 max-w-3xl mx-auto">
      <div>
        <h2 className="text-lg font-bold text-slate-700 font-sans">Accountant's Shift Close Wizard</h2>
        <p className="text-xs text-slate-400 font-sans mb-3">Step-by-step process to reconcile and move cash from POS registers to the Main Safe and Tips Drawer.</p>
        
        <div className="bg-white rounded-xl p-5 shadow border border-slate-100 font-sans space-y-4">
          <div className="flex justify-between items-center border-b pb-3">
            <div>
              <h3 className="font-bold text-slate-800 text-sm">Last Closed Shift Summary</h3>
              <p className="text-[11px] text-slate-400 mt-0.5">
                Closed At: {new Date(lastClosedShift.closedAt).toLocaleString('en-EG')} | Operator: {lastClosedShift.openedBy?.name ?? '—'}
              </p>
            </div>
            <span className="font-mono bg-slate-100 px-2 py-0.5 rounded text-slate-700 text-[10px] font-semibold">
              ID: {lastClosedShift.id.slice(-6)}
            </span>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-xs">
            <div className="bg-slate-50 p-2.5 rounded-lg border border-slate-100">
              <p className="text-slate-400 font-medium">Opening Float</p>
              <p className="font-bold font-mono text-slate-700 mt-1">{egp(lastClosedShift.floatCents)}</p>
            </div>
            <div className="bg-slate-50 p-2.5 rounded-lg border border-slate-100">
              <p className="text-slate-400 font-medium">Expected Drawer Cash</p>
              <p className="font-bold font-mono text-slate-700 mt-1">{egp(lastClosedShift.expectedCents ?? 0)}</p>
            </div>
            <div className="bg-slate-50 p-2.5 rounded-lg border border-slate-100">
              <p className="text-slate-400 font-medium">Actual Counted Cash</p>
              <p className="font-bold font-mono text-slate-700 mt-1">{egp(lastClosedShift.countedCents ?? 0)}</p>
            </div>
            <div className="bg-slate-50 p-2.5 rounded-lg border border-slate-100">
              <p className="text-slate-400 font-medium">Difference (Variance)</p>
              <p className={`font-bold font-mono mt-1 ${(lastClosedShift.varianceCents ?? 0) < 0 ? 'text-red-600' : (lastClosedShift.varianceCents ?? 0) > 0 ? 'text-emerald-700' : 'text-slate-700'}`}>
                {(lastClosedShift.varianceCents ?? 0) > 0 ? '+' : ''}{egp(lastClosedShift.varianceCents ?? 0)}
              </p>
            </div>
          </div>

          {!isReconciling ? (
            <div className="flex justify-end pt-1">
              <Btn
                onClick={() => {
                  setNewCountedAmount(String((lastClosedShift.countedCents ?? 0) / 100));
                  setReconcileError('');
                  setIsReconciling(true);
                }}
              >
                Correct Count / Reconcile
              </Btn>
            </div>
          ) : (
            <div className="bg-indigo-50/50 p-3.5 rounded-lg border border-indigo-100 space-y-3">
              <p className="text-xs font-semibold text-indigo-900">Correct Cash Drawer Count</p>
              {reconcileError && <ErrorBanner message={reconcileError} />}
              <div className="flex flex-wrap items-end gap-3">
                <div className="w-44">
                  <Field label="New Counted Amount (EGP)">
                    <TextInput
                      value={newCountedAmount}
                      onChange={setNewCountedAmount}
                      type="number"
                      disabled={reconcileLoading}
                    />
                  </Field>
                </div>
                <div className="flex gap-2">
                  <Btn
                    kind="primary"
                    disabled={reconcileLoading}
                    onClick={() => void submitReconciliation()}
                  >
                    Save & Reconcile
                  </Btn>
                  <Btn
                    disabled={reconcileLoading}
                    onClick={() => setIsReconciling(false)}
                  >
                    Cancel
                  </Btn>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {error && <ErrorBanner message={error} />}

      <div className="space-y-4 font-sans">
        {/* STEP 1: TIPS TRANSFER */}
        <div className={`rounded-xl bg-white p-5 shadow border-l-4 transition-all ${
          step1StatusState === 'success' ? 'border-l-emerald-500' : step1StatusState === 'skipped' ? 'border-l-slate-300 opacity-60' : 'border-l-amber-500'
        }`}>
          <div className="flex justify-between items-start">
            <div>
              <h3 className="font-bold text-slate-800 flex items-center gap-2">
                <span className="flex h-5 w-5 items-center justify-center rounded-full bg-slate-100 text-xs font-bold text-slate-600">1</span>
                <span>Move Tips to Tips Drawer</span>
                {step1StatusState === 'success' && <span className="text-xs text-emerald-600 font-semibold bg-emerald-50 px-2 py-0.5 rounded">Completed</span>}
                {step1StatusState === 'skipped' && <span className="text-xs text-slate-400 font-semibold bg-slate-100 px-2 py-0.5 rounded">Skipped</span>}
              </h3>
              <p className="text-xs text-slate-400 mt-1">
                Transfers the cash tips collected in this shift from the Cash Drawer to the Tips Drawer.
              </p>
            </div>
            {cashDrawerAcc && tipsDrawerAcc && (
              <div className="text-right text-xs">
                <div className="text-slate-400">Drawer Balance: <span className="font-mono text-slate-700 font-semibold">{egp(cashDrawerAcc.balanceCents)}</span></div>
                <div className="text-slate-400">Tips Drawer Balance: <span className="font-mono text-slate-700 font-semibold">{egp(tipsDrawerAcc.balanceCents)}</span></div>
              </div>
            )}
          </div>

          <div className="mt-4 grid grid-cols-3 gap-3 items-end">
            <Field label="Amount to Transfer (EGP)">
              <TextInput
                value={step1Amount}
                onChange={setStep1Amount}
                type="number"
                disabled={step1StatusState !== 'pending' || loading}
              />
            </Field>
            <div className="col-span-2 flex gap-2">
              <Btn
                kind="primary"
                disabled={step1StatusState !== 'pending' || loading || tipsCents === 0}
                onClick={() => {
                  if (cashDrawerAcc && tipsDrawerAcc) {
                    void postTransfer(
                      1,
                      cashDrawerAcc.id,
                      tipsDrawerAcc.id,
                      step1Amount,
                      `Move shift tips to Tips Drawer: Shift #${lastClosedShift.id.slice(-6)}`
                    );
                  }
                }}
              >
                Approve & Transfer
              </Btn>
              {step1StatusState === 'pending' && (
                <Btn
                  kind="default"
                  onClick={() => setStep1Status('skipped')}
                  disabled={loading}
                >
                  Skip
                </Btn>
              )}
            </div>
          </div>
          {tipsCents === 0 && step1StatusState === 'skipped' && !step1Posted && (
            <p className="text-[11px] text-slate-400 mt-2">ℹ️ No cash tips were recorded for this shift.</p>
          )}
        </div>

        {/* STEP 2: REMAINING CASH TO SAFE */}
        <div className={`rounded-xl bg-white p-5 shadow border-l-4 transition-all ${
          step2StatusState === 'success' ? 'border-l-emerald-500' : 'border-l-amber-500'
        }`}>
          <div className="flex justify-between items-start">
            <div>
              <h3 className="font-bold text-slate-800 flex items-center gap-2">
                <span className="flex h-5 w-5 items-center justify-center rounded-full bg-slate-100 text-xs font-bold text-slate-600">2</span>
                <span>Transfer Remaining Cash to Main Safe</span>
                {step2StatusState === 'success' && <span className="text-xs text-emerald-600 font-semibold bg-emerald-50 px-2 py-0.5 rounded">Completed</span>}
              </h3>
              <p className="text-xs text-slate-400 mt-1">
                Transfers the remaining cash sales from the Cash Drawer to the Main Safe.
              </p>
            </div>
            {cashDrawerAcc && mainSafeAcc && (
              <div className="text-right text-xs">
                <div className="text-slate-400">Drawer Balance: <span className="font-mono text-slate-700 font-semibold">{egp(cashDrawerAcc.balanceCents)}</span></div>
                <div className="text-slate-400">Safe Balance: <span className="font-mono text-slate-700 font-semibold">{egp(mainSafeAcc.balanceCents)}</span></div>
              </div>
            )}
          </div>

          <div className="mt-4 grid grid-cols-3 gap-3 items-end">
            <Field label="Amount to Transfer (EGP)">
              <TextInput
                value={step2Amount}
                onChange={setStep2Amount}
                type="number"
                disabled={step2StatusState !== 'pending' || loading}
              />
            </Field>
            <div className="col-span-2">
              <Btn
                kind="primary"
                disabled={step2StatusState !== 'pending' || loading || !cashDrawerAcc || cashDrawerAcc.balanceCents <= 0}
                onClick={() => {
                  if (cashDrawerAcc && mainSafeAcc) {
                    void postTransfer(
                      2,
                      cashDrawerAcc.id,
                      mainSafeAcc.id,
                      step2Amount,
                      `Move remaining cash to Main Safe: Shift #${lastClosedShift.id.slice(-6)}`
                    );
                  }
                }}
              >
                Approve & Transfer
              </Btn>
            </div>
          </div>
        </div>

        {/* STEP 3: CUSTODY TO SAFE */}
        <div className={`rounded-xl bg-white p-5 shadow border-l-4 transition-all ${
          step3StatusState === 'success' ? 'border-l-emerald-500' : step3StatusState === 'skipped' ? 'border-l-slate-300 opacity-60' : 'border-l-amber-500'
        }`}>
          <div className="flex justify-between items-start">
            <div>
              <h3 className="font-bold text-slate-800 flex items-center gap-2">
                <span className="flex h-5 w-5 items-center justify-center rounded-full bg-slate-100 text-xs font-bold text-slate-600">3</span>
                <span>Transfer Custody to Safe</span>
                {step3StatusState === 'success' && <span className="text-xs text-emerald-600 font-semibold bg-emerald-50 px-2 py-0.5 rounded">Completed</span>}
                {step3StatusState === 'skipped' && <span className="text-xs text-slate-400 font-semibold bg-slate-100 px-2 py-0.5 rounded">Skipped</span>}
              </h3>
              <p className="text-xs text-slate-400 mt-1">
                Returns/deposits any remaining custody account balance back to the Main Safe.
              </p>
            </div>
            {custodyAcc && mainSafeAcc && (
              <div className="text-right text-xs">
                <div className="text-slate-400">Custody Balance: <span className="font-mono text-slate-700 font-semibold">{egp(custodyAcc.balanceCents)}</span></div>
                <div className="text-slate-400">Safe Balance: <span className="font-mono text-slate-700 font-semibold">{egp(mainSafeAcc.balanceCents)}</span></div>
              </div>
            )}
          </div>

          <div className="mt-4 grid grid-cols-3 gap-3 items-end">
            <Field label="Amount to Transfer (EGP)">
              <TextInput
                value={step3Amount}
                onChange={setStep3Amount}
                type="number"
                disabled={step3StatusState !== 'pending' || loading}
              />
            </Field>
            <div className="col-span-2 flex gap-2">
              <Btn
                kind="primary"
                disabled={step3StatusState !== 'pending' || loading || !custodyAcc || custodyAcc.balanceCents <= 0}
                onClick={() => {
                  if (custodyAcc && mainSafeAcc) {
                    void postTransfer(
                      3,
                      custodyAcc.id,
                      mainSafeAcc.id,
                      step3Amount,
                      `Move Custody balance to Main Safe`
                    );
                  }
                }}
              >
                Approve & Transfer
              </Btn>
              {step3StatusState === 'pending' && (
                <Btn
                  kind="default"
                  onClick={() => setStep3Status('skipped')}
                  disabled={loading}
                >
                  Skip
                </Btn>
              )}
            </div>
          </div>
          {custodyAcc && custodyAcc.balanceCents === 0 && step3StatusState === 'skipped' && (
            <p className="text-[11px] text-slate-400 mt-2">ℹ️ Custody account balance is zero.</p>
          )}
        </div>

        {/* STEP 4: SAFE BALANCE SNAPSHOT */}
        <div className="rounded-xl bg-slate-900 text-white p-6 shadow flex justify-between items-center">
          <div>
            <h3 className="font-bold text-base flex items-center gap-2">
              <span className="flex h-5 w-5 items-center justify-center rounded-full bg-slate-800 text-xs font-bold text-slate-300">4</span>
              <span>Total Safe Actual Balance</span>
            </h3>
            <p className="text-xs text-slate-400 mt-1">
              The verified cash balance currently remaining in the Main Safe after completing all shift close transfers.
            </p>
          </div>
          {mainSafeAcc && (
            <div className="text-right">
              <div className="text-xs text-slate-400 uppercase tracking-wider font-semibold">Verified Safe Balance</div>
              <div className="text-3xl font-extrabold text-emerald-400 font-mono mt-1">
                {egp(mainSafeAcc.balanceCents)}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
