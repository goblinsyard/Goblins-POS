import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { Btn, ErrorBanner, Field, Modal, Pills, Select, Spinner, Table, TextInput, useLoad } from '../lib/ui';

interface Staff {
  id: string;
  name: string;
  email?: string | null;
  phone?: string | null;
  role: { id: string; name: string };
  salaryType: 'MONTHLY' | 'HOURLY';
  baseSalaryCents: number;
  hourlyRateCents: number;
  tipsPoints: number;
  deservesBonus: boolean;
  createdAt: string;
}

interface Role {
  id: string;
  name: string;
  isSystem: boolean;
  permissions: { permissionId: string }[];
}

interface AttendanceLog {
  id: string;
  userId: string;
  user: { name: string };
  clockIn: string;
  clockOut?: string | null;
  note?: string | null;
}

interface HrTx {
  id: string;
  userId: string;
  user: { name: string };
  type: 'ADVANCE' | 'BONUS' | 'DEDUCTION' | 'SALARY_PAYMENT';
  amountCents: number;
  date: string;
  notes?: string | null;
  journalEntry?: { id: string } | null;
}

function toDatetimeLocal(d?: string | null): string {
  if (!d) return '';
  const date = new Date(d);
  const offset = date.getTimezoneOffset();
  const adjusted = new Date(date.getTime() - offset * 60 * 1000);
  return adjusted.toISOString().slice(0, 16);
}

