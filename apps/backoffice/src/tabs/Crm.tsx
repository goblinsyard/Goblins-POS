import { useEffect, useState } from 'react';
import { api, cairoTime, downloadCsv, egp, pct } from '../lib/api';
import { Btn, ErrorBanner, Field, Modal, Pills, Select, Table, TextInput, useLoad } from '../lib/ui';

interface CustomerGroup {
  id: string; name: string; nameAr?: string | null; discountBps: number; isActive: boolean;
  _count?: { customers: number };
}
interface Customer {
  id: string; name: string; phone: string; email?: string | null; birthday?: string | null;
  pointsBalance: number; visitCount: number; lifetimeCents: number; tags: string[]; notes?: string | null;
  walletBalanceCents: number;
  tier?: { name: string } | null;
  group?: CustomerGroup | null; groupId?: string | null;
  isActive: boolean;
}
interface CustomerDetail extends Customer {
  favorites: { name: string; count: number }[];
  orders: { id: string; number: number; totalCents: number; closedAt?: string | null }[];
  pointsTransactions: { id: string; points: number; kind: string; createdAt: string }[];
  reservations: { id: string; startAt: string; status: string; resource: { name: string } }[];
}
interface SegmentRow { id?: string; name: string; phone: string; pointsBalance?: number; lifetimeCents?: number; birthday?: string | null }

const SEGMENTS = [
  { value: 'all', label: 'all customers' },
  { value: 'inactive30', label: 'inactive 30d' },
  { value: 'top10pct', label: 'top 10%' },
  { value: 'birthdayThisWeek', label: 'birthday this week' },
] as const;

