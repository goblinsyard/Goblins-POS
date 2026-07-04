import { ReactNode } from 'react';
import {
  Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Legend, Pie, PieChart,
  ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import { egp } from './api';

/**
 * Themed chart primitives built on Recharts, following the data-viz method:
 *  - single-series charts use the brand green + NO legend (title names the series);
 *  - categorical charts use the validated, CVD-safe palette in FIXED slot order
 *    (var(--chart-1..6) — green-free, themed light/dark via theme.css);
 *  - one axis only (never dual), recessive grid/axes, tooltips on by default.
 * Colors are CSS vars so charts re-theme instantly with the light/dark toggle.
 */

export const CHART_COLORS = [
  'var(--chart-1)', 'var(--chart-2)', 'var(--chart-3)',
  'var(--chart-4)', 'var(--chart-5)', 'var(--chart-6)',
];
export const BRAND = 'rgb(var(--goblin-500))';

const GRID = 'rgb(var(--goblin-700))';
const AXIS_INK = 'rgb(var(--goblin-400))';
const shortEgp = (cents: number) => {
  const v = cents / 100;
  if (Math.abs(v) >= 1000) return `${Math.round(v / 1000)}k`;
  return String(Math.round(v));
};

/** Card frame so every chart sits in a consistent titled surface. */
export function ChartCard({ title, subtitle, icon, right, children, className = '' }: {
  title: string; subtitle?: string; icon?: ReactNode; right?: ReactNode; children: ReactNode; className?: string;
}) {
  return (
    <div className={`rounded-2xl border border-goblin-800 bg-goblin-900 p-5 shadow-sm ${className}`}>
      <div className="mb-4 flex items-start justify-between gap-2">
        <div>
          <h2 className="flex items-center gap-2 text-base font-bold text-goblin-50">{icon}{title}</h2>
          {subtitle && <p className="text-[11px] font-medium text-goblin-300">{subtitle}</p>}
        </div>
        {right}
      </div>
      {children}
    </div>
  );
}

/** Themed tooltip — one row per series, values right-aligned & monospaced. */
function ChartTooltip({ active, payload, label, format }: {
  active?: boolean; payload?: { name: string; value: number; color: string }[]; label?: string;
  format: (n: number) => string;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-xl border border-goblin-700 bg-goblin-900 px-3 py-2 text-xs shadow-xl">
      {label != null && <div className="mb-1 font-bold text-goblin-300">{label}</div>}
      {payload.map((p, i) => (
        <div key={i} className="flex items-center justify-between gap-4">
          <span className="flex items-center gap-1.5 text-goblin-200">
            <span className="h-2.5 w-2.5 rounded-sm" style={{ background: p.color }} />
            {p.name}
          </span>
          <span className="font-mono font-bold text-goblin-50 tabular-nums">{format(p.value)}</span>
        </div>
      ))}
    </div>
  );
}

const axisProps = {
  stroke: GRID,
  tick: { fill: AXIS_INK, fontSize: 11 },
  tickLine: false,
};

/** Single-series revenue trend (area + line), brand green, no legend. */
export function RevenueTrend({ points, height = 240, format = egp }: {
  points: { label: string; value: number }[]; height?: number; format?: (n: number) => string;
}) {
  if (!points.length) return <Empty height={height} />;
  return (
    <ResponsiveContainer width="100%" height={height}>
      <AreaChart data={points} margin={{ top: 8, right: 12, left: 4, bottom: 4 }}>
        <defs>
          <linearGradient id="revfill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={BRAND} stopOpacity={0.28} />
            <stop offset="100%" stopColor={BRAND} stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid stroke={GRID} strokeOpacity={0.5} vertical={false} />
        <XAxis dataKey="label" {...axisProps} />
        <YAxis {...axisProps} width={44} tickFormatter={(v: number) => shortEgp(v)} />
        <Tooltip content={<ChartTooltip format={format} />} cursor={{ stroke: GRID }} />
        <Area type="monotone" dataKey="value" name="Revenue" stroke={BRAND} strokeWidth={2}
          fill="url(#revfill)" dot={{ r: 3, fill: BRAND, strokeWidth: 0 }}
          activeDot={{ r: 5, stroke: 'rgb(var(--goblin-900))', strokeWidth: 2 }} />
      </AreaChart>
    </ResponsiveContainer>
  );
}

/** Category bars — single measure across labels. Brand green unless `categorical`. */
export function CategoryBars({ rows, height = 260, horizontal = false, categorical = false, name = 'Value', format = egp }: {
  rows: { label: string; value: number }[]; height?: number; horizontal?: boolean;
  categorical?: boolean; name?: string; format?: (n: number) => string;
}) {
  if (!rows.length) return <Empty height={height} />;
  const color = (i: number) => (categorical ? CHART_COLORS[i % CHART_COLORS.length] : BRAND);
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={rows} layout={horizontal ? 'vertical' : 'horizontal'}
        margin={{ top: 8, right: 12, left: 4, bottom: 4 }}>
        <CartesianGrid stroke={GRID} strokeOpacity={0.5} vertical={horizontal} horizontal={!horizontal} />
        {horizontal ? (
          <>
            <XAxis type="number" {...axisProps} tickFormatter={(v: number) => shortEgp(v)} />
            <YAxis type="category" dataKey="label" {...axisProps} width={110} />
          </>
        ) : (
          <>
            <XAxis dataKey="label" {...axisProps} />
            <YAxis {...axisProps} width={44} tickFormatter={(v: number) => shortEgp(v)} />
          </>
        )}
        <Tooltip content={<ChartTooltip format={format} />} cursor={{ fill: GRID, fillOpacity: 0.15 }} />
        <Bar dataKey="value" name={name} radius={horizontal ? [0, 4, 4, 0] : [4, 4, 0, 0]}>
          {rows.map((_, i) => <Cell key={i} fill={color(i)} />)}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

/** Donut share — categorical palette, legend always present. */
export function SharePie({ slices, height = 240, format = egp }: {
  slices: { label: string; value: number }[]; height?: number; format?: (n: number) => string;
}) {
  const data = slices.filter((s) => s.value > 0);
  if (!data.length) return <Empty height={height} />;
  return (
    <ResponsiveContainer width="100%" height={height}>
      <PieChart>
        <Pie data={data} dataKey="value" nameKey="label" innerRadius="58%" outerRadius="85%"
          paddingAngle={2} stroke="rgb(var(--goblin-900))" strokeWidth={2}>
          {data.map((_, i) => <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />)}
        </Pie>
        <Tooltip content={<ChartTooltip format={format} />} />
        <Legend formatter={(v) => <span className="text-xs text-goblin-200">{v}</span>}
          iconType="circle" iconSize={9} />
      </PieChart>
    </ResponsiveContainer>
  );
}

function Empty({ height }: { height: number }) {
  return (
    <div className="flex items-center justify-center text-xs text-goblin-400" style={{ height }}>
      No data for this period.
    </div>
  );
}
