/**
 * Money math — ALL amounts are integer piasters (EGP minor units, 1 EGP = 100 pt).
 * No floats may ever hold money. These helpers are the only place rounding happens.
 */

/** Basis points: 1400 bps = 14%. */
export type Bps = number;

/** Round half away from zero (commercial rounding), result is an integer. */
export function roundHalfUp(value: number): number {
  return Math.sign(value) * Math.round(Math.abs(value));
}

/** Apply a bps percentage to an amount: pct(10000, 1400) = 1400. */
export function applyBps(amountCents: number, bps: Bps): number {
  return roundHalfUp((amountCents * bps) / 10_000);
}

/** Multiply unit price by a (possibly fractional, 3dp) quantity. */
export function lineTotal(unitCents: number, quantity: number): number {
  // quantity is at most 3 decimal places; scale to integer math
  const qtyMilli = roundHalfUp(quantity * 1000);
  return roundHalfUp((unitCents * qtyMilli) / 1000);
}

export interface BillInput {
  /** line totals AFTER item-level discounts, in piasters */
  lineCents: number[];
  /** bill-level discounts in piasters (already resolved from % or fixed) */
  billDiscountCents?: number;
  /** service charge in bps applied to (subtotal - discounts) */
  serviceChargeBps?: Bps;
  /** tax in bps applied to (subtotal - discounts + service charge) */
  taxBps?: Bps;
  /** true when prices already include tax (extract instead of add) */
  taxInclusive?: boolean;
}

export interface BillTotals {
  subtotalCents: number;
  discountCents: number;
  serviceChargeCents: number;
  taxCents: number;
  totalCents: number;
}

export function computeBill(input: BillInput): BillTotals {
  const subtotal = input.lineCents.reduce((a, b) => a + b, 0);
  const discount = Math.min(input.billDiscountCents ?? 0, subtotal);
  const afterDiscount = subtotal - discount;
  const service = applyBps(afterDiscount, input.serviceChargeBps ?? 0);
  let tax: number;
  let total: number;
  if (input.taxInclusive) {
    // prices already include tax: extract the portion for reporting
    const base = afterDiscount + service;
    const taxBps = input.taxBps ?? 0;
    tax = base - roundHalfUp((base * 10_000) / (10_000 + taxBps));
    total = base;
  } else {
    tax = applyBps(afterDiscount + service, input.taxBps ?? 0);
    total = afterDiscount + service + tax;
  }
  return {
    subtotalCents: subtotal,
    discountCents: discount,
    serviceChargeCents: service,
    taxCents: tax,
    totalCents: total,
  };
}

/** Resolve a discount (percent in bps, or fixed) against a base amount, clamped to base. */
export function resolveDiscount(
  kind: 'PERCENT' | 'FIXED',
  value: number,
  baseCents: number,
): number {
  const raw = kind === 'PERCENT' ? applyBps(baseCents, value) : value;
  return Math.max(0, Math.min(raw, baseCents));
}

/** Split an amount into n parts that sum exactly to the original (remainder to first parts). */
export function splitEven(amountCents: number, parts: number): number[] {
  if (parts <= 0) throw new Error('parts must be > 0');
  const base = Math.floor(amountCents / parts);
  const remainder = amountCents - base * parts;
  return Array.from({ length: parts }, (_, i) => base + (i < remainder ? 1 : 0));
}

/** Change due for a cash tender. Throws if tendered is insufficient. */
export function changeDue(totalCents: number, tenderedCents: number): number {
  if (tenderedCents < totalCents) throw new Error('Insufficient tender');
  return tenderedCents - totalCents;
}

export function formatEgp(cents: number, locale: 'en' | 'ar' = 'en'): string {
  const value = cents / 100;
  return new Intl.NumberFormat(locale === 'ar' ? 'ar-EG' : 'en-EG', {
    style: 'currency',
    currency: 'EGP',
  }).format(value);
}
