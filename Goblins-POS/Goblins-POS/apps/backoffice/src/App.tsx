import { useState } from 'react';
import {
  LayoutDashboard, TrendingUp, Gauge, Landmark, Package, ShoppingCart, CalendarClock,
  Users, Receipt, BookOpen, UtensilsCrossed, ChefHat, LayoutGrid, Clock, UserCog,
  Settings as SettingsIcon, ScrollText, Menu as MenuIcon, X, Moon, Sun, LogOut, Store, Languages,
  type LucideIcon,
} from 'lucide-react';
import { api, hasToken, setToken } from './lib/api';
import { getLang, setLang, t, type Lang } from './lib/i18n';
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

/** Apply and persist the light/dark appearance (goblin theme in both). */
function applyMode(m: 'light' | 'dark') {
  localStorage.setItem('bo.mode', m);
  document.documentElement.classList.toggle('light', m === 'light');
}

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
      setErr(e instanceof Error ? e.message : t('loginFailed'));
    }
  }

  return (
    <div className="flex h-screen items-center justify-center bg-goblin-950">
      <div className="w-96 rounded-2xl bg-goblin-900 p-8 shadow-lg ring-1 ring-goblin-700">
        <h1 className="mb-6 flex items-center gap-2 text-2xl font-bold text-goblin-500">
          <Store className="h-6 w-6" /> {t('brand')} — {t('appName')}
        </h1>
        {err && <p className="mb-3 rounded bg-red-500/15 p-2 text-sm text-red-500">{err}</p>}
        <input className="mb-3 w-full rounded-lg border border-goblin-700 bg-goblin-900 p-3 text-goblin-50 placeholder:text-goblin-400 focus:border-goblin-500 focus:outline-none focus:ring-1 focus:ring-goblin-500"
          placeholder={t('email')} value={email} onChange={(e) => setEmail(e.target.value)} />
        <input className="mb-4 w-full rounded-lg border border-goblin-700 bg-goblin-900 p-3 text-goblin-50 placeholder:text-goblin-400 focus:border-goblin-500 focus:outline-none focus:ring-1 focus:ring-goblin-500"
          type="password" placeholder={t('password')}
          value={password} onChange={(e) => setPassword(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && void submit()} />
        <button onClick={() => void submit()} className="w-full rounded-lg bg-goblin-600 py-3 font-semibold text-white hover:bg-goblin-500 transition-colors">
          {t('signIn')}
        </button>
      </div>
    </div>
  );
}

const NAV: { section: string; tabs: { name: string; view: () => JSX.Element; icon: LucideIcon }[] }[] = [
  {
    section: 'Analytics',
    tabs: [
      { name: 'Dashboard', view: DashboardView, icon: LayoutDashboard },
      { name: 'Sales', view: SalesView, icon: TrendingUp },
      { name: 'Utilization', view: UtilizationView, icon: Gauge },
      { name: 'P&L + Costs', view: PnlView, icon: Landmark },
    ],
  },
  {
    section: 'Operations',
    tabs: [
      { name: 'Inventory', view: InventoryView, icon: Package },
      { name: 'Purchasing', view: PurchasingView, icon: ShoppingCart },
      { name: 'Reservations', view: ReservationsView, icon: CalendarClock },
      { name: 'Customers', view: CrmView, icon: Users },
      { name: 'Expenses', view: ExpensesView, icon: Receipt },
      { name: 'Accounting', view: AccountingView, icon: BookOpen },
    ],
  },
  {
    section: 'Configuration',
    tabs: [
      { name: 'Menu', view: MenuView, icon: UtensilsCrossed },
      { name: 'Recipes', view: RecipesView, icon: ChefHat },
      { name: 'Tables', view: TablesView, icon: LayoutGrid },
      { name: 'Rate plans', view: RatePlansView, icon: Clock },
      { name: 'Staff', view: StaffView, icon: UserCog },
      { name: 'Settings', view: SettingsView, icon: SettingsIcon },
      { name: 'Audit', view: AuditView, icon: ScrollText },
    ],
  },
];

