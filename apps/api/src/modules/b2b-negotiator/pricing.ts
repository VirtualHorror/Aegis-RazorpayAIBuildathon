export const ROUND_DISCOUNT_PCT = [5, 10, 15] as const;

export type OfferClamp = 'none' | 'floor' | 'max_pct';

/** Compute one bounded offer in integer paise; all rounding favours the merchant. */
export function offerForRound(
  amountPaise: number,
  floorPaise: number,
  round: 1 | 2 | 3,
  maxDiscountPct: number,
): { offerPaise: number; discountPct: number; clampedBy: OfferClamp } {
  assertPaise(amountPaise, 'amountPaise');
  assertPaise(floorPaise, 'floorPaise');
  if (floorPaise > amountPaise) throw new RangeError('floorPaise cannot exceed amountPaise');
  if (!Number.isFinite(maxDiscountPct) || maxDiscountPct < 0 || maxDiscountPct > 100) throw new RangeError('maxDiscountPct must be 0..100');
  const requestedPct = ROUND_DISCOUNT_PCT[round - 1] ?? 0;
  const effectivePct = Math.min(requestedPct, maxDiscountPct);
  const candidate = Math.ceil(amountPaise * (100 - effectivePct) / 100);
  if (candidate < floorPaise) {
    const actualPct = amountPaise === 0 ? 0 : (amountPaise - floorPaise) * 100 / amountPaise;
    return { offerPaise: floorPaise, discountPct: actualPct, clampedBy: 'floor' };
  }
  return { offerPaise: candidate, discountPct: amountPaise === 0 ? 0 : (amountPaise - candidate) * 100 / amountPaise, clampedBy: requestedPct > maxDiscountPct ? 'max_pct' : 'none' };
}

export function isAcceptableCounter(counterPaise: number, floorPaise: number): boolean {
  return Number.isSafeInteger(counterPaise) && Number.isSafeInteger(floorPaise) && counterPaise >= floorPaise;
}

function assertPaise(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 0) throw new RangeError(`${label} must be a non-negative safe integer`);
}
