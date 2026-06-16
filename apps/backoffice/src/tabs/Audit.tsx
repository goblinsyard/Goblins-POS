import { useState } from 'react';
import { api, cairoTime } from '../lib/api';
import { Btn, Select, Table, TextInput, useLoad } from '../lib/ui';

export function AuditView() {
  const { data } = useLoad(() =>
    api<{ id: string; action: string; entity?: string; createdAt: string; user?: { name: string }; detail?: any }[]>('/audit?take=500'));

  const [search, setSearch] = useState('');
  const [moduleGroup, setModuleGroup] = useState('ALL');
  const [userFilter, setUserFilter] = useState('');
  const [entityFilter, setEntityFilter] = useState('');
  const [tableFilter, setTableFilter] = useState('');
  const [timePeriod, setTimePeriod] = useState('ALL');

  const logsList = data ?? [];

  // Extract unique users, entities and tables for filters
  const uniqueUsers = [...new Set(logsList.map(l => l.user?.name).filter(Boolean))].sort() as string[];
  const uniqueEntities = [...new Set(logsList.map(l => l.entity).filter(Boolean))].sort() as string[];
  const uniqueTables = [
    ...new Set(
      logsList.flatMap(l => [
        l.detail?.resourceName,
        l.detail?.fromResourceName,
        l.detail?.toResourceName,
      ]).filter(Boolean)
    ),
  ].sort() as string[];

  const userOptions = uniqueUsers.map(u => ({ value: u, label: u }));
  const entityOptions = uniqueEntities.map(e => ({ value: e, label: e }));
  const tableOptions = uniqueTables.map(t => ({ value: t, label: t }));

  const clearFilters = () => {
    setSearch('');
    setModuleGroup('ALL');
    setUserFilter('');
    setEntityFilter('');
    setTableFilter('');
    setTimePeriod('ALL');
  };

  const now = new Date();
  const filteredLogs = logsList.filter((r) => {
    // 1. Module Group
    if (moduleGroup !== 'ALL') {
      const act = r.action;
      if (moduleGroup === 'HR' && !act.startsWith('hr.') && !act.startsWith('staff.')) return false;
      if (moduleGroup === 'ACCOUNTING' && !act.startsWith('accounting.')) return false;
      if (moduleGroup === 'MENU' && !act.startsWith('menu.') && !act.startsWith('price.')) return false;
      if (moduleGroup === 'SESSIONS' && !act.startsWith('session.') && !act.startsWith('reservation.')) return false;
      if (moduleGroup === 'EXPENSES' && !act.startsWith('expense.')) return false;
      if (moduleGroup === 'OTHER') {
        const isKnown = act.startsWith('hr.') || act.startsWith('staff.') || act.startsWith('accounting.') ||
                        act.startsWith('menu.') || act.startsWith('price.') || act.startsWith('session.') ||
                        act.startsWith('reservation.') || act.startsWith('expense.');
        if (isKnown) return false;
      }
    }

    // 2. User Filter
    if (userFilter && r.user?.name !== userFilter) return false;

    // 3. Entity Filter
    if (entityFilter && r.entity !== entityFilter) return false;

    // Table/Room Filter
    if (
      tableFilter &&
      r.detail?.resourceName !== tableFilter &&
      r.detail?.fromResourceName !== tableFilter &&
      r.detail?.toResourceName !== tableFilter
    ) {
      return false;
    }

    // 4. Time Period
    if (timePeriod !== 'ALL') {
      const created = new Date(r.createdAt).getTime();
      const diffMs = now.getTime() - created;
      if (timePeriod === 'TODAY' && diffMs > 24 * 3600_000) return false;
      if (timePeriod === '3DAYS' && diffMs > 3 * 24 * 3600_000) return false;
      if (timePeriod === '7DAYS' && diffMs > 7 * 24 * 3600_000) return false;
      if (timePeriod === '30DAYS' && diffMs > 30 * 24 * 3600_000) return false;
    }

    // 5. Search Text
    if (search.trim()) {
      const q = search.toLowerCase();
      const formatted = formatDetail(r.action, r.detail).toLowerCase();
      const user = (r.user?.name ?? '').toLowerCase();
      const action = r.action.toLowerCase();
      const entity = (r.entity ?? '').toLowerCase();
      if (!formatted.includes(q) && !user.includes(q) && !action.includes(q) && !entity.includes(q)) {
        return false;
      }
    }

    return true;
  });

  return (
    <div className="space-y-4">
      <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 space-y-3">
        <div className="grid grid-cols-1 md:grid-cols-6 gap-3">
          <div className="md:col-span-2">
            <label className="block text-xs font-semibold uppercase tracking-wider text-slate-500 mb-1">Search</label>
            <TextInput value={search} onChange={setSearch} placeholder="Search user, action, entity or detail..." />
          </div>
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider text-slate-500 mb-1">Module Group</label>
            <Select value={moduleGroup} onChange={setModuleGroup} options={[
              { value: 'ALL', label: 'All Modules' },
              { value: 'HR', label: 'HR & Payroll' },
              { value: 'ACCOUNTING', label: 'Accounting' },
              { value: 'MENU', label: 'Menu & Pricing' },
              { value: 'SESSIONS', label: 'Sessions & Tables' },
              { value: 'EXPENSES', label: 'Expenses' },
              { value: 'OTHER', label: 'Other / System' }
            ]} />
          </div>
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider text-slate-500 mb-1">Performed By</label>
            <Select value={userFilter} onChange={setUserFilter} allowEmpty="All Users" options={userOptions} />
          </div>
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider text-slate-500 mb-1">Entity Type</label>
            <Select value={entityFilter} onChange={setEntityFilter} allowEmpty="All Entities" options={entityOptions} />
          </div>
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider text-slate-500 mb-1">Table/Room</label>
            <Select value={tableFilter} onChange={setTableFilter} allowEmpty="All Tables" options={tableOptions} />
          </div>
        </div>
        
        <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-slate-200">
          <div className="flex items-center gap-3">
            <span className="text-xs font-semibold uppercase tracking-wider text-slate-400">Timeframe:</span>
            <div className="w-48">
              <Select value={timePeriod} onChange={setTimePeriod} options={[
                { value: 'ALL', label: 'All Loaded Logs (500)' },
                { value: 'TODAY', label: 'Today (24h)' },
                { value: '3DAYS', label: 'Last 3 Days' },
                { value: '7DAYS', label: 'Last 7 Days' },
                { value: '30DAYS', label: 'Last 30 Days' }
              ]} />
            </div>
          </div>
          
          <div className="flex items-center gap-3">
            <span className="text-xs text-slate-500">Showing <b>{filteredLogs.length}</b> of <b>{logsList.length}</b> entries</span>
            {(search || moduleGroup !== 'ALL' || userFilter || entityFilter || tableFilter || timePeriod !== 'ALL') && (
              <Btn onClick={clearFilters}>Clear Filters</Btn>
            )}
          </div>
        </div>
      </div>

      <Table
        headers={['Time', 'User', 'Action', 'Entity', 'Detail']}
        rows={filteredLogs.map((r) => [
          cairoTime(r.createdAt),
          r.user?.name ?? '—',
          r.action,
          r.entity ?? '',
          formatDetail(r.action, r.detail),
        ])}
      />
    </div>
  );
}