export function StaffView() {
  const [section, setSection] = useState<'directory' | 'attendance' | 'payroll' | 'transactions' | 'tips' | 'bonus'>('directory');
  const [month, setMonth] = useState(() => new Date().toISOString().slice(0, 7)); // YYYY-MM

  // Date ranges for queries based on selected month (local/UTC boundary alignment)
  const parts = month.split('-');
  const year = parseInt(parts[0] || '2026');
  const monthIdx = parseInt(parts[1] || '06') - 1;
  const fromStr = new Date(Date.UTC(year, monthIdx, 1, 0, 0, 0)).toISOString();
  const toStr = new Date(Date.UTC(year, monthIdx + 1, 0, 23, 59, 59)).toISOString();

  // Directory Data
  const { data: staff, reload: reloadStaff } = useLoad(() => api<Staff[]>('/admin/staff'));
  const { data: roles, reload: reloadRoles } = useLoad(() => api<Role[]>('/admin/roles'));
  const [editingStaff, setEditingStaff] = useState<Staff | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [matrixOpen, setMatrixOpen] = useState(false);

  // Attendance Data
  const { data: attendance, reload: reloadAttendance } = useLoad(() => api<AttendanceLog[]>(`/hr/attendance?from=${fromStr}&to=${toStr}`), [month]);
  const [editingAttendance, setEditingAttendance] = useState<AttendanceLog | null>(null);
  const [attendanceOpen, setAttendanceOpen] = useState(false);

  // Payroll Data
  const { data: payroll, reload: reloadPayroll } = useLoad(() => api<any[]>(`/hr/staff?from=${fromStr}&to=${toStr}`), [month]);
  const [txTargetStaff, setTxTargetStaff] = useState<any | null>(null);
  const [txType, setTxType] = useState<'ADVANCE' | 'BONUS' | 'DEDUCTION' | 'SALARY_PAYMENT' | null>(null);

  // Transactions Ledger Data
  const { data: transactions, reload: reloadTransactions } = useLoad(() => api<HrTx[]>(`/hr/transactions?from=${fromStr}&to=${toStr}`), [month]);

  async function deleteStaff(id: string) {
    if (!confirm(tr('Are you sure you want to delete this staff member?'))) return;
    try {
      await api(`/admin/staff/${id}`, { method: 'DELETE' });
      reloadStaff();
      reloadPayroll();
      reloadAttendance();
      reloadTransactions();
    } catch (e) {
      alert(e instanceof Error ? e.message : tr('Delete failed'));
    }
  }

  async function deleteAttendance(id: string) {
    if (!confirm(tr('Are you sure you want to delete this attendance record?'))) return;
    try {
      await api(`/hr/attendance/${id}`, { method: 'DELETE' });
      reloadAttendance();
      reloadPayroll();
    } catch (e) {
      alert(e instanceof Error ? e.message : tr('Delete failed'));
    }
  }

  async function voidTransaction(id: string) {
    if (!confirm(tr('Are you sure you want to void this HR transaction? This will also reverse any associated journal entries.'))) return;
    try {
      await api(`/hr/transactions/${id}`, { method: 'DELETE' });
      reloadTransactions();
      reloadPayroll();
    } catch (e) {
      alert(e instanceof Error ? e.message : tr('Void failed'));
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <Pills value={section} onChange={(val: any) => {
          setSection(val);
          if (val === 'directory') reloadStaff();
          if (val === 'attendance') reloadAttendance();
          if (val === 'payroll') reloadPayroll();
          if (val === 'transactions') reloadTransactions();
        }} options={[
          { value: 'directory', label: tr('Staff Directory') },
          { value: 'attendance', label: tr('Attendance Log') },
          { value: 'payroll', label: tr('Payroll & Salaries') },
          { value: 'transactions', label: tr('Transactions Ledger') },
          { value: 'tips', label: tr('Tips Distribution') },
          { value: 'bonus', label: tr('Sales Bonus') }
        ]} />

        {section !== 'directory' && (
          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold uppercase tracking-wider text-goblin-400">{tr('Salary Month:')}</span>
            <input type="month" value={month} onChange={(e) => setMonth(e.target.value)}
              className="rounded-lg border border-goblin-700 bg-goblin-900 p-1 text-sm text-goblin-100 focus:outline-none" />
          </div>
        )}
      </div>

      {/* Directory Section */}
      {section === 'directory' && staff && (
        <div className="space-y-6">
          <div className="flex gap-2">
            <Btn kind="primary" onClick={() => { setEditingStaff(null); setCreateOpen(true); }}>{tr('+ New staff member')}</Btn>
            <Btn onClick={() => setMatrixOpen(true)}>{tr('Role permissions')}</Btn>
          </div>
          <div>
            <h2 className="mb-2 font-semibold text-goblin-100">{tr('Staff Directory')}</h2>
            <Table headers={[tr('Name'), tr('Role'), tr('Email'), tr('Salary Setup'), tr('Since'), tr('Actions')]}
              rows={staff.map((s) => [
                s.name,
                s.role.name,
                s.email ?? '—',
                s.salaryType === 'HOURLY' ? `${(s.hourlyRateCents / 100).toFixed(2)} ${tr('EGP/hr')}` : `${(s.baseSalaryCents / 100).toFixed(2)} ${tr('EGP/mo')}`,
                new Date(s.createdAt).toLocaleDateString('en-EG'),
                <div key={s.id} className="flex gap-2">
                  <Btn onClick={() => { setEditingStaff(s); setCreateOpen(true); }}>{tr('Edit')}</Btn>
                  <Btn kind="danger" onClick={() => void deleteStaff(s.id)}>{tr('Delete')}</Btn>
                </div>,
              ])} />
          </div>
        </div>
      )}

      {/* Attendance Section */}
      {section === 'attendance' && (
        <div className="space-y-6">
          <div className="flex gap-2">
            <Btn kind="primary" onClick={() => { setEditingAttendance(null); setAttendanceOpen(true); }}>{tr('+ Add manual log')}</Btn>
          </div>
          <div>
            <h2 className="mb-2 font-semibold text-goblin-100">{tr('Time Clock Logs')}</h2>
            {attendance ? (
              <Table headers={[tr('Staff'), tr('Clock In'), tr('Clock Out'), tr('Hours'), tr('Notes'), tr('Actions')]}
                rows={attendance.map((a) => {
                  const cin = new Date(a.clockIn);
                  const cout = a.clockOut ? new Date(a.clockOut) : null;
                  const hrs = cout ? (cout.getTime() - cin.getTime()) / 3600_000 : 0;
                  return [
                    a.user.name,
                    cin.toLocaleString('en-EG'),
                    cout ? cout.toLocaleString('en-EG') : <span className="text-goblin-500 font-semibold">{tr('Clocked In')}</span>,
                    cout ? hrs.toFixed(2) : '—',
                    a.note ?? '—',
                    <div key={a.id} className="flex gap-2">
                      <Btn onClick={() => { setEditingAttendance(a); setAttendanceOpen(true); }}>{tr('Edit')}</Btn>
                      <Btn kind="danger" onClick={() => void deleteAttendance(a.id)}>{tr('Delete')}</Btn>
                    </div>
                  ];
                })} />
            ) : <Spinner />}
          </div>
        </div>
      )}

      {/* Payroll Section */}
      {section === 'payroll' && (
        <div className="space-y-6">
          <div>
            <h2 className="mb-2 font-semibold text-goblin-100">{tr('Payroll Calculation (')}{month})</h2>
            {payroll ? (
              <Table headers={[tr('Staff'), tr('Role'), tr('Salary Config'), tr('Hours'), tr('Gross Wages'), tr('Advances (Solfa)'), tr('Bonuses'), tr('Deductions'), tr('Paid'), tr('Net Due'), tr('Actions')]}
                rows={payroll.map((p) => [
                  p.name,
                  p.role,
                  p.salaryType === 'HOURLY' ? `${(p.hourlyRateCents / 100).toFixed(2)} /hr` : `${(p.baseSalaryCents / 100).toFixed(2)} /mo`,
                  p.hoursWorked.toFixed(2),
                  `${(p.grossCents / 100).toFixed(2)} EGP`,
                  p.advancesCents > 0 ? <span className="text-red-600">-${(p.advancesCents / 100).toFixed(2)}</span> : '—',
                  p.bonusesCents > 0 ? <span className="text-goblin-500">+${(p.bonusesCents / 100).toFixed(2)}</span> : '—',
                  p.deductionsCents > 0 ? <span className="text-red-700">-${(p.deductionsCents / 100).toFixed(2)}</span> : '—',
                  p.paymentsCents > 0 ? `${(p.paymentsCents / 100).toFixed(2)}` : '—',
                  <span key={p.id} className={`font-bold ${p.netDueCents > 0 ? 'text-goblin-500' : p.netDueCents < 0 ? 'text-red-700' : 'text-goblin-300'}`}>
                    {(p.netDueCents / 100).toFixed(2)} {tr('EGP')}
                  </span>,
                  <div key={p.id} className="flex flex-wrap gap-1">
                    <Btn onClick={() => { setTxTargetStaff(p); setTxType('ADVANCE'); }}>{tr('Solfah')}</Btn>
                    <Btn onClick={() => { setTxTargetStaff(p); setTxType('BONUS'); }}>{tr('Bonus')}</Btn>
                    <Btn onClick={() => { setTxTargetStaff(p); setTxType('DEDUCTION'); }}>{tr('Penalty')}</Btn>
                    <Btn kind="primary" onClick={() => { setTxTargetStaff(p); setTxType('SALARY_PAYMENT'); }}>{tr('Payout')}</Btn>
                  </div>
                ])} />
            ) : <Spinner />}
          </div>
        </div>
      )}

      {/* Transactions Section */}
      {section === 'transactions' && (
        <div className="space-y-6">
          <div>
            <h2 className="mb-2 font-semibold text-goblin-100">{tr('Wages & Solfah Ledger (')}{month})</h2>
            {transactions ? (
              <Table headers={[tr('Date'), tr('Staff'), tr('Type'), tr('Amount'), tr('Notes'), tr('Bookkeeping'), tr('Actions')]}
                rows={transactions.map((t) => [
                  new Date(t.date).toLocaleDateString('en-EG'),
                  t.user.name,
                  <span key={t.id} className={`rounded px-1.5 py-0.5 text-xs font-semibold ${
                    t.type === 'ADVANCE' ? 'bg-amber-100 text-amber-800' :
                    t.type === 'BONUS' ? 'bg-goblin-700 text-goblin-500' :
                    t.type === 'DEDUCTION' ? 'bg-red-100 text-red-800' : 'bg-blue-100 text-blue-800'
                  }`}>{tr(t.type)}</span>,
                  `${(t.amountCents / 100).toFixed(2)} EGP`,
                  t.notes ?? '—',
                  t.journalEntry ? <span className="font-mono text-xs text-goblin-300">{tr('Journaled')}</span> : <span className="text-goblin-400 italic text-xs">{tr('Memo only')}</span>,
                  <Btn key={t.id} kind="danger" onClick={() => void voidTransaction(t.id)}>{tr('Void')}</Btn>
                ])} />
            ) : <Spinner />}
          </div>
        </div>
      )}

      {/* Modals */}
      {createOpen && (
        <StaffFormModal staff={editingStaff} roles={roles ?? []} onClose={() => setCreateOpen(false)}
          onDone={() => {
            setCreateOpen(false);
            reloadStaff();
            reloadPayroll();
            reloadAttendance();
            reloadTransactions();
          }} />
      )}
      {matrixOpen && roles && (
        <PermissionMatrixModal roles={roles} onClose={() => setMatrixOpen(false)} onSaved={reloadRoles} />
      )}
      {attendanceOpen && staff && (
        <AttendanceFormModal log={editingAttendance} staffList={staff} onClose={() => setAttendanceOpen(false)}
          onDone={() => { setAttendanceOpen(false); reloadAttendance(); reloadPayroll(); }} />
      )}
      {txType && txTargetStaff && (
        <RecordTxModal staff={txTargetStaff} type={txType} onClose={() => { setTxTargetStaff(null); setTxType(null); }}
          onDone={() => { setTxTargetStaff(null); setTxType(null); reloadPayroll(); reloadTransactions(); }} />
      )}

      {/* Tips Distribution Section */}
      {section === 'tips' && (
        <TipsDistributionView onDone={() => {
          reloadPayroll();
          reloadTransactions();
        }} />
      )}

      {/* Sales Bonus Section */}
      {section === 'bonus' && (
        <SalesBonusView onDone={() => {
          reloadPayroll();
          reloadTransactions();
        }} />
      )}
    </div>
  );
}

