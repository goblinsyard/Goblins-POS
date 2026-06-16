import { useState } from 'react';
import { api, egp, parseEgp } from '../lib/api';
import { Btn, ErrorBanner, Field, Modal, Select, Spinner, TextInput, useLoad } from '../lib/ui';

interface Reservation {
  id: string; startAt: string; endAt: string; partySize: number; status: string;
  guestName?: string | null; guestPhone?: string | null; depositCents: number; notes?: string | null;
  resource: { id: string; name: string; type: string };
  customer?: { id: string; name: string; phone: string; visitCount: number } | null;
}
interface FloorZone { id: string; name: string; resources: { id: string; name: string; type: string }[] }

const STATUS_BADGE: Record<string, string> = {
  PENDING: 'bg-slate-100 text-slate-600', CONFIRMED: 'bg-blue-100 text-blue-700',
  SEATED: 'bg-emerald-100 text-emerald-700', COMPLETED: 'bg-slate-100 text-slate-400',
  NO_SHOW: 'bg-red-100 text-red-600', CANCELLED: 'bg-slate-100 text-slate-400 line-through',
};
// mirrors the API's allowed status machine
const NEXT: Record<string, string[]> = {
  PENDING: ['CONFIRMED', 'CANCELLED'],
  CONFIRMED: ['SEATED', 'NO_SHOW', 'CANCELLED'],
  SEATED: ['COMPLETED'],
};

