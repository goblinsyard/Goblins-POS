/**
 * Time-billing engine — pure functions, no I/O.
 *
 * A session is a list of SEGMENTS (contiguous clock-time runs; pause/transfer
 * close one segment and open another). Pricing walks each segment minute-band
 * by minute-band across the rate windows that apply (base rate + RateRules
 * such as happy hour), so midnight crossover and happy-hour boundaries are
 * handled by construction.
 *
 * All money is integer piasters. All timestamps are epoch ms (UTC).
 * Rate rule windows are defined in LOCAL Cairo wall-clock time; the caller
 * supplies a `toLocal` converter so this module stays pure & testable.
 */

export interface RatePlanSpec {
  hourlyCents: number;
  hourlyMultiCents?: number | null;
  minimumCents: number;
  roundToMinutes: number; // bill duration rounded to nearest N minutes
  roundingMode: 'nearest' | 'up' | 'down';
  graceMinutes: number; // free minutes at session start
  rules: RateRuleSpec[];
}

export interface RateRuleSpec {
  daysOfWeek: number[]; // 0=Sun..6=Sat in LOCAL time
  startTime: string; // "HH:mm" local; window may wrap midnight
  endTime: string;
  hourlyCents: number;
  hourlyMultiCents?: number | null;
  priority: number;
}

export interface SegmentSpec {
  startedAt: number; // epoch ms
  endedAt: number; // epoch ms
  isMultiplayer: boolean;
}

export interface LocalTime {
  dayOfWeek: number; // 0=Sun..6=Sat
  minutesOfDay: number; // 0..1439
}

/** Converts an epoch-ms instant to local Cairo wall-clock info. */
export type ToLocal = (epochMs: number) => LocalTime;

export interface BandCharge {
  ruleName: string | null; // null = base rate
  minutes: number;
  hourlyCents: number;
  amountCents: number;
}

export interface TimeBillResult {
  rawMinutes: number; // actual elapsed across segments
  billedMinutes: number; // after grace + rounding
  bands: BandCharge[];
  timeCents: number; // sum of bands (before minimum)
  totalCents: number; // max(timeCents, minimum)
  minimumApplied: boolean;
}

const MS_PER_MIN = 60_000;

export function parseHm(s: string): number {
  const [hRaw, mRaw] = s.split(':');
  const h = Number(hRaw);
  const m = Number(mRaw);
  if (!Number.isInteger(h) || !Number.isInteger(m) || h < 0 || h > 23 || m < 0 || m > 59) {
    throw new Error(`Invalid HH:mm time: ${s}`);
  }
  return h * 60 + m;
}

/** Is this local instant inside the rule's window? Handles midnight wrap. */
export function ruleApplies(rule: RateRuleSpec, local: LocalTime): boolean {
  const start = parseHm(rule.startTime);
  const end = parseHm(rule.endTime);
  const t = local.minutesOfDay;
  if (start === end) return false; // zero-length window
  if (start < end) {
    // simple window e.g. 14:00–17:00
    return rule.daysOfWeek.includes(local.dayOfWeek) && t >= start && t < end;
  }
  // wrapping window e.g. 22:00–02:00: the window "belongs" to the start day
  if (t >= start) return rule.daysOfWeek.includes(local.dayOfWeek);
  if (t < end) {
    // after midnight — check against the PREVIOUS day
    const prevDay = (local.dayOfWeek + 6) % 7;
    return rule.daysOfWeek.includes(prevDay);
  }
  return false;
}

/** Pick the hourly rate (piasters/hr) in force at an instant. */
export function rateAt(
  plan: RatePlanSpec,
  local: LocalTime,
  isMultiplayer: boolean,
): { hourlyCents: number; ruleName: string | null } {
  const applicable = plan.rules
    .filter((r) => ruleApplies(r, local))
    .sort((a, b) => b.priority - a.priority);
  const rule = applicable[0];
  if (rule) {
    const cents =
      isMultiplayer && rule.hourlyMultiCents != null ? rule.hourlyMultiCents : rule.hourlyCents;
    return { hourlyCents: cents, ruleName: ruleName(rule) };
  }
  const cents =
    isMultiplayer && plan.hourlyMultiCents != null ? plan.hourlyMultiCents : plan.hourlyCents;
  return { hourlyCents: cents, ruleName: null };
}

function ruleName(rule: RateRuleSpec): string {
  return `${rule.startTime}-${rule.endTime}@${rule.hourlyCents}`;
}

export function roundMinutes(
  rawMinutes: number,
  roundTo: number,
  mode: 'nearest' | 'up' | 'down',
): number {
  if (roundTo <= 1) return Math.ceil(rawMinutes); // sub-minute time still counts as a minute
  const units = rawMinutes / roundTo;
  const rounded =
    mode === 'up' ? Math.ceil(units) : mode === 'down' ? Math.floor(units) : Math.round(units);
  return rounded * roundTo;
}

