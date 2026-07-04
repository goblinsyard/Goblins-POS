import { ReactNode } from 'react';
import {
  Wallet, Receipt, MapPin, Percent, UtensilsCrossed, Target, Gamepad2,
  Banknote, TrendingUp, PieChart, Flame, Users, Coffee, HardHat,
} from 'lucide-react';
import { api, egp, pct } from '../lib/api';
import { Spinner, useLoad } from '../lib/ui';
import { ChartCard, RevenueTrend, SharePie } from '../lib/charts';

interface Dashboard {
  revenueCents: number;
  revenueByDepartment: Record<string, number>;
  orderCount: number;
  occupancy: { occupied: number; total: number };
  laborClockedIn: number;
  foodCostPctBps: number;
  expensesTodayCents: number;
  topSellers: { name: string; qty: number; revenue: number }[];
}

interface SalesPoint {
  key: string;
  orders: number;
  revenueCents: number;
  quantity: number;
}

// 1. KPI Stat Card Component
function StatCard({
  title,
  value,
  icon,
  badge,
  badgeColor = 'bg-goblin-800 text-goblin-100',
  description,
  progress,
  progressColor = 'bg-goblin-600',
}: {
  title: string;
  value: string;
  icon: ReactNode;
  badge?: string;
  badgeColor?: string;
  description?: string;
  progress?: number;
  progressColor?: string;
}) {
  return (
    <div className="relative rounded-2xl border border-goblin-800 bg-goblin-900 p-5 shadow-sm hover:shadow-md transition-shadow">
      <div className="flex items-start justify-between">
        <div>
          <span className="text-xs font-bold uppercase tracking-wider text-goblin-400">{title}</span>
          <h3 className="mt-1.5 text-2xl font-extrabold text-goblin-50 font-mono">{value}</h3>
        </div>
        <div className="flex flex-col items-end gap-1.5">
          <span className="text-goblin-300">{icon}</span>
          {badge && (
            <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${badgeColor}`}>
              {badge}
            </span>
          )}
        </div>
      </div>
      {description && <p className="mt-2 text-xs text-goblin-300">{description}</p>}
      {progress !== undefined && (
        <div className="mt-3">
          <div className="h-1.5 w-full rounded-full bg-goblin-800 overflow-hidden">
            <div
              className={`h-full rounded-full ${progressColor} transition-all duration-500`}
              style={{ width: `${Math.max(0, Math.min(100, progress))}%` }}
            />
          </div>
        </div>
      )}
    </div>
  );
}

// 2. Main Dashboard Component
export function DashboardView() {
  const { data, error } = useLoad(() => api<Dashboard>('/reports/dashboard'));
  const { data: sales, error: salesError } = useLoad(() => api<SalesPoint[]>('/reports/sales?groupBy=day'));

  if (error) return <p className="p-8 text-red-600 font-semibold">Couldn’t load dashboard: {error}</p>;
  if (!data) return <Spinner />;

  // Calculate maximum sold count for Top Sellers relative progress calculation
  const maxQty = Math.max(...data.topSellers.map((t) => t.qty), 1);

  // Parse occupancy percent
  const occupancyPercent = data.occupancy.total > 0
    ? (data.occupancy.occupied / data.occupancy.total) * 100
    : 0;

  // Evaluate Food Cost indicator styling
  const foodCostVal = data.foodCostPctBps / 100;
  const isFoodCostLow = foodCostVal < 30;
  const foodCostBadge = isFoodCostLow ? 'Optimal' : 'Needs Review';
  const foodCostBadgeColor = isFoodCostLow
    ? 'bg-goblin-800 text-goblin-100 border border-goblin-700'
    : 'bg-amber-500/15 text-amber-500';
  const foodCostProgressColor = isFoodCostLow ? 'bg-goblin-600' : 'bg-amber-500';

  // Sorted revenue trend points for the last 7 days
  const trendPoints = [...(sales ?? [])]
    .sort((a, b) => a.key.localeCompare(b.key))
    .map((d) => {
      const parts = d.key.split('-');
      return {
        label: parts.length === 3 ? `${parts[1]}/${parts[2]}` : d.key,
        value: d.revenueCents,
      };
    });

  // Department revenue share slices
  const deptSlices = Object.entries(data.revenueByDepartment).map(([label, value]) => ({ label, value }));

  return (
    <div className="space-y-6">
      {/* 1. Header Row */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 border-b border-goblin-800 pb-4">
        <div>
          <h1 className="text-2xl font-black text-goblin-50">Yard Performance</h1>
          <p className="text-xs text-goblin-300 font-medium">Real-time metrics & financial analytics dashboard</p>
        </div>
        <div className="flex items-center gap-2">
          <span className="flex h-2 w-2 rounded-full bg-goblin-500 animate-pulse" />
          <span className="text-xs font-bold text-goblin-500 uppercase tracking-wide bg-goblin-800 border border-goblin-600 px-2.5 py-1 rounded-full">
            Live Feed
          </span>
        </div>
      </div>

      {/* 2. KPI Cards Grid */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          title="Revenue Today"
          value={egp(data.revenueCents)}
          icon={<Wallet className="h-4 w-4" />}
          badge="Daily Gross"
          badgeColor="bg-goblin-800 text-goblin-100 border border-goblin-700"
        />
        <StatCard
          title="Transactions"
          value={String(data.orderCount)}
          icon={<Receipt className="h-4 w-4" />}
          badge="Paid Orders"
          badgeColor="bg-goblin-800 text-goblin-100 border border-goblin-700"
        />
        <StatCard
          title="Asset Occupancy"
          value={`${data.occupancy.occupied} / ${data.occupancy.total}`}
          icon={<MapPin className="h-4 w-4" />}
          badge={`${Math.round(occupancyPercent)}% capacity`}
          badgeColor="bg-goblin-800 text-goblin-100 border border-goblin-700"
          progress={occupancyPercent}
          progressColor="bg-goblin-600"
        />
        <StatCard
          title="Food Cost Share"
          value={pct(data.foodCostPctBps)}
          icon={<Percent className="h-4 w-4" />}
          badge={foodCostBadge}
          badgeColor={foodCostBadgeColor}
          progress={foodCostVal}
          progressColor={foodCostProgressColor}
        />
        <StatCard
          title="Restaurant Sales"
          value={egp(data.revenueByDepartment.Restaurant ?? 0)}
          icon={<UtensilsCrossed className="h-4 w-4" />}
        />
        <StatCard
          title="Billiards Sales"
          value={egp(data.revenueByDepartment.Billiards ?? 0)}
          icon={<Target className="h-4 w-4" />}
        />
        <StatCard
          title="PlayStation Sales"
          value={egp(data.revenueByDepartment.PlayStation ?? 0)}
          icon={<Gamepad2 className="h-4 w-4" />}
        />
        <StatCard
          title="Expenses Today"
          value={egp(data.expensesTodayCents)}
          icon={<Banknote className="h-4 w-4" />}
          badge={data.expensesTodayCents > 0 ? 'Cash Outflow' : 'No Expenses'}
          badgeColor={data.expensesTodayCents > 0 ? 'bg-red-500/15 text-red-500' : 'bg-goblin-800 text-goblin-100'}
        />
      </div>

      {/* 3. Charts Grid */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Sales Trend */}
        <ChartCard
          className="lg:col-span-2"
          icon={<TrendingUp className="h-5 w-5" />}
          title="Sales Trend"
          subtitle="Daily gross revenue comparison over the last 7 days"
          right={
            <span className="text-[10px] font-bold text-goblin-400 bg-goblin-800 border border-goblin-700 px-2 py-0.5 rounded">
              7D Interval
            </span>
          }
        >
          {salesError ? (
            <p className="text-xs text-red-500 py-10 text-center">Failed to load weekly trends: {salesError}</p>
          ) : !sales ? (
            <div className="flex h-52 items-center justify-center">
              <span className="animate-spin inline-block w-6 h-6 border-2 border-goblin-600 border-t-transparent rounded-full" />
            </div>
          ) : (
            <RevenueTrend points={trendPoints} />
          )}
        </ChartCard>

        {/* Department Revenue Share */}
        <ChartCard
          icon={<PieChart className="h-5 w-5" />}
          title="Department Revenue"
          subtitle="Distribution share of sales channels today"
        >
          <SharePie slices={deptSlices} />
        </ChartCard>
      </div>

      {/* 4. Bottom Grid */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Top Sellers Popularity List */}
        <div className="rounded-2xl border border-goblin-800 bg-goblin-900 p-5 shadow-sm lg:col-span-2">
          <div className="mb-4">
            <h2 className="flex items-center gap-2 text-base font-bold text-goblin-50"><Flame className="h-5 w-5" />Top Sellers Today</h2>
            <p className="text-[11px] text-goblin-300 font-medium">Most popular inventory items by quantity sold</p>
          </div>
          <div className="space-y-4">
            {data.topSellers.map((item, idx) => {
              const percent = (item.qty / maxQty) * 100;
              return (
                <div key={idx} className="space-y-1.5">
                  <div className="flex items-center justify-between text-xs">
                    <div className="flex items-center gap-1.5 font-bold text-goblin-100">
                      <span className="flex h-5 w-5 items-center justify-center rounded-lg bg-goblin-800 text-[10px] text-goblin-300 border">
                        {idx + 1}
                      </span>
                      <span>{item.name}</span>
                    </div>
                    <span className="text-goblin-300 font-mono text-[11px]">
                      <span className="font-extrabold text-goblin-50">{item.qty}</span> sold ·{' '}
                      <span className="font-semibold text-goblin-100">{egp(item.revenue)}</span>
                    </span>
                  </div>
                  <div className="h-2 w-full rounded-full bg-goblin-800 overflow-hidden">
                    <div
                      className="h-full rounded-full bg-goblin-600 transition-all duration-500"
                      style={{ width: `${percent}%` }}
                    />
                  </div>
                </div>
              );
            })}
            {!data.topSellers.length && (
              <div className="py-8 text-center text-xs text-goblin-400">No products sold today yet.</div>
            )}
          </div>
        </div>

        {/* Operations & Staff Quick Info */}
        <div className="rounded-2xl border border-goblin-800 bg-goblin-900 p-5 shadow-sm flex flex-col justify-between">
          <div>
            <h2 className="flex items-center gap-2 text-base font-bold text-goblin-50"><Users className="h-5 w-5" />Today's Operations</h2>
            <p className="text-[11px] text-goblin-300 font-medium">Quick snapshot of staff activity and attendance</p>
          </div>
          <div className="my-4 space-y-4 flex-1 flex flex-col justify-center">
            <div className="flex items-center justify-between rounded-xl bg-goblin-800 border p-3.5">
              <div className="flex items-center gap-3">
                <HardHat className="h-5 w-5 text-goblin-300" />
                <div>
                  <h4 className="text-xs font-bold text-goblin-100">Clocked-in Staff</h4>
                  <p className="text-[10px] text-goblin-400">Currently active on shift</p>
                </div>
              </div>
              <span className="text-xl font-extrabold text-goblin-100 font-mono bg-goblin-800 border border-goblin-700 px-3 py-1 rounded-lg">
                {data.laborClockedIn}
              </span>
            </div>

            <div className="flex items-center justify-between rounded-xl bg-goblin-800 border p-3.5">
              <div className="flex items-center gap-3">
                <Coffee className="h-5 w-5 text-goblin-300" />
                <div>
                  <h4 className="text-xs font-bold text-goblin-100">Food Cost Status</h4>
                  <p className="text-[10px] text-goblin-400">COGS to Sales relation</p>
                </div>
              </div>
              <span
                className={`text-[10px] font-bold uppercase tracking-wider px-2.5 py-1 rounded-full ${
                  isFoodCostLow
                    ? 'bg-goblin-800 text-goblin-100 border border-goblin-700'
                    : 'bg-amber-500/15 text-amber-500'
                }`}
              >
                {isFoodCostLow ? 'Healthy' : 'Investigate'}
              </span>
            </div>
          </div>
          <div className="border-t border-goblin-800 pt-3 text-center">
            <span className="text-[10px] font-semibold text-goblin-400 uppercase tracking-widest">
              Goblins POS Platform
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
