import { Fragment, useState } from 'react';
import { api, egp, pct } from '../lib/api';
import { Card, ErrorBanner, Pills, Spinner, Table, useLoad } from '../lib/ui';
import { CategoryBars, ChartCard } from '../lib/charts';

interface ResourceRow {
  resourceId: string; name: string; type: string; sessions: number; minutes: number;
  revenueCents: number; fnbRevenueCents: number; occupancyPctBps: number;
  revenuePerAvailableHourCents: number; avgSessionMinutes: number;
}
interface Utilization {
  openHoursPerDay: number;
  totals: { sessions: number; minutes: number; revenueCents: number; fnbRevenueCents: number; occupancyPctBps: number; avgSessionMinutes: number };
  peak: { dayOfWeek: number; hour: number; minutes: number } | null;
  resources: ResourceRow[];
  heatmap: { dayOfWeek: number; hour: number; minutes: number }[];
}

type RangeV = '7' | '14' | '30' | '90';
type TypeV = 'ALL' | 'BILLIARDS_TABLE' | 'PS_ROOM';
const RANGES: { value: RangeV; label: string }[] = [
  { value: '7', label: '7 days' },
  { value: '14', label: '14 days' },
  { value: '30', label: '30 days' },
  { value: '90', label: '90 days' },
];
const TYPES: { value: TypeV; label: string }[] = [
  { value: 'ALL', label: 'All' },
  { value: 'BILLIARDS_TABLE', label: 'Billiards' },
  { value: 'PS_ROOM', label: 'PlayStation' },
];
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const hourLabel = (h: number) => `${String(h).padStart(2, '0')}:00`;
const hours = (min: number) => `${(min / 60).toFixed(1)} h`;

export function UtilizationView() {
  const [range, setRange] = useState<RangeV>('14');
  const [type, setType] = useState<TypeV>('ALL');
  const [hover, setHover] = useState<{ dow: number; hour: number; minutes: number } | null>(null);
  const { data, error } = useLoad(() => {
    const from = new Date(Date.now() - Number(range) * 86_400_000).toISOString();
    return api<Utilization>(`/reports/utilization?from=${encodeURIComponent(from)}${type === 'ALL' ? '' : `&type=${type}`}`);
  }, [range, type]);

  return (
    <div>
      {/* filters, one row above the charts */}
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <Pills value={range} onChange={setRange} options={RANGES} />
        <Pills value={type} onChange={setType} options={TYPES} />
      </div>
      <ErrorBanner message={error} />
      {!data ? <Spinner /> : <Report data={data} hover={hover} setHover={setHover} />}
    </div>
  );
}

