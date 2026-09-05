import { describe, expect, it } from 'vitest';
import { base32, dayBucket, retryLink } from './links';

describe('CheckoutRecovery retry links', () => {
  it('is deterministic for a payment within one UTC day', () => {
    const morning = new Date('2026-09-05T00:01:00.000Z');
    const evening = new Date('2026-09-05T23:59:59.999Z');
    const first = retryLink('pay_deterministic', morning);
    expect(retryLink('pay_deterministic', evening)).toBe(first);
    expect(first).toMatch(/^https:\/\/rzp\.io\/l\/aegis-[A-Z2-7]{8}$/);
  });

  it('rotates on a new UTC day and validates input', () => {
    const now = new Date('2026-09-05T12:00:00.000Z');
    expect(retryLink('pay_deterministic', new Date('2026-09-06T00:00:00.000Z'))).not.toBe(retryLink('pay_deterministic', now));
    expect(dayBucket(now)).toBe('2026-09-05');
    expect(() => retryLink('', now)).toThrow(TypeError);
    expect(() => dayBucket(new Date(Number.NaN))).toThrow(RangeError);
  });

  it('encodes digest bytes as unpadded RFC 4648 base32', () => {
    expect(base32(new Uint8Array([0]))).toBe('AA');
    expect(base32(new Uint8Array([255]))).toBe('74');
  });
});

