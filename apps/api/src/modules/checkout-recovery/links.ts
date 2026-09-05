import { createHash } from 'node:crypto';

const RETRY_LINK_PREFIX = 'https://rzp.io/l/aegis-';
const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

/**
 * Return the UTC calendar bucket used for retry-link derivation.
 * Intent: a payment gets one stable link for a calendar day regardless of worker retries or process restarts.
 * Flow: validate the clock -> normalize to an ISO UTC date -> hash payment id plus that bucket.
 */
export function dayBucket(now: Date): string {
  if (!(now instanceof Date) || Number.isNaN(now.getTime())) throw new RangeError('retry-link clock must be a valid Date');
  return now.toISOString().slice(0, 10);
}

/**
 * Encode digest bytes using RFC 4648 base32 without padding.
 * Intent: links use a short URL-safe alphabet and avoid hex's longer, less readable representation.
 * Flow: consume each byte into a bit buffer -> emit five-bit symbols -> emit the final partial symbol.
 */
export function base32(value: Uint8Array): string {
  let buffer = 0;
  let bits = 0;
  let output = '';
  for (const byte of value) {
    buffer = (buffer << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      output += BASE32_ALPHABET[(buffer >>> bits) & 31] ?? '';
    }
  }
  if (bits > 0) output += BASE32_ALPHABET[(buffer << (5 - bits)) & 31] ?? '';
  return output;
}

/**
 * Create the deterministic simulated Razorpay retry URL for a payment/day pair.
 * Intent: repeated proposals for one payment are idempotent while a new UTC day rotates the link.
 * Flow: validate payment id -> hash `<paymentId>:<dayBucket>` with SHA-256 -> base32 and keep eight symbols.
 */
export function retryLink(paymentId: string, now: Date): string {
  if (typeof paymentId !== 'string' || paymentId.trim().length === 0) throw new TypeError('payment id is required');
  const bucket = dayBucket(now);
  const digest = createHash('sha256').update(`${paymentId}:${bucket}`, 'utf8').digest();
  return `${RETRY_LINK_PREFIX}${base32(digest).slice(0, 8)}`;
}
