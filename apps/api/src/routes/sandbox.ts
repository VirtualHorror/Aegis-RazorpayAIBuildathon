import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import type pg from 'pg';
import { insertAuditLog } from '../db/repos/audit';
import { upsertSandboxSecret } from '../db/repos/sandbox';
import { withTransaction } from '../db/tx';

/**
 * Razorpay account ids are opaque tokens; the same charset bounds `sandbox_secret_<account_id>` so the value can never
 * widen the key space the ingress looks rows up in (`sandbox/keys.ts` enforces the identical pattern).
 */
const AccountIdSchema = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/, 'account_id must be 1-64 characters of A-Z a-z 0-9 _ -');
/**
 * A webhook secret is whatever the merchant typed into their Razorpay dashboard, so the only bounds are the ones that
 * make it usable as an HMAC key at all: printable ASCII (no whitespace or control characters to be lost in transit)
 * and long enough that the signature it produces is worth checking.
 */
const WebhookSecretSchema = z
  .string()
  .min(8, 'webhook_secret must be at least 8 characters')
  .max(256)
  .regex(/^[\x21-\x7e]+$/, 'webhook_secret must be printable ASCII without spaces');

const SandboxKeysBody = z.object({
  account_id: AccountIdSchema,
  webhook_secret: WebhookSecretSchema,
  actor: z.string().min(1).max(200).default('human:dashboard'),
});

export interface SandboxRouteOptions {
  readonly db: pg.Pool;
}

/**
 * Sandbox / BYOK key registration (T25).
 * Intent: Live mode means "run Aegis against my own Razorpay account", which needs exactly one server-side secret —
 *         the webhook secret the ingress verifies signatures with. It is written once, read only by the HMAC check,
 *         and never returned: the response and the audit trail carry a fingerprint instead (C-D3, C-D4).
 * Flow: validate the body -> upsert `guardrail_config.sandbox_secret_<account_id>` and append the audit row in one
 *       transaction -> answer with the row's identity and the secret's fingerprint.
 */
export const sandboxRoutes: FastifyPluginAsync<SandboxRouteOptions> = async (app, options) => {
  app.post('/api/v1/sandbox/keys', async (request) => {
    const body = SandboxKeysBody.parse(request.body ?? {});
    const saved = await withTransaction(options.db, async (tx) => {
      const record = await upsertSandboxSecret(tx, {
        accountId: body.account_id,
        webhookSecret: body.webhook_secret,
        actor: body.actor,
      });
      // Intent: the audit trail records that a secret was set and which one, never the secret itself.
      await insertAuditLog(tx, {
        actor: body.actor,
        action: 'sandbox.keys_saved',
        // Not `guardrail`: the settings page's change history reads that entity type and must stay free of key events.
        entityType: 'sandbox_key',
        entityId: record.key,
        metadata: { account_id: record.accountId, webhook_secret_fingerprint: record.fingerprint },
      });
      return record;
    });
    return {
      sandbox: {
        account_id: saved.accountId,
        key: saved.key,
        webhook_secret_fingerprint: saved.fingerprint,
        updated_by: saved.updatedBy,
        updated_at: saved.updatedAt,
      },
    };
  });
};

export default sandboxRoutes;
