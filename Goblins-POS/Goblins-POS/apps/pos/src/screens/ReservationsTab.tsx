import { useEffect, useState, useCallback } from 'react';
import {
  Brush, CalendarDays, Check, Clock, Coins, Gamepad2, List, MapPin, Phone, Plus,
  Star, StickyNote, Timer, TriangleAlert, User, Users, UtensilsCrossed, X,
} from 'lucide-react';
import { api } from '../lib/api';
import { fmtMoney, t } from '../lib/i18n';
import { usePos } from '../lib/store';
import type { FloorZone, Order } from '../lib/types';

interface Reservation {
  id: string;
  startAt: string;
  endAt: string;
  partySize: number;
  status: 'PENDING' | 'CONFIRMED' | 'SEATED' | 'COMPLETED' | 'NO_SHOW' | 'CANCELLED';
  guestName?: string | null;
  guestPhone?: string | null;
  depositCents: number;
  notes?: string | null;
  resource: { id: string; name: string; type: string };
  customerId?: string | null;
  customer?: { id: string; name: string; phone: string; visitCount: number } | null;
}

const STATUS_BADGE: Record<string, string> = {
  PENDING: 'bg-slate-800 text-slate-300 border-slate-700',
  CONFIRMED: 'bg-blue-950 text-blue-200 border-blue-800',
  SEATED: 'bg-emerald-950 text-emerald-200 border-emerald-800',
  COMPLETED: 'bg-zinc-800 text-zinc-400 border-zinc-700 opacity-60',
  NO_SHOW: 'bg-red-950 text-red-300 border-red-900',
  CANCELLED: 'bg-zinc-900 text-zinc-500 border-zinc-800 line-through opacity-50',
};

const NEXT: Record<string, string[]> = {
  PENDING: ['CONFIRMED', 'CANCELLED'],
  CONFIRMED: ['SEATED', 'NO_SHOW', 'CANCELLED'],
  SEATED: ['COMPLETED'],
};

