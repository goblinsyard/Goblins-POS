import { useState } from 'react';
import { api, egp, parseEgp } from '../lib/api';
import { Btn, ErrorBanner, Field, Modal, TextInput, useLoad } from '../lib/ui';

interface RateRule {
  id: string; name: string; startTime: string; endTime: string;
  hourlyCents: number; hourlyMultiCents?: number | null; daysOfWeek: number[];
}
interface RatePlan {
  id: string; name: string; hourlyCents: number; hourlyMultiCents: number | null; minimumCents: number;
  roundToMinutes: number; graceMinutes?: number; rules: RateRule[]; resources: { name: string }[];
}

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export function RatePlansView() {
  const { data: plans, error, reload } = useLoad(() => api<RatePlan[]>('/admin/rate-plans'));
  const [ruleFor, setRuleFor] = useState<RatePlan | null>(null);
  const [newPlanOpen, setNewPlanOpen] = useState(false);
  const [err, setErr] = useState('');

  async function run(fn: () => Promise<unknown>) {
    setErr('');
    try { await fn(); reload(); } catch (e) { setErr(e instanceof Error ? e.message : 'Failed'); }
  }

  async function edit(id: string, field: string, currentCents: number, label: string) {
    const input = prompt(`New ${label} (EGP):`, String(currentCents / 100));
    if (!input) return;
    const cents = parseEgp(input);
    if (cents == null || cents < 0) { setErr('Invalid amount'); return; }
    await run(() => api(`/admin/rate-plans/${id}`, { method: 'PATCH', body: { [field]: cents } }));
  }

  if (error) return <p className="p-8 text-red-600">{error}</p>;
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-goblin-50">Rate Plans</h1>
        <Btn kind="primary" onClick={() => setNewPlanOpen(true)}>+ New rate plan</Btn>
      </div>
      <ErrorBanner message={err} />
      {(plans ?? []).map((p) => (
        <div key={p.id} className="rounded-xl bg-goblin-900 p-5 shadow">
          <div className="mb-2 flex items-center justify-between">
            <h2 className="font-semibold text-goblin-100">{p.name}</h2>
            <div className="flex items-center gap-2">
              <span className="text-xs text-goblin-400">{p.resources.map((r) => r.name).join(', ')}</span>
              {p.resources.length === 0 && (
                <button onClick={() => {
                  if (confirm(`Are you sure you want to delete rate plan "${p.name}"?`)) {
                    void run(() => api(`/admin/rate-plans/${p.id}`, { method: 'DELETE' }));
                  }
                }} className="rounded bg-red-50 px-2 py-1 text-xs text-red-600 hover:bg-red-100">
                  delete plan
                </button>
              )}
            </div>
          </div>
          <div className="flex flex-wrap gap-4 text-sm">
            <button onClick={() => void edit(p.id, 'hourlyCents', p.hourlyCents, 'hourly rate')} className="rounded-lg bg-goblin-800 px-3 py-2">
              Hourly: <b>{egp(p.hourlyCents)}</b>
            </button>
            {p.hourlyMultiCents != null && (
              <button onClick={() => void edit(p.id, 'hourlyMultiCents', p.hourlyMultiCents!, 'multiplayer rate')} className="rounded-lg bg-goblin-800 px-3 py-2">
                Multiplayer: <b>{egp(p.hourlyMultiCents)}</b>
              </button>
            )}
            <button onClick={() => void edit(p.id, 'minimumCents', p.minimumCents, 'minimum charge')} className="rounded-lg bg-goblin-800 px-3 py-2">
              Minimum: <b>{egp(p.minimumCents)}</b>
            </button>
            <span className="rounded-lg bg-goblin-800 px-3 py-2">Round: <b>{p.roundToMinutes} min</b></span>
            <Btn onClick={() => setRuleFor(p)}>+ Time rule</Btn>
          </div>
          {p.rules.length > 0 && (
            <div className="mt-3 space-y-1 text-sm text-goblin-300">
              {p.rules.map((r) => (
                <div key={r.id} className="flex items-center gap-2">
                  <span>
                    ↳ {r.name}: {r.startTime}–{r.endTime} @ {egp(r.hourlyCents)}/hr
                    {r.daysOfWeek?.length ? ` (${r.daysOfWeek.map((d) => DAYS[d]).join(' ')})` : ''}
                  </span>
                  <button onClick={() => void run(() => api(`/admin/rate-plans/rules/${r.id}`, { method: 'DELETE' }))}
                    className="rounded bg-red-50 px-2 text-xs text-red-600 hover:bg-red-100">
                    delete
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      ))}
      {ruleFor && (
        <NewRuleModal plan={ruleFor} onClose={() => setRuleFor(null)} onDone={() => { setRuleFor(null); reload(); }} />
      )}
      {newPlanOpen && (
        <NewPlanModal onClose={() => setNewPlanOpen(false)} onDone={() => { setNewPlanOpen(false); reload(); }} />
      )}
    </div>
  );
}

function NewRuleModal({ plan, onClose, onDone }: { plan: RatePlan; onClose: () => void; onDone: () => void }) {
  const [name, setName] = useState('Happy hour');
  const [start, setStart] = useState('16:00');
  const [end, setEnd] = useState('19:00');
  const [rate, setRate] = useState(String(plan.hourlyCents / 100));
  const [days, setDays] = useState<number[]>([0, 1, 2, 3, 4, 5, 6]);
  const [err, setErr] = useState('');

  async function submit() {
    const hourlyCents = parseEgp(rate);
    if (!name.trim() || hourlyCents == null || hourlyCents <= 0 || !days.length) {
      setErr('Name, positive rate and at least one day are required'); return;
    }
    try {
      await api(`/admin/rate-plans/${plan.id}/rules`, {
        method: 'POST',
        body: { name: name.trim(), daysOfWeek: days, startTime: start, endTime: end, hourlyCents },
      });
      onDone();
    } catch (e) { setErr(e instanceof Error ? e.message : 'Failed'); }
  }
  return (
    <Modal title={`New rule for ${plan.name}`} onClose={onClose}>
      <ErrorBanner message={err} />
      <div className="space-y-3">
        <Field label="Name"><TextInput value={name} onChange={setName} /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Start (HH:mm)"><TextInput value={start} onChange={setStart} type="time" /></Field>
          <Field label="End (HH:mm)"><TextInput value={end} onChange={setEnd} type="time" /></Field>
        </div>
        <Field label="Hourly rate (EGP)"><TextInput value={rate} onChange={setRate} type="number" /></Field>
        <Field label="Days">
          <div className="flex gap-1">
            {DAYS.map((d, i) => (
              <button key={d} onClick={() => setDays((cur) => cur.includes(i) ? cur.filter((x) => x !== i) : [...cur, i])}
                className={`rounded px-2 py-1 text-xs ${days.includes(i) ? 'bg-goblin-600 text-white' : 'bg-goblin-800'}`}>
                {d}
              </button>
            ))}
          </div>
        </Field>
        <Btn kind="primary" onClick={() => void submit()}>Add rule</Btn>
      </div>
    </Modal>
  );
}

function NewPlanModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [name, setName] = useState('');
  const [hourlyRate, setHourlyRate] = useState('');
  const [multiplayerRate, setMultiplayerRate] = useState('');
  const [minimumCharge, setMinimumCharge] = useState('0');
  const [roundToMinutes, setRoundToMinutes] = useState('1');
  const [graceMinutes, setGraceMinutes] = useState('0');
  const [err, setErr] = useState('');

  async function submit() {
    if (!name.trim()) { setErr('Name is required'); return; }
    const hourlyCents = parseEgp(hourlyRate);
    if (hourlyCents == null || hourlyCents < 0) { setErr('Hourly rate must be a positive number'); return; }
    
    const hourlyMultiCents = multiplayerRate.trim() ? parseEgp(multiplayerRate) : null;
    if (multiplayerRate.trim() && (hourlyMultiCents == null || hourlyMultiCents < 0)) {
      setErr('Multiplayer rate must be a positive number');
      return;
    }
    
    const minimumCents = parseEgp(minimumCharge);
    if (minimumCents == null || minimumCents < 0) { setErr('Minimum charge must be a non-negative number'); return; }
    
    const round = Number(roundToMinutes);
    if (!Number.isInteger(round) || round < 1) { setErr('Round to minutes must be a positive integer'); return; }
    
    const grace = Number(graceMinutes);
    if (!Number.isInteger(grace) || grace < 0) { setErr('Grace minutes must be a non-negative integer'); return; }

    try {
      await api('/admin/rate-plans', {
        method: 'POST',
        body: {
          name: name.trim(),
          hourlyCents,
          hourlyMultiCents,
          minimumCents,
          roundToMinutes: round,
          graceMinutes: grace,
        },
      });
      onDone();
    } catch (e) { setErr(e instanceof Error ? e.message : 'Failed'); }
  }

  return (
    <Modal title="New Rate Plan" onClose={onClose}>
      <ErrorBanner message={err} />
      <div className="space-y-3">
        <Field label="Plan Name"><TextInput value={name} onChange={setName} placeholder="e.g. Billiards Standard, PS5 VIP" /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Hourly Rate (EGP)"><TextInput value={hourlyRate} onChange={setHourlyRate} type="number" /></Field>
          <Field label="Multiplayer Hourly Rate (EGP, optional)"><TextInput value={multiplayerRate} onChange={setMultiplayerRate} type="number" placeholder="N/A" /></Field>
        </div>
        <div className="grid grid-cols-3 gap-3">
          <Field label="Min Charge (EGP)"><TextInput value={minimumCharge} onChange={setMinimumCharge} type="number" /></Field>
          <Field label="Round (min)"><TextInput value={roundToMinutes} onChange={setRoundToMinutes} type="number" /></Field>
          <Field label="Grace (min)"><TextInput value={graceMinutes} onChange={setGraceMinutes} type="number" /></Field>
        </div>
        <Btn kind="primary" onClick={() => void submit()}>Create Rate Plan</Btn>
      </div>
    </Modal>
  );
}

