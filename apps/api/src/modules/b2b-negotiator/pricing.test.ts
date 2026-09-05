import { describe, expect, it } from 'vitest';
import { isAcceptableCounter, offerForRound } from './pricing';

describe('bounded invoice pricing', () => {
  it('rounds toward the merchant and reports max percentage clamps', () => {
    expect(offerForRound(1_000_001, 0, 2, 7)).toMatchObject({ clampedBy: 'max_pct', offerPaise: 930_001 });
  });

  it('never crosses the immutable floor', () => {
    expect(offerForRound(1_000_000, 950_000, 3, 15)).toMatchObject({ offerPaise: 950_000, clampedBy: 'floor' });
    expect(isAcceptableCounter(950_000, 950_000)).toBe(true);
    expect(isAcceptableCounter(949_999, 950_000)).toBe(false);
  });
});
