import type { Pool, PoolClient } from 'pg';
import { isSandboxAccountId, sandboxSecretKey, secretFingerprint, SANDBOX_SECRET_PREFIX } from '../../sandbox/keys';

/**
 * Per-account webhook secrets for Sandbox / BYOK mode (T25).
 * Intent: `guardrail_config` already is the one audited, database-backed place where operational bounds live, so a
 *         merchant's own webhook secret is stored there under `sandbox_secret_<account_id>` rather than in a second
 *         configuration surface. The value is a credential, so it leaves the database only to verify an HMAC.
 * Flow: POST /api/v1/sandbox/keys -> `upsertSandboxSecret` (audited by the route) -> ingress `getSandboxSecret`.
 */

export interface SandboxSecretRecord {
  readonly key: string;
  readonly accountId: string;
  readonly fingerprint: string;
  readonly updatedBy: string;
  readonly updatedAt: Date;
}

/** `LIKE` pattern for every sandbox row; `_` is a wildcard in LIKE, so both underscores are escaped. */
export const SANDBOX_SECRET_LIKE = `${SANDBOX_SECRET_PREFIX.replace(/_/g, '\\_')}%`;

export async function getSandboxSecret(db: Pool | PoolClient, accountId: string): Promise<string | null> {
  if (!isSandboxAccountId(accountId)) return null;
  const result = await db.query<{ value: unknown }>('SELECT value FROM guardrail_config WHERE key = $1', [
    sandboxSecretKey(accountId),
  ]);
  const value = result.rows[0]?.value;
  // A row whose JSON value is not a non-empty string is not a usable secret; treat it as absent rather than guessing.
  return typeof value === 'string' && value.length > 0 ? value : null;
}

/**
 * Register or rotate one account's webhook secret.
 * Flow: upsert the `guardrail_config` row -> return only the row's identity and the secret's fingerprint, so no caller
 *       of this function is able to echo the credential back out of the API.
 */
export async function upsertSandboxSecret(
  db: Pool | PoolClient,
  input: { accountId: string; webhookSecret: string; actor: string },
): Promise<SandboxSecretRecord> {
  const key = sandboxSecretKey(input.accountId);
  const result = await db.query<{ key: string; updated_by: string; updated_at: Date }>(
    `INSERT INTO guardrail_config (key, value, description, updated_by)
     VALUES ($1, $2::jsonb, $3, $4)
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, description = EXCLUDED.description,
       updated_by = EXCLUDED.updated_by, updated_at = now()
     RETURNING key, updated_by, updated_at`,
    [key, JSON.stringify(input.webhookSecret), `Sandbox webhook secret for Razorpay account ${input.accountId}`, input.actor],
  );
  const row = result.rows[0];
  if (!row) throw new Error('sandbox secret upsert returned no row');
  return {
    key: row.key,
    accountId: input.accountId,
    fingerprint: secretFingerprint(input.webhookSecret),
    updatedBy: row.updated_by,
    updatedAt: row.updated_at,
  };
}
