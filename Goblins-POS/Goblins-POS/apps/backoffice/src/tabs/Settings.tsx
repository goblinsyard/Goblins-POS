import { useCallback, useEffect, useState } from 'react';
import { api } from '../lib/api';
import { Btn, ErrorBanner, Field, Modal, Pills, Select, Spinner, Table, TextInput, useLoad } from '../lib/ui';

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

  async function exportFloor() {
    setBusy(true);
    try {
      const data = await api<any[]>('/admin/export/floor');
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `floor-layout-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      setSuccess('Floor layout exported successfully.');
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Export failed');
    } finally { setBusy(false); }
  }

  async function handleFloorImport(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setBusy(true);
    try {
      const text = await file.text();
      const payload = JSON.parse(text);
      if (!Array.isArray(payload)) throw new Error('Floor layout file must be a JSON array of zones.');
      const res = await api<any>('/admin/import/floor', { method: 'POST', body: payload });
      setSuccess(`Floor import complete! ${res.zonesCreated} zones, ${res.resourcesCreated} resources imported.`);
    } catch (err) {
      setErr(err instanceof Error ? err.message : 'Import failed');
    } finally { setBusy(false); e.target.value = ''; }
  }

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
  const keys = Object.keys(settings).filter((k) => !hiddenKeys.includes(k)).sort();
  const dirtyKeys = keys.filter((k) => draft[k] !== undefined && draft[k] !== String(settings[k]));

  async function save() {
    setErr(''); setSaved(false);
    const body: Record<string, unknown> = {};
    for (const k of dirtyKeys) {
      const original = settings![k];
      const raw = draft[k];
      if (typeof original === 'number') {
        const n = Number(raw);
        if (!Number.isFinite(n)) { setErr(`${k} must be a number`); return; }
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
    } catch (e) { setErr(e instanceof Error ? e.message : 'Failed'); }
  }

  return (
    <div className="max-w-2xl">
      <ErrorBanner message={err} />
      {saved && <p className="mb-3 rounded-lg bg-emerald-100 p-2 text-sm text-emerald-700">Settings saved.</p>}
      <div className="overflow-hidden rounded-xl bg-white shadow">
        <table className="w-full text-sm">
          <tbody>
            {keys.map((k) => {
              const original = settings[k];
              return (
                <tr key={k} className="border-t first:border-0">
                  <td className="p-3 font-mono text-xs text-slate-500">{k}</td>
                  <td className="p-3">
                    {typeof original === 'boolean' ? (
                      <select value={draft[k] ?? 'false'}
                        onChange={(e) => setDraft((c) => ({ ...c, [k]: e.target.value }))}
                        className="rounded-lg border border-slate-300 bg-white p-1.5">
                        <option value="true">true</option>
                        <option value="false">false</option>
                      </select>
                    ) : (
                      <input value={draft[k] ?? ''} dir="auto"
                        type={typeof original === 'number' ? 'number' : 'text'}
                        onChange={(e) => setDraft((c) => ({ ...c, [k]: e.target.value }))}
                        className="w-full rounded-lg border border-slate-300 p-1.5" />
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
          Save{dirtyKeys.length ? ` (${dirtyKeys.length})` : ''}
        </Btn>
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
    } catch (e) { setErr(e instanceof Error ? e.message : 'Failed'); }
  }

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <div className="space-y-4">
        <h2 className="text-lg font-bold text-slate-700">Receipt Design & Layout</h2>
        <ErrorBanner message={err} />
        {saved && <p className="rounded-lg bg-emerald-100 p-2 text-sm text-emerald-700">Receipt settings saved.</p>}
        
        <LogoSection current={(settings['receipt.logo'] as string) || ''} onSaved={reload} />

        <div className="rounded-xl bg-white p-4 shadow space-y-3">
          <Field label="Header Title (EN)"><TextInput value={draft['receipt.header'] ?? ''} onChange={(v) => setDraft(c => ({ ...c, 'receipt.header': v }))} /></Field>
          <Field label="Header Title (Arabic)"><TextInput value={draft['receipt.headerAr'] ?? ''} onChange={(v) => setDraft(c => ({ ...c, 'receipt.headerAr': v }))} /></Field>
          <Field label="Footer Note (EN)"><TextInput value={draft['receipt.footer'] ?? ''} onChange={(v) => setDraft(c => ({ ...c, 'receipt.footer': v }))} /></Field>
          <Field label="Footer Note (Arabic)"><TextInput value={draft['receipt.footerAr'] ?? ''} onChange={(v) => setDraft(c => ({ ...c, 'receipt.footerAr': v }))} /></Field>
          
          <div className="grid grid-cols-2 gap-3">
            <Field label="Font Size">
              <Select value={draft['receipt.fontSize'] ?? 'normal'} onChange={(v) => setDraft(c => ({ ...c, 'receipt.fontSize': v }))}
                options={[{ value: 'normal', label: 'Normal' }, { value: 'large', label: 'Large (Header & Footer)' }]} />
            </Field>
            <Field label="QR Code Text">
              <TextInput value={draft['receipt.qrCodeText'] ?? ''} onChange={(v) => setDraft(c => ({ ...c, 'receipt.qrCodeText': v }))} disabled={!draft['receipt.showQrCode']} />
            </Field>
          </div>

          <div className="space-y-2 pt-2">
            <label className="flex items-center gap-2 text-sm text-slate-600">
              <input type="checkbox" checked={draft['receipt.showTaxSummary'] ?? false} onChange={(e) => setDraft(c => ({ ...c, 'receipt.showTaxSummary': e.target.checked }))} />
              Show detailed Tax (VAT & Service Charge) breakdown
            </label>
            <label className="flex items-center gap-2 text-sm text-slate-600">
              <input type="checkbox" checked={draft['receipt.showLoyalty'] ?? false} onChange={(e) => setDraft(c => ({ ...c, 'receipt.showLoyalty': e.target.checked }))} />
              Show Customer Loyalty tiers and point balances
            </label>
            <label className="flex items-center gap-2 text-sm text-slate-600">
              <input type="checkbox" checked={draft['receipt.showQrCode'] ?? false} onChange={(e) => setDraft(c => ({ ...c, 'receipt.showQrCode': e.target.checked }))} />
              Show QR Code at the bottom of the receipt
            </label>
          </div>
        </div>

        <Btn kind="primary" onClick={() => void save()} disabled={!isDirty}>
          Save Layout
        </Btn>
      </div>

      {/* Live Preview Column */}
      <div className="flex flex-col items-center">
        <h3 className="mb-2 font-semibold text-slate-500 uppercase text-xs tracking-wider">Live Mock Preview</h3>
        <div className="w-[300px] border border-dashed border-slate-300 rounded-2xl bg-[#fafafa] p-4 text-black shadow-inner font-mono text-xs leading-snug">
          {settings['receipt.logo'] && (
            <img src={settings['receipt.logo'] as string} alt="Receipt Logo" className="mx-auto mb-3 max-h-12 border rounded bg-white p-0.5" />
          )}
          
          <div className="text-center">
            <div className={draft['receipt.fontSize'] === 'large' ? 'font-bold text-sm' : ''}>
              {draft['receipt.header'] || 'Goblins Yard'}
            </div>
            {draft['receipt.headerAr'] && (
              <div className={draft['receipt.fontSize'] === 'large' ? 'font-bold text-sm' : ''}>
                {draft['receipt.headerAr']}
              </div>
            )}
            <div className="text-slate-400">{String(settings['business.address'] || '123 Nile Street, Zamalek, Cairo')}</div>
            <div className="text-slate-400">Tax ID: {String(settings['business.taxId'] || '123-456-789')}</div>
          </div>
          
          <div className="my-2 border-t border-dashed border-slate-300"></div>
          
          <div className="flex justify-between">
            <span>Order #1234</span>
            <span>DINE IN</span>
          </div>
          <div className="flex justify-between">
            <span>Table: T1</span>
            <span>Server: Hassan</span>
          </div>
          
          <div className="my-2 border-t border-dashed border-slate-300"></div>
          
          <div className="flex justify-between">
            <span>1 x Virgin Mojito</span>
            <span>85.00 EGP</span>
          </div>
          <div className="flex justify-between">
            <span>1 x Pizza Margherita</span>
            <span>160.00 EGP</span>
          </div>
          
          <div className="my-2 border-t border-dashed border-slate-300"></div>
          
          <div className="flex justify-between font-bold">
            <span>Subtotal</span>
            <span>245.00 EGP</span>
          </div>
          {draft['receipt.showTaxSummary'] && (
            <>
              <div className="flex justify-between">
                <span>Service (12%)</span>
                <span>29.40 EGP</span>
              </div>
              <div className="flex justify-between">
                <span>VAT (14%)</span>
                <span>38.42 EGP</span>
              </div>
            </>
          )}
          
          <div className="my-1 border-t border-slate-300"></div>
          <div className="flex justify-between font-bold">
            <span>TOTAL</span>
            <span>{draft['receipt.showTaxSummary'] ? '312.82 EGP' : '245.00 EGP'}</span>
          </div>
          <div className="my-1 border-t border-slate-300"></div>
          
          {draft['receipt.showLoyalty'] && (
            <div className="text-center text-slate-500 my-2 pt-1 border-t border-dashed border-slate-200">
              <div>Loyalty Tier: Goblin King</div>
              <div>Points Balance: 125 pts</div>
            </div>
          )}
          
          <div className="text-center mt-3">
            <div className={draft['receipt.fontSize'] === 'large' ? 'font-bold text-sm' : ''}>
              {draft['receipt.footer'] || 'Thank you! See you soon'}
            </div>
            {draft['receipt.footerAr'] && (
              <div className={draft['receipt.fontSize'] === 'large' ? 'font-bold text-sm' : ''}>
                {draft['receipt.footerAr']}
              </div>
            )}
          </div>

          {draft['receipt.showQrCode'] && (
            <div className="mt-3 border-t border-dashed border-slate-200 pt-3 flex flex-col items-center">
              <div className="w-16 h-16 bg-slate-200 flex items-center justify-center text-[10px] text-slate-500">QR Code</div>
              <div className="text-[9px] text-slate-400 mt-1 max-w-[150px] truncate">{draft['receipt.qrCodeText']}</div>
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
    if (file.size > 300 * 1024) { setErr('Keep the logo under 300 KB (small PNG works best on receipts)'); return; }
    const reader = new FileReader();
    reader.onload = () => {
      void (async () => {
        setBusy(true);
        try {
          await api('/settings', { method: 'PUT', body: { 'receipt.logo': reader.result as string } });
          onSaved();
        } catch (e) { setErr(e instanceof Error ? e.message : 'Failed'); }
        finally { setBusy(false); }
      })();
    };
    reader.readAsDataURL(file);
  }

  async function remove() {
    setBusy(true);
    try { await api('/settings', { method: 'PUT', body: { 'receipt.logo': '' } }); onSaved(); }
    catch (e) { setErr(e instanceof Error ? e.message : 'Failed'); }
    finally { setBusy(false); }
  }

  return (
    <div className="mt-6 rounded-xl bg-white p-4 shadow">
      <h2 className="mb-2 font-semibold text-slate-700">Receipt logo</h2>
      <ErrorBanner message={err} />
      {current ? (
        <div className="mb-3 flex items-center gap-4">
          <img src={current} alt="Receipt logo" className="max-h-24 rounded border border-slate-200 bg-white p-1" />
          <Btn kind="danger" onClick={() => void remove()} disabled={busy}>Remove</Btn>
        </div>
      ) : (
        <p className="mb-3 text-sm text-slate-400">No logo yet.</p>
      )}
      <label className="inline-block cursor-pointer rounded-lg bg-emerald-700 px-3 py-1.5 text-sm text-white hover:bg-emerald-800">
        {busy ? 'Uploading…' : 'Upload logo'}
        <input type="file" accept="image/png,image/jpeg,image/svg+xml" className="hidden"
          onChange={(e) => pick(e.target.files?.[0])} />
      </label>
      <p className="mt-2 text-xs text-slate-400">
        Shown at the top of receipts on screen and in browser printing. Thermal ESC/POS printers print text only for now — logo raster printing is a future print-service upgrade.
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
      setMsg(`Test sent (${r.mode}) — check the printer / preview window.`);
    } catch (e) { setMsg(e instanceof Error ? e.message : 'Failed'); }
  }

  async function deletePrinter(id: string) {
    if (!confirm('Are you sure you want to delete this printer?')) return;
    try {
      await api(`/admin/printers/${id}`, { method: 'DELETE' });
      reload();
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Delete failed');
    }
  }

  if (error) return <p className="p-8 text-red-600">{error}</p>;
  return (
    <div>
      <div className="mb-3 flex items-center gap-3">
        <Btn kind="primary" onClick={() => { setEditingPrinter(null); setCreateOpen(true); }}>+ New printer</Btn>
        {msg && <span className="text-sm text-slate-500">{msg}</span>}
      </div>
      <Table headers={['Name', 'Connection', 'Address', 'Paper', 'Used by', 'Actions']}
        rows={(printers ?? []).map((p) => [
          p.name, p.connection, p.address, `${p.paperWidth}mm`,
          p.stations.map((s) => s.name).join(', ') || '—',
          <div key={p.id} className="flex gap-2">
            <Btn onClick={() => void test(p.id)}>Test</Btn>
            <Btn onClick={() => { setEditingPrinter(p); setCreateOpen(true); }}>Edit</Btn>
            <Btn kind="danger" onClick={() => void deletePrinter(p.id)}>Delete</Btn>
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
    if (!name.trim() || !address.trim()) { setErr('Name and address are required'); return; }
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
    } catch (e) { setErr(e instanceof Error ? e.message : 'Failed'); }
  }

  return (
    <Modal title={printer ? "Edit printer" : "New printer"} onClose={onClose}>
      <ErrorBanner message={err} />
      <div className="space-y-3">
        <Field label="Name"><TextInput value={name} onChange={setName} /></Field>
        <Field label="Connection">
          <Select value={connection} onChange={(v) => {
            setConnection(v as typeof connection);
            if (v === 'PREVIEW') setAddress('preview');
          }}
            options={['NETWORK', 'USB', 'PREVIEW'].map((c) => ({ value: c, label: c }))} />
        </Field>
        <Field label={connection === 'NETWORK' ? 'Address (ip:port, ESC/POS TCP 9100)' : 'Address'}>
          <TextInput value={address} onChange={setAddress} />
        </Field>
        <Field label="Paper width (mm)">
          <Select value={paperWidth} onChange={setPaperWidth}
            options={['58', '80'].map((w) => ({ value: w, label: `${w}mm` }))} />
        </Field>
        <Btn kind="primary" onClick={() => void submit()}>{printer ? "Save" : "Create"}</Btn>
      </div>
    </Modal>
  );
}

// ---------- stations ----------

function Stations() {
  const { data: stations, error, reload } = useLoad(() => api<Station[]>('/kds/stations'));
  const { data: printers } = useLoad(() => api<Printer[]>('/admin/printers'));
  const [err, setErr] = useState('');

  async function patch(id: string, body: Record<string, unknown>) {
    setErr('');
    try { await api(`/admin/stations/${id}`, { method: 'PATCH', body }); reload(); }
    catch (e) { setErr(e instanceof Error ? e.message : 'Failed'); }
  }

  if (error) return <p className="p-8 text-red-600">{error}</p>;
  return (
    <div>
      <ErrorBanner message={err} />
      <div className="overflow-hidden rounded-xl bg-white shadow">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-slate-500">
            <tr><th className="p-3">Station</th><th className="p-3">Kind</th><th className="p-3">Printer</th><th className="p-3">KDS screen</th><th className="p-3">Print tickets</th></tr>
          </thead>
          <tbody>
            {(stations ?? []).map((s) => (
              <tr key={s.id} className="border-t">
                <td className="p-3 font-semibold text-slate-700">{s.name}</td>
                <td className="p-3">{s.kind}</td>
                <td className="p-3">
                  <select value={s.printerId ?? ''}
                    onChange={(e) => void patch(s.id, { printerId: e.target.value || null })}
                    className="rounded-lg border border-slate-300 bg-white p-1.5">
                    <option value="">— none —</option>
                    {(printers ?? []).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </select>
                </td>
                <td className="p-3">
                  <input type="checkbox" checked={s.useKds} onChange={(e) => void patch(s.id, { useKds: e.target.checked })} />
                </td>
                <td className="p-3">
                  <input type="checkbox" checked={s.usePrinter} onChange={(e) => void patch(s.id, { usePrinter: e.target.checked })} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
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

  const loadBackups = useCallback(() => {
    api<{ files: string[] }>('/admin/db/backups')
      .then((res) => setBackups(res.files || []))
      .catch((e) => setErr(e instanceof Error ? e.message : 'Failed to load backups'));
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
      .catch((e) => setErr(e instanceof Error ? e.message : 'Failed to load auto-backup config'));
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
      setSuccess('Auto-backup configuration updated successfully.');
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed to save auto-backup config');
    } finally {
      setBusy(false);
    }
  }

  async function triggerBackup() {
    setErr(''); setSuccess(''); setBusy(true);
    try {
      const res = await api<{ files: string[] }>('/admin/db/backup', { method: 'POST' });
      setBackups(res.files || []);
      setSuccess('Database backup created successfully.');
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Backup failed');
    } finally {
      setBusy(false);
    }
  }

  async function triggerRestore(filename: string) {
    if (!confirm(`Are you sure you want to restore the database from ${filename}? Current data will be overwritten.`)) return;
    setErr(''); setSuccess(''); setBusy(true);
    try {
      await api('/admin/db/restore', { method: 'POST', body: { filename } });
      setSuccess('Database successfully restored from backup.');
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Restore failed');
    } finally {
      setBusy(false);
    }
  }

  async function triggerReset() {
    if (!confirm('WARNING: This will delete ALL orders, payments, sessions, shifts, time clock entries, manual journal entries, and audit logs. Setup data (menu items, categories, printers, tables) will be kept. THIS IS IRREVERSIBLE. Proceed?')) return;
    setErr(''); setSuccess(''); setBusy(true);
    try {
      await api('/admin/db/reset', { method: 'POST' });
      setSuccess('Transaction and activity data successfully reset.');
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Reset failed');
    } finally {
      setBusy(false);
    }
  }

  async function triggerEraseDemo() {
    if (!confirm('CRITICAL WARNING: This will delete ALL demo assets (menu items, categories, modifier groups, ingredients, recipes, suppliers, floor zones, tables, customer profiles) AND all transaction histories. Only your system users, roles, tax rates, branch, and base Chart of Accounts structure will be preserved. THIS IS IRREVERSIBLE. Proceed?')) return;
    if (!confirm('Are you absolutely sure you want to wipe the system database? All menu configuration and sales data will be permanently deleted.')) return;
    setErr(''); setSuccess(''); setBusy(true);
    try {
      await api('/admin/db/erase-demo', { method: 'POST' });
      setSuccess('Demo assets and transactions successfully erased. The database is now clean.');
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Erase failed');
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
      a.click();
      setSuccess('Menu catalog exported successfully.');
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Export failed');
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
      a.click();
      setSuccess('Customers directory exported successfully.');
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Export failed');
    }
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
            throw new Error('CSV file must contain a header row and at least one data row.');
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
              throw new Error('Customers CSV must contain "Name" and "Phone" columns.');
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
              throw new Error('Menu CSV must contain "Category", "Item", and "PriceEGP" columns.');
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
          throw new Error('Unsupported file extension. Please upload a .json or .csv file.');
        }

        // Post to backend
        const res = await api<any>(`/admin/import/${type}`, { method: 'POST', body: payload });
        
        if (type === 'menu') {
          setSuccess(`Import complete! Created/updated ${res.itemsImported} items under ${res.categoriesCreated} categories.`);
        } else {
          setSuccess(`Import complete! Imported/updated ${res.importedCount} customers.`);
        }
      } catch (err) {
        setErr(err instanceof Error ? err.message : 'Import failed');
      } finally {
        setBusy(false);
        e.target.value = ''; // Reset file input
      }
    };

    reader.readAsText(file);
  }

  return (
    <div className="max-w-2xl space-y-6">
      <h2 className="text-lg font-bold text-slate-700">Database & Data Manager</h2>
      <ErrorBanner message={err} />
      {success && <p className="mb-3 rounded-lg bg-emerald-100 p-2 text-sm text-emerald-700">{success}</p>}

      <div className="rounded-xl bg-white p-4 shadow space-y-4">
        <div>
          <h3 className="font-semibold text-slate-800">Backup & Reset Tools</h3>
          <p className="text-xs text-slate-500 mt-0.5">Manage backups and perform system wipes or resets to configure a new restaurant.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Btn kind="primary" onClick={triggerBackup} disabled={busy}>
            {busy ? 'Processing...' : 'Create Backup'}
          </Btn>
          <Btn kind="danger" onClick={triggerReset} disabled={busy}>
            Reset Transactions
          </Btn>
          <Btn kind="danger" onClick={triggerEraseDemo} disabled={busy}>
            Erase Demo & Reset Setup
          </Btn>
        </div>
      </div>

      <div className="rounded-xl bg-white p-4 shadow space-y-4">
        <div>
          <h3 className="font-semibold text-slate-800">Auto-Backup Scheduler</h3>
          <p className="text-xs text-slate-500 mt-0.5">Configure automatic background database backups to cycle at custom intervals and rotate old files.</p>
        </div>
        <div className="space-y-3">
          <label className="flex items-center gap-2 text-sm text-slate-700 font-semibold cursor-pointer">
            <input
              type="checkbox"
              checked={autoBackupEnabled}
              onChange={(e) => setAutoBackupEnabled(e.target.checked)}
              disabled={busy}
            />
            <span>Enable Cycling Auto-Backup</span>
          </label>

          {autoBackupEnabled && (
            <div className="grid grid-cols-2 gap-4 pl-6 border-l-2 border-slate-100">
              <Field label="Interval (Hours)">
                <TextInput
                  type="number"
                  value={autoBackupInterval}
                  onChange={setAutoBackupInterval}
                  disabled={busy}
                />
              </Field>
              <Field label="Retention Count (Keep latest N backups)">
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
              Save Auto-Backup Config
            </Btn>
          </div>
        </div>
      </div>

      <div className="rounded-xl bg-white p-4 shadow space-y-3">
        <h3 className="font-semibold text-slate-800">Available Backups</h3>
        <Table
          headers={['Filename', 'Action']}
          rows={backups.map((b) => [
            b,
            <Btn key={b} onClick={() => void triggerRestore(b)} disabled={busy}>
              Restore
            </Btn>,
          ])}
        />
        {backups.length === 0 && <p className="text-sm text-slate-400">No backups found.</p>}
      </div>

      <div className="rounded-xl bg-white p-4 shadow space-y-5">
        <div>
          <h3 className="font-semibold text-slate-800">Import & Export Data</h3>
          <p className="text-xs text-slate-500 mt-0.5">Import and export your Menu Catalog or Customers Directory in JSON or CSV formats.</p>
        </div>

        <div className="grid grid-cols-2 gap-6 pt-2 border-t divide-x divide-slate-100">
          {/* Menu Catalog */}
          <div className="space-y-3">
            <h4 className="font-medium text-slate-700 text-sm">Menu Catalog</h4>
            <div className="flex flex-col gap-2">
              <Btn onClick={exportMenu} disabled={busy}>Export Menu (JSON)</Btn>
              
              <div className="border-t pt-2 mt-1">
                <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1">Import Menu Catalog</label>
                <input
                  type="file"
                  accept=".json,.csv"
                  onChange={(e) => void handleImport(e, 'menu')}
                  disabled={busy}
                  className="w-full text-xs text-slate-500 file:mr-2 file:py-1 file:px-2 file:rounded file:border-0 file:text-xs file:font-semibold file:bg-slate-100 file:text-slate-700 hover:file:bg-slate-200 cursor-pointer"
                />
                <p className="text-[10px] text-slate-400 mt-1">Accepts JSON (nested structure) or CSV with columns: `Category, Item, Description, SKU, PriceEGP, ModifierGroup, Modifier, PriceDeltaEGP`</p>
              </div>
            </div>
          </div>

          {/* Customers Directory */}
          <div className="space-y-3 pl-6">
            <h4 className="font-medium text-slate-700 text-sm">Customers Directory</h4>
            <div className="flex flex-col gap-2">
              <Btn onClick={exportCustomers} disabled={busy}>Export Customers (JSON)</Btn>
              
              <div className="border-t pt-2 mt-1">
                <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1">Import Customers</label>
                <input
                  type="file"
                  accept=".json,.csv"
                  onChange={(e) => void handleImport(e, 'customers')}
                  disabled={busy}
                  className="w-full text-xs text-slate-500 file:mr-2 file:py-1 file:px-2 file:rounded file:border-0 file:text-xs file:font-semibold file:bg-slate-100 file:text-slate-700 hover:file:bg-slate-200 cursor-pointer"
                />
                <p className="text-[10px] text-slate-400 mt-1">Accepts JSON or CSV with columns: `Name, Phone, Email, Birthday, Tags, Notes` (Tags split by comma)</p>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="rounded-xl bg-white p-4 shadow space-y-5">
        <div>
          <h3 className="font-semibold text-slate-800">Floor Layout & Tables</h3>
          <p className="text-xs text-slate-500 mt-0.5">Export or import your full floor plan — zones, tables, billiards tables, and rooms — as a JSON file.</p>
        </div>
        <div className="flex flex-wrap gap-3 pt-2 border-t">
          <Btn onClick={exportFloor} disabled={busy}>Export Floor Layout (JSON)</Btn>
          <div>
            <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1">Import Floor Layout</label>
            <input
              type="file"
              accept=".json"
              onChange={handleFloorImport}
              disabled={busy}
              className="w-full text-xs text-slate-500 file:mr-2 file:py-1 file:px-2 file:rounded file:border-0 file:text-xs file:font-semibold file:bg-slate-100 file:text-slate-700 hover:file:bg-slate-200 cursor-pointer"
            />
            <p className="text-[10px] text-slate-400 mt-1">Warning: importing will ADD zones/resources on top of existing ones.</p>
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
  { value: 'CASH', label: 'Cash (كاش)' },
  { value: 'CARD', label: 'Card (بطاقة)' },
  { value: 'WALLET', label: 'Mobile Wallet (محفظة)' },
  { value: 'LOYALTY_POINTS', label: 'Loyalty Points (نقاط)' },
  { value: 'OTHER', label: 'Other (أخرى)' },
];

function PaymentMethods() {
  const { data: methods, error, reload } = useLoad(() => api<PaymentMethod[]>('/admin/payment-methods'));
  const [createOpen, setCreateOpen] = useState(false);
  const [editingMethod, setEditingMethod] = useState<PaymentMethod | null>(null);
  const [err, setErr] = useState('');

  async function deleteMethod(id: string) {
    if (!confirm('Are you sure you want to delete this payment method?')) return;
    setErr('');
    try {
      await api(`/admin/payment-methods/${id}`, { method: 'DELETE' });
      reload();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Delete failed');
    }
  }

  if (error) return <p className="p-8 text-red-600">{error}</p>;
  return (
    <div>
      <ErrorBanner message={err} />
      <div className="mb-3 flex items-center justify-between">
        <div>
          <h2 className="text-lg font-bold text-slate-700">Payment Methods</h2>
          <p className="text-xs text-slate-400 font-normal">Manage payment options accepted at the POS.</p>
        </div>
        <Btn kind="primary" onClick={() => { setEditingMethod(null); setCreateOpen(true); }}>+ New Payment Method</Btn>
      </div>
      <Table headers={['Name (EN)', 'Name (AR)', 'Type (Kind)', 'Linked Account', 'Opens Drawer', 'Status', 'Sort Order', 'Actions']}
        rows={(methods ?? []).map((m) => [
          m.name,
          m.nameAr || '—',
          m.kind,
          m.account ? `${m.account.name} (${m.account.code})` : '—',
          m.opensDrawer ? 'Yes' : 'No',
          m.isActive ? <span className="text-emerald-700 font-semibold">Active</span> : <span className="text-slate-400">Inactive</span>,
          String(m.sortOrder),
          <div key={m.id} className="flex gap-2">
            <Btn onClick={() => { setEditingMethod(m); setCreateOpen(true); }}>Edit</Btn>
            <Btn kind="danger" onClick={() => void deleteMethod(m.id)}>Delete</Btn>
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
    if (!name.trim()) { setErr('Name is required'); return; }
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
      setErr(e instanceof Error ? e.message : 'Save failed');
    }
  }

  return (
    <Modal title={method ? "Edit Payment Method" : "New Payment Method"} onClose={onClose}>
      <ErrorBanner message={err} />
      <div className="space-y-4">
        <Field label="Name (English)"><TextInput value={name} onChange={setName} /></Field>
        <Field label="Name (Arabic - Optional)"><TextInput value={nameAr} onChange={setNameAr} /></Field>
        <Field label="Type (Kind)">
          <Select value={kind} onChange={setKind} options={PAY_KINDS} />
        </Field>
        <Field label="Linked Ledger Account (Payment Source)">
          <Select
            value={accountId}
            onChange={setAccountId}
            options={[
              { value: '', label: 'None (Use default cash/bank)' },
              ...sourceAccounts
            ]}
          />
        </Field>
        <div className="flex flex-col gap-2 rounded-lg border border-slate-100 p-3 bg-slate-50">
          <label className="flex items-center gap-2 text-sm text-slate-700 font-semibold cursor-pointer">
            <input type="checkbox" checked={opensDrawer} onChange={(e) => setOpensDrawer(e.target.checked)} />
            <span>Opens Cash Drawer</span>
          </label>
          <label className="flex items-center gap-2 text-sm text-slate-700 font-semibold cursor-pointer mt-1">
            <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} />
            <span>Active (Available in POS)</span>
          </label>
        </div>
        <Field label="Sort Order"><TextInput type="number" value={sortOrder} onChange={setSortOrder} /></Field>
        <div className="flex justify-end gap-2 pt-2">
          <Btn onClick={onClose}>Cancel</Btn>
          <Btn kind="primary" onClick={() => void submit()}>{method ? "Save" : "Create"}</Btn>
        </div>
      </div>
    </Modal>
  );
}

function flattenAccounts(nodes: any[], prefix = ''): { value: string; label: string; isPaymentSource: boolean; code: string; balanceCents: number }[] {
  const list: any[] = [];
  for (const n of nodes) {
    list.push({ value: n.id, label: `${prefix}${n.name} (${n.code}) (${(n.balanceCents / 100).toFixed(2)} EGP)`, isPaymentSource: n.isPaymentSource, code: n.code, balanceCents: n.balanceCents });
    if (n.subAccounts && n.subAccounts.length > 0) {
      list.push(...flattenAccounts(n.subAccounts, prefix + '  '));
    }
  }
  return list;
}