function StaffFormModal({ roles, onClose, onDone, staff }: { roles: Role[]; onClose: () => void; onDone: () => void; staff?: Staff | null }) {
  const [name, setName] = useState(staff?.name ?? '');
  const [roleId, setRoleId] = useState(staff?.role?.id ?? '');
  const [email, setEmail] = useState(staff?.email ?? '');
  const [password, setPassword] = useState('');
  const [pin, setPin] = useState('');
  const [salaryType, setSalaryType] = useState<'MONTHLY' | 'HOURLY'>(staff?.salaryType ?? 'MONTHLY');
  const [baseSalary, setBaseSalary] = useState(staff ? (staff.baseSalaryCents / 100).toString() : '0');
  const [hourlyRate, setHourlyRate] = useState(staff ? (staff.hourlyRateCents / 100).toString() : '0');
  const [tipsPoints, setTipsPoints] = useState(staff?.tipsPoints?.toString() ?? '0');
  const [deservesBonus, setDeservesBonus] = useState(staff?.deservesBonus ?? false);
  const [err, setErr] = useState('');

  async function submit() {
    if (!name.trim() || !roleId) { setErr(tr('Name and role are required')); return; }
    if (pin && !/^\d{4,6}$/.test(pin)) { setErr(tr('PIN must be 4–6 digits')); return; }
    if (!staff && !pin && !password) { setErr(tr('Set a PIN (for POS) or a password (for back office)')); return; }
    try {
      const body: any = {
        name: name.trim(),
        roleId,
        email: email.trim() || null,
      };
      if (password) body.password = password;
      if (pin) body.pin = pin;

      let savedStaff;
      if (staff) {
        savedStaff = await api<any>(`/admin/staff/${staff.id}`, { method: 'PATCH', body });
      } else {
        savedStaff = await api<any>('/admin/staff', { method: 'POST', body });
      }

      // Update Salary configs
      const salaryBody = {
        salaryType,
        baseSalaryCents: Math.round(parseFloat(baseSalary || '0') * 100),
        hourlyRateCents: Math.round(parseFloat(hourlyRate || '0') * 100),
        tipsPoints: parseInt(tipsPoints, 10) || 0,
        deservesBonus,
      };
      await api(`/hr/staff/${savedStaff.id}`, { method: 'PATCH', body: salaryBody });

      onDone();
    } catch (e) { setErr(e instanceof Error ? e.message : tr('Failed')); }
  }

  return (
    <Modal title={staff ? tr('Edit staff member') : tr('New staff member')} onClose={onClose}>
      <ErrorBanner message={err} />
      <div className="space-y-3">
        <Field label={tr('Name')}><TextInput value={name} onChange={setName} /></Field>
        <Field label={tr('Role')}>
          <Select value={roleId} onChange={setRoleId} allowEmpty="— pick —"
            options={roles.map((r) => ({ value: r.id, label: r.name }))} />
        </Field>
        <Field label={tr('Email (for back-office login)')}><TextInput value={email} onChange={setEmail} autoComplete="new-password" /></Field>
        <Field label={staff ? tr('Password (leave blank to keep unchanged)') : tr('Password (back office)')}>
          <TextInput value={password} onChange={setPassword} type="password" autoComplete="new-password" />
        </Field>
        <Field label={staff ? tr('PIN (leave blank to keep unchanged)') : tr('PIN (POS/KDS, 4–6 digits)')}>
          <TextInput value={pin} onChange={setPin} autoComplete="new-password" />
        </Field>

        <div className="border-t pt-3 space-y-3">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-goblin-300">{tr('Salary Configuration')}</h3>
          <Field label={tr('Wage Structure')}>
            <Select value={salaryType} onChange={(val: any) => setSalaryType(val)} options={[
              { value: 'MONTHLY', label: tr('Monthly Fixed Salary') },
              { value: 'HOURLY', label: tr('Hourly Rate') }
            ]} />
          </Field>

          {salaryType === 'MONTHLY' ? (
            <Field label={tr('Base Monthly Salary (EGP)')}><TextInput type="number" value={baseSalary} onChange={setBaseSalary} /></Field>
          ) : (
            <Field label={tr('Hourly Wage Rate (EGP)')}><TextInput type="number" value={hourlyRate} onChange={setHourlyRate} /></Field>
          )}

          <Field label={tr('Tips Points Weight (0 to exclude)')}>
            <TextInput type="number" value={tipsPoints} onChange={setTipsPoints} />
          </Field>

          <div className="flex items-center gap-2 py-2">
            <input type="checkbox" id="deservesBonus" checked={deservesBonus} onChange={(e) => setDeservesBonus(e.target.checked)}
              className="rounded border-goblin-700 text-indigo-600 focus:ring-indigo-500" />
            <label htmlFor="deservesBonus" className="text-sm font-medium text-goblin-100">{tr('Eligible for Sales Bonus')}</label>
          </div>
        </div>

        <Btn kind="primary" onClick={() => void submit()}>{staff ? tr('Save') : tr('Create')}</Btn>
      </div>
    </Modal>
  );
}

