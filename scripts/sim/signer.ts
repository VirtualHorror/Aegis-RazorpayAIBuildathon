import { createHmac } from 'node:crypto';

/**
 * Compute the Razorpay-compatible HMAC without importing the API package.
 * Intent: the simulator must sign the exact bytes it sends while remaining runnable from the repository root.
 * Flow: raw Buffer -> SHA-256 HMAC with the configured secret -> lowercase hexadecimal digest.
 */
export function computeSignature(raw: Buffer, secret: string): string {
  return createHmac('sha256', secret).update(raw).digest('hex');
}

/** Alias used by the CLI to make the transport intent explicit at call sites. */
export const signWebhook = computeSignature;
