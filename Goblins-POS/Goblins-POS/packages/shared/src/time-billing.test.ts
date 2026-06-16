import { describe, expect, it } from 'vitest';
import {
  priceSession,
  roundMinutes,
  ruleApplies,
  type RatePlanSpec,
  type SegmentSpec,
  type ToLocal,
} from './time-billing';
import { makeToLocal } from './cairo-time';

// ---------- helpers ----------

/** Fixed-offset "local" clock: UTC+2 (Cairo standard time, no DST). */
const utc2: ToLocal = (ms) => {
  const d = new Date(ms + 2 * 3600_000);
  return { dayOfWeek: d.getUTCDay(), minutesOfDay: d.getUTCHours() * 60 + d.getUTCMinutes() };
};

/** Build epoch ms for a given UTC+2 local wall time on 2026-06-10 (Wednesday). */
function local(h: number, m: number, dayOffset = 0): number {
  // 2026-06-10T00:00 local = 2026-06-09T22:00Z
  const base = Date.UTC(2026, 5, 9, 22, 0, 0);
  return base + dayOffset * 86400_000 + h * 3600_000 + m * 60_000;
}

const BILLIARDS: RatePlanSpec = {
  hourlyCents: 12000, // 120 EGP/hr
  minimumCents: 0,
  roundToMinutes: 1,
  roundingMode: 'nearest',
  graceMinutes: 0,
  rules: [],
};

const PS5: RatePlanSpec = {
  hourlyCents: 8000, // 80 EGP/hr single
  hourlyMultiCents: 12000, // 120 EGP/hr multi
  minimumCents: 0,
  roundToMinutes: 5,
  roundingMode: 'nearest',
  graceMinutes: 0,
  rules: [],
};

function seg(start: number, end: number, multi = false): SegmentSpec {
  return { startedAt: start, endedAt: end, isMultiplayer: multi };
}

// ---------- tests ----------

describe('basic pricing', () => {
  it('1 hour of billiards at 120 EGP/hr = 120 EGP', () => {
    const r = priceSession([seg(local(14, 0), local(15, 0))], BILLIARDS, utc2);
    expect(r.billedMinutes).toBe(60);
    expect(r.totalCents).toBe(12000);
  });

  it('90 minutes prorated = 180 EGP', () => {
    const r = priceSession([seg(local(14, 0), local(15, 30))], BILLIARDS, utc2);
    expect(r.totalCents).toBe(18000);
  });

  it('1 minute = 2 EGP (120/60)', () => {
    const r = priceSession([seg(local(14, 0), local(14, 1))], BILLIARDS, utc2);
    expect(r.totalCents).toBe(200);
  });

  it('sub-minute play bills as one minute', () => {
    const r = priceSession([seg(local(14, 0), local(14, 0) + 30_000)], BILLIARDS, utc2);
    expect(r.billedMinutes).toBe(1);
    expect(r.totalCents).toBe(200);
  });

  it('zero-length session bills nothing', () => {
    const r = priceSession([seg(local(14, 0), local(14, 0))], BILLIARDS, utc2);
    expect(r.totalCents).toBe(0);
    expect(r.billedMinutes).toBe(0);
  });
});

describe('paused timers (multiple segments)', () => {
  it('pause gap is not billed', () => {
    // 30 min, pause 20, then 30 more = 60 billed
    const r = priceSession(
      [seg(local(14, 0), local(14, 30)), seg(local(14, 50), local(15, 20))],
      BILLIARDS,
      utc2,
    );
    expect(r.billedMinutes).toBe(60);
    expect(r.totalCents).toBe(12000);
  });
});

describe('midnight crossover', () => {
  it('23:30 → 00:30 bills 60 minutes', () => {
    const r = priceSession([seg(local(23, 30), local(24, 30))], BILLIARDS, utc2);
    expect(r.billedMinutes).toBe(60);
    expect(r.totalCents).toBe(12000);
  });

  it('happy hour ending at midnight splits correctly across the boundary', () => {
    const plan: RatePlanSpec = {
      ...BILLIARDS,
      rules: [
        {
          daysOfWeek: [0, 1, 2, 3, 4, 5, 6],
          startTime: '22:00',
          endTime: '00:00', // parses as 0 → wrapping window 22:00→00:00
          hourlyCents: 6000, // half price until midnight
          priority: 1,
        },
      ],
    };
    // 23:00 → 01:00: 60 min at 60 EGP/hr + 60 min at 120 EGP/hr = 60 + 120 = 180
    const r = priceSession([seg(local(23, 0), local(25, 0))], plan, utc2);
    expect(r.billedMinutes).toBe(120);
    expect(r.totalCents).toBe(6000 + 12000);
    expect(r.bands).toHaveLength(2);
  });
});

describe('happy-hour boundary', () => {
  const plan: RatePlanSpec = {
    ...BILLIARDS,
    rules: [
      {
        daysOfWeek: [3], // Wednesday
        startTime: '14:00',
        endTime: '17:00',
        hourlyCents: 8000,
        priority: 1,
      },
    ],
  };

  it('session straddling the end of happy hour splits into two bands', () => {
    // 16:30–17:30 Wed: 30 min @80 + 30 min @120 = 40 + 60 = 100 EGP
    const r = priceSession([seg(local(16, 30), local(17, 30))], plan, utc2);
    expect(r.totalCents).toBe(4000 + 6000);
  });

  it('happy hour does not apply on other days', () => {
    // Thursday 16:30 (dayOffset 1)
    const r = priceSession(
      [seg(local(16, 30, 1), local(17, 30, 1))],
      plan,
      utc2,
    );
    expect(r.totalCents).toBe(12000);
  });

  it('minute exactly at window start gets the happy rate; at end gets base', () => {
    const atStart = priceSession([seg(local(14, 0), local(14, 1))], plan, utc2);
    expect(atStart.totalCents).toBe(Math.round(8000 / 60)); // 133
    const atEnd = priceSession([seg(local(17, 0), local(17, 1))], plan, utc2);
    expect(atEnd.totalCents).toBe(200); // base 120/hr
  });
});

