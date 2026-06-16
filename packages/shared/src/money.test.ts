import { describe, expect, it } from 'vitest';
import {
  applyBps,
  changeDue,
  computeBill,
  lineTotal,
  resolveDiscount,
  roundHalfUp,
  splitEven,
} from './money';

describe('roundHalfUp', () => {
  it('rounds .5 away from zero', () => {
    expect(roundHalfUp(2.5)).toBe(3);
    expect(roundHalfUp(-2.5)).toBe(-3);
    expect(roundHalfUp(2.4)).toBe(2);
  });
});

describe('lineTotal', () => {
  it('handles whole quantities', () => {
    expect(lineTotal(5000, 3)).toBe(15000); // 50 EGP x3
  });
  it('handles 0.5 quantity items', () => {
    expect(lineTotal(5000, 0.5)).toBe(2500);
    expect(lineTotal(333, 0.5)).toBe(167); // 166.5 → 167 half-up
  });
  it('handles 3-decimal quantities (weight items)', () => {
    expect(lineTotal(10000, 0.250)).toBe(2500); // 100 EGP/kg * 250g
    expect(lineTotal(9999, 0.333)).toBe(3330); // 3329.667 → 3330
  });
});

describe('computeBill', () => {
  it('computes Egyptian standard: 12% service + 14% VAT on top', () => {
    // 100 EGP food: service 12 EGP, VAT on 112 = 15.68 → total 127.68
    const t = computeBill({
      lineCents: [10000],
      serviceChargeBps: 1200,
      taxBps: 1400,
    });
    expect(t.subtotalCents).toBe(10000);
    expect(t.serviceChargeCents).toBe(1200);
    expect(t.taxCents).toBe(1568);
    expect(t.totalCents).toBe(12768);
  });

  it('applies bill discount before service & tax', () => {
    const t = computeBill({
      lineCents: [10000],
      billDiscountCents: 1000,
      serviceChargeBps: 1200,
      taxBps: 1400,
    });
    expect(t.discountCents).toBe(1000);
    expect(t.serviceChargeCents).toBe(1080); // 12% of 9000
    expect(t.taxCents).toBe(1411); // 14% of 10080 = 1411.2 → 1411
    expect(t.totalCents).toBe(11491);
  });

  it('clamps discount to subtotal', () => {
    const t = computeBill({ lineCents: [500], billDiscountCents: 9999 });
    expect(t.discountCents).toBe(500);
    expect(t.totalCents).toBe(0);
  });

  it('extracts tax when tax-inclusive', () => {
    // 114 EGP inclusive of 14% → base 100, tax 14
    const t = computeBill({ lineCents: [11400], taxBps: 1400, taxInclusive: true });
    expect(t.taxCents).toBe(1400);
    expect(t.totalCents).toBe(11400);
  });

  it('zero bill is all zeros', () => {
    const t = computeBill({ lineCents: [] });
    expect(t.totalCents).toBe(0);
  });
});

describe('resolveDiscount', () => {
  it('percent discount in bps', () => {
    expect(resolveDiscount('PERCENT', 1000, 20000)).toBe(2000); // 10% of 200 EGP
  });
  it('fixed discount clamped to base', () => {
    expect(resolveDiscount('FIXED', 5000, 3000)).toBe(3000);
  });
  it('never negative', () => {
    expect(resolveDiscount('FIXED', -100, 3000)).toBe(0);
  });
});

describe('splitEven', () => {
  it('sums exactly to original with remainder spread', () => {
    expect(splitEven(10000, 3)).toEqual([3334, 3333, 3333]);
    expect(splitEven(10000, 3).reduce((a, b) => a + b)).toBe(10000);
  });
  it('handles 1 part', () => {
    expect(splitEven(777, 1)).toEqual([777]);
  });
});

describe('changeDue', () => {
  it('computes change', () => {
    expect(changeDue(12768, 15000)).toBe(2232);
  });
  it('throws on insufficient tender', () => {
    expect(() => changeDue(100, 99)).toThrow();
  });
});

describe('applyBps', () => {
  it('14% VAT of 1 piaster rounds correctly', () => {
    expect(applyBps(1, 1400)).toBe(0); // 0.14 → 0
    expect(applyBps(4, 1400)).toBe(1); // 0.56 → 1
  });
});
