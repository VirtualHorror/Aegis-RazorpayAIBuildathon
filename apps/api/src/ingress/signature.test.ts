import { describe, expect, it } from 'vitest';
import { computeSignature, verifySignature } from './signature';

const secret = 'test_webhook_secret_16';

describe('Razorpay webhook signatures', () => {
  it('accepts the exact HMAC header', () => {
    const raw = Buffer.from('{"event":"payment.failed"}');
    const signature = computeSignature(raw, secret);
    expect(verifySignature(raw, signature, secret)).toBe(true);
  });

  it('rejects a missing or invalid header', () => {
    const raw = Buffer.from('payload');
    const signature = computeSignature(raw, secret);
    expect(verifySignature(raw, undefined, secret)).toBe(false);
    expect(verifySignature(raw, `${signature.slice(0, -1)}0`, secret)).toBe(false);
  });

  it('rejects a length mismatch before timingSafeEqual', () => {
    const raw = Buffer.from('payload');
    const signature = computeSignature(raw, secret);
    expect(verifySignature(raw, signature.slice(0, -2), secret)).toBe(false);
    expect(verifySignature(raw, `${signature}00`, secret)).toBe(false);
  });

  it('rejects a single tampered body byte', () => {
    const raw = Buffer.from('payload');
    const signature = computeSignature(raw, secret);
    const tampered = Buffer.from('payloae');
    expect(verifySignature(tampered, signature, secret)).toBe(false);
  });

  it('trims transport whitespace around a valid header', () => {
    const raw = Buffer.from('payload');
    const signature = computeSignature(raw, secret);
    expect(verifySignature(raw, `  ${signature}\n`, secret)).toBe(true);
  });
});
