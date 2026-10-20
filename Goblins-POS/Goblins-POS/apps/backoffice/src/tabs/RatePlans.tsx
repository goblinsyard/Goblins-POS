import { useState } from 'react';
import { api, egp, parseEgp } from '../lib/api';
import { Btn, ErrorBanner, Field, Modal, Select, TextInput, useLoad } from '../lib/ui';
import { tr } from '../lib/i18n';

interface RateRule {
  id: string; name: string; startTime: string; endTime: string; isActive: boolean;
  hourlyCents: number; hourlyMultiCents?: number | null; daysOfWeek: number[];
}
interface RatePlan {
  id: string; name: string; hourlyCents: number; hourlyMultiCents: number | null; minimumCents: number;
  roundToMinutes: number; roundingMode: string; graceMinutes: number; isActive: boolean;
  rules: RateRule[]; resources: { id: string; name: string }[];
}

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((d) => tr(d));
const ROUNDING = [
  { value: 'nearest', label: tr('Nearest') },
  { value: 'up', label: tr('Always up') },
  { value: 'down', label: tr('Always down') },
];

export function RatePlansView() {
  const { data: plans, error, reload } = useLoad(() => api<RatePlan[]>('/admin/rate-plans'));
  const [editingPlan, setEditingPlan] = useState<RatePlan | 'new' | null>(null);
  const [rule, setRule] = useState<{ plan: RatePlan; rule?: RateRule } | null>(null);
  const [deleting, setDeleting] = useState<RatePlan | null>(null);
  const [err, setErr] = useState('');

  async function run(fn: () => Promise<unknown>) {
    setErr('');
    try { await fn(); reload(); } catch (e) { setErr(e instanceof Error ? e.message : tr('Failed')); }
  }

  if (error) return <p className="p-8 text-red-600">{error}</p>;
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-goblin-50">{tr('Rate Plans')}</h1>
        <Btn kind="primary" onClick={() => setEditingPlan('new')}>{tr('+ New rate plan')}</Btn>
      </div>
      <ErrorBanner message={err} />
      {(plans ?? []).map((p) => (
        <div key={p.id} className={`rounded-xl bg-goblin-900 p-5 shadow ${p.isActive ? '' : 'opacity-60'}`}>
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <h2 className="font-semibold text-goblin-100">{p.name}</h2>
              {!p.isActive && <span className="rounded-full bg-red-900/60 px-2 py-0.5 text-xs font-semibold text-red-200">{tr('Off')}</span>}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs text-goblin-400">{p.resources.map((r) => r.name).join(', ') || tr('No tables use this plan')}</span>
              <Btn onClick={() => setEditingPlan(p)}>{tr('Edit')}</Btn>
              <Btn onClick={() => void run(() => api(`/admin/rate-plans/${p.id}`, { method: 'PATCH', body: { isActive: !p.isActive } }))}>
                {p.isActive ? tr('Turn off') : tr('Turn on')}
              </Btn>
              <Btn kind="danger" onClick={() => setDeleting(p)}>{tr('Delete')}</Btn>
            </div>
          </div>
          <div className="flex flex-wrap gap-3 text-sm">
            <span className="rounded-lg bg-goblin-800 px-3 py-2">{tr('Hourly:')} <b>{egp(p.hourlyCents)}</b></span>
            {p.hourlyMultiCents != null && <span className="rounded-lg bg-goblin-800 px-3 py-2">{tr('Multiplayer:')} <b>{egp(p.hourlyMultiCents)}</b></span>}
            <span className="rounded-lg bg-goblin-800 px-3 py-2">{tr('Minimum:')} <b>{egp(p.minimumCents)}</b></span>
            <span className="rounded-lg bg-goblin-800 px-3 py-2">{tr('Round:')} <b>{p.roundToMinutes} {tr('min')}</b> ({ROUNDING.find((r) => r.value === p.roundingMode)?.label ?? p.roundingMode})</span>
            {p.graceMinutes > 0 && <span className="rounded-lg bg-goblin-800 px-3 py-2">{tr('Grace:')} <b>{p.graceMinutes} {tr('min')}</b></span>}
            <Btn onClick={() => setRule({ plan: p })}>{tr('+ Time rule')}</Btn>
          </div>
          {p.rules.length > 0 && (
            <div className="mt-3 space-y-1.5 text-sm text-goblin-300">
              {p.rules.map((r) => (
                <div key={r.id} className={`flex flex-wrap items-center gap-2 ${r.isActive ? '' : 'opacity-50'}`}>
                  <span>
                    ↳ <b className="text-goblin-100">{r.name}</b>: {r.startTime}–{r.endTime} @ {egp(r.hourlyCents)}{tr('/hr')}
                    {r.hourlyMultiCents != null ? ` · ${tr('Multiplayer:')} ${egp(r.hourlyMultiCents)}` : ''}
                    {r.daysOfWeek?.length ? ` (${r.daysOfWeek.map((d) => DAYS[d]).join(' ')})` : ''}
                    {!r.isActive && ` — ${tr('Off')}`}
                  </span>
                  <button onClick={() => setRule({ plan: p, rule: r })} className="rounded bg-goblin-800 px-2 py-0.5 text-xs hover:bg-goblin-700">{tr('Edit')}</button>
                  <button onClick={() => void run(() => api(`/admin/rate-plans/rules/${r.id}`, { method: 'PATCH', body: { isActive: !r.isActive } }))}
                    className="rounded bg-goblin-800 px-2 py-0.5 text-xs hover:bg-goblin-700">
                    {r.isActive ? tr('Turn off') : tr('Turn on')}
                  </button>
                  <button onClick={() => void run(() => api(`/admin/rate-plans/rules/${r.id}`, { method: 'DELETE' }))}
                    className="rounded bg-red-500/15 px-2 py-0.5 text-xs text-red-400 hover:bg-red-500/25">
                    {tr('Delete')}
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      ))}
      {rule && (
        <RuleModal plan={rule.plan} rule={rule.rule} onClose={() => setRule(null)} onDone={() => { setRule(null); reload(); }} />
      )}
      {editingPlan && (
        <PlanModal plan={editingPlan === 'new' ? null : editingPlan}
          onClose={() => setEditingPlan(null)} onDone={() => { setEditingPlan(null); reload(); }} />
      )}
      {deleting && (
        <DeletePlanModal plan={deleting} onClose={() => setDeleting(null)} onDone={() => { setDeleting(null); reload(); }} />
      )}
    </div>
  );
}

function DeletePlanModal({ plan, onClose, onDone }: { plan: RatePlan; onClose: () => void; onDone: () => void }) {
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  async function go() {
    setBusy(true); setErr('');
    try { await api(`/admin/rate-plans/${plan.id}`, { method: 'DELETE' }); onDone(); }
    catch (e) { setErr(e instanceof Error ? e.message : tr('Failed')); setBusy(false); }
  }
  return (
    <Modal title={`${tr('Delete')} ${plan.name}`} onClose={onClose}>
      <ErrorBanner message={err} />
      <div className="space-y-3 text-sm text-goblin-300">
        {plan.resources.length > 0 && (
          <p>{tr('These tables will be left without a rate plan until you pick another one:')} <b className="text-goblin-100">{plan.resources.map((r) => r.name).join(', ')}</b></p>
        )}
        <p>{tr('A plan already used for past sessions can\'t be deleted (its history stays) — turn it off instead.')}</p>
        <div className="flex justify-end gap-2">
          <Btn onClick={onClose}>{tr('Cancel')}</Btn>
          <Btn kind="danger" disabled={busy} onClick={() => void go()}>{tr('Delete')}</Btn>
        </div>
      </div>
    </Modal>
  );
}

function RuleModal({ plan, rule, onClose, onDone }: { plan: RatePlan; rule?: RateRule; onClose: () => void; onDone: () => void }) {
  const [name, setName] = useState(rule?.name ?? 'Happy hour');
  const [start, setStart] = useState(rule?.startTime ?? '16:00');
  const [end, setEnd] = useState(rule?.endTime ?? '19:00');
  const [rate, setRate] = useState(String((rule?.hourlyCents ?? plan.hourlyCents) / 100));
  const [multi, setMulti] = useState(rule?.hourlyMultiCents != null ? String(rule.hourlyMultiCents / 100) : '');
  const [days, setDays] = useState<number[]>(rule?.daysOfWeek ?? [0, 1, 2, 3, 4, 5, 6]);
  const [err, setErr] = useState('');

  async function submit() {
    const hourlyCents = parseEgp(rate);
    const hourlyMultiCents = multi.trim() ? parseEgp(multi) : null;
    if (!name.trim() || hourlyCents == null || hourlyCents < 0 || !days.length || (multi.trim() && hourlyMultiCents == null)) {
      setErr(tr('Name, a valid rate and at least one day are required')); return;
    }
    const body = { name: name.trim(), daysOfWeek: days, startTime: start, endTime: end, hourlyCents, hourlyMultiCents };
    try {
      if (rule) await api(`/admin/rate-plans/rules/${rule.id}`, { method: 'PATCH', body });
      else await api(`/admin/rate-plans/${plan.id}/rules`, { method: 'POST', body });
      onDone();
    } catch (e) { setErr(e instanceof Error ? e.message : tr('Failed')); }
  }
  return (
    <Modal title={rule ? `${tr('Edit rule')} — ${plan.name}` : `${tr('New rule for')} ${plan.name}`} onClose={onClose}>
      <ErrorBanner message={err} />
      <div className="space-y-3">
        <Field label={tr('Name')}><TextInput value={name} onChange={setName} /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label={tr('Start (HH:mm)')}><TextInput value={start} onChange={setStart} type="time" /></Field>
          <Field label={tr('End (HH:mm)')}><TextInput value={end} onChange={setEnd} type="time" /></Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label={tr('Hourly rate (EGP)')}><TextInput value={rate} onChange={setRate} type="number" /></Field>
          {plan.hourlyMultiCents != null && (
            <Field label={tr('Multiplayer rate (EGP, optional)')}><TextInput value={multi} onChange={setMulti} type="number" /></Field>
          )}
        </div>
        <Field label={tr('Days')}>
          <div className="flex flex-wrap gap-1">
            {DAYS.map((d, i) => (
              <button key={i} onClick={() => setDays((cur) => cur.includes(i) ? cur.filter((x) => x !== i) : [...cur, i])}
                className={`rounded px-3 py-1.5 text-xs ${days.includes(i) ? 'bg-goblin-600 text-white' : 'bg-goblin-800'}`}>
                {d}
              </button>
            ))}
          </div>
        </Field>
        <Btn kind="primary" onClick={() => void submit()}>{rule ? tr('Save') : tr('Add rule')}</Btn>
      </div>
    </Modal>
  );
}

function PlanModal({ plan, onClose, onDone }: { plan: RatePlan | null; onClose: () => void; onDone: () => void }) {
  const cents = (v: number | null | undefined) => (v == null ? '' : String(v / 100));
  const [name, setName] = useState(plan?.name ?? '');
  const [hourlyRate, setHourlyRate] = useState(cents(plan?.hourlyCents));
  const [multiplayerRate, setMultiplayerRate] = useState(cents(plan?.hourlyMultiCents));
  const [minimumCharge, setMinimumCharge] = useState(plan ? cents(plan.minimumCents) : '0');
  const [roundToMinutes, setRoundToMinutes] = useState(String(plan?.roundToMinutes ?? 1));
  const [roundingMode, setRoundingMode] = useState(plan?.roundingMode ?? 'nearest');
  const [graceMinutes, setGraceMinutes] = useState(String(plan?.graceMinutes ?? 0));
  const [active, setActive] = useState(plan?.isActive ?? true);
  const [err, setErr] = useState('');

  async function submit() {
    if (!name.trim()) { setErr(tr('Name is required')); return; }
    const hourlyCents = parseEgp(hourlyRate);
    if (hourlyCents == null || hourlyCents < 0) { setErr(tr('Hourly rate must be a positive number')); return; }
    const hourlyMultiCents = multiplayerRate.trim() ? parseEgp(multiplayerRate) : null;
    if (multiplayerRate.trim() && (hourlyMultiCents == null || hourlyMultiCents < 0)) {
      setErr(tr('Multiplayer rate must be a positive number')); return;
    }
    const minimumCents = parseEgp(minimumCharge || '0');
    if (minimumCents == null || minimumCents < 0) { setErr(tr('Minimum charge must be a non-negative number')); return; }
    const round = Number(roundToMinutes);
    if (!Number.isInteger(round) || round < 1) { setErr(tr('Round to minutes must be a positive integer')); return; }
    const grace = Number(graceMinutes);
    if (!Number.isInteger(grace) || grace < 0) { setErr(tr('Grace minutes must be a non-negative integer')); return; }

    const body = {
      name: name.trim(), hourlyCents, hourlyMultiCents, minimumCents,
      roundToMinutes: round, roundingMode, graceMinutes: grace, isActive: active,
    };
    try {
      if (plan) await api(`/admin/rate-plans/${plan.id}`, { method: 'PATCH', body });
      else await api('/admin/rate-plans', { method: 'POST', body });
      onDone();
    } catch (e) { setErr(e instanceof Error ? e.message : tr('Failed')); }
  }

  return (
    <Modal title={plan ? `${tr('Edit')} ${plan.name}` : tr('New Rate Plan')} onClose={onClose}>
      <ErrorBanner message={err} />
      <div className="space-y-3">
        <Field label={tr('Plan Name')}><TextInput value={name} onChange={setName} placeholder={tr('e.g. Billiards Standard, PS5 VIP')} /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label={tr('Hourly Rate (EGP)')}><TextInput value={hourlyRate} onChange={setHourlyRate} type="number" /></Field>
          <Field label={tr('Multiplayer Hourly Rate (EGP, optional)')}><TextInput value={multiplayerRate} onChange={setMultiplayerRate} type="number" placeholder="N/A" /></Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label={tr('Min Charge (EGP)')}><TextInput value={minimumCharge} onChange={setMinimumCharge} type="number" /></Field>
          <Field label={tr('Grace (min)')}><TextInput value={graceMinutes} onChange={setGraceMinutes} type="number" /></Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label={tr('Round (min)')}><TextInput value={roundToMinutes} onChange={setRoundToMinutes} type="number" /></Field>
          <Field label={tr('Rounding')}><Select value={roundingMode} onChange={setRoundingMode} options={ROUNDING} /></Field>
        </div>
        <label className="flex items-center gap-2 text-sm text-goblin-200">
          <input type="checkbox" className="h-4 w-4" checked={active} onChange={(e) => setActive(e.target.checked)} />
          {tr('Active (tables using it can start timers)')}
        </label>
        {plan && <p className="text-xs text-goblin-400">{tr('Price changes also apply to timers that are running right now.')}</p>}
        <Btn kind="primary" onClick={() => void submit()}>{plan ? tr('Save') : tr('Create Rate Plan')}</Btn>
      </div>
    </Modal>
  );
}