function formatDetail(action: string, detail: any): string {
  let formatted = formatDetailBase(action, detail);
  if (detail && typeof detail === 'object' && detail.resourceName && action !== 'order.transfer' && action !== 'session.transfer') {
    formatted += ` (Table: ${detail.resourceName})`;
  }
  return formatted;
}

function formatDetailBase(action: string, detail: any): string {
  if (!detail) return '—';
  if (typeof detail !== 'object') return String(detail);

  // Helper to format cents to EGP
  const fmtCents = (cents: unknown) => {
    const num = Number(cents);
    if (isNaN(num)) return '0.00 EGP';
    return `${(num / 100).toFixed(2)} EGP`;
  };

  try {
    switch (action) {
      // HR & Payroll
      case 'hr.transaction.advance':
        return `Recorded cash advance (Solfah) of ${fmtCents(detail.amountCents)}${detail.notes ? ` (${detail.notes})` : ''}`;
      case 'hr.transaction.bonus':
        return `Added salary bonus of ${fmtCents(detail.amountCents)}${detail.notes ? ` (${detail.notes})` : ''}`;
      case 'hr.transaction.deduction':
        return `Added salary deduction/penalty of ${fmtCents(detail.amountCents)}${detail.notes ? ` (${detail.notes})` : ''}`;
      case 'hr.transaction.salary_payment':
        return `Paid salary payout of ${fmtCents(detail.amountCents)}${detail.notes ? ` (${detail.notes})` : ''}`;
      case 'hr.transaction.void':
        return `Voided HR transaction: type ${detail.type || '—'}, amount ${fmtCents(detail.amountCents)}`;
      case 'hr.staff.update_salary':
        if (detail.salaryType === 'HOURLY') {
          return `Set salary to Hourly (Rate: ${fmtCents(detail.hourlyRateCents)}/hr)`;
        } else {
          return `Set salary to Monthly Fixed (Salary: ${fmtCents(detail.baseSalaryCents)}/mo)`;
        }
      case 'hr.attendance.create':
        return `Logged manual attendance: In ${detail.clockIn ? new Date(detail.clockIn).toLocaleString('en-EG') : '—'}, Out ${detail.clockOut ? new Date(detail.clockOut).toLocaleString('en-EG') : '—'}`;
      case 'hr.attendance.update': {
        const parts: string[] = [];
        if (detail.clockIn) parts.push(`In: ${new Date(detail.clockIn).toLocaleString('en-EG')}`);
        if (detail.clockOut) parts.push(`Out: ${new Date(detail.clockOut).toLocaleString('en-EG')}`);
        if (detail.note) parts.push(`Note: "${detail.note}"`);
        return `Updated attendance log details (${parts.join(', ')})`;
      }
      case 'hr.attendance.delete':
        return `Deleted manual attendance log`;

      // Staff directory
      case 'staff.create':
        return `Created new staff member: ${detail.name || '—'}`;
      case 'staff.update':
        return `Updated staff details: ${detail.name ? `Name "${detail.name}"` : 'Updated settings'}`;
      case 'staff.delete':
        return `Deleted staff member`;
      case 'staff.role_permissions':
        return `Updated role permissions`;

      // Accounting
      case 'accounting.account.create':
        return `Created ledger account: ${detail.code} — ${detail.name}`;
      case 'accounting.account.update':
        return `Updated ledger account: ${detail.code} — ${detail.name}`;
      case 'accounting.journal-entry.create':
      case 'accounting.journal.create':
        return `Created journal entry: "${detail.description || '—'}" (Ref: ${detail.reference || '—'})`;
      case 'accounting.transfer.create':
        return `Transferred ${fmtCents(detail.amountCents)} from account ${detail.fromAccountId || '—'} to ${detail.toAccountId || '—'}`;

      // Menu / Pricing / Costing / Inventory
      case 'menu.item_create':
        return `Created menu item: ${detail.name} (Price: ${fmtCents(detail.priceCents)})`;
      case 'menu.item_update': {
        const updates: string[] = [];
        if (detail.name) updates.push(`Name: "${detail.name}"`);
        if (detail.priceCents) updates.push(`Price: ${fmtCents(detail.priceCents)}`);
        return `Updated menu item (${updates.join(', ') || 'Updated options'})`;
      }
      case 'price.override':
        return `Overrode price from ${fmtCents(detail.from)} to ${fmtCents(detail.to)}`;
      case 'menu.category_create':
        return `Created menu category: "${detail.name}"`;
      case 'menu.category_update':
        return `Updated menu category: "${detail.name || '—'}"`;

      // Customer
      case 'customer.create':
        return `Created customer: "${detail.name || '—'}" (${detail.phone || 'no phone'})`;
      case 'customer.update':
        return `Updated customer: "${detail.name || '—'}"`;

      // Reservations & Sessions
      case 'reservation.create':
        return `Created reservation starting at ${detail.startAt ? new Date(detail.startAt).toLocaleString('en-EG') : '—'}`;
      case 'order.transfer':
        return `Transferred order from Table ${detail.fromResourceName || '—'} to Table ${detail.toResourceName || '—'}`;
      case 'session.transfer':
        return `Transferred play session from ${detail.fromResourceName || '—'} to ${detail.toResourceName || '—'}`;
      case 'session.start':
        return `Started play session ${detail.isMultiplayer ? '(Multiplayer)' : '(Singleplayer)'}`;
      case 'session.stop':
        return `Stopped play session: Billed ${fmtCents(detail.billedCents)} for ${detail.billedMinutes || 0} min`;
      case 'order.customer':
        return `Linked customer to order`;
      case 'kds.send':
        return `Sent ${detail.tickets || 1} ticket(s) to KDS`;
      case 'order.abandon':
        return `Abandoned order`;
      case 'shift.x_report':
        return `Generated Shift X-Report`;
      case 'shift.z_report':
        return `Generated Shift Z-Report (Closed Shift)`;

      // Expense
      case 'expense.create':
        return `Recorded expense: "${detail.description}" for ${fmtCents(detail.amountCents)}`;
      case 'expense.delete':
        return `Deleted expense record`;

      // Recipe / Costing
      case 'recipe.update':
        return `Updated recipes / consumption formulas`;
      case 'ingredient.create':
        return `Created ingredient "${detail.name}" (Cost: ${fmtCents(detail.costCents)} / ${detail.uom || 'unit'})`;
      case 'ingredient.update':
        return `Updated ingredient details: "${detail.name || '—'}"`;

      default: {
        // Generic fallback: format keys and values nicely
        const cleanKeys = Object.entries(detail)
          .filter(([k]) => !k.endsWith('Id') && k !== 'password' && k !== 'pin')
          .map(([k, v]) => {
            const label = k.replace(/Cents$/, '').replace(/([A-Z])/g, ' $1').trim().toLowerCase();
            let valStr = String(v);
            if (k.endsWith('Cents')) {
              valStr = fmtCents(v);
            }
            return `${label}: ${valStr}`;
          });
        return cleanKeys.length > 0 ? cleanKeys.join(', ') : JSON.stringify(detail);
      }
    }
  } catch (err) {
    return JSON.stringify(detail);
  }
}