export function CrmView() {
  const [phone, setPhone] = useState('');
  const [results, setResults] = useState<Customer[] | null>(null);
  const [segment, setSegment] = useState<(typeof SEGMENTS)[number]['value']>('all');
  const [template, setTemplate] = useState('Hi {name}! We miss you at Goblins Yard — show this message for 10% off.');
  const [detailId, setDetailId] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [err, setErr] = useState('');

  const [gateway, setGateway] = useState<'twilio_sms' | 'twilio_whatsapp' | 'mock_sms' | 'mock_whatsapp'>('mock_sms');
  const [sending, setSending] = useState(false);
  const [campaignResult, setCampaignResult] = useState<{ total: number; successCount: number; failCount: number; results?: any[] } | null>(null);

  async function sendCampaign() {
    if (!window.confirm(`Are you sure you want to send this campaign to ${segmentRows?.length ?? 0} customers?`)) return;
    setSending(true);
    setCampaignResult(null);
    setErr('');
    try {
      const res = await api<{ total: number; successCount: number; failCount: number; results?: any[] }>('/crm/campaigns/send', {
        method: 'POST',
        body: { segment, gateway, template },
      });
      setCampaignResult(res);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Campaign failed');
    } finally {
      setSending(false);
    }
  }

  const { data: segmentRows } = useLoad(() => api<SegmentRow[]>(`/crm/segments/${segment}`), [segment]);
  const { data: groups, reload: reloadGroups } = useLoad(() => api<CustomerGroup[]>('/crm/groups'));
  const [groupModal, setGroupModal] = useState<CustomerGroup | 'new' | null>(null);

  async function search() {
    setErr('');
    try { setResults(await api<Customer[]>(`/crm/customers/lookup?q=${encodeURIComponent(phone)}`)); }
    catch (e) { setErr(e instanceof Error ? e.message : 'Search failed'); }
  }

  // saved customers show immediately; typing filters by name or phone
  useEffect(() => {
    const handle = setTimeout(() => void search(), phone ? 250 : 0);
    return () => clearTimeout(handle);
  }, [phone]);

  return (
    <div className="space-y-6">
      <ErrorBanner message={err} />
      <div>
        <h2 className="mb-2 font-semibold text-slate-700">Find customer</h2>
        <div className="flex gap-2">
          <div className="w-64">
            <TextInput value={phone} onChange={setPhone} placeholder="Search by name or phone…" />
          </div>
          <Btn onClick={() => setCreateOpen(true)}>+ New customer</Btn>
        </div>
        {results && (
          <div className="mt-3">
            <Table headers={['Name', 'Phone', 'Group', 'Tier', 'Points', 'Wallet', 'Visits', 'Lifetime', 'Status', '']}
              rows={results.map((c) => [
                c.name, c.phone,
                c.group ? `${c.group.name} (−${pct(c.group.discountBps)})` : '—',
                c.tier?.name ?? '—', String(c.pointsBalance), egp(c.walletBalanceCents), String(c.visitCount), egp(c.lifetimeCents),
                c.isActive ? (
                  <span key="status" className="rounded bg-emerald-100 px-2 py-0.5 text-xs font-semibold text-emerald-800">
                    Active
                  </span>
                ) : (
                  <span key="status" className="rounded bg-red-100 px-2 py-0.5 text-xs font-semibold text-red-800">
                    Disabled
                  </span>
                ),
                <Btn key="v" onClick={() => setDetailId(c.id)}>View</Btn>,
              ])} />
          </div>
        )}
      </div>

      <div>
        <div className="mb-2 flex items-center justify-between">
          <h2 className="font-semibold text-slate-700">Customer groups (auto discount)</h2>
          <Btn kind="primary" onClick={() => setGroupModal('new')}>+ New group</Btn>
        </div>
        <Table headers={['Group', 'Discount', 'Members', 'Status', '']}
          rows={(groups ?? []).map((g) => [
            g.name + (g.nameAr ? ` · ${g.nameAr}` : ''),
            `−${pct(g.discountBps)}`,
            String(g._count?.customers ?? 0),
            g.isActive ? 'active' : 'inactive',
            <span key="a" className="flex gap-1">
              <Btn onClick={() => setGroupModal(g)}>Edit</Btn>
              <Btn kind={g.isActive ? 'danger' : 'default'}
                onClick={() => void api(`/crm/groups/${g.id}`, { method: 'PATCH', body: { isActive: !g.isActive } }).then(reloadGroups)}>
                {g.isActive ? 'Disable' : 'Enable'}
              </Btn>
            </span>,
          ])} />
        <p className="mt-1 text-xs text-slate-400">The discount applies automatically on any order the customer is attached to at the POS.</p>
      </div>

      <div>
        <h2 className="mb-2 font-semibold text-slate-700">Segments & campaigns</h2>
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <Pills value={segment} onChange={setSegment} options={SEGMENTS as unknown as { value: typeof segment; label: string }[]} />
          <button
            onClick={() => void downloadCsv(`/crm/segments/${segment}/export?template=${encodeURIComponent(template)}`, `segment-${segment}.csv`)}
            className="ml-auto rounded-lg bg-slate-700 px-3 py-1.5 text-sm text-white">
            Export CSV
          </button>
        </div>
        <Field label="Message template ({name} is replaced)">
          <TextInput value={template} onChange={setTemplate} />
        </Field>

        <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-4">
          <h3 className="mb-3 font-medium text-slate-800 font-semibold flex items-center gap-2">
            <span>🚀</span> Send Marketing Campaign
          </h3>
          <div className="grid gap-4 md:grid-cols-3">
            <Field label="Gateway Channel">
              <Select
                value={gateway}
                onChange={(v) => setGateway(v as any)}
                options={[
                  { value: 'twilio_sms', label: 'Twilio SMS' },
                  { value: 'twilio_whatsapp', label: 'Twilio WhatsApp' },
                  { value: 'mock_sms', label: 'Mock SMS (Logs)' },
                  { value: 'mock_whatsapp', label: 'Mock WhatsApp (Logs)' },
                ]}
              />
            </Field>
            <div className="md:col-span-2 flex items-end justify-between gap-4">
              <div className="flex-1">
                <p className="text-xs text-slate-500 mb-1">
                  Replaces <code className="bg-slate-200 px-1 rounded font-mono">{`{name}`}</code> and <code className="bg-slate-200 px-1 rounded font-mono">{`{points}`}</code> dynamically.
                </p>
              </div>
              <Btn kind="primary" onClick={() => void sendCampaign()} disabled={sending || !segmentRows?.length}>
                {sending ? 'Sending…' : `Send to ${segmentRows?.length ?? 0} customers`}
              </Btn>
            </div>
          </div>
          
          {campaignResult && (
            <div className="mt-4 rounded-lg bg-white p-3 text-sm border border-slate-200">
              <div className="font-semibold text-slate-800 mb-1">Campaign Report:</div>
              <div className="flex gap-4 text-slate-600">
                <div>Total Selected: <span className="font-bold text-slate-900">{campaignResult.total}</span></div>
                <div className="text-emerald-600">Success: <span className="font-bold">{campaignResult.successCount}</span></div>
                <div className="text-red-600">Failed: <span className="font-bold">{campaignResult.failCount}</span></div>
              </div>
              {campaignResult.results && campaignResult.results.some((r: any) => !r.success) && (
                <div className="mt-2 text-xs text-red-500 max-h-24 overflow-y-auto border-t border-slate-100 pt-2">
                  {campaignResult.results.filter((r: any) => !r.success).map((r: any, i: number) => (
                    <div key={i}>Customer: {r.customerId} — {r.error}</div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        <div className="mt-6">
          <Table headers={['Name', 'Phone', 'Points', 'Lifetime', '']}
            rows={(segmentRows ?? []).map((r) => [
              r.name, r.phone, String(r.pointsBalance ?? '—'), r.lifetimeCents != null ? egp(r.lifetimeCents) : '—',
              r.id ? <Btn key="v" onClick={() => setDetailId(r.id!)}>View / Edit</Btn> : '',
            ])} />
        </div>
      </div>

      {detailId && (
        <CustomerModal
          id={detailId}
          groups={groups ?? []}
          onClose={() => {
            setDetailId(null);
            void search();
          }}
        />
      )}
      {createOpen && (
        <CustomerFormModal groups={groups ?? []} onClose={() => setCreateOpen(false)}
          onDone={(c) => { setCreateOpen(false); setPhone(c.phone); void search(); }} />
      )}
      {groupModal && (
        <GroupModal group={groupModal === 'new' ? undefined : groupModal}
          onClose={() => setGroupModal(null)}
          onDone={() => { setGroupModal(null); reloadGroups(); }} />
      )}
    </div>
  );
}

function GroupModal({ group, onClose, onDone }: { group?: CustomerGroup; onClose: () => void; onDone: () => void }) {
  const [name, setName] = useState(group?.name ?? '');
  const [nameAr, setNameAr] = useState(group?.nameAr ?? '');
  const [discount, setDiscount] = useState(String((group?.discountBps ?? 0) / 100));
  const [err, setErr] = useState('');

  async function submit() {
    const discountBps = Math.round(Number(discount) * 100);
    if (!name.trim() || !Number.isFinite(discountBps) || discountBps < 0 || discountBps > 10000) {
      setErr('Name and a discount between 0 and 100% are required'); return;
    }
    const body = { name: name.trim(), nameAr: nameAr.trim() || undefined, discountBps };
    try {
      if (group) await api(`/crm/groups/${group.id}`, { method: 'PATCH', body });
      else await api('/crm/groups', { method: 'POST', body });
      onDone();
    } catch (e) { setErr(e instanceof Error ? e.message : 'Failed'); }
  }

  return (
    <Modal title={group ? `Edit ${group.name}` : 'New customer group'} onClose={onClose}>
      <ErrorBanner message={err} />
      <div className="space-y-3">
        <Field label="Name (e.g. Staff, VIP, Corporate)"><TextInput value={name} onChange={setName} /></Field>
        <Field label="Name (Arabic)"><TextInput value={nameAr} onChange={setNameAr} /></Field>
        <Field label="Discount % (auto-applied)"><TextInput value={discount} onChange={setDiscount} type="number" /></Field>
        <Btn kind="primary" onClick={() => void submit()}>{group ? 'Save' : 'Create group'}</Btn>
      </div>
    </Modal>
  );
}

function CustomerModal({ id, groups, onClose }: { id: string; groups: CustomerGroup[]; onClose: () => void }) {
  const { data: c, error, reload } = useLoad(() => api<CustomerDetail>(`/crm/customers/${id}`), [id]);
  const [editOpen, setEditOpen] = useState(false);
  if (error) return <Modal title="Customer" onClose={onClose}><ErrorBanner message={error} /></Modal>;
  if (!c) return <Modal title="Customer" onClose={onClose}><p className="text-slate-400">Loading…</p></Modal>;
  return (
    <Modal title={c.name} onClose={onClose} wide>
      <div className="mb-4 flex flex-wrap items-center gap-2 text-sm">
        <span className="rounded-lg bg-slate-100 px-3 py-1.5">{c.phone}</span>
        {c.group && <span className="rounded-lg bg-emerald-100 px-3 py-1.5 text-emerald-800">{c.group.name} −{pct(c.group.discountBps)}</span>}
        {c.tier && <span className="rounded-lg bg-amber-100 px-3 py-1.5 text-amber-800">{c.tier.name}</span>}
        <span className="rounded-lg bg-emerald-100 px-3 py-1.5 text-emerald-800">{c.pointsBalance} pts</span>
        <span className="rounded-lg bg-indigo-100 px-3 py-1.5 text-indigo-800">Wallet: {egp(c.walletBalanceCents)}</span>
        <span className="rounded-lg bg-slate-100 px-3 py-1.5">{c.visitCount} visits</span>
        <span className="rounded-lg bg-slate-100 px-3 py-1.5">lifetime {egp(c.lifetimeCents)}</span>
        {c.birthday && <span className="rounded-lg bg-slate-100 px-3 py-1.5">🎂 {new Date(c.birthday).toLocaleDateString('en-EG', { month: 'short', day: 'numeric' })}</span>}
        <span className={`rounded-lg px-3 py-1.5 font-semibold ${c.isActive ? 'bg-emerald-100 text-emerald-800' : 'bg-red-100 text-red-800'}`}>
          {c.isActive ? 'Active' : 'Disabled'}
        </span>
        <span className="ml-auto flex gap-2">
          <Btn kind={c.isActive ? 'danger' : 'primary'} onClick={() => void api(`/crm/customers/${c.id}`, { method: 'PATCH', body: { isActive: !c.isActive } }).then(reload)}>
            {c.isActive ? 'Disable' : 'Enable'}
          </Btn>
          <Btn onClick={() => setEditOpen(true)}>Edit</Btn>
        </span>
      </div>
      {c.tags.length > 0 && <p className="mb-3 text-xs text-slate-500">Tags: {c.tags.join(', ')}</p>}
      {c.notes && <p className="mb-3 rounded-lg bg-slate-50 p-2 text-sm text-slate-600">{c.notes}</p>}
      <div className="grid gap-4 md:grid-cols-2">
        <div>
          <h3 className="mb-1 text-sm font-semibold text-slate-600">Favorites</h3>
          <ul className="text-sm text-slate-600">
            {c.favorites.map((f) => <li key={f.name}>{f.name} ×{f.count}</li>)}
            {!c.favorites.length && <li className="text-slate-400">No history yet</li>}
          </ul>
          <h3 className="mb-1 mt-4 text-sm font-semibold text-slate-600">Recent visits</h3>
          <ul className="text-sm text-slate-600">
            {c.orders.map((o) => (
              <li key={o.id}>#{o.number} — {egp(o.totalCents)}{o.closedAt ? ` — ${cairoTime(o.closedAt)}` : ''}</li>
            ))}
            {!c.orders.length && <li className="text-slate-400">None</li>}
          </ul>
        </div>
        <div>
          <h3 className="mb-1 text-sm font-semibold text-slate-600">Points history</h3>
          <ul className="text-sm text-slate-600">
            {c.pointsTransactions.map((t) => (
              <li key={t.id}>
                <span className={t.points < 0 ? 'text-red-600' : 'text-emerald-700'}>{t.points > 0 ? '+' : ''}{t.points}</span>
                {' '}{t.kind.toLowerCase()} — {cairoTime(t.createdAt)}
              </li>
            ))}
            {!c.pointsTransactions.length && <li className="text-slate-400">None</li>}
          </ul>
          <h3 className="mb-1 mt-4 text-sm font-semibold text-slate-600">Reservations</h3>
          <ul className="text-sm text-slate-600">
            {c.reservations.map((r) => (
              <li key={r.id}>{r.resource.name} — {cairoTime(r.startAt)} — {r.status}</li>
            ))}
            {!c.reservations.length && <li className="text-slate-400">None</li>}
          </ul>
        </div>
      </div>
      {editOpen && (
        <CustomerFormModal existing={c} groups={groups} onClose={() => setEditOpen(false)}
          onDone={() => { setEditOpen(false); reload(); }} />
      )}
    </Modal>
  );
}

export function CustomerFormModal({ existing, groups, onClose, onDone }: {
  existing?: Customer; groups: CustomerGroup[]; onClose: () => void; onDone: (c: Customer) => void;
}) {
  const [name, setName] = useState(existing?.name ?? '');
  const [phone, setPhone] = useState(existing?.phone ?? '');
  const [email, setEmail] = useState(existing?.email ?? '');
  const [birthday, setBirthday] = useState(existing?.birthday ? existing.birthday.slice(0, 10) : '');
  const [notes, setNotes] = useState(existing?.notes ?? '');
  const [groupId, setGroupId] = useState(existing?.group?.id ?? existing?.groupId ?? '');
  const [walletCreditEgp, setWalletCreditEgp] = useState(existing ? String((existing.walletBalanceCents ?? 0) / 100) : '0');
  const [err, setErr] = useState('');

  async function submit() {
    if (!name.trim() || (!existing && !phone.trim())) { setErr('Name and phone are required'); return; }
    const walletBalanceCents = walletCreditEgp ? Math.round(Number(walletCreditEgp) * 100) : 0;
    if (!Number.isFinite(walletBalanceCents) || walletBalanceCents < 0) {
      setErr('Wallet credit must be a non-negative number'); return;
    }
    const body = {
      name: name.trim(), email: email.trim() || undefined,
      birthday: birthday || undefined, notes: notes.trim() || undefined,
      groupId: existing ? (groupId || null) : (groupId || undefined),
      walletBalanceCents,
    };
    try {
      const c = existing
        ? await api<Customer>(`/crm/customers/${existing.id}`, { method: 'PATCH', body })
        : await api<Customer>('/crm/customers', { method: 'POST', body: { ...body, phone: phone.trim() } });
      onDone(c);
    } catch (e) { setErr(e instanceof Error ? e.message : 'Failed'); }
  }

  return (
    <Modal title={existing ? `Edit ${existing.name}` : 'New customer'} onClose={onClose}>
      <ErrorBanner message={err} />
      <div className="space-y-3">
        <Field label="Name"><TextInput value={name} onChange={setName} /></Field>
        {!existing && <Field label="Phone"><TextInput value={phone} onChange={setPhone} /></Field>}
        <Field label="Email"><TextInput value={email} onChange={setEmail} /></Field>
        <Field label="Birthday"><TextInput value={birthday} onChange={setBirthday} type="date" /></Field>
        <Field label="Group (auto discount)">
          <Select value={groupId} onChange={setGroupId} allowEmpty="— none —"
            options={groups.filter((g) => g.isActive).map((g) => ({ value: g.id, label: `${g.name} (−${pct(g.discountBps)})` }))} />
        </Field>
        <Field label="Notes"><TextInput value={notes} onChange={setNotes} /></Field>
        <Field label="Wallet Credit (EGP)"><TextInput value={walletCreditEgp} onChange={setWalletCreditEgp} type="number" /></Field>
        <Btn kind="primary" onClick={() => void submit()}>{existing ? 'Save' : 'Create'}</Btn>
      </div>
    </Modal>
  );
}