export function App() {
  const [authed, setAuthed] = useState(hasToken());
  const [tab, setTab] = useState('Dashboard');
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [mode, setMode] = useState<'light' | 'dark'>(
    (localStorage.getItem('bo.mode') as 'light' | 'dark') ?? 'light',
  );
  const [lang, setLangState] = useState<Lang>(getLang());

  function toggleMode() {
    const next = mode === 'light' ? 'dark' : 'light';
    setMode(next);
    applyMode(next);
  }
  function toggleLang() {
    const next: Lang = lang === 'en' ? 'ar' : 'en';
    setLang(next);
    setLangState(next);
  }

  if (!authed) return <Login onDone={() => setAuthed(true)} />;
  const View = NAV.flatMap((s) => s.tabs).find((t2) => t2.name === tab)?.view ?? DashboardView;
  return (
    <div className="flex h-screen flex-col md:flex-row bg-goblin-950 text-goblin-100 overflow-hidden">
      {/* Mobile Top Header */}
      <header className="flex h-14 items-center justify-between bg-goblin-900 px-4 text-goblin-100 md:hidden shadow-md border-b border-goblin-700">
        <button onClick={() => setSidebarOpen(true)} className="rounded-lg p-2 hover:bg-goblin-800 active:bg-goblin-700">
          <MenuIcon className="h-5 w-5" />
        </button>
        <h1 className="flex items-center gap-2 text-base font-bold"><Store className="h-4 w-4 text-goblin-500" /> {t('brand')}</h1>
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
        className={`fixed inset-y-0 z-50 flex w-52 flex-col gap-1 overflow-y-auto bg-goblin-900 p-3 text-goblin-100 border-e border-goblin-700 transition-transform duration-200 ease-in-out ltr:left-0 rtl:right-0 md:static md:!translate-x-0 ${
          sidebarOpen ? 'translate-x-0' : 'ltr:-translate-x-full rtl:translate-x-full'
        }`}
      >
        <div className="flex items-center justify-between mb-2 px-2">
          <h1 className="flex items-center gap-2 text-lg font-bold text-goblin-50"><Store className="h-5 w-5 text-goblin-500" /> {t('brand')}</h1>
          <button
            onClick={() => setSidebarOpen(false)}
            className="rounded-lg p-1.5 hover:bg-goblin-800 md:hidden text-goblin-400"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        {NAV.map((group) => (
          <div key={group.section}>
            <p className="mb-1 mt-3 px-3 text-[10px] font-semibold uppercase tracking-widest text-goblin-400">{t(group.section)}</p>
            {group.tabs.map((t2) => {
              const Icon = t2.icon;
              return (
                <button key={t2.name} onClick={() => { setTab(t2.name); setSidebarOpen(false); }}
                  className={`flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-start text-sm transition-colors ${t2.name === tab ? 'bg-goblin-600 text-white font-semibold' : 'hover:bg-goblin-800'}`}>
                  <Icon className="h-4 w-4 shrink-0" /> {t(t2.name)}
                </button>
              );
            })}
          </div>
        ))}
        <button onClick={toggleLang}
          className="mt-auto flex items-center gap-2.5 rounded-lg px-3 py-2 text-start text-sm text-goblin-300 hover:bg-goblin-800">
          <Languages className="h-4 w-4" /> {lang === 'en' ? 'العربية' : 'English'}
        </button>
        <button onClick={toggleMode}
          className="flex items-center gap-2.5 rounded-lg px-3 py-2 text-start text-sm text-goblin-300 hover:bg-goblin-800">
          {mode === 'light' ? <Moon className="h-4 w-4" /> : <Sun className="h-4 w-4" />}
          {mode === 'light' ? t('darkMode') : t('lightMode')}
        </button>
        <button onClick={() => { setToken(null); location.reload(); }}
          className="flex items-center gap-2.5 rounded-lg px-3 py-2 text-start text-sm text-goblin-300 hover:bg-goblin-800">
          <LogOut className="h-4 w-4" /> {t('signOut')}
        </button>
      </aside>

      {/* Main Content */}
      <main className="flex-1 overflow-auto p-4 md:p-6">
        <View />
      </main>
    </div>
  );
}