export function ReservationsTab({ zones }: { zones: FloorZone[] }) {
  const { lang, openOrder } = usePos();
  const [reservations, setReservations] = useState<Reservation[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('ALL');
  const [dateFilter, setDateFilter] = useState<string>('ALL'); // 'ALL' | 'TODAY' | 'TOMORROW' | YYYY-MM-DD
  const [viewMode, setViewMode] = useState<'timeline' | 'list' | 'hourly'>('timeline');
  const [createOpen, setCreateOpen] = useState(false);
  const [activeCategory, setActiveCategory] = useState<'RENTAL' | 'DINING'>('RENTAL');
  const [selectedRes, setSelectedRes] = useState<Reservation | null>(null);

  const [initialBookingData, setInitialBookingData] = useState<{
    resourceId: string;
    date: string;
    startTime: string;
    durationMin: string;
  } | null>(null);

  const [dragInfo, setDragInfo] = useState<{
    resourceId: string;
    startPercent: number;
    currentPercent: number;
    rect: DOMRect;
  } | null>(null);

  const handleTrackPointerDown = (e: React.PointerEvent<HTMLDivElement>, resourceId: string) => {
    if (e.button !== 0) return;
    const target = e.target as HTMLElement;
    if (target.closest('button')) {
      return;
    }
    const rect = e.currentTarget.getBoundingClientRect();
    const startX = e.clientX - rect.left;
    const startPercent = Math.max(0, Math.min(1, startX / rect.width));

    setDragInfo({
      resourceId,
      startPercent,
      currentPercent: startPercent,
      rect,
    });
  };

  const load = useCallback(async () => {
    setLoading(true);
    setErr('');
    try {
      const data = await api<Reservation[]>('/reservations/timeline');
      setReservations(data);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed to load reservations');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function setStatus(id: string, status: string) {
    setErr('');
    try {
      await api(`/reservations/${id}/status/${status.toLowerCase()}`, { method: 'POST' });
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed to update status');
    }
  }

  async function handleCheckIn(r: Reservation) {
    setErr('');
    try {
      // 1. Transition reservation status to SEATED
      await api(`/reservations/${r.id}/status/seated`, { method: 'POST' });

      // 2. Check if the resource already has an active order
      const targetResource = zones
        .flatMap((z) => z.resources)
        .find((res) => res.id === r.resource.id);

      const existingOrder = targetResource?.orders?.[0];

      if (existingOrder) {
        // Open the existing order screen
        openOrder(existingOrder.id);
      } else {
        // Automatically start a new order for this resource type
        const type =
          r.resource.type === 'BILLIARDS_TABLE' ? 'BILLIARDS' :
          r.resource.type === 'PS_ROOM' ? 'PS_ROOM' : 'DINE_IN';

        const order = await api<Order>('/orders', {
          method: 'POST',
          body: {
            type,
            resourceId: r.resource.id,
            customerId: r.customerId || undefined,
          },
        });
        openOrder(order.id);
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Check-in failed');
    }
  }

  async function sweep() {
    setErr('');
    try {
      await api('/reservations/sweep', { method: 'POST' });
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Sweep failed');
    }
  }

  const getCairoIsoDate = (iso: string) => {
    // Returns YYYY-MM-DD
    const d = new Date(iso);
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: 'Africa/Cairo', year: 'numeric', month: '2-digit', day: '2-digit',
    });
    const parts = formatter.formatToParts(d);
    const year = parts.find((p) => p.type === 'year')?.value ?? '';
    const month = parts.find((p) => p.type === 'month')?.value ?? '';
    const day = parts.find((p) => p.type === 'day')?.value ?? '';
    return `${year}-${month}-${day}`;
  };

  const parseCairoDateTime = (dateStr: string, timeStr: string) => {
    const partsDate = dateStr.split('-').map(Number);
    const partsTime = timeStr.split(':').map(Number);
    const y = partsDate[0] ?? 2026;
    const m = partsDate[1] ?? 1;
    const d = partsDate[2] ?? 1;
    const h = partsTime[0] ?? 0;
    const min = partsTime[1] ?? 0;
    const candidateUtc = new Date(Date.UTC(y, m - 1, d, h, min));
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: 'Africa/Cairo',
      year: 'numeric', month: 'numeric', day: 'numeric',
      hour: 'numeric', minute: 'numeric', second: 'numeric',
      hour12: false
    });
    const parts = formatter.formatToParts(candidateUtc);
    const yVal = Number(parts.find(p => p.type === 'year')?.value);
    const mVal = Number(parts.find(p => p.type === 'month')?.value);
    const dVal = Number(parts.find(p => p.type === 'day')?.value);
    const hVal = Number(parts.find(p => p.type === 'hour')?.value) % 24;
    const minVal = Number(parts.find(p => p.type === 'minute')?.value);
    const sVal = Number(parts.find(p => p.type === 'second')?.value);
    
    const cairoUtc = Date.UTC(yVal, mVal - 1, dVal, hVal, minVal, sVal);
    const offset = cairoUtc - candidateUtc.getTime();
    return new Date(candidateUtc.getTime() - offset);
  };

  const dayLabel = (iso: string) => {
    return new Date(iso).toLocaleDateString(lang === 'ar' ? 'ar-EG' : 'en-EG', {
      timeZone: 'Africa/Cairo',
      weekday: 'long',
      month: 'short',
      day: 'numeric',
    });
  };

  const timeLabel = (iso: string) => {
    return new Date(iso).toLocaleTimeString(lang === 'ar' ? 'ar-EG' : 'en-EG', {
      timeZone: 'Africa/Cairo',
      hour: '2-digit',
      minute: '2-digit',
      hour12: true,
    });
  };

  // Filter reservations
  const filtered = reservations.filter((r) => {
    // 1. Search filter
    const term = search.toLowerCase().trim();
    if (term) {
      const name = (r.customer?.name || r.guestName || '').toLowerCase();
      const phone = (r.customer?.phone || r.guestPhone || '').toLowerCase();
      const table = r.resource.name.toLowerCase();
      if (!name.includes(term) && !phone.includes(term) && !table.includes(term)) {
        return false;
      }
    }

    // 2. Status filter
    if (statusFilter !== 'ALL' && r.status !== statusFilter) {
      return false;
    }

    // 3. Date filter
    if (dateFilter !== 'ALL') {
      const rCairoDate = getCairoIsoDate(r.startAt);
      const today = getCairoIsoDate(new Date().toISOString());
      const tomorrow = getCairoIsoDate(new Date(Date.now() + 86400_000).toISOString());

      if (dateFilter === 'TODAY' && rCairoDate !== today) return false;
      if (dateFilter === 'TOMORROW' && rCairoDate !== tomorrow) return false;
      if (dateFilter !== 'TODAY' && dateFilter !== 'TOMORROW' && rCairoDate !== dateFilter) return false;
    }

    // 4. Category filter
    const isRental = r.resource.type === 'BILLIARDS_TABLE' || r.resource.type === 'PS_ROOM';
    if (activeCategory === 'RENTAL' && !isRental) return false;
    if (activeCategory === 'DINING' && isRental) return false;

    return true;
  });

  // Group by day for Timeline View
  const groupedByDay: [string, Reservation[]][] = [];
  if (viewMode === 'timeline') {
    const map = new Map<string, Reservation[]>();
    for (const r of filtered) {
      const day = dayLabel(r.startAt);
      map.set(day, [...(map.get(day) ?? []), r]);
    }
    groupedByDay.push(...map.entries());
  }

  // Active Category Resources
  const activeResources = zones
    .flatMap((z) => z.resources)
    .filter((res) => {
      const isRental = res.type === 'BILLIARDS_TABLE' || res.type === 'PS_ROOM';
      return activeCategory === 'RENTAL' ? isRental : !isRental;
    });

  // Hourly timeline variables
  const targetDateStr = dateFilter === 'TODAY'
    ? getCairoIsoDate(new Date().toISOString())
    : dateFilter === 'TOMORROW'
    ? getCairoIsoDate(new Date(Date.now() + 86400_000).toISOString())
    : dateFilter === 'ALL'
    ? getCairoIsoDate(new Date().toISOString())
    : dateFilter;

  useEffect(() => {
    if (!dragInfo) return;

    const handlePointerMove = (e: PointerEvent) => {
      const rect = dragInfo.rect;
      const currentX = e.clientX - rect.left;
      const currentPercent = Math.max(0, Math.min(1, currentX / rect.width));
      setDragInfo((prev) => (prev ? { ...prev, currentPercent } : null));
    };

    const handlePointerUp = () => {
      const startPct = Math.min(dragInfo.startPercent, dragInfo.currentPercent);
      const endPct = Math.max(dragInfo.startPercent, dragInfo.currentPercent);

      const startMinRaw = 720 + startPct * 840;
      const endMinRaw = 720 + endPct * 840;

      const startMin = Math.round(startMinRaw / 15) * 15;
      const endMin = Math.round(endMinRaw / 15) * 15;

      const diff = endPct - startPct;
      let duration = endMin - startMin;

      if (diff < 0.01 || duration < 15) {
        duration = 120; // Default to 2 hours
      }

      if (startMin + duration > 1560) {
        if (startMin + 120 <= 1560) {
          duration = 120;
        } else {
          duration = 1560 - startMin;
        }
      }

      const startHour = Math.floor(startMin / 60) % 24;
      const startMinute = startMin % 60;
      const startTimeStr = `${String(startHour).padStart(2, '0')}:${String(startMinute).padStart(2, '0')}`;

      setInitialBookingData({
        resourceId: dragInfo.resourceId,
        date: targetDateStr,
        startTime: startTimeStr,
        durationMin: String(duration),
      });

      setCreateOpen(true);
      setDragInfo(null);
    };

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);
    return () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
    };
  }, [dragInfo, targetDateStr]);

  const timelineStart = parseCairoDateTime(targetDateStr, '12:00');
  const timelineEnd = new Date(timelineStart.getTime() + 14 * 60 * 60 * 1000); // 12:00 PM to 02:00 AM next day

  const hourLabels = [
    '12:00 PM', '01:00 PM', '02:00 PM', '03:00 PM', '04:00 PM', '05:00 PM', '06:00 PM',
    '07:00 PM', '08:00 PM', '09:00 PM', '10:00 PM', '11:00 PM', '12:00 AM', '01:00 AM'
  ];

  const getReservationStyle = (r: Reservation) => {
    const startMs = new Date(r.startAt).getTime();
    const endMs = new Date(r.endAt).getTime();
    const timelineStartMs = timelineStart.getTime();
    const timelineEndMs = timelineEnd.getTime();

    // Clip to timeline bounds
    const displayStartMs = Math.max(startMs, timelineStartMs);
    const displayEndMs = Math.min(endMs, timelineEndMs);

    if (displayStartMs >= timelineEndMs || displayEndMs <= timelineStartMs) {
      return null;
    }

    const totalDurationMs = timelineEndMs - timelineStartMs;
    const leftPercent = ((displayStartMs - timelineStartMs) / totalDurationMs) * 100;
    const widthPercent = ((displayEndMs - displayStartMs) / totalDurationMs) * 100;

    return {
      left: `${leftPercent}%`,
      width: `${widthPercent}%`,
    };
  };

  return (
    <div className="space-y-4 text-goblin-50">
      {err && (
        <div className="flex items-center gap-2 rounded-xl bg-red-950/60 p-4 border border-red-900 text-red-200 text-sm">
          <TriangleAlert className="h-4 w-4 shrink-0" /> {err}
        </div>
      )}

      {/* Category Tabs Selector */}
      <div className="flex rounded-2xl bg-goblin-950 p-1 border border-goblin-800 w-full sm:max-w-md">
        <button
          onClick={() => setActiveCategory('RENTAL')}
          className={`flex-1 rounded-xl py-2.5 text-xs font-bold transition-all flex items-center justify-center gap-2 ${
            activeCategory === 'RENTAL'
              ? 'bg-goblin-600 text-white shadow-md'
              : 'text-goblin-400 hover:text-white'
          }`}
        >
          <Gamepad2 className="h-4 w-4" /> {lang === 'ar' ? 'أصول التأجير' : 'Rental Assets'}
        </button>
        <button
          onClick={() => setActiveCategory('DINING')}
          className={`flex-1 rounded-xl py-2.5 text-xs font-bold transition-all flex items-center justify-center gap-2 ${
            activeCategory === 'DINING'
              ? 'bg-goblin-600 text-white shadow-md'
              : 'text-goblin-400 hover:text-white'
          }`}
        >
          <UtensilsCrossed className="h-4 w-4" /> {lang === 'ar' ? 'طاولات الطعام' : 'Dining Tables'}
        </button>
      </div>

      {/* Filter Control Bar */}
      <div className="flex flex-col gap-3 rounded-2xl bg-goblin-900 p-4 border border-goblin-800 shadow w-full">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2 w-full sm:w-auto">
            {/* View Mode Toggle */}
            <div className="flex rounded-xl bg-goblin-950 p-1 border border-goblin-800 w-full sm:w-auto">
              <button
                onClick={() => setViewMode('timeline')}
                className={`flex-1 sm:flex-initial rounded-lg px-3 py-1.5 text-xs font-semibold transition-all text-center ${
                  viewMode === 'timeline'
                    ? 'bg-goblin-600 text-white font-bold'
                    : 'text-goblin-400 hover:text-white'
                }`}
              >
                <span className="inline-flex items-center justify-center gap-1.5"><CalendarDays className="h-3.5 w-3.5" /> {t(lang, 'timelineView')}</span>
              </button>
              <button
                onClick={() => setViewMode('list')}
                className={`flex-1 sm:flex-initial rounded-lg px-3 py-1.5 text-xs font-semibold transition-all text-center ${
                  viewMode === 'list'
                    ? 'bg-goblin-600 text-white font-bold'
                    : 'text-goblin-400 hover:text-white'
                }`}
              >
                <span className="inline-flex items-center justify-center gap-1.5"><List className="h-3.5 w-3.5" /> {t(lang, 'listView')}</span>
              </button>
              <button
                onClick={() => {
                  setViewMode('hourly');
                  if (dateFilter === 'ALL') {
                    setDateFilter('TODAY');
                  }
                }}
                className={`flex-1 sm:flex-initial rounded-lg px-3 py-1.5 text-xs font-semibold transition-all text-center ${
                  viewMode === 'hourly'
                    ? 'bg-goblin-600 text-white font-bold'
                    : 'text-goblin-400 hover:text-white'
                }`}
              >
                <span className="inline-flex items-center justify-center gap-1.5"><Clock className="h-3.5 w-3.5" /> {lang === 'ar' ? 'الجدول الساعي' : 'Hourly Schedule'}</span>
              </button>
            </div>

            {/* Search Box */}
            <input
              type="text"
              placeholder={lang === 'ar' ? 'ابحث بالاسم، الهاتف أو الطاولة...' : 'Search name, phone, table...'}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="rounded-xl bg-goblin-950 px-3 py-2 text-sm border border-goblin-800 focus:outline-none focus:border-goblin-600 w-full sm:w-60"
            />

            {/* Status Filter */}
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="rounded-xl bg-goblin-950 px-3 py-2 text-sm border border-goblin-800 focus:outline-none focus:border-goblin-600 cursor-pointer w-full sm:w-auto"
            >
              <option value="ALL">{lang === 'ar' ? 'كل الحالات' : 'All Statuses'}</option>
              <option value="PENDING">{lang === 'ar' ? 'معلق' : 'Pending'}</option>
              <option value="CONFIRMED">{lang === 'ar' ? 'مؤكد' : 'Confirmed'}</option>
              <option value="SEATED">{lang === 'ar' ? 'تم الدخول' : 'Seated'}</option>
              <option value="COMPLETED">{lang === 'ar' ? 'مكتمل' : 'Completed'}</option>
              <option value="NO_SHOW">{lang === 'ar' ? 'لم يحضر' : 'No Show'}</option>
              <option value="CANCELLED">{lang === 'ar' ? 'ملغي' : 'Cancelled'}</option>
            </select>

            {/* Date Filter */}
            <select
              value={dateFilter === 'ALL' && viewMode === 'hourly' ? 'TODAY' : dateFilter}
              onChange={(e) => setDateFilter(e.target.value)}
              className="rounded-xl bg-goblin-950 px-3 py-2 text-sm border border-goblin-800 focus:outline-none focus:border-goblin-600 cursor-pointer w-full sm:w-auto"
            >
              {viewMode !== 'hourly' && (
                <option value="ALL">{lang === 'ar' ? 'كل التواريخ' : 'All Dates'}</option>
              )}
              <option value="TODAY">{lang === 'ar' ? 'اليوم' : 'Today'}</option>
              <option value="TOMORROW">{lang === 'ar' ? 'غداً' : 'Tomorrow'}</option>
            </select>

            {/* Custom Date Input if needed */}
            {dateFilter !== 'ALL' && dateFilter !== 'TODAY' && dateFilter !== 'TOMORROW' && (
              <input
                type="date"
                value={dateFilter}
                onChange={(e) => setDateFilter(e.target.value)}
                className="rounded-xl bg-goblin-950 px-3 py-2 text-sm border border-goblin-800 focus:outline-none focus:border-goblin-600 w-full sm:w-auto"
              />
            )}
            {dateFilter === 'ALL' && (
              <button
                onClick={() => setDateFilter(getCairoIsoDate(new Date().toISOString()))}
                className="text-xs text-goblin-400 hover:text-goblin-200 underline w-full sm:w-auto text-center"
              >
                {lang === 'ar' ? 'اختر تاريخ معين' : 'Pick specific date'}
              </button>
            )}
          </div>

          {/* Global Action Buttons */}
          <div className="flex gap-2 w-full sm:w-auto justify-end">
            <button
              onClick={() => void sweep()}
              className="rounded-xl bg-goblin-800 px-4 py-2.5 text-sm font-semibold hover:bg-goblin-700 transition-all flex items-center justify-center gap-1 active:scale-95 flex-1 sm:flex-initial"
              title={t(lang, 'runSweep')}
            >
              <Brush className="h-4 w-4" /> {t(lang, 'runSweep')}
            </button>
            <button
              onClick={() => setCreateOpen(true)}
              className="rounded-xl bg-goblin-600 px-4 py-2.5 text-sm font-bold hover:bg-goblin-500 transition-all shadow-md active:scale-95 flex items-center justify-center gap-1 flex-1 sm:flex-initial"
            >
              <Plus className="h-4 w-4" /> {t(lang, 'newReservation')}
            </button>
          </div>
        </div>
      </div>

      {loading && reservations.length === 0 ? (
        <div className="py-20 text-center text-goblin-400">
          <div className="animate-spin inline-block w-8 h-8 border-4 border-goblin-600 border-t-transparent rounded-full mb-3"></div>
          <div>{lang === 'ar' ? 'جاري التحميل...' : 'Loading reservations...'}</div>
        </div>
      ) : (
        <div className="space-y-6">
          {viewMode === 'timeline' ? (
            groupedByDay.map(([day, rows]) => (
              <div key={day} className="space-y-2.5">
                <h3 className="text-sm font-bold text-goblin-400 uppercase tracking-wider border-s-4 border-goblin-600 ps-2.5 py-0.5">
                  {day}
                </h3>
                <div className="space-y-2">
                  {rows.map((r) => (
                    <ReservationCard
                      key={r.id}
                      r={r}
                      lang={lang}
                      timeLabel={timeLabel}
                      onStatusChange={setStatus}
                      onCheckIn={handleCheckIn}
                    />
                  ))}
                </div>
              </div>
            ))
          ) : viewMode === 'list' ? (
            <div className="space-y-2">
              {filtered.map((r) => (
                <ReservationCard
                  key={r.id}
                  r={r}
                  lang={lang}
                  timeLabel={timeLabel}
                  onStatusChange={setStatus}
                  onCheckIn={handleCheckIn}
                />
              ))}
            </div>
          ) : (
            /* Hourly Grid Scheduler */
            <div className="rounded-2xl bg-goblin-900 border border-goblin-800 overflow-hidden shadow-lg">
              <div className="overflow-x-auto min-w-full">
                <div className="min-w-[900px] flex flex-col">
                  {/* Timeline Header Row */}
                  <div className="flex border-b border-goblin-800 bg-goblin-950 font-semibold text-xs text-goblin-300">
                    <div className="w-32 flex-shrink-0 p-3 border-r border-goblin-800 flex items-center justify-center sticky left-0 bg-goblin-950 z-10">
                      {lang === 'ar' ? 'الطاولة / الغرفة' : 'Resource'}
                    </div>
                    <div className="flex-1 relative h-10" style={{ display: 'grid', gridTemplateColumns: 'repeat(14, minmax(0, 1fr))' }}>
                      {hourLabels.map((lbl, idx) => (
                        <div
                          key={idx}
                          className="p-3 text-center border-r border-goblin-850/40 text-[10px] font-mono flex items-center justify-center"
                        >
                          {lbl}
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Resource Rows */}
                  <div className="divide-y divide-goblin-800 bg-goblin-900">
                    {activeResources.map((res) => {
                      const resReservations = filtered.filter((r) => r.resource.id === res.id);
                      return (
                        <div key={res.id} className="flex hover:bg-goblin-850/20 transition-colors h-14">
                          <div className="w-32 flex-shrink-0 p-3 border-r border-goblin-800 flex flex-col justify-center sticky left-0 bg-goblin-950/90 backdrop-blur-sm z-10 shadow-md">
                            <span className="inline-flex items-center gap-1 font-bold text-xs text-goblin-50 truncate">
                              <MapPin className="h-3 w-3 shrink-0" /> {res.name}
                            </span>
                            <span className="inline-flex items-center gap-1 text-[9px] text-goblin-400">
                              <Users className="h-2.5 w-2.5 shrink-0" /> {res.capacity} {lang === 'ar' ? 'أفراد' : 'pax'}
                            </span>
                          </div>

                          <div
                            className="flex-1 relative h-full cursor-crosshair select-none"
                            style={{ touchAction: 'none' }}
                            onPointerDown={(e) => handleTrackPointerDown(e, res.id)}
                          >
                            {/* Backdrop vertical lines */}
                            <div className="absolute inset-0 pointer-events-none h-full" style={{ display: 'grid', gridTemplateColumns: 'repeat(14, minmax(0, 1fr))' }}>
                              {Array.from({ length: 14 }).map((_, idx) => (
                                <div key={idx} className="border-r border-goblin-850/40 h-full" />
                              ))}
                            </div>

                            {/* Drag Selection Preview Overlay */}
                            {dragInfo && dragInfo.resourceId === res.id && (() => {
                              const startPct = Math.min(dragInfo.startPercent, dragInfo.currentPercent);
                              const endPct = Math.max(dragInfo.startPercent, dragInfo.currentPercent);
                              const left = `${startPct * 100}%`;
                              const width = `${(endPct - startPct) * 100}%`;

                              const startMinRaw = 720 + startPct * 840;
                              const endMinRaw = 720 + endPct * 840;
                              const startMin = Math.round(startMinRaw / 15) * 15;
                              const endMin = Math.round(endMinRaw / 15) * 15;
                              let duration = endMin - startMin;
                              if (endPct - startPct < 0.01 || duration < 15) {
                                duration = 120;
                              }

                              return (
                                <div
                                  className="absolute top-2 bottom-2 border-2 border-dashed border-goblin-400 bg-goblin-500/20 rounded-xl pointer-events-none flex items-center justify-center z-20"
                                  style={{ left, width }}
                                >
                                  <span className="bg-goblin-950/90 text-[10px] font-bold px-1.5 py-0.5 rounded text-goblin-50 border border-goblin-800">
                                    {duration}m
                                  </span>
                                </div>
                              );
                            })()}

                            {/* Reservation Blocks */}
                            {resReservations.map((r) => {
                              const style = getReservationStyle(r);
                              if (!style) return null;
                              return (
                                <button
                                  key={r.id}
                                  onClick={() => setSelectedRes(r)}
                                  style={style}
                                  className={`absolute top-2 bottom-2 rounded-xl border px-3 py-1 flex flex-col justify-center text-left transition-all hover:scale-[1.01] hover:shadow-lg focus:outline-none focus:ring-1 focus:ring-goblin-500 overflow-hidden cursor-pointer ${
                                    STATUS_BADGE[r.status] ?? ''
                                  }`}
                                  title={`${r.customer?.name ?? r.guestName ?? '—'} (${timeLabel(r.startAt)} - ${timeLabel(r.endAt)})`}
                                >
                                  <span className="inline-flex items-center gap-1 text-[10px] font-bold truncate w-full">
                                    {r.status === 'CONFIRMED' ? <Check className="h-2.5 w-2.5 shrink-0" /> : r.status === 'PENDING' ? <Clock className="h-2.5 w-2.5 shrink-0" /> : null}
                                    {r.customer?.name ?? r.guestName ?? '—'}
                                  </span>
                                  <span className="inline-flex items-center gap-1 text-[8px] font-mono opacity-80 truncate w-full mt-0.5">
                                    <Users className="h-2 w-2 shrink-0" /> {r.partySize} · {timeLabel(r.startAt).replace(/:00\s/g, ' ')}
                                  </span>
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      );
                    })}

                    {activeResources.length === 0 && (
                      <div className="p-8 text-center text-goblin-400">
                        {lang === 'ar' ? 'لا توجد طاولات أو غرف متاحة في هذا القسم.' : 'No resources available in this section.'}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}

          {filtered.length === 0 && viewMode !== 'hourly' && (
            <div className="rounded-2xl border border-dashed border-goblin-800 py-16 text-center text-goblin-400">
              <CalendarDays className="mx-auto mb-2 h-10 w-10" />
              {t(lang, 'noReservations')}
            </div>
          )}
        </div>
      )}

      {/* Detail Modal Dialog for clicked timeline items */}
      {selectedRes && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 overflow-y-auto animate-fade-in" onClick={() => setSelectedRes(null)}>
          <div className="w-full max-w-lg bg-goblin-950 rounded-2xl border border-goblin-800 p-5 text-goblin-50 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between border-b border-goblin-800 pb-3 mb-4">
              <h2 className="inline-flex items-center gap-2 text-lg font-bold">
                <CalendarDays className="h-5 w-5" /> {lang === 'ar' ? 'تفاصيل الحجز' : 'Reservation Details'}
              </h2>
              <button onClick={() => setSelectedRes(null)} className="text-goblin-400 hover:text-goblin-50 p-1">
                <X className="h-5 w-5" />
              </button>
            </div>
            <ReservationCard
              r={selectedRes}
              lang={lang}
              timeLabel={timeLabel}
              onStatusChange={async (id, status) => {
                await setStatus(id, status);
                setSelectedRes(prev => prev ? { ...prev, status: status as any } : null);
              }}
              onCheckIn={async (r) => {
                await handleCheckIn(r);
                setSelectedRes(null);
              }}
            />
          </div>
        </div>
      )}

      {createOpen && (
        <NewReservationDialog
          zones={zones}
          initialData={initialBookingData}
          onClose={() => {
            setCreateOpen(false);
            setInitialBookingData(null);
          }}
          onCreated={() => {
            setCreateOpen(false);
            setInitialBookingData(null);
            void load();
          }}
        />
      )}
    </div>
  );
}

interface ReservationCardProps {
  r: Reservation;
  lang: 'en' | 'ar';
  timeLabel: (iso: string) => string;
  onStatusChange: (id: string, status: string) => Promise<void>;
  onCheckIn: (r: Reservation) => Promise<void>;
}

function ReservationCard({ r, lang, timeLabel, onStatusChange, onCheckIn }: ReservationCardProps) {
  const [busy, setBusy] = useState(false);

  const handleAction = async (status: string) => {
    setBusy(true);
    try {
      if (status === 'SEATED') {
        await onCheckIn(r);
      } else {
        await onStatusChange(r.id, status);
      }
    } finally {
      setBusy(false);
    }
  };

  const getDuration = () => {
    const diffMs = new Date(r.endAt).getTime() - new Date(r.startAt).getTime();
    const mins = Math.round(diffMs / 60_000);
    return `${mins} ${lang === 'ar' ? 'دقيقة' : 'min'}`;
  };

  const guestName = r.customer?.name ?? r.guestName ?? '—';
  const guestPhone = r.customer?.phone ?? r.guestPhone ?? '';

  return (
    <div className="flex flex-col gap-4 rounded-2xl bg-goblin-900 p-4 border border-goblin-850 hover:border-goblin-700 transition-all shadow-md w-full">
      {/* Header: Time & Table info */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between border-b border-goblin-800 pb-3">
        <div className="flex items-center gap-3">
          <div className="rounded-xl bg-goblin-950 px-3 py-2 text-center border border-goblin-850 min-w-[120px]">
            <div className="text-xs font-mono font-bold text-goblin-300">
              {timeLabel(r.startAt)}
            </div>
            <div className="text-[10px] text-goblin-500 mt-0.5 font-medium">
              {getDuration()}
            </div>
          </div>

          <div className="flex flex-col">
            <span className="inline-flex items-center gap-1.5 text-base font-extrabold text-goblin-50">
              <MapPin className="h-4 w-4 shrink-0" /> {r.resource.name}
            </span>
            <span className="text-xs text-goblin-400 capitalize">
              {r.resource.type.replace('_', ' ').toLowerCase()}
            </span>
          </div>
        </div>

        {/* Status Badge */}
        <div className="flex items-center">
          <span className={`rounded-xl px-3 py-1.5 text-xs font-extrabold border ${STATUS_BADGE[r.status] ?? ''}`}>
            {lang === 'ar' ? r.status : r.status.replace('_', ' ')}
          </span>
        </div>
      </div>

      {/* Body: Guest details */}
      <div className="space-y-2.5">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="inline-flex items-center gap-1.5 text-base font-bold text-goblin-200">
            <User className="h-4 w-4 shrink-0" /> {guestName}
          </span>
          {r.customer && r.customer.visitCount > 0 && (
            <span className="inline-flex items-center gap-1 text-[10px] bg-goblin-800 text-goblin-300 px-2 py-0.5 rounded-full font-mono font-bold">
              <Star className="h-3 w-3" /> {r.customer.visitCount} {lang === 'ar' ? 'زيارة' : 'visits'}
            </span>
          )}
        </div>

        {/* Info Grid */}
        <div className="grid grid-cols-2 gap-2 text-xs text-goblin-300 bg-goblin-950/30 p-2.5 rounded-xl border border-goblin-850/50">
          {guestPhone && (
            <div className="flex items-center gap-1.5">
              <Phone className="h-3.5 w-3.5" />
              <span className="font-mono">{guestPhone}</span>
            </div>
          )}
          <div className="flex items-center gap-1.5">
            <Users className="h-3.5 w-3.5" />
            <span>{r.partySize} {lang === 'ar' ? 'أفراد' : 'pax'}</span>
          </div>
          {r.depositCents > 0 && (
            <div className="flex items-center gap-1.5 col-span-2 border-t border-goblin-850/30 pt-1.5 mt-0.5">
              <Coins className="h-3.5 w-3.5 text-emerald-400" />
              <span className="text-emerald-400 font-bold">
                {lang === 'ar' ? 'تأمين' : 'Deposit'}: {fmtMoney(r.depositCents, lang)}
              </span>
            </div>
          )}
        </div>

        {r.notes && (
          <p className="inline-flex items-start gap-1.5 text-xs text-goblin-400 italic bg-goblin-950/60 p-2.5 rounded-xl border border-goblin-950 leading-relaxed">
            <StickyNote className="h-3.5 w-3.5 shrink-0 mt-0.5" /> {r.notes}
          </p>
        )}
      </div>

      {/* Actions */}
      {(NEXT[r.status] ?? []).length > 0 && (
        <div className="flex flex-wrap gap-2 border-t border-goblin-800 pt-3 mt-1">
          {(NEXT[r.status] ?? []).map((s) => {
            const isSeated = s === 'SEATED';
            const isDanger = s === 'CANCELLED' || s === 'NO_SHOW';
            let label = s.replace('_', ' ').toLowerCase();
            if (lang === 'ar') {
              label = s === 'CONFIRMED' ? 'تأكيد' :
                      s === 'CANCELLED' ? 'إلغاء' :
                      s === 'SEATED' ? 'تسجيل دخول' :
                      s === 'NO_SHOW' ? 'لم يحضر' :
                      s === 'COMPLETED' ? 'اكتمال' : label;
            } else if (s === 'SEATED') {
              label = 'Check in';
            }

            return (
              <button
                key={s}
                disabled={busy}
                onClick={() => void handleAction(s)}
                className={`flex-1 min-w-[100px] rounded-xl px-4 py-2.5 text-xs font-bold text-center transition-all active:scale-[0.98] disabled:opacity-40 shadow-sm ${
                  isSeated
                    ? 'bg-emerald-600 hover:bg-emerald-500 text-white font-extrabold ring-2 ring-emerald-500/20'
                    : isDanger
                    ? 'bg-red-900/60 hover:bg-red-800/80 text-red-200 border border-red-800'
                    : 'bg-goblin-800 hover:bg-goblin-700 text-white'
                }`}
              >
                {busy ? '...' : label}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

interface NewReservationDialogProps {
  zones: FloorZone[];
  onClose: () => void;
  onCreated: () => void;
  initialData?: {
    resourceId: string;
    date: string;
    startTime: string;
    durationMin: string;
  } | null;
}

function NewReservationDialog({ zones, onClose, onCreated, initialData }: NewReservationDialogProps) {
  const { lang } = usePos();
  const resources = zones.flatMap((z) =>
    z.resources.map((r) => ({
      ...r,
      zoneName: lang === 'ar' && z.nameAr ? z.nameAr : z.name,
    })),
  );

  const [resourceId, setResourceId] = useState(initialData?.resourceId ?? '');
  const [date, setDate] = useState(initialData?.date ?? new Date().toISOString().slice(0, 10));
  const [start, setStart] = useState(initialData?.startTime ?? '19:00');
  const [durationMin, setDurationMin] = useState(initialData?.durationMin ?? '120');
  const [partySize, setPartySize] = useState('2');
  const [guestName, setGuestName] = useState('');
  const [guestPhone, setGuestPhone] = useState('');
  const [deposit, setDeposit] = useState('');
  const [notes, setNotes] = useState('');

  const [crmSearch, setCrmSearch] = useState('');
  const [crmResults, setCrmResults] = useState<any[]>([]);
  const [selectedCustomer, setSelectedCustomer] = useState<any | null>(null);

  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  // CRM autocomplete lookup
  useEffect(() => {
    const handle = setTimeout(() => {
      if (!crmSearch.trim()) {
        setCrmResults([]);
        return;
      }
      api<any[]>(`/crm/customers/lookup?q=${encodeURIComponent(crmSearch)}&onlyActive=true`)
        .then(setCrmResults)
        .catch(() => {});
    }, 250);
    return () => clearTimeout(handle);
  }, [crmSearch]);

  async function submit() {
    if (!resourceId) {
      setErr(lang === 'ar' ? 'يجب اختيار الطاولة أو الغرفة' : 'Resource is required');
      return;
    }
    if (!guestName.trim() && !selectedCustomer) {
      setErr(lang === 'ar' ? 'يجب إدخال اسم العميل' : 'Guest name or customer is required');
      return;
    }

    setErr('');
    setBusy(true);

    const startAt = new Date(`${date}T${start}:00`);
    const endAt = new Date(startAt.getTime() + Number(durationMin) * 60_000);

    if (Number.isNaN(startAt.getTime()) || !(Number(durationMin) > 0)) {
      setErr(lang === 'ar' ? 'الوقت أو المدة غير صالحة' : 'Invalid start time or duration');
      setBusy(false);
      return;
    }

    const depositCents = deposit ? Math.round(Number(deposit) * 100) : undefined;

    try {
      await api('/reservations', {
        method: 'POST',
        body: {
          resourceId,
          startAt: startAt.toISOString(),
          endAt: endAt.toISOString(),
          partySize: Math.max(1, Math.round(Number(partySize))),
          customerId: selectedCustomer?.id || undefined,
          guestName: guestName.trim() || selectedCustomer?.name,
          guestPhone: guestPhone.trim() || selectedCustomer?.phone || undefined,
          depositCents: depositCents ?? undefined,
          notes: notes.trim() || undefined,
        },
      });
      onCreated();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Booking failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 overflow-y-auto animate-fade-in" onClick={onClose}>
      <div className="w-full max-w-lg bg-goblin-900 rounded-2xl border border-goblin-800 p-5 text-goblin-50 max-h-[95vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-goblin-800 pb-3 mb-4">
          <h2 className="inline-flex items-center gap-2 text-lg font-bold">
            <CalendarDays className="h-5 w-5" /> {lang === 'ar' ? 'حجز جديد' : 'New Reservation'}
          </h2>
          <button onClick={onClose} className="text-goblin-400 hover:text-goblin-50 p-1">
            <X className="h-5 w-5" />
          </button>
        </div>

        {err && (
          <div className="mb-4 flex items-center gap-2 rounded-xl bg-red-950/60 p-3.5 border border-red-900 text-red-200 text-sm">
            <TriangleAlert className="h-4 w-4 shrink-0" /> {err}
          </div>
        )}

        <div className="space-y-4">
          {/* CRM Profile Selector */}
          <div className="rounded-xl bg-goblin-950 p-3 border border-goblin-850">
            <label className="flex items-center gap-1.5 text-xs font-bold text-goblin-400 mb-1.5 uppercase tracking-wide">
              <User className="h-3.5 w-3.5" /> {lang === 'ar' ? 'ربط بملف عميل (اختياري)' : 'Link Customer Profile (Optional)'}
            </label>
            {selectedCustomer ? (
              <div className="flex items-center justify-between bg-goblin-900 p-2.5 rounded-xl border border-goblin-800">
                <div>
                  <div className="font-bold">{selectedCustomer.name}</div>
                  <div className="text-xs text-goblin-400 font-mono">{selectedCustomer.phone}</div>
                </div>
                <button
                  onClick={() => {
                    setSelectedCustomer(null);
                    setGuestName('');
                    setGuestPhone('');
                  }}
                  className="rounded-lg bg-red-950 text-red-300 hover:bg-red-900 px-2 py-1 text-xs"
                >
                  {lang === 'ar' ? 'إزالة' : 'Remove'}
                </button>
              </div>
            ) : (
              <div className="space-y-2">
                <input
                  type="text"
                  placeholder={lang === 'ar' ? 'ابحث بالاسم أو الهاتف في الـ CRM...' : 'Search CRM by name or phone...'}
                  value={crmSearch}
                  onChange={(e) => setCrmSearch(e.target.value)}
                  className="w-full rounded-xl bg-goblin-900 px-3 py-2 text-sm border border-goblin-800 focus:outline-none focus:border-goblin-600"
                />
                {crmResults.length > 0 && (
                  <div className="max-h-40 overflow-y-auto bg-goblin-900 border border-goblin-800 rounded-xl divide-y divide-goblin-850">
                    {crmResults.map((c) => (
                      <button
                        key={c.id}
                        onClick={() => {
                          setSelectedCustomer(c);
                          setGuestName(c.name);
                          setGuestPhone(c.phone);
                          setCrmSearch('');
                          setCrmResults([]);
                        }}
                        className="w-full text-start p-2.5 hover:bg-goblin-800 text-sm transition-colors flex justify-between items-center"
                      >
                        <div>
                          <span className="font-bold">{c.name}</span>
                          <span className="text-goblin-400 text-xs font-mono ms-2">{c.phone}</span>
                        </div>
                        <span className="text-goblin-300 text-xs bg-goblin-950 px-2 py-0.5 rounded-full font-mono">
                          {c.pointsBalance} pts
                        </span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Table Selector */}
          <div>
            <label className="flex items-center gap-1.5 text-xs font-bold text-goblin-400 mb-1.5 uppercase tracking-wide">
              <MapPin className="h-3.5 w-3.5" /> {lang === 'ar' ? 'الطاولة / الغرفة' : 'Table / Room'}
            </label>
            <select
              value={resourceId}
              onChange={(e) => setResourceId(e.target.value)}
              className="w-full rounded-xl bg-goblin-950 p-3 text-sm border border-goblin-800 focus:outline-none focus:border-goblin-600 cursor-pointer"
            >
              <option value="">{lang === 'ar' ? '— اختر —' : '— Select —'}</option>
              {resources.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.zoneName} · {r.name} ({r.capacity} pax)
                </option>
              ))}
            </select>
          </div>

          {/* Date & Time fields */}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div>
              <label className="flex items-center gap-1.5 text-xs font-bold text-goblin-400 mb-1.5 uppercase tracking-wide">
                <CalendarDays className="h-3.5 w-3.5" /> {lang === 'ar' ? 'التاريخ' : 'Date'}
              </label>
              <input
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className="w-full rounded-xl bg-goblin-950 p-3 text-sm border border-goblin-800 focus:outline-none"
              />
            </div>
            <div>
              <label className="flex items-center gap-1.5 text-xs font-bold text-goblin-400 mb-1.5 uppercase tracking-wide">
                <Clock className="h-3.5 w-3.5" /> {lang === 'ar' ? 'وقت البدء' : 'Start Time'}
              </label>
              <input
                type="time"
                value={start}
                onChange={(e) => setStart(e.target.value)}
                className="w-full rounded-xl bg-goblin-950 p-3 text-sm border border-goblin-800 focus:outline-none"
              />
            </div>
            <div>
              <label className="flex items-center gap-1.5 text-xs font-bold text-goblin-400 mb-1.5 uppercase tracking-wide">
                <Timer className="h-3.5 w-3.5" /> {lang === 'ar' ? 'المدة (بالدقائق)' : 'Minutes'}
              </label>
              <input
                type="number"
                value={durationMin}
                onChange={(e) => setDurationMin(e.target.value)}
                className="w-full rounded-xl bg-goblin-950 p-3 text-sm border border-goblin-800 focus:outline-none"
              />
            </div>
          </div>

          {/* Guest Name & Phone info */}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label className="flex items-center gap-1.5 text-xs font-bold text-goblin-400 mb-1.5 uppercase tracking-wide">
                <User className="h-3.5 w-3.5" /> {lang === 'ar' ? 'اسم الضيف' : 'Guest Name'}
              </label>
              <input
                type="text"
                value={guestName}
                onChange={(e) => setGuestName(e.target.value)}
                disabled={!!selectedCustomer}
                className="w-full rounded-xl bg-goblin-950 p-3 text-sm border border-goblin-800 focus:outline-none disabled:opacity-50"
              />
            </div>
            <div>
              <label className="flex items-center gap-1.5 text-xs font-bold text-goblin-400 mb-1.5 uppercase tracking-wide">
                <Phone className="h-3.5 w-3.5" /> {lang === 'ar' ? 'رقم الهاتف' : 'Phone'}
              </label>
              <input
                type="text"
                value={guestPhone}
                onChange={(e) => setGuestPhone(e.target.value)}
                disabled={!!selectedCustomer}
                className="w-full rounded-xl bg-goblin-950 p-3 text-sm border border-goblin-800 focus:outline-none disabled:opacity-50"
              />
            </div>
          </div>

          {/* Party size & Deposit */}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label className="flex items-center gap-1.5 text-xs font-bold text-goblin-400 mb-1.5 uppercase tracking-wide">
                <Users className="h-3.5 w-3.5" /> {lang === 'ar' ? 'عدد الأفراد' : 'Party Size'}
              </label>
              <input
                type="number"
                value={partySize}
                onChange={(e) => setPartySize(e.target.value)}
                className="w-full rounded-xl bg-goblin-950 p-3 text-sm border border-goblin-800 focus:outline-none"
              />
            </div>
            <div>
              <label className="flex items-center gap-1.5 text-xs font-bold text-goblin-400 mb-1.5 uppercase tracking-wide">
                <Coins className="h-3.5 w-3.5" /> {lang === 'ar' ? 'الدفعة المقدمة (جنيه - اختياري)' : 'Deposit (EGP, optional)'}
              </label>
              <input
                type="number"
                placeholder="0.00"
                value={deposit}
                onChange={(e) => setDeposit(e.target.value)}
                className="w-full rounded-xl bg-goblin-950 p-3 text-sm border border-goblin-800 focus:outline-none"
              />
            </div>
          </div>

          {/* Notes */}
          <div>
            <label className="flex items-center gap-1.5 text-xs font-bold text-goblin-400 mb-1.5 uppercase tracking-wide">
              <StickyNote className="h-3.5 w-3.5" /> {lang === 'ar' ? 'ملاحظات' : 'Notes'}
            </label>
            <input
              type="text"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className="w-full rounded-xl bg-goblin-950 p-3 text-sm border border-goblin-800 focus:outline-none focus:border-goblin-600"
            />
          </div>

          {/* Dialog Action Buttons */}
          <div className="flex gap-3 pt-3">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 rounded-xl bg-goblin-800 py-3.5 font-semibold text-center hover:bg-goblin-750 transition-colors"
            >
              {lang === 'ar' ? 'إلغاء' : 'Cancel'}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={submit}
              className="flex-1 rounded-xl bg-goblin-600 py-3.5 font-bold text-center hover:bg-goblin-500 transition-all shadow-md active:scale-95 disabled:opacity-40"
            >
              {busy ? (lang === 'ar' ? 'حفظ...' : 'Booking...') : (lang === 'ar' ? 'حفظ الحجز' : 'Book')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
