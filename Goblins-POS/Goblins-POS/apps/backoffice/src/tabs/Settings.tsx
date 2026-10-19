import { useCallback, useEffect, useState } from 'react';
import { api } from '../lib/api';
import { Btn, ErrorBanner, Field, Modal, Pills, Select, Spinner, Table, TextInput, useLoad } from '../lib/ui';
import { tr } from '../lib/i18n';

interface Printer {
  id: string; name: string; connection: 'NETWORK' | 'USB' | 'PREVIEW'; address: string;
  paperWidth: number; isActive: boolean; stations: { name: string }[];
}
interface Station {
  id: string; name: string; nameAr?: string | null; kind: string;
  printerId?: string | null; printer?: { name: string } | null; useKds: boolean; usePrinter: boolean;
}

const SECTIONS = ['general', 'receipt customizer', 'printers', 'stations', 'payment methods', 'database manager'] as const;

export function SettingsView() {
  const [section, setSection] = useState<(typeof SECTIONS)[number]>('general');

  return (
    <div>
      <div className="mb-4"><Pills value={section} onChange={setSection} options={SECTIONS} /></div>
      {section === 'general' && <GeneralSettings />}
      {section === 'receipt customizer' && <ReceiptSettings />}
      {section === 'printers' && <Printers />}
      {section === 'stations' && <Stations />}
      {section === 'payment methods' && <PaymentMethods />}
      {section === 'database manager' && <DatabaseManager />}
    </div>
  );
}

// ---------- general settings ----------