/**
 * Price a session. Walks each segment minute-by-minute (minutes are the billing
 * quantum), assigning each minute to the rate band in force at its start.
 * Grace minutes are deducted from the start of the first segment. The
 * rounding adjustment is applied to the LAST band (the rate in force at
 * session end), keeping band totals exactly equal to the bill.
 */
export function priceSession(
  segments: SegmentSpec[],
  plan: RatePlanSpec,
  toLocal: ToLocal,
): TimeBillResult {
  const ordered = [...segments].sort((a, b) => a.startedAt - b.startedAt);
  for (const s of ordered) {
    if (s.endedAt < s.startedAt) throw new Error('Segment ends before it starts');
  }

  // 1. Raw elapsed minutes (ceil sub-minute remainders only on the total)
  const rawMs = ordered.reduce((acc, s) => acc + (s.endedAt - s.startedAt), 0);
  const rawMinutes = Math.ceil(rawMs / MS_PER_MIN);

  // 2. Walk minutes across segments, skipping grace, accumulating bands
  const bands = new Map<string, BandCharge>();
  let graceLeft = plan.graceMinutes;
  let lastBandKey: string | null = null;

  for (const seg of ordered) {
    const segMinutes = Math.ceil((seg.endedAt - seg.startedAt) / MS_PER_MIN);
    for (let i = 0; i < segMinutes; i++) {
      if (graceLeft > 0) {
        graceLeft--;
        continue;
      }
      const instant = seg.startedAt + i * MS_PER_MIN;
      const { hourlyCents, ruleName: rn } = rateAt(plan, toLocal(instant), seg.isMultiplayer);
      const key = `${rn ?? 'base'}|${hourlyCents}`;
      const band = bands.get(key) ?? { ruleName: rn, minutes: 0, hourlyCents, amountCents: 0 };
      band.minutes++;
      bands.set(key, band);
      lastBandKey = key;
    }
  }

  // 3. Rounding: adjust total billable minutes, applying the delta to the last band
  const billableRaw = Math.max(0, rawMinutes - plan.graceMinutes);
  const billedMinutes = Math.max(
    0,
    roundMinutes(billableRaw, plan.roundToMinutes, plan.roundingMode),
  );
  const accumulated = [...bands.values()].reduce((a, b) => a + b.minutes, 0);
  const delta = billedMinutes - accumulated;
  if (delta !== 0 && lastBandKey) {
    const band = bands.get(lastBandKey)!;
    band.minutes = Math.max(0, band.minutes + delta);
  } else if (delta > 0 && !lastBandKey) {
    // entire session was inside grace but rounding still bills time (edge: roundTo up)
    const { hourlyCents, ruleName: rn } = rateAt(
      plan,
      toLocal(ordered[ordered.length - 1]?.endedAt ?? Date.now()),
      ordered[ordered.length - 1]?.isMultiplayer ?? false,
    );
    bands.set('rounding', { ruleName: rn, minutes: delta, hourlyCents, amountCents: 0 });
  }

  // 4. Money: per-band amount = minutes * hourly / 60, rounded half-up per band
  const bandList: BandCharge[] = [...bands.values()]
    .filter((b) => b.minutes > 0)
    .map((b) => ({
      ...b,
      amountCents: Math.round((b.minutes * b.hourlyCents) / 60),
    }));

  const timeCents = bandList.reduce((a, b) => a + b.amountCents, 0);
  // Minimum applies whenever the session actually ran (rawMinutes > 0), even if
  // rounding brought billable minutes to 0 — that is exactly what minimums are for.
  const played = rawMinutes > 0;
  const minimumApplied = played && timeCents < plan.minimumCents;
  const totalCents = played ? Math.max(timeCents, plan.minimumCents) : 0;

  return { rawMinutes, billedMinutes, bands: bandList, timeCents, totalCents, minimumApplied };
}

/** Live running cost for the floor plan — prices segments as if stopped now. */
export function runningCost(
  openSegments: SegmentSpec[],
  nowMs: number,
  plan: RatePlanSpec,
  toLocal: ToLocal,
): TimeBillResult {
  const closed = openSegments.map((s) => ({
    ...s,
    endedAt: s.endedAt > 0 ? s.endedAt : nowMs,
  }));
  return priceSession(closed, plan, toLocal);
}

/** Minutes remaining on a prepaid block given elapsed billable minutes. */
export function prepaidRemaining(prepaidMinutes: number, billableMinutes: number): number {
  return Math.max(0, prepaidMinutes - billableMinutes);
}
