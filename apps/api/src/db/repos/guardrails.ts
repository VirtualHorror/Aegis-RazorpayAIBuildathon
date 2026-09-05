import { z } from 'zod';
import type { Pool, PoolClient } from 'pg';
import { GUARDRAIL_KEYS, type GuardrailConfig } from '../../guardrails/types';

const paise = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const boundedInteger = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);

const GuardrailConfigSchema = z.object({
  kill_switch: z.boolean(),
  auto_approve_limit_paise: paise,
  max_discount_pct: z.number().finite().min(0).max(100),
  max_negotiation_rounds: boundedInteger,
  max_dunning_retries: boundedInteger,
  dunning_schedule_hours: z.array(z.number().int().min(0).max(Number.MAX_SAFE_INTEGER)),
  message_cooldown_hours: boundedInteger,
  quiet_hours_local: z.object({
    start: z.number().int().min(0).max(23),
    end: z.number().int().min(0).max(23),
  }),
  daily_discount_budget_paise: paise,
  attribution_window_hours: boundedInteger,
  x402_max_amount_paise: paise,
  x402_daily_cap_per_payer_paise: paise,
});

export class GuardrailConfigError extends Error {
  override name = 'GuardrailConfigError';
}

/**
 * Load and validate the complete guardrail snapshot from PostgreSQL.
 * Intent: fail fast when a migration or seed is incomplete; a partial config must never silently disable a bound.
 * Flow:   SELECT key/value rows -> verify every expected key -> validate each JSON value with zod -> return the typed snapshot.
 */
export async function loadGuardrailConfig(db: Pool | PoolClient): Promise<GuardrailConfig> {
  const result = await db.query<{ key: string; value: unknown }>('SELECT key, value FROM guardrail_config');
  const values = new Map(result.rows.map((row) => [row.key, row.value]));
  const missing = GUARDRAIL_KEYS.filter((key) => !values.has(key));
  if (missing.length > 0) {
    throw new GuardrailConfigError(`missing guardrail config keys: ${missing.join(', ')}`);
  }

  const raw = Object.fromEntries(GUARDRAIL_KEYS.map((key) => [key, values.get(key)]));
  const parsed = GuardrailConfigSchema.safeParse(raw);
  if (!parsed.success) {
    const details = parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; ');
    throw new GuardrailConfigError(`invalid guardrail config: ${details}`);
  }
  return parsed.data;
}
