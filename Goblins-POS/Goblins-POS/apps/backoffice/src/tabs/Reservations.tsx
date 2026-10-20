import { useState } from 'react';
import { api, egp, parseEgp } from '../lib/api';
import { Btn, ErrorBanner, Field, Modal, Select, Spinner, TextInput, useLoad } from '../lib/ui';
import { tr } from '../lib/i18n';

interface Reservation {
  id: string; startAt: string; endAt: string; partySize: number; status: string;
  guestName?: string | null; guestPhone?: string | null; depositCents: number; notes?: string | null;
  source?: 'STAFF' | 'ONLINE'; bookingCode?: string | null;
  depositStatus?: 'NONE' | 'AWAITING' | 'RECEIVED' | 'REFUNDED'; depositReference?: string | null;
  resource: { id: string; name: string; type: string };
  customer?: { id: string; name: string; phone: string; visitCount: number } | null;
}
interface FloorZone { id: string; name: string; resources: { id: string; name: string; type: string }[] }

const STATUS_BADGE: Record<string, string> = {
  PENDING: 'bg-goblin-800 text-goblin-200', CONFIRMED: 'bg-blue-100 text-blue-700',
  SEATED: 'bg-goblin-700 text-goblin-500', COMPLETED: 'bg-goblin-800 text-goblin-400',
  NO_SHOW: 'bg-red-100 text-red-600', CANCELLED: 'bg-goblin-800 text-goblin-400 line-through',
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
    } catch (e) { setErr(e instanceof Error ? e.message : tr('Failed')); }
  }

  const [depositFor, setDepositFor] = useState<Reservation | null>(null);
  const [depositRef, setDepositRef] = useState('');
  async function confirmDeposit() {
    if (!depositFor) return;
    setErr('');
    try {
      await api(`/reservations/${depositFor.id}/deposit-received`, { method: 'POST', body: { reference: depositRef.trim() } });
      setDepositFor(null); setDepositRef('');
      reload();
    } catch (e) { setErr(e instanceof Error ? e.message : tr('Failed')); }
  }

  async function sweep() {
    setErr('');
    try { await api('/reservations/sweep', { method: 'POST' }); reload(); }
    catch (e) { setErr(e instanceof Error ? e.message : tr('Failed')); }
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
      <div className="flex border-b border-goblin-700">
        <button
          onClick={() => setActiveCategory('RENTAL')}
          className={`border-b-2 px-4 py-2 text-sm font-semibold transition-all ${
            activeCategory === 'RENTAL'
              ? 'border-indigo-600 text-indigo-600'
              : 'border-transparent text-goblin-300 hover:text-goblin-100'
          }`}
        >
          {tr('🎮 Rental Assets (Billiards & PS)')}
        </button>
        <button
          onClick={() => setActiveCategory('DINING')}
          className={`border-b-2 px-4 py-2 text-sm font-semibold transition-all ${
            activeCategory === 'DINING'
              ? 'border-indigo-600 text-indigo-600'
              : 'border-transparent text-goblin-300 hover:text-goblin-100'
          }`}
        >
          {tr('🍽️ Dining Tables')}
        </button>
      </div>

      <div className="flex items-center gap-2">
        <Btn kind="primary" onClick={() => setCreateOpen(true)}>{tr('+ New reservation')}</Btn>
        <Btn onClick={() => void sweep()}>{tr('Run no-show sweep')}</Btn>
      </div>
      <ErrorBanner message={err} />
      {[...byDay.entries()].map(([day, rows]) => (
        <div key={day}>
          <h2 className="mb-2 font-semibold text-goblin-100">{day}</h2>
          <div className="space-y-2">
            {rows.map((r) => (
              <div key={r.id} className="flex flex-wrap items-center gap-3 rounded-xl bg-goblin-900 p-3 shadow">
                <span className="w-28 font-mono text-sm">{time(r.startAt)}–{time(r.endAt)}</span>
                <span className="font-semibold text-goblin-100">{r.resource.name}</span>
                {r.source === 'ONLINE' && (
                  <span className="rounded-full bg-blue-500/15 px-2 py-0.5 text-xs font-semibold text-blue-400" title={tr('Booked on the website')}>
                    {tr('Online ·')} {r.bookingCode}
                  </span>
                )}
                <span className="text-sm text-goblin-200">
                  {r.customer?.name ?? r.guestName ?? '—'}
                  {(r.customer?.phone ?? r.guestPhone) && <span className="text-goblin-400"> · {r.customer?.phone ?? r.guestPhone}</span>}
                  {' '}· {r.partySize} {tr('pax')}
                  {r.depositCents > 0 && (
                    <span className={r.depositStatus === 'AWAITING' ? 'text-amber-500' : 'text-goblin-500'}>
                      {' '}{tr('· deposit')} {egp(r.depositCents)}
                      {r.depositStatus === 'AWAITING' && tr(' — awaiting transfer')}
                      {r.depositStatus === 'RECEIVED' && ` ${tr('— received')}${r.depositReference ? ` (${r.depositReference})` : ''}`}
                    </span>
                  )}
                </span>
                <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${STATUS_BADGE[r.status] ?? ''}`}>{tr(r.status.replace('_', ' '))}</span>
                <span className="ml-auto flex gap-1">
                  {r.depositStatus === 'AWAITING' && (r.status === 'PENDING' || r.status === 'CONFIRMED') && (
                    <Btn kind="primary" onClick={() => { setDepositFor(r); setDepositRef(''); }}>{tr('Deposit received')}</Btn>
                  )}
                  {(NEXT[r.status] ?? []).map((s) => (
                    <Btn key={s} kind={s === 'CANCELLED' || s === 'NO_SHOW' ? 'danger' : 'default'}
                      onClick={() => void setStatus(r.id, s)}>
                      {s === 'SEATED' ? tr('Check in') : tr(s.replace('_', ' ').toLowerCase())}
                    </Btn>
                  ))}
                </span>
              </div>
            ))}
          </div>
        </div>
      ))}
      {!filtered.length && <p className="text-sm text-goblin-400">{tr('No reservations in the next 7 days for this category')}</p>}
      {depositFor && (
        <Modal title={`${tr('Deposit for')} ${depositFor.bookingCode ?? depositFor.resource.name}`} onClose={() => setDepositFor(null)}>
          <p className="mb-3 text-sm text-goblin-300">
            {tr('Confirm that')} {egp(depositFor.depositCents)} {tr('arrived by InstaPay / wallet from')} {depositFor.guestName ?? tr('the guest')}
            {depositFor.guestPhone ? ` (${depositFor.guestPhone})` : ''}{tr('. The booking becomes confirmed and the guest gets a message. At check-out, take this amount with the “Booking deposit” payment method.')}
          </p>
          <Field label={tr('Transfer reference (from the InstaPay / wallet message)')}>
            <TextInput value={depositRef} onChange={setDepositRef} />
          </Field>
          <div className="mt-3 flex justify-end gap-2">
            <Btn onClick={() => setDepositFor(null)}>{tr('Cancel')}</Btn>
            <Btn kind="primary" onClick={() => void confirmDeposit()}>{tr('Confirm deposit')}</Btn>
          </div>
        </Modal>
      )}
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
  // today in Cairo — toISOString() is UTC, which is still yesterday after midnight here
  const [date, setDate] = useState(new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Cairo' }).format(new Date()));
  const [saveCustomer, setSaveCustomer] = useState(true);
  const [start, setStart] = useState('19:00');
  const [durationMin, setDurationMin] = useState('120');
  const [partySize, setPartySize] = useState('2');
  const [guestName, setGuestName] = useState('');
  const [guestPhone, setGuestPhone] = useState('');
  const [deposit, setDeposit] = useState('');
  const [notes, setNotes] = useState('');
  const [err, setErr] = useState('');

  async function submit() {
    if (!resourceId || !guestName.trim()) { setErr(tr('Resource and guest name are required')); return; }
    const startAt = new Date(`${date}T${start}:00`);
    const endAt = new Date(startAt.getTime() + Number(durationMin) * 60_000);
    if (!(Number(durationMin) > 0) || Number.isNaN(startAt.getTime())) { setErr(tr('Invalid time')); return; }
    const depositCents = deposit ? parseEgp(deposit) : undefined;
    try {
      await api('/reservations', { method: 'POST', body: {
        resourceId, startAt: startAt.toISOString(), endAt: endAt.toISOString(),
        partySize: Math.max(1, Math.round(Number(partySize))),
        guestName: guestName.trim(), guestPhone: guestPhone.trim() || undefined,
        depositCents: depositCents ?? undefined, notes: notes.trim() || undefined,
        ...(saveCustomer && guestPhone.trim() ? { saveCustomer: true } : {}),
      } });
      onDone();
    } catch (e) { setErr(e instanceof Error ? e.message : tr('Failed')); }
  }

  return (
    <Modal title={tr('New reservation')} onClose={onClose}>
      <div className="space-y-3">
        <Field label={tr('Table / room')}>
          <Select value={resourceId} onChange={setResourceId} allowEmpty="— pick —"
            options={resources.map((r) => ({ value: r.id, label: `${r.zone} · ${r.name}` }))} />
        </Field>
        <div className="grid grid-cols-3 gap-3">
          <Field label={tr('Date')}><TextInput value={date} onChange={setDate} type="date" /></Field>
          <Field label={tr('Start')}><TextInput value={start} onChange={setStart} type="time" /></Field>
          <Field label={tr('Minutes')}><TextInput value={durationMin} onChange={setDurationMin} type="number" /></Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label={tr('Guest name')}><TextInput value={guestName} onChange={setGuestName} /></Field>
          <Field label={tr('Phone')}><TextInput value={guestPhone} onChange={setGuestPhone} /></Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label={tr('Party size')}><TextInput value={partySize} onChange={setPartySize} type="number" /></Field>
          <Field label={tr('Deposit (EGP, optional)')}><TextInput value={deposit} onChange={setDeposit} type="number" /></Field>
        </div>
        <Field label={tr('Notes')}><TextInput value={notes} onChange={setNotes} /></Field>
        <label className="flex cursor-pointer items-start gap-2 text-sm text-goblin-200">
          <input type="checkbox" className="mt-0.5 h-4 w-4" checked={saveCustomer} onChange={(e) => setSaveCustomer(e.target.checked)} />
          <span>
            {tr('Save this guest as a customer')}
            <span className="block text-xs text-goblin-400">{tr('Needs a phone. If the phone is already registered, the booking links to that customer.')}</span>
          </span>
        </label>
        <ErrorBanner message={err} />
        <Btn kind="primary" onClick={() => void submit()}>{tr('Book')}</Btn>
      </div>
    </Modal>
  );
}
