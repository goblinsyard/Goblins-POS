import { useState } from 'react';
import { api, egp, pct } from '../lib/api';
import { Spinner, useLoad } from '../lib/ui';

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
  badgeColor = 'bg-slate-100 text-slate-700',
  description,
  progress,
  progressColor = 'bg-emerald-600',
}: {
  title: string;
  value: string;
  icon: string;
  badge?: string;
  badgeColor?: string;
  description?: string;
  progress?: number;
  progressColor?: string;
}) {
  return (
    <div className="relative rounded-2xl border border-slate-100 bg-white p-5 shadow-sm hover:shadow-md transition-shadow">
      <div className="flex items-start justify-between">
        <div>
          <span className="text-xs font-bold uppercase tracking-wider text-slate-400">{title}</span>
          <h3 className="mt-1.5 text-2xl font-extrabold text-slate-800 font-mono">{value}</h3>
        </div>
        <div className="flex flex-col items-end gap-1.5">
          <span className="text-xl">{icon}</span>
          {badge && (
            <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${badgeColor}`}>
              {badge}
            </span>
          )}
        </div>
      </div>
      {description && <p className="mt-2 text-xs text-slate-500">{description}</p>}
      {progress !== undefined && (
        <div className="mt-3">
          <div className="h-1.5 w-full rounded-full bg-slate-100 overflow-hidden">
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

// 2. Custom SVG Line Chart with Tooltips
function SalesTrendChart({ data }: { data: SalesPoint[] }) {
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null);

  if (!data || data.length === 0) {
    return (
      <div className="flex h-52 items-center justify-center text-xs text-slate-400">
        No sales trend data available for this week.
      </div>
    );
  }

  // Sort by date key to ensure correct chronological rendering
  const sortedData = [...data].sort((a, b) => a.key.localeCompare(b.key));

  const width = 600;
  const height = 240;
  const paddingLeft = 55;
  const paddingRight = 30;
  const paddingTop = 30;
  const paddingBottom = 40;

  const plotWidth = width - paddingLeft - paddingRight;
  const plotHeight = height - paddingTop - paddingBottom;

  const maxRev = Math.max(...sortedData.map((d) => d.revenueCents), 100000); // minimum 1000 EGP to display nicely

  const points = sortedData.map((d, i) => {
    const x = paddingLeft + (i / Math.max(1, sortedData.length - 1)) * plotWidth;
    const y = paddingTop + plotHeight - (d.revenueCents / maxRev) * plotHeight;
    return { x, y, ...d };
  });

  const linePath = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ');
  const firstPoint = points[0];
  const lastPoint = points[points.length - 1];
  const areaPath = points.length > 0 && firstPoint && lastPoint
    ? `${linePath} L ${lastPoint.x} ${height - paddingBottom} L ${firstPoint.x} ${height - paddingBottom} Z`
    : '';

  const gridRatios = [0, 0.25, 0.5, 0.75, 1];

  return (
    <div className="relative">
      <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-auto overflow-visible">
        <defs>
          <linearGradient id="areaGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#059669" stopOpacity="0.2" />
            <stop offset="100%" stopColor="#059669" stopOpacity="0.0" />
          </linearGradient>
        </defs>

        {/* Y Grid Lines & Axes Labels */}
        {gridRatios.map((ratio, idx) => {
          const y = paddingTop + plotHeight - ratio * plotHeight;
          const val = (ratio * maxRev) / 100;
          return (
            <g key={idx}>
              <line
                x1={paddingLeft}
                y1={y}
                x2={width - paddingRight}
                y2={y}
                stroke="#f1f5f9"
                strokeWidth="1"
              />
              <text
                x={paddingLeft - 10}
                y={y + 3}
                className="text-[9px] font-mono fill-slate-400 text-right"
                textAnchor="end"
              >
                {Math.round(val).toLocaleString()} EGP
              </text>
            </g>
          );
        })}

        {/* Area Gradient Fill */}
        {areaPath && <path d={areaPath} fill="url(#areaGrad)" />}

        {/* Primary Line */}
        {linePath && (
          <path
            d={linePath}
            fill="none"
            stroke="#059669"
            strokeWidth="3"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        )}

        {/* Grid Point Circles */}
        {points.map((p, idx) => (
          <circle
            key={idx}
            cx={p.x}
            cy={p.y}
            r={hoveredIdx === idx ? 6 : 4}
            className="fill-emerald-600 stroke-white stroke-2 transition-all duration-150 cursor-pointer"
          />
        ))}

        {/* Date Labels (X-Axis) */}
        {points.map((p, idx) => {
          const parts = p.key.split('-');
          const label = parts.length === 3 ? `${parts[1]}/${parts[2]}` : p.key;
          return (
            <text
              key={idx}
              x={p.x}
              y={height - paddingBottom + 16}
              className="text-[9px] font-mono fill-slate-500 font-bold"
              textAnchor="middle"
            >
              {label}
            </text>
          );
        })}

        {/* Invisible Hover Hitboxes */}
        {points.map((p, idx) => (
          <rect
            key={idx}
            x={p.x - plotWidth / (2 * Math.max(1, sortedData.length - 1))}
            y={paddingTop}
            width={plotWidth / Math.max(1, sortedData.length - 1)}
            height={plotHeight}
            fill="transparent"
            className="cursor-pointer"
            onMouseEnter={() => setHoveredIdx(idx)}
            onMouseLeave={() => setHoveredIdx(null)}
          />
        ))}
      </svg>

      {/* HTML Hover Tooltip */}
      {hoveredIdx !== null && points[hoveredIdx] && (() => {
        const p = points[hoveredIdx];
        return (
          <div
            className="absolute z-20 bg-slate-900/95 backdrop-blur text-white rounded-xl p-2.5 text-xs shadow-xl border border-slate-800 -translate-x-1/2 -translate-y-full pointer-events-none transition-all duration-100"
            style={{
              left: `${(p.x / width) * 100}%`,
              top: `${(p.y / height) * 100 - 4}%`,
            }}
          >
            <div className="font-bold text-slate-300 mb-0.5">{p.key}</div>
            <div className="text-emerald-400 font-mono font-bold">{(p.revenueCents / 100).toLocaleString()} EGP</div>
            <div className="text-slate-400 text-[10px] mt-0.5">{p.orders} orders</div>
          </div>
        );
      })()}
    </div>
  );
}

// 3. Custom SVG Donut Chart for Department shares
function DepartmentDonutChart({ data }: { data: Record<string, number> }) {
  const entries = Object.entries(data).filter(([_, val]) => val > 0);
  const total = entries.reduce((a, [_, val]) => a + val, 0);

  if (total === 0) {
    return (
      <div className="flex h-52 items-center justify-center text-xs text-slate-400">
        No department sales records for today.
      </div>
    );
  }

  const COLORS: Record<string, string> = {
    Restaurant: '#10b981',   // Emerald
    Billiards: '#6366f1',    // Indigo
    PlayStation: '#f59e0b',  // Amber
  };

  const TEXT_COLORS: Record<string, string> = {
    Restaurant: 'text-emerald-600',
    Billiards: 'text-indigo-600',
    PlayStation: 'text-amber-500',
  };

  const BG_COLORS: Record<string, string> = {
    Restaurant: 'bg-emerald-500',
    Billiards: 'bg-indigo-500',
    PlayStation: 'bg-amber-500',
  };

  const radius = 50;
  const strokeWidth = 12;
  const circumference = 2 * Math.PI * radius; // ~314.159

  let accumulatedPercent = 0;

  const segments = entries.map(([dept, val]) => {
    const percent = val / total;
    const strokeLength = percent * circumference;
    const strokeOffset = -accumulatedPercent * circumference;
    accumulatedPercent += percent;
    return {
      dept,
      val,
      percent,
      strokeLength,
      strokeOffset,
      color: COLORS[dept] ?? '#64748b',
    };
  });

  return (
    <div className="flex flex-col sm:flex-row items-center justify-around gap-6 py-2">
      {/* SVG Donut */}
      <div className="relative w-36 h-36 flex-shrink-0">
        <svg viewBox="0 0 120 120" className="w-full h-full transform -rotate-90">
          {segments.map((seg, idx) => (
            <circle
              key={idx}
              cx="60"
              cy="60"
              r={radius}
              fill="transparent"
              stroke={seg.color}
              strokeWidth={strokeWidth}
              strokeDasharray={`${seg.strokeLength} ${circumference}`}
              strokeDashoffset={seg.strokeOffset}
              className="transition-all duration-300 hover:opacity-90"
            />
          ))}
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center text-center pointer-events-none">
          <span className="text-[9px] uppercase font-bold tracking-wider text-slate-400">Total</span>
          <span className="text-sm font-black text-slate-800 font-mono">
            {Math.round(total / 100).toLocaleString()}
          </span>
          <span className="text-[8px] text-slate-400">EGP</span>
        </div>
      </div>

      {/* Legend & Details */}
      <div className="flex-1 space-y-2.5 w-full">
        {segments.map((seg, idx) => (
          <div
            key={idx}
            className="flex items-center justify-between border-b border-slate-50 pb-1.5 last:border-0 last:pb-0"
          >
            <div className="flex items-center gap-2">
              <span className={`h-2.5 w-2.5 rounded-full ${BG_COLORS[seg.dept] ?? 'bg-slate-400'}`} />
              <span className="text-xs font-bold text-slate-600">{seg.dept}</span>
            </div>
            <div className="text-right">
              <div className="text-xs font-mono font-bold text-slate-800">
                {(seg.val / 100).toLocaleString()} EGP
              </div>
              <div className={`text-[10px] font-bold ${TEXT_COLORS[seg.dept] ?? 'text-slate-400'}`}>
                {Math.round(seg.percent * 100)}% share
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// 4. Main Dashboard Component
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
    ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
    : 'bg-amber-50 text-amber-700 border border-amber-200';
  const foodCostProgressColor = isFoodCostLow ? 'bg-emerald-600' : 'bg-amber-500';

  return (
    <div className="space-y-6">
      {/* 1. Header Row */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 border-b border-slate-100 pb-4">
        <div>
          <h1 className="text-2xl font-black text-slate-800">Yard Performance</h1>
          <p className="text-xs text-slate-500 font-medium">Real-time metrics & financial analytics dashboard</p>
        </div>
        <div className="flex items-center gap-2">
          <span className="flex h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
          <span className="text-xs font-bold text-emerald-700 uppercase tracking-wide bg-emerald-50 border border-emerald-200 px-2.5 py-1 rounded-full">
            Live Feed
          </span>
        </div>
      </div>

      {/* 2. KPI Cards Grid */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          title="Revenue Today"
          value={egp(data.revenueCents)}
          icon="💰"
          badge="Daily Gross"
          badgeColor="bg-emerald-50 text-emerald-700 border border-emerald-200"
        />
        <StatCard
          title="Transactions"
          value={String(data.orderCount)}
          icon="🎫"
          badge="Paid Orders"
          badgeColor="bg-indigo-50 text-indigo-700 border border-indigo-200"
        />
        <StatCard
          title="Asset Occupancy"
          value={`${data.occupancy.occupied} / ${data.occupancy.total}`}
          icon="📍"
          badge={`${Math.round(occupancyPercent)}% capacity`}
          badgeColor="bg-slate-100 text-slate-700 border border-slate-200"
          progress={occupancyPercent}
          progressColor="bg-indigo-600"
        />
        <StatCard
          title="Food Cost Share"
          value={pct(data.foodCostPctBps)}
          icon="🥗"
          badge={foodCostBadge}
          badgeColor={foodCostBadgeColor}
          progress={foodCostVal}
          progressColor={foodCostProgressColor}
        />
        <StatCard
          title="Restaurant Sales"
          value={egp(data.revenueByDepartment.Restaurant ?? 0)}
          icon="🍽️"
        />
        <StatCard
          title="Billiards Sales"
          value={egp(data.revenueByDepartment.Billiards ?? 0)}
          icon="🎱"
        />
        <StatCard
          title="PlayStation Sales"
          value={egp(data.revenueByDepartment.PlayStation ?? 0)}
          icon="🎮"
        />
        <StatCard
          title="Expenses Today"
          value={egp(data.expensesTodayCents)}
          icon="💸"
          badge={data.expensesTodayCents > 0 ? 'Cash Outflow' : 'No Expenses'}
          badgeColor={data.expensesTodayCents > 0 ? 'bg-red-50 text-red-700 border border-red-200' : 'bg-slate-100 text-slate-700'}
        />
      </div>

      {/* 3. Charts Grid */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Sales Trend SVG line chart */}
        <div className="rounded-2xl border border-slate-100 bg-white p-5 shadow-sm lg:col-span-2">
          <div className="mb-4 flex items-center justify-between">
            <div>
              <h2 className="text-base font-bold text-slate-800">📈 Sales Trend</h2>
              <p className="text-[11px] text-slate-500 font-medium">Daily gross revenue comparison over the last 7 days</p>
            </div>
            <span className="text-[10px] font-bold text-slate-400 bg-slate-50 border px-2 py-0.5 rounded">
              7D Interval
            </span>
          </div>
          {salesError ? (
            <p className="text-xs text-red-500 py-10 text-center">Failed to load weekly trends: {salesError}</p>
          ) : !sales ? (
            <div className="flex h-52 items-center justify-center">
              <span className="animate-spin inline-block w-6 h-6 border-2 border-emerald-600 border-t-transparent rounded-full" />
            </div>
          ) : (
            <SalesTrendChart data={sales} />
          )}
        </div>

        {/* Department Share SVG Donut chart */}
        <div className="rounded-2xl border border-slate-100 bg-white p-5 shadow-sm">
          <div>
            <h2 className="text-base font-bold text-slate-800">🍩 Department Revenue</h2>
            <p className="text-[11px] text-slate-500 font-medium">Distribution share of sales channels today</p>
          </div>
          <div className="mt-4">
            <DepartmentDonutChart data={data.revenueByDepartment} />
          </div>
        </div>
      </div>

      {/* 4. Bottom Grid */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Top Sellers Popularity List */}
        <div className="rounded-2xl border border-slate-100 bg-white p-5 shadow-sm lg:col-span-2">
          <div className="mb-4">
            <h2 className="text-base font-bold text-slate-800">🔥 Top Sellers Today</h2>
            <p className="text-[11px] text-slate-500 font-medium">Most popular inventory items by quantity sold</p>
          </div>
          <div className="space-y-4">
            {data.topSellers.map((item, idx) => {
              const percent = (item.qty / maxQty) * 100;
              return (
                <div key={idx} className="space-y-1.5">
                  <div className="flex items-center justify-between text-xs">
                    <div className="flex items-center gap-1.5 font-bold text-slate-700">
                      <span className="flex h-5 w-5 items-center justify-center rounded-lg bg-slate-50 text-[10px] text-slate-500 border">
                        {idx + 1}
                      </span>
                      <span>{item.name}</span>
                    </div>
                    <span className="text-slate-500 font-mono text-[11px]">
                      <span className="font-extrabold text-slate-800">{item.qty}</span> sold ·{' '}
                      <span className="font-semibold text-slate-700">{egp(item.revenue)}</span>
                    </span>
                  </div>
                  <div className="h-2 w-full rounded-full bg-slate-100 overflow-hidden">
                    <div
                      className="h-full rounded-full bg-emerald-600 transition-all duration-500"
                      style={{ width: `${percent}%` }}
                    />
                  </div>
                </div>
              );
            })}
            {!data.topSellers.length && (
              <div className="py-8 text-center text-xs text-slate-400">No products sold today yet.</div>
            )}
          </div>
        </div>

        {/* Operations & Staff Quick Info */}
        <div className="rounded-2xl border border-slate-100 bg-white p-5 shadow-sm flex flex-col justify-between">
          <div>
            <h2 className="text-base font-bold text-slate-800">👥 Today's Operations</h2>
            <p className="text-[11px] text-slate-500 font-medium">Quick snapshot of staff activity and attendance</p>
          </div>
          <div className="my-4 space-y-4 flex-1 flex flex-col justify-center">
            <div className="flex items-center justify-between rounded-xl bg-slate-50 border p-3.5">
              <div className="flex items-center gap-3">
                <span className="text-2xl">👷</span>
                <div>
                  <h4 className="text-xs font-bold text-slate-700">Clocked-in Staff</h4>
                  <p className="text-[10px] text-slate-400">Currently active on shift</p>
                </div>
              </div>
              <span className="text-xl font-extrabold text-indigo-700 font-mono bg-indigo-50 border border-indigo-200 px-3 py-1 rounded-lg">
                {data.laborClockedIn}
              </span>
            </div>

            <div className="flex items-center justify-between rounded-xl bg-slate-50 border p-3.5">
              <div className="flex items-center gap-3">
                <span className="text-2xl">☕</span>
                <div>
                  <h4 className="text-xs font-bold text-slate-700">Food Cost Status</h4>
                  <p className="text-[10px] text-slate-400">COGS to Sales relation</p>
                </div>
              </div>
              <span
                className={`text-[10px] font-bold uppercase tracking-wider px-2.5 py-1 rounded-full border ${
                  isFoodCostLow
                    ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                    : 'bg-amber-50 text-amber-700 border-amber-200'
                }`}
              >
                {isFoodCostLow ? 'Healthy' : 'Investigate'}
              </span>
            </div>
          </div>
          <div className="border-t border-slate-100 pt-3 text-center">
            <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-widest">
              Goblins POS Platform
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