function PermissionMatrixModal({ roles, onClose, onSaved }: { roles: Role[]; onClose: () => void; onSaved: () => void }) {
  const allPerms = [...new Set(roles.flatMap((r) => r.permissions.map((p) => p.permissionId)))].sort();
  const [grants, setGrants] = useState<Record<string, Set<string>>>(
    Object.fromEntries(roles.map((r) => [r.id, new Set(r.permissions.map((p) => p.permissionId))])),
  );
  const [dirty, setDirty] = useState<Set<string>>(new Set());
  const [err, setErr] = useState('');
  const [saving, setSaving] = useState(false);

  function toggle(roleId: string, perm: string) {
    setGrants((cur) => {
      const next = new Set(cur[roleId]);
      if (next.has(perm)) next.delete(perm); else next.add(perm);
      return { ...cur, [roleId]: next };
    });
    setDirty((cur) => new Set(cur).add(roleId));
  }

  async function save() {
    setErr(''); setSaving(true);
    try {
      for (const roleId of dirty) {
        await api(`/admin/roles/${roleId}/permissions`, {
          method: 'PATCH', body: { permissionIds: [...(grants[roleId] ?? [])] },
        });
      }
      onSaved();
      onClose();
    } catch (e) { setErr(e instanceof Error ? e.message : tr('Failed')); }
    finally { setSaving(false); }
  }

  const groups = new Map<string, string[]>();
  for (const p of allPerms) {
    const g = p.split('.')[0] ?? p;
    groups.set(g, [...(groups.get(g) ?? []), p]);
  }

  return (
    <Modal title={tr('Role permissions')} onClose={onClose} wide>
      <ErrorBanner message={err} />
      <div className="overflow-auto">
        <table className="w-full text-xs">
          <thead className="sticky top-0 bg-goblin-900 text-left text-goblin-300">
            <tr>
              <th className="p-2">{tr('Permission')}</th>
              {roles.map((r) => <th key={r.id} className="p-2 text-center">{r.name}</th>)}
            </tr>
          </thead>
          <tbody>
            {[...groups.entries()].map(([group, perms]) => (
              <React.Fragment key={group}>
                <tr className="bg-goblin-800">
                  <td colSpan={roles.length + 1} className="p-2 font-semibold uppercase tracking-wide text-goblin-400">{group}</td>
                </tr>
                {perms.map((p) => (
                  <tr key={p} className="border-t">
                    <td className="p-2 font-mono">{p}</td>
                    {roles.map((r) => (
                      <td key={r.id} className="p-2 text-center">
                        <input type="checkbox" checked={grants[r.id]?.has(p) ?? false}
                          disabled={r.name === 'Owner'}
                          onChange={() => toggle(r.id, p)} />
                      </td>
                    ))}
                  </tr>
                ))}
              </React.Fragment>
            ))}
          </tbody>
        </table>
      </div>
      <div className="mt-4 flex items-center gap-2">
        <Btn kind="primary" onClick={() => void save()} disabled={saving || !dirty.size}>
          {saving ? tr('Saving…') : `${tr('Save')} ${dirty.size ? `(${dirty.size} role${dirty.size > 1 ? 's' : ''})` : ''}`}
        </Btn>
        <p className="text-xs text-goblin-400">{tr('Owner permissions are locked to prevent locking yourself out.')}</p>
      </div>
    </Modal>
  );
}

