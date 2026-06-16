import { useState } from 'react';
import { api, hasToken, setToken } from './lib/api';
import { AuditView } from './tabs/Audit';
import { CrmView } from './tabs/Crm';
import { DashboardView } from './tabs/Dashboard';
import { ExpensesView } from './tabs/Expenses';
import { AccountingView } from './tabs/Accounting';
import { InventoryView } from './tabs/Inventory';
import { MenuView } from './tabs/MenuTab';
import { PnlView } from './tabs/Pnl';
import { PurchasingView } from './tabs/Purchasing';
import { RatePlansView } from './tabs/RatePlans';
import { RecipesView } from './tabs/Recipes';
import { ReservationsView } from './tabs/Reservations';
import { SalesView } from './tabs/Sales';
import { SettingsView } from './tabs/Settings';
import { StaffView } from './tabs/Staff';
import { TablesView } from './tabs/Tables';
import { UtilizationView } from './tabs/Utilization';

function Login({ onDone }: { onDone: () => void }) {
  const [email, setEmail] = useState('owner@goblinsyard.com');
  const [password, setPassword] = useState('');
  const [err, setErr] = useState('');

  async function submit() {
    try {
      const res = await api<{ accessToken: string }>('/auth/login', { method: 'POST', body: { email, password } });
      setToken(res.accessToken);
      onDone();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Login failed');
    }
  }

  return (
    <div className="flex h-screen items-center justify-center bg-slate-100">
      <div className="w-96 rounded-2xl bg-white p-8 shadow-lg">
        <h1 className="mb-6 text-2xl font-bold text-emerald-800">Goblins Yard — Back Office</h1>
        {err && <p className="mb-3 rounded bg-red-100 p-2 text-sm text-red-700">{err}</p>}
        <input className="mb-3 w-full rounded-lg border p-3" placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} />
        <input className="mb-4 w-full rounded-lg border p-3" type="password" placeholder="Password"
          value={password} onChange={(e) => setPassword(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && void submit()} />
        <button onClick={() => void submit()} className="w-full rounded-lg bg-emerald-700 py-3 font-semibold text-white">
          Sign in
        </button>
      </div>
    </div>
  );
}

const NAV: { section: string; tabs: { name: string; view: () => JSX.Element }[] }[] = [
  {
    section: 'Analytics',
    tabs: [
      { name: 'Dashboard', view: DashboardView },
      { name: 'Sales', view: SalesView },
      { name: 'Utilization', view: UtilizationView },
      { name: 'P&L + Costs', view: PnlView },
    ],
  },
  {
    section: 'Operations',
    tabs: [
      { name: 'Inventory', view: InventoryView },
      { name: 'Purchasing', view: PurchasingView },
      { name: 'Reservations', view: ReservationsView },
      { name: 'Customers', view: CrmView },
      { name: 'Expenses', view: ExpensesView },
      { name: 'Accounting', view: AccountingView },
    ],
  },
  {
    section: 'Configuration',
    tabs: [
      { name: 'Menu', view: MenuView },
      { name: 'Recipes', view: RecipesView },
      { name: 'Tables', view: TablesView },
      { name: 'Rate plans', view: RatePlansView },
      { name: 'Staff', view: StaffView },
      { name: 'Settings', view: SettingsView },
      { name: 'Audit', view: AuditView },
    ],
  },
];

export function App() {
  const [authed, setAuthed] = useState(hasToken());
  const [tab, setTab] = useState('Dashboard');
  const [sidebarOpen, setSidebarOpen] = useState(false);

  if (!authed) return <Login onDone={() => setAuthed(true)} />;
  const View = NAV.flatMap((s) => s.tabs).find((t) => t.name === tab)?.view ?? DashboardView;
  return (
    <div className="flex h-screen flex-col md:flex-row bg-slate-100 overflow-hidden">
      {/* Mobile Top Header */}
      <header className="flex h-14 items-center justify-between bg-emerald-950 px-4 text-emerald-100 md:hidden shadow-md">
        <button onClick={() => setSidebarOpen(true)} className="rounded-lg p-2 text-xl hover:bg-emerald-900 active:bg-emerald-800">
          ☰
        </button>
        <h1 className="text-base font-bold">🟢 Goblins Yard</h1>
        <div className="w-10" /> {/* Spacer for symmetry */}
      </header>

      {/* Sidebar Overlay Backdrop for Mobile */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/55 md:hidden transition-opacity"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Sidebar Drawer */}
      <aside
        className={`fixed inset-y-0 left-0 z-50 flex w-52 flex-col gap-1 overflow-y-auto bg-emerald-950 p-3 text-emerald-100 transition-transform duration-200 ease-in-out md:static md:translate-x-0 ${
          sidebarOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <div className="flex items-center justify-between mb-2 px-2">
          <h1 className="text-lg font-bold">🟢 Goblins Yard</h1>
          <button
            onClick={() => setSidebarOpen(false)}
            className="rounded-lg p-1.5 hover:bg-emerald-900 md:hidden text-emerald-300"
          >
            ✕
          </button>
        </div>
        {NAV.map((group) => (
          <div key={group.section}>
            <p className="mb-1 mt-3 px-3 text-[10px] font-semibold uppercase tracking-widest text-emerald-500">{group.section}</p>
            {group.tabs.map((t) => (
              <button key={t.name} onClick={() => { setTab(t.name); setSidebarOpen(false); }}
                className={`w-full rounded-lg px-3 py-2 text-left text-sm ${t.name === tab ? 'bg-emerald-700 font-semibold' : 'hover:bg-emerald-900'}`}>
                {t.name}
              </button>
            ))}
          </div>
        ))}
        <button onClick={() => { setToken(null); location.reload(); }}
          className="mt-auto rounded-lg px-3 py-2 text-left text-sm text-emerald-300 hover:bg-emerald-900">
          Sign out
        </button>
      </aside>

      {/* Main Content */}
      <main className="flex-1 overflow-auto p-4 md:p-6">
        <View />
      </main>
    </div>
  );
}
