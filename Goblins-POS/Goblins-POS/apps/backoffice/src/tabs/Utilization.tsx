import { Fragment } from 'react';
import { api, egp, pct } from '../lib/api';
import { Spinner, Table, useLoad } from '../lib/ui';

interface Utilization {
  resources: { name: string; type: string; sessions: number; minutes: number; revenueCents: number; occupancyPctBps: number; revenuePerAvailableHourCents: number }[];
  heatmap: { dayOfWeek: number; hour: number; minutes: number }[];
}

export function UtilizationView() {
  const { data } = useLoad(() =>
    api<Utilization>('/reports/utilization?from=' + new Date(Date.now() - 14 * 86400_000).toISOString()));
  if (!data) return <Spinner />;
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const maxHeat = Math.max(1, ...data.heatmap.map((h) => h.minutes));
  return (
    <div>
      <Table
        headers={['Resource', 'Type', 'Sessions', 'Hours', 'Revenue', 'Occupancy', 'Rev/avail-hr']}
        rows={data.resources.map((r) => [
          r.name, r.type.replace('_', ' '), String(r.sessions), (r.minutes / 60).toFixed(1),
          egp(r.revenueCents), pct(r.occupancyPctBps), egp(r.revenuePerAvailableHourCents),
        ])}
      />
      <h2 className="mb-2 mt-6 font-semibold text-slate-700">Peak heatmap (14 days)</h2>
      <div className="overflow-x-auto rounded-xl bg-white p-4 shadow">
        <div className="grid grid-cols-[40px_repeat(24,minmax(16px,1fr))] gap-0.5 text-xs">
          <div />
          {Array.from({ length: 24 }, (_, h) => <div key={h} className="text-center text-slate-400">{h}</div>)}
          {days.map((d, dow) => (
            <Fragment key={d}>
              <div className="pr-1 text-right text-slate-500">{d}</div>
              {Array.from({ length: 24 }, (_, h) => {
                const cell = data.heatmap.find((x) => x.dayOfWeek === dow && x.hour === h);
                const intensity = cell ? cell.minutes / maxHeat : 0;
                return (
                  <div key={`${dow}-${h}`} title={`${cell?.minutes ?? 0} min`}
                    className="aspect-square rounded-sm"
                    style={{ backgroundColor: `rgba(4,120,87,${0.08 + intensity * 0.9})` }} />
                );
              })}
            </Fragment>
          ))}
        </div>
      </div>
    </div>
  );
}
