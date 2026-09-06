import { createHash } from 'node:crypto';

/**
 * Sandbox / BYOK key naming.
 * Intent: a merchant running Aegis against their own Razorpay account registers their own webhook secret. That secret
 *         is addressed by the account id Razorpay stamps on every delivery, so the ingress can pick the right one
 *         before it trusts a single field of the body.
 * Flow:   the dashboard POSTs {account_id, webhook_secret} -> `sandboxSecretKey` names the `guardrail_config` row ->
 *         ingress reads `account_id` out of the raw bytes with `accountIdFromRawBody` and looks the row up by key.
 */

export const SANDBOX_SECRET_PREFIX = 'sandbox_secret_';

/**
 * Account ids Razorpay issues look like `acc_ABC123def`. The pattern is deliberately narrower than "any string":
 * the value becomes part of a primary key that the settings UI, the audit log, and `LIKE` filters all reason about,
 * so anything outside this charset is treated as "no account" rather than sanitised into one.
 */
const ACCOUNT_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

export function isSandboxAccountId(value: unknown): value is string {
  return typeof value === 'string' && ACCOUNT_ID_PATTERN.test(value);
}

export function sandboxSecretKey(accountId: string): string {
  if (!isSandboxAccountId(accountId)) {
    throw new TypeError(`account id must match ${ACCOUNT_ID_PATTERN.source}`);
  }
  return `${SANDBOX_SECRET_PREFIX}${accountId}`;
}

/**
 * Read `account_id` out of an unauthenticated request body.
 * Intent: this runs BEFORE the HMAC passes, so nothing it returns may be trusted for anything except choosing which
 *         secret to verify against — an attacker naming another tenant's account still has to produce that tenant's
 *         signature over these exact bytes, and a wrong guess simply fails verification.
 * Flow:   parse a copy of the bytes -> require a JSON object -> require an allowlisted account id -> otherwise null,
 *         which makes the caller fall back to the `.env` secret. Malformed bytes never throw out of here, because the
 *         real parse (and its 400/401 handling) happens later against the same unmodified buffer.
 */
export function accountIdFromRawBody(raw: Buffer): string | null {
  if (raw.length === 0) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw.toString('utf8'));
  } catch {
    // Intent: a body that is not JSON cannot name an account; the signature check still runs on the raw bytes.
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null;
  const accountId = (parsed as { account_id?: unknown }).account_id;
  return isSandboxAccountId(accountId) ? accountId : null;
}

/**
 * A stable, non-reversible label for a stored secret.
 * Intent: the API must be able to answer "which secret is saved?" without ever sending one back — a fingerprint is
 *         enough for the dashboard to confirm a save and for the audit log to distinguish one rotation from the next.
 */
export function secretFingerprint(secret: string): string {
  return createHash('sha256').update(secret, 'utf8').digest('hex').slice(0, 12);
}