function AttendanceFormModal({ log, staffList, onClose, onDone }: { log?: AttendanceLog | null; staffList: Staff[]; onClose: () => void; onDone: () => void }) {
  const [staffId, setStaffId] = useState(log?.userId ?? '');
  const [clockIn, setClockIn] = useState(() => toDatetimeLocal(log?.clockIn ?? new Date().toISOString()));
  const [clockOut, setClockOut] = useState(() => toDatetimeLocal(log?.clockOut));
  const [note, setNote] = useState(log?.note ?? '');
  const [err, setErr] = useState('');

  async function submit() {
    if (!staffId) { setErr(tr('Staff member is required')); return; }
    if (!clockIn) { setErr(tr('Clock In time is required')); return; }
    try {
      const body = {
        staffId,
        clockIn: new Date(clockIn).toISOString(),
        clockOut: clockOut ? new Date(clockOut).toISOString() : null,
        note: note.trim() || null
      };

      if (log) {
        await api(`/hr/attendance/${log.id}`, { method: 'PATCH', body });
      } else {
        await api('/hr/attendance', { method: 'POST', body });
      }
      onDone();
    } catch (e) { setErr(e instanceof Error ? e.message : tr('Save failed')); }
  }

  return (
    <Modal title={log ? tr('Edit Attendance Log') : tr('Add Manual Attendance')} onClose={onClose}>
      <ErrorBanner message={err} />
      <div className="space-y-3">
        <Field label={tr('Staff Member')}>
          {log ? (
            <div className="p-2 bg-goblin-800 rounded-lg text-sm text-goblin-100 font-semibold">{log.user.name}</div>
          ) : (
            <Select value={staffId} onChange={setStaffId} allowEmpty="— select staff —"
              options={staffList.map((s) => ({ value: s.id, label: s.name }))} />
          )}
        </Field>

        <Field label={tr('Clock In Time')}>
          <input type="datetime-local" value={clockIn} onChange={(e) => setClockIn(e.target.value)}
            className="w-full rounded-lg border border-goblin-700 p-2 text-sm" />
        </Field>

        <Field label={tr('Clock Out Time (Optional)')}>
          <input type="datetime-local" value={clockOut} onChange={(e) => setClockOut(e.target.value)}
            className="w-full rounded-lg border border-goblin-700 p-2 text-sm" />
        </Field>

        <Field label={tr('Note / Reason')}><TextInput value={note} onChange={setNote} placeholder={tr('e.g. forgot card, manual correction')} /></Field>

        <Btn kind="primary" onClick={() => void submit()}>{tr('Save Record')}</Btn>
      </div>
    </Modal>
  );
}

