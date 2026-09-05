import { describe, expect, it } from 'vitest';
import { backoff } from './backoff';

describe('backoff', () => {
  it('uses exponential five-second delays with deterministic zero jitter', () => {
    const zero = () => 0;
    expect(backoff(1, zero)).toBe(5_000);
    expect(backoff(2, zero)).toBe(10_000);
    expect(backoff(3, zero)).toBe(20_000);
    expect(backoff(6, zero)).toBe(160_000);
  });

  it('caps exponential growth at five minutes and permits 1000ms jitter', () => {
    expect(backoff(7, () => 0.999999)).toBe(301_000);
    expect(backoff(Number.MAX_SAFE_INTEGER, () => 0)).toBe(300_000);
  });

  it('rejects invalid attempt numbers instead of producing an unbounded delay', () => {
    expect(() => backoff(0, () => 0)).toThrow(/positive integer/);
    expect(() => backoff(1.5, () => 0)).toThrow(/positive integer/);
  });
});
