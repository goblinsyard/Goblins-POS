import { useEffect, useState } from 'react';
import { api, cairoTime, downloadCsv, egp, pct } from '../lib/api';
import { Btn, ErrorBanner, Field, Modal, Pills, Select, Table, TextInput, useLoad } from '../lib/ui';
import { Cake } from 'lucide-react';
import { tr } from '../lib/i18n';

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
  { value: 'all', label: tr('all customers') },
  { value: 'inactive30', label: tr('inactive 30d') },
  { value: 'top10pct', label: tr('top 10%') },
  { value: 'birthdayThisWeek', label: tr('birthday this week') },
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
    if (!window.confirm(`${tr('Are you sure you want to send this campaign to')} ${segmentRows?.length ?? 0} ${tr('customers?')}`)) return;
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
      setErr(e instanceof Error ? e.message : tr('Campaign failed'));
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
    catch (e) { setErr(e instanceof Error ? e.message : tr('Search failed')); }
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
        <h2 className="mb-2 font-semibold text-goblin-100">{tr('Find customer')}</h2>
        <div className="flex gap-2">
          <div className="w-64">
            <TextInput value={phone} onChange={setPhone} placeholder={tr('Search by name or phone…')} />
          </div>
          <Btn onClick={() => setCreateOpen(true)}>{tr('+ New customer')}</Btn>
        </div>
        {results && (
          <div className="mt-3">
            <Table headers={[tr('Name'), tr('Phone'), tr('Group'), tr('Tier'), tr('Points'), tr('Wallet'), tr('Visits'), tr('Lifetime'), tr('Status'), '']}
              rows={results.map((c) => [
                c.name, c.phone,
                c.group ? `${c.group.name} (−${pct(c.group.discountBps)})` : '—',
                c.tier?.name ?? '—', String(c.pointsBalance), egp(c.walletBalanceCents), String(c.visitCount), egp(c.lifetimeCents),
                c.isActive ? (
                  <span key="status" className="rounded bg-goblin-700 px-2 py-0.5 text-xs font-semibold text-goblin-500">
                    {tr('Active')}
                  </span>
                ) : (
                  <span key="status" className="rounded bg-red-100 px-2 py-0.5 text-xs font-semibold text-red-800">
                    {tr('Disabled')}
                  </span>
                ),
                <Btn key="v" onClick={() => setDetailId(c.id)}>{tr('View')}</Btn>,
              ])} />
          </div>
        )}
      </div>

      <div>
        <div className="mb-2 flex items-center justify-between">
          <h2 className="font-semibold text-goblin-100">{tr('Customer groups (auto discount)')}</h2>
          <Btn kind="primary" onClick={() => setGroupModal('new')}>{tr('+ New group')}</Btn>
        </div>
        <Table headers={[tr('Group'), tr('Discount'), tr('Members'), tr('Status'), '']}
          rows={(groups ?? []).map((g) => [
            g.name + (g.nameAr ? ` · ${g.nameAr}` : ''),
            `−${pct(g.discountBps)}`,
            String(g._count?.customers ?? 0),
            g.isActive ? 'active' : 'inactive',
            <span key="a" className="flex gap-1">
              <Btn onClick={() => setGroupModal(g)}>{tr('Edit')}</Btn>
              <Btn kind={g.isActive ? 'danger' : 'default'}
                onClick={() => void api(`/crm/groups/${g.id}`, { method: 'PATCH', body: { isActive: !g.isActive } }).then(reloadGroups)}>
                {g.isActive ? tr('Disable') : tr('Enable')}
              </Btn>
            </span>,
          ])} />
        <p className="mt-1 text-xs text-goblin-400">{tr('The discount applies automatically on any order the customer is attached to at the POS.')}</p>
      </div>

      <div>
        <h2 className="mb-2 font-semibold text-goblin-100">{tr('Segments & campaigns')}</h2>
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <Pills value={segment} onChange={setSegment} options={SEGMENTS as unknown as { value: typeof segment; label: string }[]} />
          <button
            onClick={() => void downloadCsv(`/crm/segments/${segment}/export?template=${encodeURIComponent(template)}`, `segment-${segment}.csv`)}
            className="ml-auto rounded-lg bg-goblin-900 px-3 py-1.5 text-sm text-white">
            {tr('Export CSV')}
          </button>
        </div>
        <Field label={tr('Message template ({name} is replaced)')}>
          <TextInput value={template} onChange={setTemplate} />
        </Field>

        <div className="mt-4 rounded-xl border border-goblin-700 bg-goblin-800 p-4">
          <h3 className="mb-3 font-medium text-goblin-50 font-semibold flex items-center gap-2">
            <span>🚀</span> {tr('Send Marketing Campaign')}
          </h3>
          <div className="grid gap-4 md:grid-cols-3">
            <Field label={tr('Gateway Channel')}>
              <Select
                value={gateway}
                onChange={(v) => setGateway(v as any)}
                options={[
                  { value: 'twilio_sms', label: tr('Twilio SMS') },
                  { value: 'twilio_whatsapp', label: tr('Twilio WhatsApp') },
                  { value: 'mock_sms', label: tr('Mock SMS (Logs)') },
                  { value: 'mock_whatsapp', label: tr('Mock WhatsApp (Logs)') },
                ]}
              />
            </Field>
            <div className="md:col-span-2 flex items-end justify-between gap-4">
              <div className="flex-1">
                <p className="text-xs text-goblin-300 mb-1">
                  {tr('Replaces')} <code className="bg-goblin-700 px-1 rounded font-mono">{tr('{name}')}</code> {tr('and')} <code className="bg-goblin-700 px-1 rounded font-mono">{tr('{points}')}</code> {tr('dynamically.')}
                </p>
              </div>
              <Btn kind="primary" onClick={() => void sendCampaign()} disabled={sending || !segmentRows?.length}>
                {sending ? tr('Sending…') : `${tr('Send to')} ${segmentRows?.length ?? 0} ${tr('customers')}`}
              </Btn>
            </div>
          </div>
          
          {campaignResult && (
            <div className="mt-4 rounded-lg bg-goblin-900 p-3 text-sm border border-goblin-700">
              <div className="font-semibold text-goblin-50 mb-1">{tr('Campaign Report:')}</div>
              <div className="flex gap-4 text-goblin-200">
                <div>{tr('Total Selected:')} <span className="font-bold text-goblin-50">{campaignResult.total}</span></div>
                <div className="text-goblin-500">{tr('Success:')} <span className="font-bold">{campaignResult.successCount}</span></div>
                <div className="text-red-600">{tr('Failed:')} <span className="font-bold">{campaignResult.failCount}</span></div>
              </div>
              {campaignResult.results && campaignResult.results.some((r: any) => !r.success) && (
                <div className="mt-2 text-xs text-red-500 max-h-24 overflow-y-auto border-t border-goblin-800 pt-2">
                  {campaignResult.results.filter((r: any) => !r.success).map((r: any, i: number) => (
                    <div key={i}>{tr('Customer:')} {r.customerId} — {r.error}</div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        <div className="mt-6">
          <Table headers={[tr('Name'), tr('Phone'), tr('Points'), tr('Lifetime'), '']}
            rows={(segmentRows ?? []).map((r) => [
              r.name, r.phone, String(r.pointsBalance ?? '—'), r.lifetimeCents != null ? egp(r.lifetimeCents) : '—',
              r.id ? <Btn key="v" onClick={() => setDetailId(r.id!)}>{tr('View / Edit')}</Btn> : '',
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
      setErr(tr('Name and a discount between 0 and 100% are required')); return;
    }
    const body = { name: name.trim(), nameAr: nameAr.trim() || undefined, discountBps };
    try {
      if (group) await api(`/crm/groups/${group.id}`, { method: 'PATCH', body });
      else await api('/crm/groups', { method: 'POST', body });
      onDone();
    } catch (e) { setErr(e instanceof Error ? e.message : tr('Failed')); }
  }

  return (
    <Modal title={group ? `${tr('Edit')} ${group.name}` : tr('New customer group')} onClose={onClose}>
      <ErrorBanner message={err} />
      <div className="space-y-3">
        <Field label={tr('Name (e.g. Staff, VIP, Corporate)')}><TextInput value={name} onChange={setName} /></Field>
        <Field label={tr('Name (Arabic)')}><TextInput value={nameAr} onChange={setNameAr} /></Field>
        <Field label={tr('Discount % (auto-applied)')}><TextInput value={discount} onChange={setDiscount} type="number" /></Field>
        <Btn kind="primary" onClick={() => void submit()}>{group ? tr('Save') : tr('Create group')}</Btn>
      </div>
    </Modal>
  );
}

function CustomerModal({ id, groups, onClose }: { id: string; groups: CustomerGroup[]; onClose: () => void }) {
  const { data: c, error, reload } = useLoad(() => api<CustomerDetail>(`/crm/customers/${id}`), [id]);
  const [editOpen, setEditOpen] = useState(false);
  if (error) return <Modal title={tr('Customer')} onClose={onClose}><ErrorBanner message={error} /></Modal>;
  if (!c) return <Modal title={tr('Customer')} onClose={onClose}><p className="text-goblin-400">{tr('Loading…')}</p></Modal>;
  return (
    <Modal title={c.name} onClose={onClose} wide>
      <div className="mb-4 flex flex-wrap items-center gap-2 text-sm">
        <span className="rounded-lg bg-goblin-800 px-3 py-1.5">{c.phone}</span>
        {c.group && <span className="rounded-lg bg-goblin-700 px-3 py-1.5 text-goblin-500">{c.group.name} −{pct(c.group.discountBps)}</span>}
        {c.tier && <span className="rounded-lg bg-amber-100 px-3 py-1.5 text-amber-800">{c.tier.name}</span>}
        <span className="rounded-lg bg-goblin-700 px-3 py-1.5 text-goblin-500">{c.pointsBalance} {tr('pts')}</span>
        <span className="rounded-lg bg-indigo-100 px-3 py-1.5 text-indigo-800">{tr('Wallet:')} {egp(c.walletBalanceCents)}</span>
        <span className="rounded-lg bg-goblin-800 px-3 py-1.5">{c.visitCount} {tr('visits')}</span>
        <span className="rounded-lg bg-goblin-800 px-3 py-1.5">{tr('lifetime')} {egp(c.lifetimeCents)}</span>
        {c.birthday && <span className="inline-flex items-center gap-1 rounded-lg bg-goblin-800 px-3 py-1.5"><Cake className="h-4 w-4" /> {new Date(c.birthday).toLocaleDateString('en-EG', { month: 'short', day: 'numeric' })}</span>}
        <span className={`rounded-lg px-3 py-1.5 font-semibold ${c.isActive ? 'bg-goblin-700 text-goblin-500' : 'bg-red-100 text-red-800'}`}>
          {c.isActive ? tr('Active') : tr('Disabled')}
        </span>
        <span className="ml-auto flex gap-2">
          <Btn kind={c.isActive ? 'danger' : 'primary'} onClick={() => void api(`/crm/customers/${c.id}`, { method: 'PATCH', body: { isActive: !c.isActive } }).then(reload)}>
            {c.isActive ? tr('Disable') : tr('Enable')}
          </Btn>
          <Btn onClick={() => setEditOpen(true)}>{tr('Edit')}</Btn>
        </span>
      </div>
      {c.tags.length > 0 && <p className="mb-3 text-xs text-goblin-300">{tr('Tags:')} {c.tags.join(', ')}</p>}
      {c.notes && <p className="mb-3 rounded-lg bg-goblin-800 p-2 text-sm text-goblin-200">{c.notes}</p>}
      <div className="grid gap-4 md:grid-cols-2">
        <div>
          <h3 className="mb-1 text-sm font-semibold text-goblin-200">{tr('Favorites')}</h3>
          <ul className="text-sm text-goblin-200">
            {c.favorites.map((f) => <li key={f.name}>{f.name} ×{f.count}</li>)}
            {!c.favorites.length && <li className="text-goblin-400">{tr('No history yet')}</li>}
          </ul>
          <h3 className="mb-1 mt-4 text-sm font-semibold text-goblin-200">{tr('Recent visits')}</h3>
          <ul className="text-sm text-goblin-200">
            {c.orders.map((o) => (
              <li key={o.id}>#{o.number} — {egp(o.totalCents)}{o.closedAt ? ` — ${cairoTime(o.closedAt)}` : ''}</li>
            ))}
            {!c.orders.length && <li className="text-goblin-400">{tr('None')}</li>}
          </ul>
        </div>
        <div>
          <h3 className="mb-1 text-sm font-semibold text-goblin-200">{tr('Points history')}</h3>
          <ul className="text-sm text-goblin-200">
            {c.pointsTransactions.map((t) => (
              <li key={t.id}>
                <span className={t.points < 0 ? 'text-red-600' : 'text-goblin-500'}>{t.points > 0 ? '+' : ''}{t.points}</span>
                {' '}{tr(t.kind.toLowerCase())} — {cairoTime(t.createdAt)}
              </li>
            ))}
            {!c.pointsTransactions.length && <li className="text-goblin-400">{tr('None')}</li>}
          </ul>
          <h3 className="mb-1 mt-4 text-sm font-semibold text-goblin-200">{tr('Reservations')}</h3>
          <ul className="text-sm text-goblin-200">
            {c.reservations.map((r) => (
              <li key={r.id}>{r.resource.name} — {cairoTime(r.startAt)} — {tr(r.status)}</li>
            ))}
            {!c.reservations.length && <li className="text-goblin-400">{tr('None')}</li>}
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
    if (!name.trim() || (!existing && !phone.trim())) { setErr(tr('Name and phone are required')); return; }
    const walletBalanceCents = walletCreditEgp ? Math.round(Number(walletCreditEgp) * 100) : 0;
    if (!Number.isFinite(walletBalanceCents) || walletBalanceCents < 0) {
      setErr(tr('Wallet credit must be a non-negative number')); return;
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
    } catch (e) { setErr(e instanceof Error ? e.message : tr('Failed')); }
  }

  return (
    <Modal title={existing ? `${tr('Edit')} ${existing.name}` : tr('New customer')} onClose={onClose}>
      <ErrorBanner message={err} />
      <div className="space-y-3">
        <Field label={tr('Name')}><TextInput value={name} onChange={setName} /></Field>
        {!existing && <Field label={tr('Phone')}><TextInput value={phone} onChange={setPhone} /></Field>}
        <Field label={tr('Email')}><TextInput value={email} onChange={setEmail} /></Field>
        <Field label={tr('Birthday')}><TextInput value={birthday} onChange={setBirthday} type="date" /></Field>
        <Field label={tr('Group (auto discount)')}>
          <Select value={groupId} onChange={setGroupId} allowEmpty="— none —"
            options={groups.filter((g) => g.isActive).map((g) => ({ value: g.id, label: `${g.name} (−${pct(g.discountBps)})` }))} />
        </Field>
        <Field label={tr('Notes')}><TextInput value={notes} onChange={setNotes} /></Field>
        <Field label={tr('Wallet Credit (EGP)')}><TextInput value={walletCreditEgp} onChange={setWalletCreditEgp} type="number" /></Field>
        <Btn kind="primary" onClick={() => void submit()}>{existing ? tr('Save') : tr('Create')}</Btn>
      </div>
    </Modal>
  );
}