describe('PS single vs multiplayer', () => {
  it('single rate', () => {
    const r = priceSession([seg(local(15, 0), local(16, 0))], PS5, utc2);
    expect(r.totalCents).toBe(8000);
  });
  it('multiplayer rate', () => {
    const r = priceSession([seg(local(15, 0), local(16, 0), true)], PS5, utc2);
    expect(r.totalCents).toBe(12000);
  });
  it('switching single→multi mid-session bills each segment at its own rate', () => {
    const r = priceSession(
      [seg(local(15, 0), local(15, 30), false), seg(local(15, 30), local(16, 0), true)],
      PS5,
      utc2,
    );
    expect(r.totalCents).toBe(4000 + 6000);
  });
});

describe('rounding rules', () => {
  it('roundMinutes nearest-5: 62 → 60, 63 → 65', () => {
    expect(roundMinutes(62, 5, 'nearest')).toBe(60);
    expect(roundMinutes(63, 5, 'nearest')).toBe(65);
  });
  it('round up / down', () => {
    expect(roundMinutes(61, 5, 'up')).toBe(65);
    expect(roundMinutes(64, 5, 'down')).toBe(60);
  });
  it('PS plan rounds to nearest 5 minutes', () => {
    // 47 min → 45 min at 80/hr = 60 EGP
    const r = priceSession([seg(local(15, 0), local(15, 47))], PS5, utc2);
    expect(r.billedMinutes).toBe(45);
    expect(r.totalCents).toBe(6000);
  });
});

describe('minimum charge & grace', () => {
  it('minimum charge applies when time is short', () => {
    const plan = { ...BILLIARDS, minimumCents: 3000 };
    const r = priceSession([seg(local(14, 0), local(14, 5))], plan, utc2);
    expect(r.timeCents).toBe(1000); // 5 min * 2 EGP
    expect(r.totalCents).toBe(3000);
    expect(r.minimumApplied).toBe(true);
  });
  it('grace minutes are free', () => {
    const plan = { ...BILLIARDS, graceMinutes: 10 };
    const r = priceSession([seg(local(14, 0), local(15, 0))], plan, utc2);
    expect(r.billedMinutes).toBe(50);
    expect(r.totalCents).toBe(10000);
  });
  it('session entirely inside grace bills zero', () => {
    const plan = { ...BILLIARDS, graceMinutes: 10 };
    const r = priceSession([seg(local(14, 0), local(14, 5))], plan, utc2);
    expect(r.totalCents).toBe(0);
  });
  it('minimum still applies when rounding brings billed minutes to 0', () => {
    // 1 real minute, round-to-5 nearest → 0 billed minutes, but the table WAS used
    const plan = { ...BILLIARDS, minimumCents: 3000, roundToMinutes: 5 };
    const r = priceSession([seg(local(14, 0), local(14, 1))], plan, utc2);
    expect(r.billedMinutes).toBe(0);
    expect(r.totalCents).toBe(3000);
    expect(r.minimumApplied).toBe(true);
  });
});

describe('ruleApplies window logic', () => {
  const rule = {
    daysOfWeek: [5], // Friday
    startTime: '22:00',
    endTime: '02:00',
    hourlyCents: 1,
    priority: 0,
  };
  it('wrapping window: Friday 23:00 applies', () => {
    expect(ruleApplies(rule, { dayOfWeek: 5, minutesOfDay: 23 * 60 })).toBe(true);
  });
  it('wrapping window: Saturday 01:00 applies (belongs to Friday)', () => {
    expect(ruleApplies(rule, { dayOfWeek: 6, minutesOfDay: 60 })).toBe(true);
  });
  it('wrapping window: Saturday 03:00 does not apply', () => {
    expect(ruleApplies(rule, { dayOfWeek: 6, minutesOfDay: 180 })).toBe(false);
  });
  it('wrapping window: Friday 21:00 does not apply', () => {
    expect(ruleApplies(rule, { dayOfWeek: 5, minutesOfDay: 21 * 60 })).toBe(false);
  });
});

describe('real Cairo timezone (DST-aware)', () => {
  it('makeToLocal(Africa/Cairo) returns sane wall time', () => {
    const toCairo = makeToLocal('Africa/Cairo');
    // 2026-01-15T12:00Z = 14:00 Cairo (UTC+2, winter)
    const winter = toCairo(Date.UTC(2026, 0, 15, 12, 0));
    expect(winter.minutesOfDay).toBe(14 * 60);
    // 2026-06-15T12:00Z = 15:00 Cairo (UTC+3, summer DST)
    const summer = toCairo(Date.UTC(2026, 5, 15, 12, 0));
    expect(summer.minutesOfDay).toBe(15 * 60);
  });
});

describe('band integrity', () => {
  it('band amounts always sum to timeCents', () => {
    const plan: RatePlanSpec = {
      ...BILLIARDS,
      roundToMinutes: 5,
      rules: [
        { daysOfWeek: [3], startTime: '14:00', endTime: '17:00', hourlyCents: 8000, priority: 1 },
      ],
    };
    const r = priceSession([seg(local(16, 13), local(17, 41))], plan, utc2);
    const bandSum = r.bands.reduce((a, b) => a + b.amountCents, 0);
    expect(bandSum).toBe(r.timeCents);
    const bandMinutes = r.bands.reduce((a, b) => a + b.minutes, 0);
    expect(bandMinutes).toBe(r.billedMinutes);
  });
});
