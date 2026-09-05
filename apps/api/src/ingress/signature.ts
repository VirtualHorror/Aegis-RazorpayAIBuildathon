import { createHmac, timingSafeEqual } from 'node:crypto';

export function computeSignature(raw: Buffer, secret: string): string {
  return createHmac('sha256', secret).update(raw).digest('hex');
}

// Intent: compare HMACs without exposing timing differences that reveal the expected signature.
// Flow: compute expected bytes -> reject a length mismatch -> compare equal-length buffers in constant time.
export function verifySignature(raw: Buffer, header: string | undefined, secret: string): boolean {
  if (!header) return false;
  const expected = Buffer.from(computeSignature(raw, secret), 'utf8');
  const given = Buffer.from(header.trim(), 'utf8');
  return expected.length === given.length && timingSafeEqual(expected, given);
}