function Report({ data, hover, setHover }: {
  data: Utilization;
  hover: { dow: number; hour: number; minutes: number } | null;
  setHover: (h: { dow: number; hour: number; minutes: number } | null) => void;
}) {
  const { totals, peak } = data;
  const idle = data.resources.filter((r) => r.sessions === 0);
  const maxHeat = Math.max(1, ...data.heatmap.map((h) => h.minutes));
  const cell = (dow: number, h: number) => data.heatmap.find((x) => x.dayOfWeek === dow && x.hour === h)?.minutes ?? 0;

  return (
    <>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Card title="Occupancy" value={pct(totals.occupancyPctBps)} />
        <Card title="Time revenue" value={egp(totals.revenueCents)} />
        <Card title="Food & drink at tables" value={egp(totals.fnbRevenueCents)} />
        <Card title="Sessions · avg length" value={`${totals.sessions} · ${totals.avgSessionMinutes} min`} />
      </div>

      <p className="mt-3 text-sm text-goblin-300">
        {peak ? <>Busiest hour: <strong className="text-goblin-100">{DAYS[peak.dayOfWeek]} {hourLabel(peak.hour)}</strong>. </> : null}
        {idle.length > 0 && <>No sessions at all on <strong className="text-goblin-100">{idle.map((r) => r.name).join(', ')}</strong>. </>}
        Occupancy is measured against {data.openHoursPerDay} open hours a day (setting <code>business.openHoursPerDay</code>).
      </p>

      <div className="mt-4">
        <Table
          headers={['Table / room', 'Type', 'Occupancy', 'Sessions', 'Hours', 'Avg session', 'Time revenue', 'Food & drink', 'Rev / open hour']}
          rows={data.resources.map((r) => [
            r.name,
            r.type === 'PS_ROOM' ? 'PlayStation' : 'Billiards',
            <div key="occ" className="flex min-w-28 items-center gap-2">
              <div className="h-2 flex-1 rounded-full bg-goblin-800">
                <div className="h-2 rounded-full" style={{ width: `${Math.min(100, r.occupancyPctBps / 100)}%`, background: 'rgb(var(--goblin-500))' }} />
              </div>
              <span className="w-12 text-end tabular-nums">{pct(r.occupancyPctBps)}</span>
            </div>,
            String(r.sessions),
            hours(r.minutes),
            r.sessions ? `${r.avgSessionMinutes} min` : '—',
            egp(r.revenueCents),
            egp(r.fnbRevenueCents),
            egp(r.revenuePerAvailableHourCents),
          ])}
        />
      </div>

      <div className="mt-6">
        <ChartCard title="Time revenue per open hour" subtitle="By table / room">
          <CategoryBars horizontal rows={data.resources.map((r) => ({ label: r.name, value: r.revenuePerAvailableHourCents }))} />
        </ChartCard>
      </div>

      <div className="mt-6 rounded-xl bg-goblin-900 p-4 shadow">
        <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="font-semibold text-goblin-100">When tables are busy</h2>
          <p className="text-sm text-goblin-300" aria-live="polite">
            {hover
              ? <>{DAYS[hover.dow]} {hourLabel(hover.hour)}–{hourLabel((hover.hour + 1) % 24)}: <strong className="text-goblin-100">{hours(hover.minutes)}</strong> played</>
              : 'Hover a cell for details'}
          </p>
        </div>
        <div className="overflow-x-auto">
          <div className="grid min-w-[640px] grid-cols-[40px_repeat(24,minmax(18px,1fr))] gap-0.5 text-xs">
            <div />
            {Array.from({ length: 24 }, (_, h) => (
              <div key={h} className="text-center text-goblin-400">{h % 3 === 0 ? h : ''}</div>
            ))}
            {DAYS.map((d, dow) => (
              <Fragment key={d}>
                <div className="pe-1 text-end text-goblin-300">{d}</div>
                {Array.from({ length: 24 }, (_, h) => {
                  const minutes = cell(dow, h);
                  const t = minutes / maxHeat;
                  return (
                    <div
                      key={`${dow}-${h}`}
                      onMouseEnter={() => setHover({ dow, hour: h, minutes })}
                      onMouseLeave={() => setHover(null)}
                      title={`${d} ${hourLabel(h)}: ${hours(minutes)}`}
                      className={`aspect-square rounded-sm ${minutes ? '' : 'bg-goblin-800'} ${hover?.dow === dow && hover.hour === h ? 'ring-2 ring-goblin-100' : ''}`}
                      style={minutes ? { backgroundColor: `rgb(var(--goblin-500) / ${(0.2 + t * 0.8).toFixed(2)})` } : undefined}
                    />
                  );
                })}
              </Fragment>
            ))}
          </div>
        </div>
        <div className="mt-3 flex items-center gap-2 text-xs text-goblin-400">
          <span>Quiet</span>
          {[0.2, 0.4, 0.6, 0.8, 1].map((a) => (
            <span key={a} className="h-3 w-5 rounded-sm" style={{ backgroundColor: `rgb(var(--goblin-500) / ${a})` }} />
          ))}
          <span>Busy (up to {hours(maxHeat)} in one hour slot)</span>
        </div>
      </div>
    </>
  );
}
