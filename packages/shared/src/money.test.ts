import { describe, expect, it } from 'vitest';
import { MoneyError, addPaise, assertSafePaise, assertSafeSignedPaise, formatInr, pctOf, rupeesToPaise } from './money';

describe('assertSafePaise', () => {
  it('accepts non-negative integers', () => {
    expect(assertSafePaise(0)).toBe(0);
    expect(assertSafePaise(149900)).toBe(149900);
  });
  it('rejects floats, negatives, strings and unsafe integers', () => {
    expect(() => assertSafePaise(1.5)).toThrow(MoneyError);
    expect(() => assertSafePaise(-1)).toThrow(MoneyError);
    expect(() => assertSafePaise('100')).toThrow(MoneyError);
    expect(() => assertSafePaise(Number.MAX_SAFE_INTEGER + 2)).toThrow(MoneyError);
  });
  it('signed variant allows negatives (money impact of an action)', () => {
    expect(assertSafeSignedPaise(-22485)).toBe(-22485);
    expect(() => assertSafeSignedPaise(-0.5)).toThrow(MoneyError);
  });
});

describe('rupeesToPaise / addPaise', () => {
  it('converts rupee constants', () => {
    expect(rupeesToPaise(1499)).toBe(149900);
    expect(rupeesToPaise(4.2e5)).toBe(42000000);
  });
  it('sums signed amounts and validates the result', () => {
    expect(addPaise(100, -30, 5)).toBe(75);
    expect(() => addPaise(1, 0.1)).toThrow(MoneyError);
  });
});

describe('pctOf', () => {
  it('computes exact percentages with basis-point precision', () => {
    expect(pctOf(149900, 15)).toBe(22485);
    expect(pctOf(42000000, 12.5)).toBe(5250000);
    expect(pctOf(100, 33.33, 'floor')).toBe(33);
    expect(pctOf(100, 33.33, 'ceil')).toBe(34);
    expect(pctOf(100, 33.33, 'nearest')).toBe(33);
    expect(pctOf(1, 50, 'nearest')).toBe(1); // 0.5 paise rounds up under 'nearest'
    expect(pctOf(1, 50, 'floor')).toBe(0);
  });
  it('rejects out-of-range percentages', () => {
    expect(() => pctOf(100, -1)).toThrow(MoneyError);
    expect(() => pctOf(100, 101)).toThrow(MoneyError);
  });
});

describe('formatInr', () => {
  it('uses Indian digit grouping and two paise digits', () => {
    expect(formatInr(149900)).toBe('₹1,499.00');
    expect(formatInr(42000000)).toBe('₹4,20,000.00');
    expect(formatInr(5)).toBe('₹0.05');
    expect(formatInr(-22485)).toBe('-₹224.85');
  });
});
