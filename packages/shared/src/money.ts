/**
 * Money helpers.
 * Intent: Aegis stores every amount as INTEGER PAISE (1 INR = 100 paise) so that ledger math is exact.
 *         Floating point never touches an amount (Constraints C-A1, C-B6); percentages are applied with BigInt basis points.
 * Flow:   validate → integer arithmetic → validate result. Formatting for humans happens only in `formatInr` (UI/messages).
 */

export const MAX_SAFE_PAISE = Number.MAX_SAFE_INTEGER;

export class MoneyError extends RangeError {
  override name = 'MoneyError';
}

/** A non-negative integer paise amount (prices, invoice totals, recoveries). */
export function assertSafePaise(value: unknown, label = 'amount'): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value > MAX_SAFE_PAISE) {
    throw new MoneyError(`${label} must be a non-negative integer paise value <= ${MAX_SAFE_PAISE}, got ${String(value)}`);
  }
  return value;
}

/** A signed integer paise amount (e.g. an action's money impact, which is <= 0). */
export function assertSafeSignedPaise(value: unknown, label = 'amount'): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || Math.abs(value) > MAX_SAFE_PAISE) {
    throw new MoneyError(`${label} must be an integer paise value with |value| <= ${MAX_SAFE_PAISE}, got ${String(value)}`);
  }
  return value;
}

/**
 * Convert rupees written as a JS number into paise. Only for constants, fixtures and seeds
 * (e.g. `rupeesToPaise(1499)`), never for values that came out of arithmetic.
 */
export function rupeesToPaise(rupees: number): number {
  if (!Number.isFinite(rupees) || rupees < 0) throw new MoneyError(`rupees must be a finite non-negative number, got ${String(rupees)}`);
  return assertSafePaise(Math.round(rupees * 100), 'rupeesToPaise');
}

/** Sum signed paise amounts; every operand and the result are validated. */
export function addPaise(...values: number[]): number {
  let total = 0;
  for (const v of values) total += assertSafeSignedPaise(v);
  return assertSafeSignedPaise(total, 'sum');
}

export type Rounding = 'floor' | 'ceil' | 'nearest';

/**
 * pct% of an amount with exact integer arithmetic.
 * `pct` may carry up to two decimals (12.5 → 1250 basis points). Rounding is explicit because the
 * direction matters for money: discounts round toward the merchant (`floor` of the discount), fees round up.
 */
export function pctOf(amountPaise: number, pct: number, rounding: Rounding = 'nearest'): number {
  assertSafePaise(amountPaise, 'amountPaise');
  if (!Number.isFinite(pct) || pct < 0 || pct > 100) throw new MoneyError(`pct must be within 0..100, got ${String(pct)}`);
  // BigInt() calls rather than literals so the file compiles under any consumer's TS target (Next's default is ES2017).
  const bps = BigInt(Math.round(pct * 100));
  const numerator = BigInt(amountPaise) * bps;
  const denominator = BigInt(10_000);
  let quotient = numerator / denominator;
  const remainder = numerator % denominator;
  if (remainder !== BigInt(0)) {
    if (rounding === 'ceil') quotient += BigInt(1);
    else if (rounding === 'nearest' && remainder * BigInt(2) >= denominator) quotient += BigInt(1);
  }
  return assertSafePaise(Number(quotient), 'pctOf');
}

/**
 * Human formatting with Indian digit grouping: 42000000 → "₹4,20,000.00". Negative amounts keep a leading minus.
 * Intent: the only place paise become a display string; the integer part is grouped by Intl, the paise part is padded —
 *         no floating point division anywhere.
 */
const inrGroup = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0, useGrouping: true });

export function formatInr(paise: number): string {
  assertSafeSignedPaise(paise, 'paise');
  const sign = paise < 0 ? '-' : '';
  const abs = Math.abs(paise);
  const rupees = Math.floor(abs / 100);
  const fraction = abs % 100;
  return `${sign}₹${inrGroup.format(rupees)}.${String(fraction).padStart(2, '0')}`;
}
