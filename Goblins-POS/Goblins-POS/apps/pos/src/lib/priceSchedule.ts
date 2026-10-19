import type { Category, MenuItem, PriceScheduleInfo } from './types';

/** Current Cairo weekday and minutes since midnight. */
export function cairoNow(): { dow: number; minutes: number } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Africa/Cairo', weekday: 'short', hour: 'numeric', minute: 'numeric', hour12: false,
  }).formatToParts(new Date());
  const days: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  let dow = 0, h = 0, m = 0;
  for (const p of parts) {
    if (p.type === 'weekday') dow = days[p.value] ?? 0;
    else if (p.type === 'hour') h = Number(p.value) % 24;
    else if (p.type === 'minute') m = Number(p.value);
  }
  return { dow, minutes: h * 60 + m };
}

const toMin = (hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
};

/** True when the schedule covers now (handles windows that cross midnight). */
export function scheduleActive(s: PriceScheduleInfo, now = cairoNow()): boolean {
  if (!s.isActive) return false;
  const start = toMin(s.startTime), end = toMin(s.endTime);
  if (start <= end) return s.daysOfWeek.includes(now.dow) && now.minutes >= start && now.minutes < end;
  // overnight: the part after midnight belongs to the previous day's schedule
  if (now.minutes >= start) return s.daysOfWeek.includes(now.dow);
  return now.minutes < end && s.daysOfWeek.includes((now.dow + 6) % 7);
}

export function activePrice(item: MenuItem, now = cairoNow()): number | null {
  const hit = (item.priceSchedules ?? []).find((s) => scheduleActive(s, now));
  return hit ? hit.priceCents : null;
}

/** Offers running right now, grouped by name: [{ name, endTime, count }]. */
export function activeOffers(menu: Category[]): { name: string; endTime: string; count: number }[] {
  const now = cairoNow();
  const seen = new Set<string>();
  const groups = new Map<string, { name: string; endTime: string; count: number }>();
  for (const c of menu) for (const item of c.items) {
    if (seen.has(item.id)) continue;
    seen.add(item.id);
    const s = (item.priceSchedules ?? []).find((x) => scheduleActive(x, now));
    if (!s) continue;
    const g = groups.get(s.name) ?? { name: s.name, endTime: s.endTime, count: 0 };
    g.count += 1;
    groups.set(s.name, g);
  }
  return [...groups.values()];
}
