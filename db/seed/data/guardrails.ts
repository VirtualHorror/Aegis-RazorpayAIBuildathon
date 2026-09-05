import type { GuardrailConfig } from '../../../apps/api/src/guardrails/types';

export interface GuardrailSeed {
  readonly key: keyof GuardrailConfig;
  readonly value: boolean | number | readonly number[] | { readonly start: number; readonly end: number };
  readonly description: string;
}

/**
 * The single source of seeded bounds, matching Architecture.md section 6 exactly.
 * Intent: make the safety envelope inspectable and reproducible; modules consume this database snapshot rather than env vars.
 * Flow:   seed.ts upserts each key/value -> loadGuardrailConfig validates the same keys before a worker handles actions.
 */
export const GUARDRAIL_DEFAULTS: readonly GuardrailSeed[] = [
  { key: 'kill_switch', value: false, description: 'When true, every module is blocked and x402 returns 503.' },
  { key: 'auto_approve_limit_paise', value: 200000, description: 'Money impact above this integer paise limit requires human approval.' },
  { key: 'max_discount_pct', value: 15, description: 'Hard ceiling for any negotiated discount percentage.' },
  { key: 'max_negotiation_rounds', value: 3, description: 'Maximum number of B2B negotiation rounds.' },
  { key: 'max_dunning_retries', value: 3, description: 'Maximum subscription salvage retries.' },
  { key: 'dunning_schedule_hours', value: [24, 72, 168], description: 'Retry offsets in hours for subscription salvage.' },
  { key: 'message_cooldown_hours', value: 24, description: 'Maximum one outbound message per customer in this window.' },
  { key: 'quiet_hours_local', value: { start: 21, end: 8 }, description: 'Local customer quiet-hour interval; no outbound messages inside it.' },
  { key: 'daily_discount_budget_paise', value: 5000000, description: 'Hard daily aggregate budget for discounts in integer paise.' },
  { key: 'attribution_window_hours', value: 72, description: 'Capture window after an action that counts as recovered revenue.' },
  { key: 'x402_max_amount_paise', value: 100000, description: 'Per-request x402 amount cap in integer paise.' },
  { key: 'x402_daily_cap_per_payer_paise', value: 500000, description: 'Per-payer daily x402 cap in integer paise.' },
];