export function ReservationsView() {
  const { data: reservations, error, reload } = useLoad(() => api<Reservation[]>('/reservations/timeline'));
  const { data: zones } = useLoad(() => api<FloorZone[]>('/floor'));
  const [createOpen, setCreateOpen] = useState(false);
  const [err, setErr] = useState('');
  const [activeCategory, setActiveCategory] = useState<'RENTAL' | 'DINING'>('RENTAL');

  async function setStatus(id: string, status: string) {
    setErr('');
    try {
      await api(`/reservations/${id}/status/${status.toLowerCase()}`, { method: 'POST' });
      reload();
    } catch (e) { setErr(e instanceof Error ? e.message : 'Failed'); }
  }

  async function sweep() {
    setErr('');
    try { await api('/reservations/sweep', { method: 'POST' }); reload(); }
    catch (e) { setErr(e instanceof Error ? e.message : 'Failed'); }
  }

  if (error) return <p className="p-8 text-red-600">{error}</p>;
  if (!reservations) return <Spinner />;

  // Filter reservations by category
  const filtered = reservations.filter((r) => {
    const isRental = r.resource.type === 'BILLIARDS_TABLE' || r.resource.type === 'PS_ROOM';
    return activeCategory === 'RENTAL' ? isRental : !isRental;
  });

  // group by Cairo calendar day
  const byDay = new Map<string, Reservation[]>();
  for (const r of filtered) {
    const day = new Date(r.startAt).toLocaleDateString('en-EG', { timeZone: 'Africa/Cairo', weekday: 'short', month: 'short', day: 'numeric' });
    byDay.set(day, [...(byDay.get(day) ?? []), r]);
  }
  const time = (iso: string) => new Date(iso).toLocaleTimeString('en-EG', { timeZone: 'Africa/Cairo', hour: '2-digit', minute: '2-digit' });

  return (
    <div className="space-y-6">
      {/* Category Tabs */}
      <div className="flex border-b border-slate-200">
        <button
          onClick={() => setActiveCategory('RENTAL')}
          className={`border-b-2 px-4 py-2 text-sm font-semibold transition-all ${
            activeCategory === 'RENTAL'
              ? 'border-indigo-600 text-indigo-600'
              : 'border-transparent text-slate-500 hover:text-slate-700'
          }`}
        >
          🎮 Rental Assets (Billiards & PS)
        </button>
        <button
          onClick={() => setActiveCategory('DINING')}
          className={`border-b-2 px-4 py-2 text-sm font-semibold transition-all ${
            activeCategory === 'DINING'
              ? 'border-indigo-600 text-indigo-600'
              : 'border-transparent text-slate-500 hover:text-slate-700'
          }`}
        >
          🍽️ Dining Tables
        </button>
      </div>

      <div className="flex items-center gap-2">
        <Btn kind="primary" onClick={() => setCreateOpen(true)}>+ New reservation</Btn>
        <Btn onClick={() => void sweep()}>Run no-show sweep</Btn>
      </div>
      <ErrorBanner message={err} />
      {[...byDay.entries()].map(([day, rows]) => (
        <div key={day}>
          <h2 className="mb-2 font-semibold text-slate-700">{day}</h2>
          <div className="space-y-2">
            {rows.map((r) => (
              <div key={r.id} className="flex flex-wrap items-center gap-3 rounded-xl bg-white p-3 shadow">
                <span className="w-28 font-mono text-sm">{time(r.startAt)}–{time(r.endAt)}</span>
                <span className="font-semibold text-slate-700">{r.resource.name}</span>
                <span className="text-sm text-slate-600">
                  {r.customer?.name ?? r.guestName ?? '—'}
                  {(r.customer?.phone ?? r.guestPhone) && <span className="text-slate-400"> · {r.customer?.phone ?? r.guestPhone}</span>}
                  {' '}· {r.partySize} pax
                  {r.depositCents > 0 && <span className="text-emerald-700"> · deposit {egp(r.depositCents)}</span>}
                </span>
                <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${STATUS_BADGE[r.status] ?? ''}`}>{r.status.replace('_', ' ')}</span>
                <span className="ml-auto flex gap-1">
                  {(NEXT[r.status] ?? []).map((s) => (
                    <Btn key={s} kind={s === 'CANCELLED' || s === 'NO_SHOW' ? 'danger' : 'default'}
                      onClick={() => void setStatus(r.id, s)}>
                      {s === 'SEATED' ? 'Check in' : s.replace('_', ' ').toLowerCase()}
                    </Btn>
                  ))}
                </span>
              </div>
            ))}
          </div>
        </div>
      ))}
      {!filtered.length && <p className="text-sm text-slate-400">No reservations in the next 7 days for this category</p>}
      {createOpen && (
        <NewReservationModal zones={zones ?? []} onClose={() => setCreateOpen(false)}
          onDone={() => { setCreateOpen(false); reload(); }} />
      )}
    </div>
  );
}

function NewReservationModal({ zones, onClose, onDone }: {
  zones: FloorZone[]; onClose: () => void; onDone: () => void;
}) {
  const resources = zones.flatMap((z) => z.resources.map((r) => ({ ...r, zone: z.name })));
  const [resourceId, setResourceId] = useState('');
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [start, setStart] = useState('19:00');
  const [durationMin, setDurationMin] = useState('120');
  const [partySize, setPartySize] = useState('2');
  const [guestName, setGuestName] = useState('');
  const [guestPhone, setGuestPhone] = useState('');
  const [deposit, setDeposit] = useState('');
  const [notes, setNotes] = useState('');
  const [err, setErr] = useState('');

  async function submit() {
    if (!resourceId || !guestName.trim()) { setErr('Resource and guest name are required'); return; }
    const startAt = new Date(`${date}T${start}:00`);
    const endAt = new Date(startAt.getTime() + Number(durationMin) * 60_000);
    if (!(Number(durationMin) > 0) || Number.isNaN(startAt.getTime())) { setErr('Invalid time'); return; }
    const depositCents = deposit ? parseEgp(deposit) : undefined;
    try {
      await api('/reservations', { method: 'POST', body: {
        resourceId, startAt: startAt.toISOString(), endAt: endAt.toISOString(),
        partySize: Math.max(1, Math.round(Number(partySize))),
        guestName: guestName.trim(), guestPhone: guestPhone.trim() || undefined,
        depositCents: depositCents ?? undefined, notes: notes.trim() || undefined,
      } });
      onDone();
    } catch (e) { setErr(e instanceof Error ? e.message : 'Failed'); }
  }

  return (
    <Modal title="New reservation" onClose={onClose}>
      <ErrorBanner message={err} />
      <div className="space-y-3">
        <Field label="Table / room">
          <Select value={resourceId} onChange={setResourceId} allowEmpty="— pick —"
            options={resources.map((r) => ({ value: r.id, label: `${r.zone} · ${r.name}` }))} />
        </Field>
        <div className="grid grid-cols-3 gap-3">
          <Field label="Date"><TextInput value={date} onChange={setDate} type="date" /></Field>
          <Field label="Start"><TextInput value={start} onChange={setStart} type="time" /></Field>
          <Field label="Minutes"><TextInput value={durationMin} onChange={setDurationMin} type="number" /></Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Guest name"><TextInput value={guestName} onChange={setGuestName} /></Field>
          <Field label="Phone"><TextInput value={guestPhone} onChange={setGuestPhone} /></Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Party size"><TextInput value={partySize} onChange={setPartySize} type="number" /></Field>
          <Field label="Deposit (EGP, optional)"><TextInput value={deposit} onChange={setDeposit} type="number" /></Field>
        </div>
        <Field label="Notes"><TextInput value={notes} onChange={setNotes} /></Field>
        <Btn kind="primary" onClick={() => void submit()}>Book</Btn>
      </div>
    </Modal>
  );
}
