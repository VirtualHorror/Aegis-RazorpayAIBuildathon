import { describe, expect, it } from 'vitest';
import { forecast } from './forecast';

describe('deterministic forecast', () => {
  it('fits a hand-computed linear fixture and emits a seven-day band', () => {
    const result = forecast([
      { date: '2026-01-01', value: 10 },
      { date: '2026-01-02', value: 12 },
      { date: '2026-01-03', value: 14 },
      { date: '2026-01-04', value: 16 },
    ], 7);
    expect(result.method).toBe('ols+ma7');
    expect(result.slopePerDay).toBeCloseTo(2);
    expect(result.intercept).toBeCloseTo(10);
    expect(result.r2).toBeCloseTo(1);
    expect(result.residualStddev).toBeCloseTo(0);
    expect(result.points).toHaveLength(7);
    expect(result.points[0]?.value).toBeCloseTo(15);
    expect(result.points[0]?.lower).toBeCloseTo(result.points[0]?.value ?? 0);
  });
});
