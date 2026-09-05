const BASE_BACKOFF_MS = 5_000;
const MAX_BACKOFF_MS = 300_000;
const JITTER_MAX_MS = 1_000;

/**
 * Calculate the bounded retry delay for a 1-based attempt number.
 * Intent: transient failures need increasing delay without allowing a poisoned job to consume the queue forever.
 * Flow: validate attempt -> exponential delay capped at five minutes -> add an integer 0..1000 ms jitter.
 */
export function backoff(attempts: number, random: () => number = Math.random): number {
  if (!Number.isSafeInteger(attempts) || attempts < 1) {
    throw new RangeError(`attempts must be a positive integer, got ${String(attempts)}`);
  }

  // Avoid overflowing 2 ** (attempts - 1) for a corrupted, very large attempts value.
  const exponent = Math.min(attempts - 1, 31);
  const exponential = BASE_BACKOFF_MS * 2 ** exponent;
  const bounded = Math.min(exponential, MAX_BACKOFF_MS);
  const sample = random();
  const normalized = Number.isFinite(sample) ? Math.min(Math.max(sample, 0), 0.999999999) : 0;
  return bounded + Math.floor(normalized * (JITTER_MAX_MS + 1));
}

export const BACKOFF_LIMITS = Object.freeze({
  baseMs: BASE_BACKOFF_MS,
  maxMs: MAX_BACKOFF_MS,
  jitterMs: JITTER_MAX_MS,
});