function GeneralSettings() {
  const { data: settings, error, reload } = useLoad(() => api<Record<string, unknown>>('/settings'));
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [err, setErr] = useState('');
  const [saved, setSaved] = useState(false);
  const [testMsg, setTestMsg] = useState('');

  useEffect(() => {
    if (settings) {
      setDraft(Object.fromEntries(Object.entries(settings).map(([k, v]) => [k, String(v)])));
    }
  }, [settings]);

  if (error) return <p className="p-8 text-red-600">{error}</p>;
  if (!settings) return <Spinner />;

  // Filter out customizer and twilio keys so they don't clutter general settings
  const hiddenKeys = [
    'receipt.logo', 'receipt.header', 'receipt.headerAr', 'receipt.footer', 'receipt.footerAr',
    'receipt.showTaxSummary', 'receipt.showLoyalty', 'receipt.showQrCode', 'receipt.qrCodeText', 'receipt.fontSize',
    'twilio.accountSid', 'twilio.authToken', 'twilio.from', 'session.prepaidSmsAlertMinutes'
  ];
  // objects/arrays are internal state (backup schedule, alert bookkeeping), not editable here
  const keys = Object.keys(settings)
    .filter((k) => !hiddenKeys.includes(k) && (settings[k] === null || typeof settings[k] !== 'object'))
    .sort();
  const dirtyKeys = keys.filter((k) => draft[k] !== undefined && draft[k] !== String(settings[k]));

  async function sendTest() {
    setTestMsg(tr('Sending…'));
    try {
      const r = await api<{ sent: number; skipped?: string; errors: string[] }>('/notify/test', { method: 'POST' });
      setTestMsg(r.sent ? `${tr('Sent to')} ${r.sent} ${tr('number(s).')}` : r.skipped ?? (r.errors.join('; ') || tr('Not sent')));
    } catch (e) { setTestMsg(e instanceof Error ? e.message : tr('Failed')); }
  }

  async function save() {
    setErr(''); setSaved(false);
    const body: Record<string, unknown> = {};
    for (const k of dirtyKeys) {
      const original = settings![k];
      const raw = draft[k];
      if (typeof original === 'number') {
        const n = Number(raw);
        if (!Number.isFinite(n)) { setErr(`${k} ${tr('must be a number')}`); return; }
        body[k] = n;
      } else if (typeof original === 'boolean') {
        body[k] = raw === 'true';
      } else {
        body[k] = raw;
      }
    }
    try {
      await api('/settings', { method: 'PUT', body });
      setSaved(true);
      reload();
    } catch (e) { setErr(e instanceof Error ? e.message : tr('Failed')); }
  }

  return (
    <div className="max-w-2xl">
      <ErrorBanner message={err} />
      {saved && <p className="mb-3 rounded-lg bg-goblin-700 p-2 text-sm text-goblin-500">{tr('Settings saved.')}</p>}
      <div className="overflow-hidden rounded-xl bg-goblin-900 shadow">
        <table className="w-full text-sm">
          <tbody>
            {keys.map((k) => {
              const original = settings[k];
              return (
                <tr key={k} className="border-t first:border-0">
                  <td className="p-3 font-mono text-xs text-goblin-300">{k}</td>
                  <td className="p-3">
                    {typeof original === 'boolean' ? (
                      <select value={draft[k] ?? 'false'}
                        onChange={(e) => setDraft((c) => ({ ...c, [k]: e.target.value }))}
                        className="rounded-lg border border-goblin-700 bg-goblin-900 p-1.5">
                        <option value="true">{tr('true')}</option>
                        <option value="false">{tr('false')}</option>
                      </select>
                    ) : (
                      <input value={draft[k] ?? ''} dir="auto"
                        type={typeof original === 'number' ? 'number' : 'text'}
                        onChange={(e) => setDraft((c) => ({ ...c, [k]: e.target.value }))}
                        className="w-full rounded-lg border border-goblin-700 p-1.5" />
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="mt-3">
        <Btn kind="primary" onClick={() => void save()} disabled={!dirtyKeys.length}>
          {tr('Save')}{dirtyKeys.length ? ` (${dirtyKeys.length})` : ''}
        </Btn>
      </div>
      <div className="mt-6 rounded-xl bg-goblin-900 p-4 text-sm shadow">
        <p className="font-semibold text-goblin-100">{tr('Owner notifications')}</p>
        <p className="mt-1 text-goblin-300">
          {tr('Set')} <code>{tr('notify.ownerPhone')}</code> {tr('above (e.g. 01001234567; separate several with commas) and your Twilio account below. You\'ll get a summary when each shift is closed, and an alert when an ingredient reaches its reorder point. The same account is used for customer campaigns and prepaid-time reminders.')}
        </p>
        <TwilioForm settings={settings} onSaved={reload} />
        <div className="mt-3 flex items-center gap-3">
          <Btn onClick={() => void sendTest()}>{tr('Send test message')}</Btn>
          {testMsg && <span className="text-goblin-300">{testMsg}</span>}
        </div>
      </div>
    </div>
  );
}

function TwilioForm({ settings, onSaved }: { settings: Record<string, unknown>; onSaved: () => void }) {
  const [sid, setSid] = useState(String(settings['twilio.accountSid'] ?? ''));
  const [token, setToken] = useState('');
  const [from, setFrom] = useState(String(settings['twilio.from'] ?? ''));
  const [msg, setMsg] = useState('');
  const hasToken = !!settings['twilio.authToken'];

  async function save() {
    setMsg('');
    const body: Record<string, string> = { 'twilio.accountSid': sid.trim(), 'twilio.from': from.trim() };
    if (token.trim()) body['twilio.authToken'] = token.trim(); // blank keeps the saved token
    try {
      await api('/settings', { method: 'PUT', body });
      setToken('');
      setMsg(tr('Saved.'));
      onSaved();
    } catch (e) { setMsg(e instanceof Error ? e.message : tr('Failed')); }
  }

  return (
    <div className="mt-3 grid gap-2 sm:grid-cols-3">
      <Field label={tr('Twilio Account SID')}><TextInput value={sid} onChange={setSid} autoComplete="off" /></Field>
      <Field label={hasToken ? tr('Auth token (saved — type to replace)') : tr('Auth token')}>
        <TextInput value={token} onChange={setToken} type="password" autoComplete="new-password" />
      </Field>
      <Field label={tr('From number (WhatsApp sender)')}><TextInput value={from} onChange={setFrom} placeholder="+14155238886" /></Field>
      <div className="flex items-center gap-3 sm:col-span-3">
        <Btn onClick={() => void save()}>{tr('Save Twilio account')}</Btn>
        {msg && <span className="text-goblin-300">{msg}</span>}
      </div>
    </div>
  );
}

// ---------- receipt settings customizer ----------

function ReceiptSettings() {
  const { data: settings, error, reload } = useLoad(() => api<Record<string, unknown>>('/settings'));
  const [draft, setDraft] = useState<Record<string, any>>({});
  const [err, setErr] = useState('');
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (settings) {
      setDraft({
        'receipt.header': String(settings['receipt.header'] ?? ''),
        'receipt.headerAr': String(settings['receipt.headerAr'] ?? ''),
        'receipt.footer': String(settings['receipt.footer'] ?? ''),
        'receipt.footerAr': String(settings['receipt.footerAr'] ?? ''),
        'receipt.showTaxSummary': settings['receipt.showTaxSummary'] !== false, // default true
        'receipt.showLoyalty': settings['receipt.showLoyalty'] !== false, // default true
        'receipt.showQrCode': settings['receipt.showQrCode'] !== false, // default true
        'receipt.qrCodeText': String(settings['receipt.qrCodeText'] ?? ''),
        'receipt.fontSize': String(settings['receipt.fontSize'] ?? 'normal'),
      });
    }
  }, [settings]);

  if (error) return <p className="p-8 text-red-600">{error}</p>;
  if (!settings) return <Spinner />;

  const isDirty = Object.keys(draft).some((k) => draft[k] !== settings[k]);

  async function save() {
    setErr(''); setSaved(false);
    try {
      await api('/settings', { method: 'PUT', body: draft });
      setSaved(true);
      reload();
    } catch (e) { setErr(e instanceof Error ? e.message : tr('Failed')); }
  }

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <div className="space-y-4">
        <h2 className="text-lg font-bold text-goblin-100">{tr('Receipt Design & Layout')}</h2>
        <ErrorBanner message={err} />
        {saved && <p className="rounded-lg bg-goblin-700 p-2 text-sm text-goblin-500">{tr('Receipt settings saved.')}</p>}
        
        <LogoSection current={(settings['receipt.logo'] as string) || ''} onSaved={reload} />

        <div className="rounded-xl bg-goblin-900 p-4 shadow space-y-3">
          <Field label={tr('Header Title (EN)')}><TextInput value={draft['receipt.header'] ?? ''} onChange={(v) => setDraft(c => ({ ...c, 'receipt.header': v }))} /></Field>
          <Field label={tr('Header Title (Arabic)')}><TextInput value={draft['receipt.headerAr'] ?? ''} onChange={(v) => setDraft(c => ({ ...c, 'receipt.headerAr': v }))} /></Field>
          <Field label={tr('Footer Note (EN)')}><TextInput value={draft['receipt.footer'] ?? ''} onChange={(v) => setDraft(c => ({ ...c, 'receipt.footer': v }))} /></Field>
          <Field label={tr('Footer Note (Arabic)')}><TextInput value={draft['receipt.footerAr'] ?? ''} onChange={(v) => setDraft(c => ({ ...c, 'receipt.footerAr': v }))} /></Field>
          
          <div className="grid grid-cols-2 gap-3">
            <Field label={tr('Font Size')}>
              <Select value={draft['receipt.fontSize'] ?? 'normal'} onChange={(v) => setDraft(c => ({ ...c, 'receipt.fontSize': v }))}
                options={[{ value: 'normal', label: tr('Normal') }, { value: 'large', label: tr('Large (Header & Footer)') }]} />
            </Field>
            <Field label={tr('QR Code Text')}>
              <TextInput value={draft['receipt.qrCodeText'] ?? ''} onChange={(v) => setDraft(c => ({ ...c, 'receipt.qrCodeText': v }))} disabled={!draft['receipt.showQrCode']} />
            </Field>
          </div>

          <div className="space-y-2 pt-2">
            <label className="flex items-center gap-2 text-sm text-goblin-200">
              <input type="checkbox" checked={draft['receipt.showTaxSummary'] ?? false} onChange={(e) => setDraft(c => ({ ...c, 'receipt.showTaxSummary': e.target.checked }))} />
              {tr('Show detailed Tax (VAT & Service Charge) breakdown')}
            </label>
            <label className="flex items-center gap-2 text-sm text-goblin-200">
              <input type="checkbox" checked={draft['receipt.showLoyalty'] ?? false} onChange={(e) => setDraft(c => ({ ...c, 'receipt.showLoyalty': e.target.checked }))} />
              {tr('Show Customer Loyalty tiers and point balances')}
            </label>
            <label className="flex items-center gap-2 text-sm text-goblin-200">
              <input type="checkbox" checked={draft['receipt.showQrCode'] ?? false} onChange={(e) => setDraft(c => ({ ...c, 'receipt.showQrCode': e.target.checked }))} />
              {tr('Show QR Code at the bottom of the receipt')}
            </label>
          </div>
        </div>

        <Btn kind="primary" onClick={() => void save()} disabled={!isDirty}>
          {tr('Save Layout')}
        </Btn>
      </div>

      {/* Live Preview Column */}
      <div className="flex flex-col items-center">
        <h3 className="mb-2 font-semibold text-goblin-300 uppercase text-xs tracking-wider">{tr('Live Mock Preview')}</h3>
        <div className="w-[300px] border border-dashed border-goblin-700 rounded-2xl bg-[#fafafa] p-4 text-black shadow-inner font-mono text-xs leading-snug">
          {settings['receipt.logo'] && (
            <img src={settings['receipt.logo'] as string} alt={tr('Receipt Logo')} className="mx-auto mb-3 max-h-12 border rounded bg-goblin-900 p-0.5" />
          )}
          
          <div className="text-center">
            <div className={draft['receipt.fontSize'] === 'large' ? 'font-bold text-sm' : ''}>
              {draft['receipt.header'] || tr('Goblins Yard')}
            </div>
            {draft['receipt.headerAr'] && (
              <div className={draft['receipt.fontSize'] === 'large' ? 'font-bold text-sm' : ''}>
                {draft['receipt.headerAr']}
              </div>
            )}
            <div className="text-goblin-400">{String(settings['business.address'] || '123 Nile Street, Zamalek, Cairo')}</div>
            <div className="text-goblin-400">{tr('Tax ID:')} {String(settings['business.taxId'] || '123-456-789')}</div>
          </div>
          
          <div className="my-2 border-t border-dashed border-goblin-700"></div>
          
          <div className="flex justify-between">
            <span>{tr('Order #1234')}</span>
            <span>{tr('DINE IN')}</span>
          </div>
          <div className="flex justify-between">
            <span>{tr('Table: T1')}</span>
            <span>{tr('Server: Hassan')}</span>
          </div>
          
          <div className="my-2 border-t border-dashed border-goblin-700"></div>
          
          <div className="flex justify-between">
            <span>{tr('1 x Virgin Mojito')}</span>
            <span>{tr('85.00 EGP')}</span>
          </div>
          <div className="flex justify-between">
            <span>{tr('1 x Pizza Margherita')}</span>
            <span>{tr('160.00 EGP')}</span>
          </div>
          
          <div className="my-2 border-t border-dashed border-goblin-700"></div>
          
          <div className="flex justify-between font-bold">
            <span>{tr('Subtotal')}</span>
            <span>{tr('245.00 EGP')}</span>
          </div>
          {draft['receipt.showTaxSummary'] && (
            <>
              <div className="flex justify-between">
                <span>{tr('Service (12%)')}</span>
                <span>{tr('29.40 EGP')}</span>
              </div>
              <div className="flex justify-between">
                <span>{tr('VAT (14%)')}</span>
                <span>{tr('38.42 EGP')}</span>
              </div>
            </>
          )}
          
          <div className="my-1 border-t border-goblin-700"></div>
          <div className="flex justify-between font-bold">
            <span>{tr('TOTAL')}</span>
            <span>{draft['receipt.showTaxSummary'] ? tr('312.82 EGP') : tr('245.00 EGP')}</span>
          </div>
          <div className="my-1 border-t border-goblin-700"></div>
          
          {draft['receipt.showLoyalty'] && (
            <div className="text-center text-goblin-300 my-2 pt-1 border-t border-dashed border-goblin-700">
              <div>{tr('Loyalty Tier: Goblin King')}</div>
              <div>{tr('Points Balance: 125 pts')}</div>
            </div>
          )}
          
          <div className="text-center mt-3">
            <div className={draft['receipt.fontSize'] === 'large' ? 'font-bold text-sm' : ''}>
              {draft['receipt.footer'] || tr('Thank you! See you soon')}
            </div>
            {draft['receipt.footerAr'] && (
              <div className={draft['receipt.fontSize'] === 'large' ? 'font-bold text-sm' : ''}>
                {draft['receipt.footerAr']}
              </div>
            )}
          </div>

          {draft['receipt.showQrCode'] && (
            <div className="mt-3 border-t border-dashed border-goblin-700 pt-3 flex flex-col items-center">
              <div className="w-16 h-16 bg-goblin-700 flex items-center justify-center text-[10px] text-goblin-300">{tr('QR Code')}</div>
              <div className="text-[9px] text-goblin-400 mt-1 max-w-[150px] truncate">{draft['receipt.qrCodeText']}</div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function LogoSection({ current, onSaved }: { current: string; onSaved: () => void }) {
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  function pick(file: File | undefined) {
    setErr('');
    if (!file) return;
    if (file.size > 300 * 1024) { setErr(tr('Keep the logo under 300 KB (small PNG works best on receipts)')); return; }
    const reader = new FileReader();
    reader.onload = () => {
      void (async () => {
        setBusy(true);
        try {
          await api('/settings', { method: 'PUT', body: { 'receipt.logo': reader.result as string } });
          onSaved();
        } catch (e) { setErr(e instanceof Error ? e.message : tr('Failed')); }
        finally { setBusy(false); }
      })();
    };
    reader.readAsDataURL(file);
  }

  async function remove() {
    setBusy(true);
    try { await api('/settings', { method: 'PUT', body: { 'receipt.logo': '' } }); onSaved(); }
    catch (e) { setErr(e instanceof Error ? e.message : tr('Failed')); }
    finally { setBusy(false); }
  }

  return (
    <div className="mt-6 rounded-xl bg-goblin-900 p-4 shadow">
      <h2 className="mb-2 font-semibold text-goblin-100">{tr('Receipt logo')}</h2>
      <ErrorBanner message={err} />
      {current ? (
        <div className="mb-3 flex items-center gap-4">
          <img src={current} alt={tr('Receipt logo')} className="max-h-24 rounded border border-goblin-700 bg-goblin-900 p-1" />
          <Btn kind="danger" onClick={() => void remove()} disabled={busy}>{tr('Remove')}</Btn>
        </div>
      ) : (
        <p className="mb-3 text-sm text-goblin-400">{tr('No logo yet.')}</p>
      )}
      <label className="inline-block cursor-pointer rounded-lg bg-goblin-600 px-3 py-1.5 text-sm text-white hover:bg-goblin-700">
        {busy ? tr('Uploading…') : tr('Upload logo')}
        <input type="file" accept="image/png,image/jpeg,image/svg+xml" className="hidden"
          onChange={(e) => pick(e.target.files?.[0])} />
      </label>
      <p className="mt-2 text-xs text-goblin-400">
        {tr('Shown at the top of receipts on screen and in browser printing. Thermal ESC/POS printers print text only for now — logo raster printing is a future print-service upgrade.')}
      </p>
    </div>
  );
}

// ---------- printers ----------

function Printers() {
  const { data: printers, error, reload } = useLoad(() => api<Printer[]>('/admin/printers'));
  const [createOpen, setCreateOpen] = useState(false);
  const [editingPrinter, setEditingPrinter] = useState<Printer | null>(null);
  const [msg, setMsg] = useState('');

  async function test(id: string) {
    setMsg('');
    try {
      const r = await api<{ sent: boolean; mode: string }>(`/admin/printers/${id}/test`, { method: 'POST' });
      setMsg(`${tr('Test sent (')}${r.mode}${tr(') — check the printer / preview window.')}`);
    } catch (e) { setMsg(e instanceof Error ? e.message : tr('Failed')); }
  }

  async function deletePrinter(id: string) {
    if (!confirm(tr('Are you sure you want to delete this printer?'))) return;
    try {
      await api(`/admin/printers/${id}`, { method: 'DELETE' });
      reload();
    } catch (e) {
      alert(e instanceof Error ? e.message : tr('Delete failed'));
    }
  }

  if (error) return <p className="p-8 text-red-600">{error}</p>;
  return (
    <div>
      <div className="mb-3 flex items-center gap-3">
        <Btn kind="primary" onClick={() => { setEditingPrinter(null); setCreateOpen(true); }}>{tr('+ New printer')}</Btn>
        {msg && <span className="text-sm text-goblin-300">{msg}</span>}
      </div>
      <Table headers={[tr('Name'), tr('Connection'), tr('Address'), tr('Paper'), tr('Used by'), tr('Actions')]}
        rows={(printers ?? []).map((p) => [
          p.name, p.connection, p.address, `${p.paperWidth}mm`,
          p.stations.map((s) => s.name).join(', ') || '—',
          <div key={p.id} className="flex gap-2">
            <Btn onClick={() => void test(p.id)}>{tr('Test')}</Btn>
            <Btn onClick={() => { setEditingPrinter(p); setCreateOpen(true); }}>{tr('Edit')}</Btn>
            <Btn kind="danger" onClick={() => void deletePrinter(p.id)}>{tr('Delete')}</Btn>
          </div>,
        ])} />
      {createOpen && (
        <PrinterFormModal
          printer={editingPrinter}
          onClose={() => setCreateOpen(false)}
          onDone={() => { setCreateOpen(false); reload(); }}
        />
      )}
    </div>
  );
}

function PrinterFormModal({ onClose, onDone, printer }: { onClose: () => void; onDone: () => void; printer?: Printer | null }) {
  const [name, setName] = useState(printer?.name ?? '');
  const [connection, setConnection] = useState<'NETWORK' | 'USB' | 'PREVIEW'>(printer?.connection ?? 'NETWORK');
  const [address, setAddress] = useState(printer?.address ?? '192.168.1.50:9100');
  const [paperWidth, setPaperWidth] = useState(String(printer?.paperWidth ?? '80'));
  const [err, setErr] = useState('');

  async function submit() {
    if (!name.trim() || !address.trim()) { setErr(tr('Name and address are required')); return; }
    try {
      const body = {
        name: name.trim(),
        connection,
        address: address.trim(),
        paperWidth: Number(paperWidth) || 80,
      };
      if (printer) {
        await api(`/admin/printers/${printer.id}`, { method: 'PATCH', body });
      } else {
        await api('/admin/printers', { method: 'POST', body });
      }
      onDone();
    } catch (e) { setErr(e instanceof Error ? e.message : tr('Failed')); }
  }

  return (
    <Modal title={printer ? tr('Edit printer') : tr('New printer')} onClose={onClose}>
      <ErrorBanner message={err} />
      <div className="space-y-3">
        <Field label={tr('Name')}><TextInput value={name} onChange={setName} /></Field>
        <Field label={tr('Connection')}>
          <Select value={connection} onChange={(v) => {
            setConnection(v as typeof connection);
            if (v === 'PREVIEW') setAddress('preview');
          }}
            options={['NETWORK', 'USB', 'PREVIEW'].map((c) => ({ value: c, label: c }))} />
        </Field>
        <Field label={connection === 'NETWORK' ? tr('Address (ip:port, ESC/POS TCP 9100)') : tr('Address')}>
          <TextInput value={address} onChange={setAddress} />
        </Field>
        <Field label={tr('Paper width (mm)')}>
          <Select value={paperWidth} onChange={setPaperWidth}
            options={['58', '80'].map((w) => ({ value: w, label: `${w}${tr('mm')}` }))} />
        </Field>
        <Btn kind="primary" onClick={() => void submit()}>{printer ? tr('Save') : tr('Create')}</Btn>
      </div>
    </Modal>
  );
}

// ---------- stations ----------

function Stations() {
  const { data: stations, error, reload } = useLoad(() => api<Station[]>('/kds/stations'));
  const { data: printers } = useLoad(() => api<Printer[]>('/admin/printers'));
  const [err, setErr] = useState('');
  const [formOpen, setFormOpen] = useState<{ station?: Station } | null>(null);

  async function patch(id: string, body: Record<string, unknown>) {
    setErr('');
    try { await api(`/admin/stations/${id}`, { method: 'PATCH', body }); reload(); }
    catch (e) { setErr(e instanceof Error ? e.message : tr('Failed')); }
  }

  async function deleteStation(id: string, name: string) {
    if (!confirm(`${tr('Delete station "')}${name}${tr('"? Items assigned to it will become unrouted.')}`)) return;
    setErr('');
    try { await api(`/admin/stations/${id}`, { method: 'DELETE' }); reload(); }
    catch (e) { setErr(e instanceof Error ? e.message : tr('Failed to delete')); }
  }

  if (error) return <p className="p-8 text-red-600">{error}</p>;
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-goblin-50">{tr('Prep Stations')}</h2>
          <p className="text-sm text-goblin-300">{tr('Manage kitchen and bar prep stations where order items are routed.')}</p>
        </div>
        <Btn kind="primary" onClick={() => setFormOpen({})}>{tr('+ New Prep Station')}</Btn>
      </div>
      <ErrorBanner message={err} />
      <div className="overflow-hidden rounded-xl bg-goblin-900 shadow border border-goblin-800">
        <table className="w-full text-sm">
          <thead className="bg-goblin-800 text-left text-goblin-300 text-xs uppercase tracking-wide">
            <tr>
              <th className="p-3">{tr('Station')}</th>
              <th className="p-3">{tr('Kind')}</th>
              <th className="p-3">{tr('Printer')}</th>
              <th className="p-3">{tr('KDS Screen')}</th>
              <th className="p-3">{tr('Print Tickets')}</th>
              <th className="p-3">{tr('Actions')}</th>
            </tr>
          </thead>
          <tbody>
            {(stations ?? []).map((st) => (
              <tr key={st.id} className="border-t hover:bg-goblin-800/50">
                <td className="p-3 font-semibold text-goblin-100">
                  {st.name}
                  {st.nameAr && <span className="ml-2 text-goblin-400 font-normal text-xs">({st.nameAr})</span>}
                </td>
                <td className="p-3 text-goblin-300">{tr(st.kind)}</td>
                <td className="p-3">
                  <select value={st.printerId ?? ''}
                    onChange={(e) => void patch(st.id, { printerId: e.target.value || null })}
                    className="rounded-lg border border-goblin-700 bg-goblin-900 p-1.5 text-sm">
                    <option value="">{tr('— none —')}</option>
                    {(printers ?? []).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </select>
                </td>
                <td className="p-3">
                  <input type="checkbox" checked={st.useKds}
                    onChange={(e) => void patch(st.id, { useKds: e.target.checked })}
                    className="rounded border-goblin-700 text-goblin-500" />
                </td>
                <td className="p-3">
                  <input type="checkbox" checked={st.usePrinter}
                    onChange={(e) => void patch(st.id, { usePrinter: e.target.checked })}
                    className="rounded border-goblin-700 text-goblin-500" />
                </td>
                <td className="p-3">
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => setFormOpen({ station: st })}
                      className="rounded border border-goblin-700 bg-goblin-900 px-2.5 py-1 text-xs text-goblin-200 hover:bg-goblin-800 font-medium"
                    >
                      {tr('Edit')}
                    </button>
                    <button
                      onClick={() => void deleteStation(st.id, st.name)}
                      className="rounded border border-red-200 bg-red-50 px-2.5 py-1 text-xs text-red-700 hover:bg-red-100 font-medium"
                    >
                      {tr('Delete')}
                    </button>
                  </div>
                </td>
              </tr>
            ))}
            {!(stations ?? []).length && (
              <tr><td colSpan={6} className="p-6 text-center text-goblin-400 italic">{tr('No stations yet. Create a Kitchen and Bar station to route orders.')}</td></tr>
            )}
          </tbody>
        </table>
      </div>
      {formOpen !== null && (
        <StationFormModal
          station={formOpen.station}
          printers={printers ?? []}
          onClose={() => setFormOpen(null)}
          onDone={() => { setFormOpen(null); reload(); }}
        />
      )}
    </div>
  );
}

function StationFormModal({
  station,
  printers,
  onClose,
  onDone,
}: {
  station?: Station;
  printers: Printer[];
  onClose: () => void;
  onDone: () => void;
}) {
  const [name, setName] = useState(station?.name ?? '');
  const [nameAr, setNameAr] = useState(station?.nameAr ?? '');
  const [kind, setKind] = useState(station?.kind ?? 'PREP');
  const [printerId, setPrinterId] = useState(station?.printerId ?? '');
  const [useKds, setUseKds] = useState(station?.useKds ?? true);
  const [usePrinter, setUsePrinter] = useState(station?.usePrinter ?? false);
  const [err, setErr] = useState('');

  async function submit() {
    if (!name.trim()) { setErr(tr('Name is required')); return; }
    setErr('');
    try {
      const body = { name: name.trim(), nameAr: nameAr.trim() || null, kind, printerId: printerId || null, useKds, usePrinter };
      if (station) {
        await api(`/admin/stations/${station.id}`, { method: 'PATCH', body });
      } else {
        await api('/admin/stations', { method: 'POST', body });
      }
      onDone();
    } catch (e) { setErr(e instanceof Error ? e.message : tr('Failed')); }
  }

  return (
    <Modal title={station ? `${tr('Edit Station:')} ${station.name}` : tr('New Prep Station')} onClose={onClose}>
      <ErrorBanner message={err} />
      <div className="space-y-3">
        <Field label={tr('Name (English)')}>
          <TextInput value={name} onChange={setName} placeholder={tr('e.g. Kitchen, Bar')} />
        </Field>
        <Field label={tr('Name (Arabic — optional)')}>
          <TextInput value={nameAr} onChange={setNameAr} placeholder="e.g. المطبخ" />
        </Field>
        <Field label={tr('Kind')}>
          <select value={kind} onChange={(e) => setKind(e.target.value)}
            className="w-full rounded-lg border border-goblin-700 bg-goblin-900 p-2.5 text-sm">
            <option value="PREP">{tr('PREP (Kitchen, Bar)')}</option>
            <option value="EXPO">{tr('EXPO (Pass-through display)')}</option>
          </select>
        </Field>
        <Field label={tr('Printer')}>
          <select value={printerId} onChange={(e) => setPrinterId(e.target.value)}
            className="w-full rounded-lg border border-goblin-700 bg-goblin-900 p-2.5 text-sm">
            <option value="">{tr('— none —')}</option>
            {printers.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </Field>
        <label className="flex items-center gap-2 text-sm text-goblin-100 cursor-pointer py-1">
          <input type="checkbox" checked={useKds} onChange={(e) => setUseKds(e.target.checked)}
            className="rounded border-goblin-700 text-goblin-500 focus:ring-goblin-500" />
          <span>{tr('Show on KDS screen')}</span>
        </label>
        <label className="flex items-center gap-2 text-sm text-goblin-100 cursor-pointer py-1">
          <input type="checkbox" checked={usePrinter} onChange={(e) => setUsePrinter(e.target.checked)}
            className="rounded border-goblin-700 text-goblin-500 focus:ring-goblin-500" />
          <span>{tr('Print Tickets automatically')}</span>
        </label>
        <div className="flex gap-2 pt-1">
          <Btn kind="ghost" onClick={onClose}>{tr('Cancel')}</Btn>
          <Btn kind="primary" onClick={() => void submit()}>{station ? tr('Save') : tr('Create')}</Btn>
        </div>
      </div>
    </Modal>
  );
}

function parseCsv(text: string): string[][] {
  const lines: string[][] = [];
  let row: string[] = [];
  let inQuotes = false;
  let currentField = '';
  
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    const nextChar = text[i+1];
    
    if (char === '"') {
      if (inQuotes && nextChar === '"') {
        currentField += '"';
        i++; // skip next quote
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === ',' && !inQuotes) {
      row.push(currentField.trim());
      currentField = '';
    } else if ((char === '\r' || char === '\n') && !inQuotes) {
      if (char === '\r' && nextChar === '\n') {
        i++;
      }
      row.push(currentField.trim());
      if (row.length > 0 || row.some(f => f !== '')) {
        lines.push(row);
      }
      row = [];
      currentField = '';
    } else {
      currentField += char;
    }
  }
  
  if (currentField || row.length > 0) {
    row.push(currentField.trim());
    lines.push(row);
  }
  
  return lines;
}

function DatabaseManager() {
  const [backups, setBackups] = useState<string[]>([]);
  const [err, setErr] = useState('');
  const [success, setSuccess] = useState('');
  const [busy, setBusy] = useState(false);
  const [autoBackupEnabled, setAutoBackupEnabled] = useState(false);
  const [autoBackupInterval, setAutoBackupInterval] = useState('24');
  const [autoBackupKeep, setAutoBackupKeep] = useState('10');

  async function exportFloor() {
    setBusy(true);
    try {
      const data = await api<any[]>('/admin/export/layout');
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `floor-layout-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      setSuccess(tr('Floor layout exported successfully.'));
    } catch (e) {
      setErr(e instanceof Error ? e.message : tr('Export failed'));
    } finally { setBusy(false); }
  }

  async function handleFloorImport(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setBusy(true);
    try {
      const text = await file.text();
      const payload = JSON.parse(text);
      if (!Array.isArray(payload)) throw new Error(tr('Floor layout file must be a JSON array of zones.'));
      const res = await api<any>('/admin/import/layout', { method: 'POST', body: payload });
      setSuccess(`${tr('Floor import complete!')} ${res.zonesCreated} ${tr('zones,')} ${res.resourcesCreated} ${tr('resources imported.')}`);
    } catch (err) {
      setErr(err instanceof Error ? err.message : tr('Import failed'));
    } finally { setBusy(false); e.target.value = ''; }
  }

  const loadBackups = useCallback(() => {
    api<{ files: string[] }>('/admin/db/backups')
      .then((res) => setBackups(res.files || []))
      .catch((e) => setErr(e instanceof Error ? e.message : tr('Failed to load backups')));
  }, []);

  useEffect(() => {
    loadBackups();
    // Load auto-backup config
    api<{ enabled: boolean; intervalHours: number; keepCount: number }>('/admin/db/auto-backup/config')
      .then((res) => {
        setAutoBackupEnabled(res.enabled);
        setAutoBackupInterval(String(res.intervalHours || 24));
        setAutoBackupKeep(String(res.keepCount || 10));
      })
      .catch((e) => setErr(e instanceof Error ? e.message : tr('Failed to load auto-backup config')));
  }, [loadBackups]);

  async function saveAutoBackupConfig() {
    setErr(''); setSuccess(''); setBusy(true);
    try {
      await api('/admin/db/auto-backup/config', {
        method: 'POST',
        body: {
          enabled: autoBackupEnabled,
          intervalHours: parseInt(autoBackupInterval, 10) || 24,
          keepCount: parseInt(autoBackupKeep, 10) || 10,
        },
      });
      setSuccess(tr('Auto-backup configuration updated successfully.'));
    } catch (e) {
      setErr(e instanceof Error ? e.message : tr('Failed to save auto-backup config'));
    } finally {
      setBusy(false);
    }
  }

  async function triggerBackup() {
    setErr(''); setSuccess(''); setBusy(true);
    try {
      const res = await api<{ files: string[] }>('/admin/db/backup', { method: 'POST' });
      setBackups(res.files || []);
      setSuccess(tr('Database backup created successfully.'));
    } catch (e) {
      setErr(e instanceof Error ? e.message : tr('Backup failed'));
    } finally {
      setBusy(false);
    }
  }

  async function triggerRestore(filename: string) {
    if (!confirm(`${tr('Are you sure you want to restore the database from')} ${filename}${tr('? Current data will be overwritten.')}`)) return;
    setErr(''); setSuccess(''); setBusy(true);
    try {
      await api('/admin/db/restore', { method: 'POST', body: { filename } });
      setSuccess(tr('Database successfully restored from backup.'));
    } catch (e) {
      setErr(e instanceof Error ? e.message : tr('Restore failed'));
    } finally {
      setBusy(false);
    }
  }

  async function triggerReset() {
    if (!confirm(tr('WARNING: This will delete ALL orders, payments, sessions, shifts, time clock entries, manual journal entries, and audit logs. Setup data (menu items, categories, printers, tables) will be kept. THIS IS IRREVERSIBLE. Proceed?'))) return;
    setErr(''); setSuccess(''); setBusy(true);
    try {
      await api('/admin/db/reset', { method: 'POST' });
      setSuccess(tr('Transaction and activity data successfully reset.'));
    } catch (e) {
      setErr(e instanceof Error ? e.message : tr('Reset failed'));
    } finally {
      setBusy(false);
    }
  }

  async function triggerEraseDemo() {
    if (!confirm(tr('CRITICAL WARNING: This will delete ALL demo assets (menu items, categories, modifier groups, ingredients, recipes, suppliers, floor zones, tables, customer profiles) AND all transaction histories. Only your system users, roles, tax rates, branch, and base Chart of Accounts structure will be preserved. THIS IS IRREVERSIBLE. Proceed?'))) return;
    if (!confirm(tr('Are you absolutely sure you want to wipe the system database? All menu configuration and sales data will be permanently deleted.'))) return;
    setErr(''); setSuccess(''); setBusy(true);
    try {
      await api('/admin/db/erase-demo', { method: 'POST' });
      setSuccess(tr('Demo assets and transactions successfully erased. The database is now clean.'));
    } catch (e) {
      setErr(e instanceof Error ? e.message : tr('Erase failed'));
    } finally {
      setBusy(false);
    }
  }

  async function exportMenu() {
    setErr(''); setSuccess('');
    try {
      const data = await api<any[]>('/admin/export/menu');
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `menu-catalog-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      setSuccess(tr('Menu catalog exported successfully.'));
    } catch (e) {
      setErr(e instanceof Error ? e.message : tr('Export failed'));
    }
  }

  async function exportCustomers() {
    setErr(''); setSuccess('');
    try {
      const data = await api<any[]>('/admin/export/customers');
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `customers-directory-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      setSuccess(tr('Customers directory exported successfully.'));
    } catch (e) {
      setErr(e instanceof Error ? e.message : tr('Export failed'));
    }
  }

  async function exportVendors() {
    setErr(''); setSuccess('');
    try {
      const data = await api<any[]>('/admin/export/vendors');
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `vendors-directory-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      setSuccess(tr('Vendors directory exported successfully.'));
    } catch (e) {
      setErr(e instanceof Error ? e.message : tr('Export failed'));
    }
  }

  async function syncVendorsFromPoster() {
    setErr(''); setSuccess(''); setBusy(true);
    try {
      const res = await api<any>('/admin/import/vendors-from-poster', { method: 'POST', body: {} });
      setSuccess(`${tr('Synced')} ${res.importedCount ?? 0} ${tr('vendors from Poster POS.')}`);
    } catch (e) {
      setErr(e instanceof Error ? e.message : tr('Sync failed'));
    } finally {
      setBusy(false);
    }
  }

  async function handleVendorImport(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setErr(''); setSuccess(''); setBusy(true);
    const reader = new FileReader();
    reader.onload = async (event) => {
      try {
        const payload = JSON.parse(event.target?.result as string);
        const res = await api<any>('/admin/import/vendors', { method: 'POST', body: payload });
        setSuccess(`${tr('Imported')} ${res.importedCount ?? 0} ${tr('vendors successfully.')}`);
      } catch (err) {
        setErr(err instanceof Error ? err.message : tr('Import failed'));
      } finally {
        setBusy(false);
        e.target.value = '';
      }
    };
    reader.readAsText(file);
  }

  async function handleImport(e: React.ChangeEvent<HTMLInputElement>, type: 'menu' | 'customers') {
    const file = e.target.files?.[0];
    if (!file) return;

    setErr(''); setSuccess(''); setBusy(true);
    const reader = new FileReader();
    
    reader.onload = async (event) => {
      try {
        const text = event.target?.result as string;
        let payload: any = null;

        if (file.name.endsWith('.json')) {
          payload = JSON.parse(text);
        } else if (file.name.endsWith('.csv')) {
          const rows = parseCsv(text);
          if (rows.length < 2) {
            throw new Error(tr('CSV file must contain a header row and at least one data row.'));
          }
          
          const headers = (rows[0] ?? []).map(h => h.toLowerCase().trim());
          const dataRows = rows.slice(1);

          if (type === 'customers') {
            const nameIdx = headers.indexOf('name');
            const phoneIdx = headers.indexOf('phone');
            const emailIdx = headers.indexOf('email');
            const bdayIdx = headers.indexOf('birthday');
            const tagsIdx = headers.indexOf('tags');
            const notesIdx = headers.indexOf('notes');

            if (nameIdx === -1 || phoneIdx === -1) {
              throw new Error(tr('Customers CSV must contain "Name" and "Phone" columns.'));
            }

            payload = dataRows.map(row => ({
              name: row[nameIdx],
              phone: row[phoneIdx],
              email: emailIdx !== -1 ? row[emailIdx] || undefined : undefined,
              birthday: bdayIdx !== -1 ? row[bdayIdx] || undefined : undefined,
              tags: tagsIdx !== -1 && row[tagsIdx] ? row[tagsIdx].split(/[,;]/).map(t => t.trim()).filter(Boolean) : [],
              notes: notesIdx !== -1 ? row[notesIdx] || undefined : undefined
            })).filter(c => c.name && c.phone);

          } else {
            // menu catalog CSV
            const catIdx = headers.indexOf('category');
            const itemIdx = headers.indexOf('item');
            const descIdx = headers.indexOf('description');
            const skuIdx = headers.indexOf('sku');
            const priceIdx = headers.indexOf('priceegp');
            const groupIdx = headers.indexOf('modifiergroup');
            const modIdx = headers.indexOf('modifier');
            const deltaIdx = headers.indexOf('pricedeltaegp');

            if (catIdx === -1 || itemIdx === -1 || priceIdx === -1) {
              throw new Error(tr('Menu CSV must contain "Category", "Item", and "PriceEGP" columns.'));
            }

            const categoriesMap: Record<string, any> = {};

            for (const row of dataRows) {
              const catName = row[catIdx];
              const itemName = row[itemIdx];
              const priceVal = row[priceIdx];
              if (!catName || !itemName) continue;

              const priceEgp = Number(priceVal);
              if (isNaN(priceEgp)) continue;

              if (!categoriesMap[catName]) {
                categoriesMap[catName] = {
                  name: catName,
                  items: []
                };
              }

              const catObj = categoriesMap[catName];
              let itemObj = catObj.items.find((it: any) => it.name === itemName);
              if (!itemObj) {
                itemObj = {
                  name: itemName,
                  sku: skuIdx !== -1 ? row[skuIdx] || undefined : undefined,
                  description: descIdx !== -1 ? row[descIdx] || undefined : undefined,
                  priceCents: Math.round(priceEgp * 100),
                  modifierGroups: []
                };
                catObj.items.push(itemObj);
              }

              const groupName = groupIdx !== -1 ? row[groupIdx] : '';
              const modName = modIdx !== -1 ? row[modIdx] : '';
              
              if (groupName && modName) {
                let groupObj = itemObj.modifierGroups.find((g: any) => g.name === groupName);
                if (!groupObj) {
                  groupObj = {
                    name: groupName,
                    minSelect: 0,
                    maxSelect: 5,
                    modifiers: []
                  };
                  itemObj.modifierGroups.push(groupObj);
                }
                
                const deltaVal = deltaIdx !== -1 ? row[deltaIdx] : '0';
                const modDeltaEgp = Number(deltaVal);
                groupObj.modifiers.push({
                  name: modName,
                  priceDeltaCents: isNaN(modDeltaEgp) ? 0 : Math.round(modDeltaEgp * 100)
                });
              }
            }

            payload = Object.values(categoriesMap);
          }
        } else {
          throw new Error(tr('Unsupported file extension. Please upload a .json or .csv file.'));
        }

        // Post to backend
        const res = await api<any>(`/admin/import/${type}`, { method: 'POST', body: payload });
        
        if (type === 'menu') {
          setSuccess(`${tr('Import complete! Created/updated')} ${res.itemsImported} ${tr('items under')} ${res.categoriesCreated} ${tr('categories.')}`);
        } else {
          setSuccess(`${tr('Import complete! Imported/updated')} ${res.importedCount} ${tr('customers.')}`);
        }
      } catch (err) {
        setErr(err instanceof Error ? err.message : tr('Import failed'));
      } finally {
        setBusy(false);
        e.target.value = ''; // Reset file input
      }
    };

    reader.readAsText(file);
  }

  return (
    <div className="max-w-2xl space-y-6">
      <h2 className="text-lg font-bold text-goblin-100">{tr('Database & Data Manager')}</h2>
      <ErrorBanner message={err} />
      {success && <p className="mb-3 rounded-lg bg-goblin-700 p-2 text-sm text-goblin-500">{success}</p>}

      <div className="rounded-xl bg-goblin-900 p-4 shadow space-y-4">
        <div>
          <h3 className="font-semibold text-goblin-50">{tr('Backup & Reset Tools')}</h3>
          <p className="text-xs text-goblin-300 mt-0.5">{tr('Manage backups and perform system wipes or resets to configure a new restaurant.')}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Btn kind="primary" onClick={triggerBackup} disabled={busy}>
            {busy ? tr('Processing...') : tr('Create Backup')}
          </Btn>
          <Btn kind="danger" onClick={triggerReset} disabled={busy}>
            {tr('Reset Transactions')}
          </Btn>
          <Btn kind="danger" onClick={triggerEraseDemo} disabled={busy}>
            {tr('Erase Demo & Reset Setup')}
          </Btn>
        </div>
      </div>

      <div className="rounded-xl bg-goblin-900 p-4 shadow space-y-4">
        <div>
          <h3 className="font-semibold text-goblin-50">{tr('Auto-Backup Scheduler')}</h3>
          <p className="text-xs text-goblin-300 mt-0.5">{tr('Configure automatic background database backups to cycle at custom intervals and rotate old files.')}</p>
        </div>
        <div className="space-y-3">
          <label className="flex items-center gap-2 text-sm text-goblin-100 font-semibold cursor-pointer">
            <input
              type="checkbox"
              checked={autoBackupEnabled}
              onChange={(e) => setAutoBackupEnabled(e.target.checked)}
              disabled={busy}
            />
            <span>{tr('Enable Cycling Auto-Backup')}</span>
          </label>

          {autoBackupEnabled && (
            <div className="grid grid-cols-2 gap-4 pl-6 border-l-2 border-goblin-800">
              <Field label={tr('Interval (Hours)')}>
                <TextInput
                  type="number"
                  value={autoBackupInterval}
                  onChange={setAutoBackupInterval}
                  disabled={busy}
                />
              </Field>
              <Field label={tr('Retention Count (Keep latest N backups)')}>
                <TextInput
                  type="number"
                  value={autoBackupKeep}
                  onChange={setAutoBackupKeep}
                  disabled={busy}
                />
              </Field>
            </div>
          )}

          <div className="pt-2">
            <Btn onClick={saveAutoBackupConfig} disabled={busy}>
              {tr('Save Auto-Backup Config')}
            </Btn>
          </div>
        </div>
      </div>

      <div className="rounded-xl bg-goblin-900 p-4 shadow space-y-3">
        <h3 className="font-semibold text-goblin-50">{tr('Available Backups')}</h3>
        <Table
          headers={[tr('Filename'), tr('Action')]}
          rows={backups.map((b) => [
            b,
            <Btn key={b} onClick={() => void triggerRestore(b)} disabled={busy}>
              {tr('Restore')}
            </Btn>,
          ])}
        />
        {backups.length === 0 && <p className="text-sm text-goblin-400">{tr('No backups found.')}</p>}
      </div>

      <div className="rounded-xl bg-goblin-900 p-4 shadow space-y-5">
        <div>
          <h3 className="font-semibold text-goblin-50">{tr('Import & Export Data')}</h3>
          <p className="text-xs text-goblin-300 mt-0.5">{tr('Import and export your Menu Catalog, Floor Layout, Customers Directory, or Vendors Directory in JSON or CSV formats.')}</p>
        </div>

        <div className="grid grid-cols-4 gap-6 pt-2 border-t divide-x divide-goblin-800">
          {/* Menu Catalog */}
          <div className="space-y-3">
            <h4 className="font-medium text-goblin-100 text-sm">{tr('Menu Catalog')}</h4>
            <div className="flex flex-col gap-2">
              <Btn onClick={exportMenu} disabled={busy}>{tr('Export Menu (JSON)')}</Btn>
              <div className="border-t pt-2 mt-1">
                <label className="block text-xs font-semibold text-goblin-400 uppercase tracking-wider mb-1">{tr('Import Menu Catalog')}</label>
                <input
                  type="file"
                  accept=".json,.csv"
                  onChange={(e) => void handleImport(e, 'menu')}
                  disabled={busy}
                  className="w-full text-xs text-goblin-300 file:mr-2 file:py-1 file:px-2 file:rounded file:border-0 file:text-xs file:font-semibold file:bg-goblin-800 file:text-goblin-100 hover:file:bg-goblin-700 cursor-pointer"
                />
                <p className="text-[10px] text-goblin-400 mt-1">{tr('Accepts JSON (nested structure) or CSV with columns: `Category, Item, Description, SKU, PriceEGP, ModifierGroup, Modifier, PriceDeltaEGP`')}</p>
              </div>
            </div>
          </div>

          {/* Floor Layout */}
          <div className="space-y-3 pl-6">
            <h4 className="font-medium text-goblin-100 text-sm">{tr('Floor Layout')}</h4>
            <div className="flex flex-col gap-2">
              <Btn onClick={exportFloor} disabled={busy}>{tr('Export Layout (JSON)')}</Btn>
              <div className="border-t pt-2 mt-1">
                <label className="block text-xs font-semibold text-goblin-400 uppercase tracking-wider mb-1">{tr('Import Floor Layout')}</label>
                <input
                  type="file"
                  accept=".json"
                  onChange={handleFloorImport}
                  disabled={busy}
                  className="w-full text-xs text-goblin-300 file:mr-2 file:py-1 file:px-2 file:rounded file:border-0 file:text-xs file:font-semibold file:bg-goblin-800 file:text-goblin-100 hover:file:bg-goblin-700 cursor-pointer"
                />
                <p className="text-[10px] text-goblin-400 mt-1">{tr('Accepts JSON or CSV with columns: `ZoneName, ZoneNameAr, ResourceName, ResourceNameAr, Type, Capacity`')}</p>
              </div>
            </div>
          </div>

          {/* Customers Directory */}
          <div className="space-y-3">
            <h4 className="font-medium text-goblin-100 text-sm">{tr('Customers Directory')}</h4>
            <div className="flex flex-col gap-2">
              <Btn onClick={exportCustomers} disabled={busy}>{tr('Export Customers (JSON)')}</Btn>
              <div className="border-t pt-2 mt-1">
                <label className="block text-xs font-semibold text-goblin-400 uppercase tracking-wider mb-1">{tr('Import Customers')}</label>
                <input
                  type="file"
                  accept=".json,.csv"
                  onChange={(e) => void handleImport(e, 'customers')}
                  disabled={busy}
                  className="w-full text-xs text-goblin-300 file:mr-2 file:py-1 file:px-2 file:rounded file:border-0 file:text-xs file:font-semibold file:bg-goblin-800 file:text-goblin-100 hover:file:bg-goblin-700 cursor-pointer"
                />
                <p className="text-[10px] text-goblin-400 mt-1">{tr('Accepts JSON or CSV with columns: `Name, Phone, Email, Birthday, Tags, Notes` (Tags split by comma)')}</p>
              </div>
            </div>
          </div>

          {/* Vendors Directory */}
          <div className="space-y-3 pl-6">
            <h4 className="font-medium text-goblin-100 text-sm">{tr('Vendors Directory')}</h4>
            <div className="flex flex-col gap-2">
              <Btn onClick={exportVendors} disabled={busy}>{tr('Export Vendors (JSON)')}</Btn>
              <Btn onClick={syncVendorsFromPoster} disabled={busy}>{tr('Sync from Poster POS')}</Btn>
              <div className="border-t pt-2 mt-1">
                <label className="block text-xs font-semibold text-goblin-400 uppercase tracking-wider mb-1">{tr('Import Vendors')}</label>
                <input
                  type="file"
                  accept=".json"
                  onChange={handleVendorImport}
                  disabled={busy}
                  className="w-full text-xs text-goblin-300 file:mr-2 file:py-1 file:px-2 file:rounded file:border-0 file:text-xs file:font-semibold file:bg-goblin-800 file:text-goblin-100 hover:file:bg-goblin-700 cursor-pointer"
                />
                <p className="text-[10px] text-goblin-400 mt-1">{tr('Accepts JSON with vendor records from export or Poster POS format.')}</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------- payment methods ----------

interface PaymentMethod {
  id: string;
  name: string;
  nameAr?: string | null;
  kind: 'CASH' | 'CARD' | 'WALLET' | 'LOYALTY_POINTS' | 'OTHER';
  opensDrawer: boolean;
  isActive: boolean;
  sortOrder: number;
  accountId?: string | null;
  account?: { name: string; code: string } | null;
}

const PAY_KINDS = [
  { value: 'CASH', label: tr('Cash (كاش)') },
  { value: 'CARD', label: tr('Card (بطاقة)') },
  { value: 'WALLET', label: tr('Mobile Wallet (محفظة)') },
  { value: 'LOYALTY_POINTS', label: tr('Loyalty Points (نقاط)') },
  { value: 'OTHER', label: tr('Other (أخرى)') },
];

function PaymentMethods() {
  const { data: methods, error, reload } = useLoad(() => api<PaymentMethod[]>('/admin/payment-methods'));
  const [createOpen, setCreateOpen] = useState(false);
  const [editingMethod, setEditingMethod] = useState<PaymentMethod | null>(null);
  const [err, setErr] = useState('');

  async function deleteMethod(id: string) {
    if (!confirm(tr('Are you sure you want to delete this payment method?'))) return;
    setErr('');
    try {
      await api(`/admin/payment-methods/${id}`, { method: 'DELETE' });
      reload();
    } catch (e) {
      setErr(e instanceof Error ? e.message : tr('Delete failed'));
    }
  }

  if (error) return <p className="p-8 text-red-600">{error}</p>;
  return (
    <div>
      <ErrorBanner message={err} />
      <div className="mb-3 flex items-center justify-between">
        <div>
          <h2 className="text-lg font-bold text-goblin-100">{tr('Payment Methods')}</h2>
          <p className="text-xs text-goblin-400 font-normal">{tr('Manage payment options accepted at the POS.')}</p>
        </div>
        <Btn kind="primary" onClick={() => { setEditingMethod(null); setCreateOpen(true); }}>{tr('+ New Payment Method')}</Btn>
      </div>
      <Table headers={[tr('Name (EN)'), tr('Name (AR)'), tr('Type (Kind)'), tr('Linked Account'), tr('Opens Drawer'), tr('Status'), tr('Sort Order'), tr('Actions')]}
        rows={(methods ?? []).map((m) => [
          m.name,
          m.nameAr || '—',
          m.kind,
          m.account ? `${m.account.name} (${m.account.code})` : '—',
          m.opensDrawer ? 'Yes' : 'No',
          m.isActive ? <span className="text-goblin-500 font-semibold">{tr('Active')}</span> : <span className="text-goblin-400">{tr('Inactive')}</span>,
          String(m.sortOrder),
          <div key={m.id} className="flex gap-2">
            <Btn onClick={() => { setEditingMethod(m); setCreateOpen(true); }}>{tr('Edit')}</Btn>
            <Btn kind="danger" onClick={() => void deleteMethod(m.id)}>{tr('Delete')}</Btn>
          </div>,
        ])} />
      {createOpen && (
        <PaymentMethodFormModal
          method={editingMethod}
          onClose={() => setCreateOpen(false)}
          onDone={() => { setCreateOpen(false); reload(); }}
        />
      )}
    </div>
  );
}

function PaymentMethodFormModal({ onClose, onDone, method }: { onClose: () => void; onDone: () => void; method?: PaymentMethod | null }) {
  const [name, setName] = useState(method?.name ?? '');
  const [nameAr, setNameAr] = useState(method?.nameAr ?? '');
  const [kind, setKind] = useState<any>(method?.kind ?? 'CASH');
  const [opensDrawer, setOpensDrawer] = useState(method?.opensDrawer ?? false);
  const [isActive, setIsActive] = useState(method?.isActive ?? true);
  const [sortOrder, setSortOrder] = useState(String(method?.sortOrder ?? '0'));
  const [accountId, setAccountId] = useState(method?.accountId ?? '');
  const [err, setErr] = useState('');

  const { data: accounts } = useLoad(() => api<any[]>('/accounting/accounts'));
  const sourceAccounts = accounts
    ? flattenAccounts(accounts).filter((a) => {
        if (!a.isPaymentSource) return false;
        const isCash = a.code.startsWith('11');
        return kind === 'CASH' ? isCash : !isCash;
      })
    : [];

  async function submit() {
    if (!name.trim()) { setErr(tr('Name is required')); return; }
    setErr('');
    const body = {
      name: name.trim(),
      nameAr: nameAr.trim() || null,
      kind,
      opensDrawer,
      isActive,
      sortOrder: parseInt(sortOrder, 10) || 0,
      accountId: accountId || null,
    };
    try {
      if (method) {
        await api(`/admin/payment-methods/${method.id}`, { method: 'PATCH', body });
      } else {
        await api('/admin/payment-methods', { method: 'POST', body });
      }
      onDone();
    } catch (e) {
      setErr(e instanceof Error ? e.message : tr('Save failed'));
    }
  }

  return (
    <Modal title={method ? tr('Edit Payment Method') : tr('New Payment Method')} onClose={onClose}>
      <ErrorBanner message={err} />
      <div className="space-y-4">
        <Field label={tr('Name (English)')}><TextInput value={name} onChange={setName} /></Field>
        <Field label={tr('Name (Arabic - Optional)')}><TextInput value={nameAr} onChange={setNameAr} /></Field>
        <Field label={tr('Type (Kind)')}>
          <Select value={kind} onChange={setKind} options={PAY_KINDS} />
        </Field>
        <Field label={tr('Linked Ledger Account (Payment Source)')}>
          <Select
            value={accountId}
            onChange={setAccountId}
            options={[
              { value: '', label: tr('None (Use default cash/bank)') },
              ...sourceAccounts
            ]}
          />
        </Field>
        <div className="flex flex-col gap-2 rounded-lg border border-goblin-800 p-3 bg-goblin-800">
          <label className="flex items-center gap-2 text-sm text-goblin-100 font-semibold cursor-pointer">
            <input type="checkbox" checked={opensDrawer} onChange={(e) => setOpensDrawer(e.target.checked)} />
            <span>{tr('Opens Cash Drawer')}</span>
          </label>
          <label className="flex items-center gap-2 text-sm text-goblin-100 font-semibold cursor-pointer mt-1">
            <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} />
            <span>{tr('Active (Available in POS)')}</span>
          </label>
        </div>
        <Field label={tr('Sort Order')}><TextInput type="number" value={sortOrder} onChange={setSortOrder} /></Field>
        <div className="flex justify-end gap-2 pt-2">
          <Btn onClick={onClose}>{tr('Cancel')}</Btn>
          <Btn kind="primary" onClick={() => void submit()}>{method ? tr('Save') : tr('Create')}</Btn>
        </div>
      </div>
    </Modal>
  );
}

function flattenAccounts(nodes: any[], prefix = ''): { value: string; label: string; isPaymentSource: boolean; code: string; balanceCents: number }[] {
  const list: any[] = [];
  for (const n of nodes) {
    list.push({ value: n.id, label: `${prefix}${n.name} (${n.code}) (${(n.balanceCents / 100).toFixed(2)} ${tr('EGP)')}`, isPaymentSource: n.isPaymentSource, code: n.code, balanceCents: n.balanceCents });
    if (n.subAccounts && n.subAccounts.length > 0) {
      list.push(...flattenAccounts(n.subAccounts, prefix + '  '));
    }
  }
  return list;
}