function RecordTxModal({ staff, type, onClose, onDone }: { staff: any; type: 'ADVANCE' | 'BONUS' | 'DEDUCTION' | 'SALARY_PAYMENT'; onClose: () => void; onDone: () => void }) {
  const { data: accounts } = useLoad(() => api<any[]>('/accounting/accounts'));
  // Payout defaults to Net Due
  const [amount, setAmount] = useState(type === 'SALARY_PAYMENT' ? Math.max(0, staff.netDueCents / 100).toString() : '0');
  const [notes, setNotes] = useState('');
  const [accountId, setAccountId] = useState('');
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10)); // YYYY-MM-DD
  const [err, setErr] = useState('');

  const modalTitles = {
    ADVANCE: 'Record Solfah (Cash Advance)',
    BONUS: 'Add Salary Bonus',
    DEDUCTION: 'Add Salary Deduction / Penalty',
    SALARY_PAYMENT: 'Record Salary Payment'
  };

  const isCashOut = type === 'ADVANCE' || type === 'SALARY_PAYMENT';

  const assetAccounts = accounts
    ? flattenAccounts(accounts).filter((a) => a.isPaymentSource)
    : [];

  useEffect(() => {
    if (assetAccounts.length > 0 && !accountId) {
      const defaultAcc = assetAccounts.find(a => a.label.includes('1110'))?.value || assetAccounts[0]?.value || '';
      setAccountId(defaultAcc);
    }
  }, [accounts, accountId, assetAccounts]);

  async function submit() {
    const parsedAmount = parseFloat(amount);
    if (isNaN(parsedAmount) || parsedAmount <= 0) {
      setErr(tr('Amount must be greater than zero'));
      return;
    }
    if (isCashOut && !accountId) {
      setErr(tr('Payment source/account is required'));
      return;
    }
    if (!date) {
      setErr(tr('Date is required'));
      return;
    }
    try {
      const body = {
        staffId: staff.id,
        type,
        amountCents: Math.round(parsedAmount * 100),
        notes: notes.trim() || null,
        accountId: isCashOut ? accountId : undefined,
        date: new Date(date).toISOString()
      };

      await api('/hr/transactions', { method: 'POST', body });
      onDone();
    } catch (e) { setErr(e instanceof Error ? e.message : tr('Failed to record transaction')); }
  }

  return (
    <Modal title={modalTitles[type]} onClose={onClose}>
      <ErrorBanner message={err} />
      <div className="space-y-3">
        <Field label={tr('Staff Member')}>
          <div className="p-2 bg-goblin-800 rounded-lg text-sm text-goblin-100 font-semibold">{staff.name}</div>
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field label={tr('Amount (EGP)')}>
            <TextInput type="number" value={amount} onChange={setAmount} />
          </Field>
          <Field label={tr('Date')}>
            <TextInput type="date" value={date} onChange={setDate} />
          </Field>
        </div>

        {isCashOut && (
          <Field label={tr('Payment Source / Account')}>
            <Select value={accountId} onChange={setAccountId} allowEmpty="— pick account (e.g. Safe, Fawry, Bank) —" options={assetAccounts} />
          </Field>
        )}

        <Field label={tr('Notes / Details')}>
          <TextInput value={notes} onChange={setNotes} placeholder={tr('e.g. solfa for transit, broke equipment, june final payout')} />
        </Field>

        <Btn kind="primary" onClick={() => void submit()}>{tr('Confirm Transaction')}</Btn>
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

import * as React from 'react';
import { tr } from '../lib/i18n';

interface TipsPreviewStaff {
  userId: string;
  name: string;
  tipsPoints: number;
  shareCents: number;
}

interface TipsPreview {
  totalTipsCents: number;
  totalPoints: number;
  eligibleStaff: TipsPreviewStaff[];
}

function TipsDistributionView({ onDone }: { onDone: () => void }) {
  const { data: preview, reload: reloadPreview } = useLoad(() => api<TipsPreview>('/hr/tips/preview'));
  const { data: accounts } = useLoad(() => api<any[]>('/accounting/accounts'));
  const [amount, setAmount] = useState('0');
  const [accountId, setAccountId] = useState('');
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState('');

  const assetAccounts = accounts
    ? flattenAccounts(accounts).filter((a) => a.isPaymentSource)
    : [];

  useEffect(() => {
    if (assetAccounts.length > 0 && !accountId) {
      const defaultAcc = assetAccounts.find((a) => a.code === '1110')?.value || assetAccounts[0]?.value || '';
      setAccountId(defaultAcc);
    }
  }, [accounts, accountId, assetAccounts]);

  useEffect(() => {
    if (preview) {
      setAmount((preview.totalTipsCents / 100).toFixed(2));
    }
  }, [preview]);

  if (!preview) return <Spinner />;


  const totalPoints = preview.totalPoints;
  const distributeCents = Math.round(parseFloat(amount || '0') * 100);

  let distributedSum = 0;
  const liveShares = preview.eligibleStaff.map((s) => {
    const share = totalPoints > 0 && distributeCents > 0 
      ? Math.floor(distributeCents * (s.tipsPoints / totalPoints))
      : 0;
    distributedSum += share;
    return { ...s, liveShareCents: share };
  });

  const remainder = distributeCents - distributedSum;
  if (remainder > 0 && liveShares.length > 0) {
    const highestIndex = liveShares.reduce(
      (maxIdx, s, idx, arr) => (s.tipsPoints > (arr[maxIdx]?.tipsPoints ?? 0) ? idx : maxIdx),
      0,
    );
    const target = liveShares[highestIndex];
    if (target) {
      target.liveShareCents += remainder;
    }
  }

  async function handleDistribute() {
    setErr('');
    if (distributeCents <= 0) {
      setErr(tr('Amount to distribute must be greater than 0'));
      return;
    }
    const eligibleCount = preview?.eligibleStaff?.length ?? 0;
    if (!confirm(`${tr('Are you sure you want to distribute')} ${amount} ${tr('EGP to')} ${eligibleCount} ${tr('employees?')}`)) {
      return;
    }
    setSubmitting(true);
    try {
      const selectedAcc = assetAccounts.find((a) => a.value === accountId);
      await api('/hr/tips/distribute', {
        method: 'POST',
        body: {
          totalAmountCents: distributeCents,
          paymentMethod: selectedAcc?.code === '1210' ? 'BANK' : 'CASH',
          accountId,
          notes: notes.trim(),
        },
      });
      alert(tr('Tips distributed successfully!'));
      setNotes('');
      reloadPreview();
      onDone();
    } catch (e) {
      setErr(e instanceof Error ? e.message : tr('Distribution failed'));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
      <div className="lg:col-span-1 space-y-4 rounded-xl border border-goblin-700 bg-goblin-900 p-5 shadow-sm">
        <h3 className="font-semibold text-goblin-50">{tr('Distribute Tips')}</h3>
        <ErrorBanner message={err} />
        
        <div className="rounded-lg bg-indigo-50 p-4 text-indigo-900">
          <div className="text-xs font-semibold uppercase tracking-wider text-indigo-700">{tr('Undistributed Tips Balance')}</div>
          <div className="mt-1 text-2xl font-bold">{(preview.totalTipsCents / 100).toFixed(2)} {tr('EGP')}</div>
        </div>

        <Field label={tr('Amount to Distribute (EGP)')}>
          <TextInput type="number" value={amount} onChange={setAmount} />
        </Field>

        <Field label={tr('Payment Source')}>
          <Select value={accountId} onChange={setAccountId} options={assetAccounts} />
        </Field>

        <Field label={tr('Notes')}>
          <TextInput value={notes} onChange={setNotes} placeholder={tr('e.g. Tips for Week 24')} disabled={submitting} />
        </Field>

        <div className="pt-2">
          <Btn kind="primary" onClick={() => void handleDistribute()} disabled={submitting}>
            {submitting ? tr('Processing Payout...') : `${tr('Distribute & Pay')} ${amount} ${tr('EGP')}`}
          </Btn>
        </div>
      </div>

      <div className="lg:col-span-2 rounded-xl border border-goblin-700 bg-goblin-900 p-5 shadow-sm space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold text-goblin-50 font-medium">{tr('Eligible Employees Preview')}</h3>
          <div className="text-xs bg-goblin-800 text-goblin-200 px-2.5 py-1 rounded-full font-semibold">
            {tr('Total Weight:')} {totalPoints} {tr('Point')}{totalPoints !== 1 ? 's' : ''}
          </div>
        </div>

        {liveShares.length > 0 ? (
          <Table 
            headers={[tr('Employee'), tr('Tips Weight'), tr('Payout Share'), tr('Percentage')]} 
            rows={liveShares.map((s) => [
              s.name,
              <span key={s.userId} className="font-semibold text-goblin-100">{s.tipsPoints} {tr('Pt')}{s.tipsPoints !== 1 ? 's' : ''}</span>,
              <span key={s.userId} className="font-bold text-goblin-500">{(s.liveShareCents / 100).toFixed(2)} {tr('EGP')}</span>,
              <span key={s.userId} className="text-goblin-300 font-mono text-xs">{totalPoints > 0 ? `${((s.tipsPoints / totalPoints) * 100).toFixed(1)}%` : '0.0%'}</span>
            ])} 
          />
        ) : (
          <div className="text-center text-goblin-400 py-8 text-sm">
            {tr('No employees have been assigned tips points weight. Configure them in the Directory tab.')}
          </div>
        )}
      </div>
    </div>
  );
}

interface BonusPreviewStaff {
  userId: string;
  name: string;
  shareCents: number;
}

interface BonusPreview {
  totalNetSalesCents: number;
  bonusPoolCents: number;
  eligibleStaff: BonusPreviewStaff[];
}

function SalesBonusView({ onDone }: { onDone: () => void }) {
  const { data: accounts } = useLoad(() => api<any[]>('/accounting/accounts'));
  const [startDate, setStartDate] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() - 15);
    return d.toISOString().slice(0, 10);
  });
  const [endDate, setEndDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [bonusPercentage, setBonusPercentage] = useState('1.0');
  const [accountId, setAccountId] = useState('');
  const [notes, setNotes] = useState('');
  
  const [preview, setPreview] = useState<BonusPreview | null>(null);
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState('');

  const assetAccounts = accounts
    ? flattenAccounts(accounts).filter((a) => a.isPaymentSource)
    : [];

  useEffect(() => {
    if (assetAccounts.length > 0 && !accountId) {
      const defaultAcc = assetAccounts.find((a) => a.code === '1110')?.value || assetAccounts[0]?.value || '';
      setAccountId(defaultAcc);
    }
  }, [accounts, accountId, assetAccounts]);

  async function handleCalculate() {
    setErr('');
    setLoading(true);
    try {
      const pct = parseFloat(bonusPercentage);
      if (isNaN(pct) || pct <= 0) {
        throw new Error(tr('Bonus percentage must be a positive number'));
      }
      const data = await api<BonusPreview>(
        `/hr/bonus/preview?startDate=${startDate}T00:00:00.000Z&endDate=${endDate}T23:59:59.999Z&bonusPercentage=${pct}`
      );
      setPreview(data);
    } catch (e) {
      setErr(e instanceof Error ? e.message : tr('Calculation failed'));
      setPreview(null);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void handleCalculate();
  }, [startDate, endDate, bonusPercentage]);

  async function handleDistribute() {
    setErr('');
    if (!preview || preview.bonusPoolCents <= 0) {
      setErr(tr('No bonus amount to distribute'));
      return;
    }
    const pct = parseFloat(bonusPercentage);
    const eligibleCount = preview?.eligibleStaff?.length ?? 0;
    if (!confirm(`${tr('Are you sure you want to payout EGP')} ${(preview.bonusPoolCents / 100).toFixed(2)} ${tr('to')} ${eligibleCount} ${tr('employees immediately?')}`)) {
      return;
    }
    setSubmitting(true);
    try {
      const selectedAcc = assetAccounts.find((a) => a.value === accountId);
      await api('/hr/bonus/distribute', {
        method: 'POST',
        body: {
          startDate: `${startDate}T00:00:00.000Z`,
          endDate: `${endDate}T23:59:59.999Z`,
          bonusPercentage: pct,
          paymentMethod: selectedAcc?.code === '1210' ? 'BANK' : 'CASH',
          accountId,
          notes: notes.trim(),
        },
      });
      alert(tr('Bonus distributed and paid successfully!'));
      setNotes('');
      handleCalculate();
      onDone();
    } catch (e) {
      setErr(e instanceof Error ? e.message : tr('Distribution failed'));
    } finally {
      setSubmitting(false);
    }
  }
  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
      <div className="lg:col-span-1 space-y-4 rounded-xl border border-goblin-700 bg-goblin-900 p-5 shadow-sm">
        <h3 className="font-semibold text-goblin-50">{tr('Bonus Distribution Setup')}</h3>
        <ErrorBanner message={err} />

        <div className="grid grid-cols-2 gap-2">
          <Field label={tr('Start Date')}>
            <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)}
              className="rounded-lg border border-goblin-700 p-2 text-sm w-full text-goblin-100 focus:outline-none focus:ring-1 focus:ring-indigo-500" />
          </Field>
          <Field label={tr('End Date')}>
            <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)}
              className="rounded-lg border border-goblin-700 p-2 text-sm w-full text-goblin-100 focus:outline-none focus:ring-1 focus:ring-indigo-500" />
          </Field>
        </div>

        <Field label={tr('Bonus % of Net Sales')}>
          <TextInput type="number" value={bonusPercentage} onChange={setBonusPercentage} disabled={submitting} />
        </Field>

        <Field label={tr('Payment Source')}>
          <Select value={accountId} onChange={setAccountId} options={assetAccounts} />
        </Field>

        <Field label={tr('Notes')}>
          <TextInput value={notes} onChange={setNotes} placeholder={tr('e.g. Sales Bonus Mid-June')} disabled={submitting} />
        </Field>

        {preview && preview.bonusPoolCents > 0 && (
          <div className="pt-2 border-t mt-4">
            <Btn kind="primary" onClick={() => void handleDistribute()} disabled={submitting}>
              {submitting ? tr('Posting Distribution...') : `${tr('Pay Bonus pool (')}${(preview.bonusPoolCents / 100).toFixed(2)} ${tr('EGP)')}`}
            </Btn>
          </div>
        )}
      </div>

      <div className="lg:col-span-2 space-y-4">
        {loading ? (
          <div className="flex h-64 items-center justify-center rounded-xl border border-goblin-700 bg-goblin-900">
            <Spinner />
          </div>
        ) : preview ? (
          <div className="space-y-6">
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
              <div className="rounded-xl border border-goblin-700 bg-goblin-900 p-4 shadow-sm">
                <div className="text-xs font-semibold uppercase tracking-wider text-goblin-400">{tr('Net Sales in Period')}</div>
                <div className="mt-1 text-xl font-bold text-goblin-50">{(preview.totalNetSalesCents / 100).toFixed(2)} {tr('EGP')}</div>
              </div>
              <div className="rounded-xl border border-indigo-200 bg-indigo-50/50 p-4 shadow-sm">
                <div className="text-xs font-semibold uppercase tracking-wider text-indigo-700">{tr('Calculated Bonus Pool')}</div>
                <div className="mt-1 text-xl font-bold text-indigo-900">{(preview.bonusPoolCents / 100).toFixed(2)} {tr('EGP')}</div>
              </div>
              <div className="rounded-xl border border-goblin-700 bg-goblin-900 p-4 shadow-sm col-span-2 sm:col-span-1">
                <div className="text-xs font-semibold uppercase tracking-wider text-goblin-400">{tr('Deserving Staff')}</div>
                <div className="mt-1 text-xl font-bold text-goblin-50">{preview.eligibleStaff.length} {tr('Employees')}</div>
              </div>
            </div>

            <div className="rounded-xl border border-goblin-700 bg-goblin-900 p-5 shadow-sm space-y-4">
              <h3 className="font-semibold text-goblin-50">{tr('Equal Distribution Preview')}</h3>
              {preview.eligibleStaff.length > 0 ? (
                <Table 
                  headers={[tr('Employee'), tr('Wages setup'), tr('Equal Bonus Share')]} 
                  rows={preview.eligibleStaff.map((s) => [
                    s.name,
                    <span key={s.userId} className="text-goblin-300 text-xs">{tr('Eligible for Bonus')}</span>,
                    <span key={s.userId} className="font-bold text-goblin-500">{(s.shareCents / 100).toFixed(2)} {tr('EGP')}</span>
                  ])} 
                />
              ) : (
                <div className="text-center text-goblin-400 py-8 text-sm">
                  {tr('No staff members are currently marked as eligible for the sales bonus. Mark them in the Staff Directory.')}
                </div>
              )}
            </div>
          </div>
        ) : (
          <div className="flex h-64 items-center justify-center rounded-xl border border-goblin-700 bg-goblin-900 text-goblin-400 text-sm">
            {tr('Enter parameters to calculate bonus preview.')}
          </div>
        )}
      </div>
    </div>
  );
}
