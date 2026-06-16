/**
 * Cairo wall-clock conversion. Egypt re-introduced DST in 2023 (last Friday
 * of April → last Thursday of October), so we MUST use the IANA zone via
 * Intl rather than a fixed UTC+2 offset.
 */
import type { LocalTime, ToLocal } from './time-billing';

const CAIRO_TZ = 'Africa/Cairo';

const fmt = new Intl.DateTimeFormat('en-US', {
  timeZone: CAIRO_TZ,
  weekday: 'short',
  hour: 'numeric',
  minute: 'numeric',
  hour12: false,
});

const DOW: Record<string, number> = {
  Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6,
};

export const toCairoLocal: ToLocal = (epochMs: number): LocalTime => {
  const parts = fmt.formatToParts(new Date(epochMs));
  let dayOfWeek = 0;
  let hour = 0;
  let minute = 0;
  for (const p of parts) {
    if (p.type === 'weekday') dayOfWeek = DOW[p.value] ?? 0;
    else if (p.type === 'hour') hour = Number(p.value) % 24; // "24" → 0
    else if (p.type === 'minute') minute = Number(p.value);
  }
  return { dayOfWeek, minutesOfDay: hour * 60 + minute };
};

/** Build a ToLocal for any IANA zone (used by tests to pin behavior). */
export function makeToLocal(timeZone: string): ToLocal {
  const f = new Intl.DateTimeFormat('en-US', {
    timeZone,
    weekday: 'short',
    hour: 'numeric',
    minute: 'numeric',
    hour12: false,
  });
  return (epochMs) => {
    let dayOfWeek = 0;
    let hour = 0;
    let minute = 0;
    for (const p of f.formatToParts(new Date(epochMs))) {
      if (p.type === 'weekday') dayOfWeek = DOW[p.value] ?? 0;
      else if (p.type === 'hour') hour = Number(p.value) % 24;
      else if (p.type === 'minute') minute = Number(p.value);
    }
    return { dayOfWeek, minutesOfDay: hour * 60 + minute };
  };
}
