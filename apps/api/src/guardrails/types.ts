/**
 * Guardrail bounds loaded from PostgreSQL.
 * Intent: keep every money, messaging, and gateway bound in one typed snapshot so action modules do not read
 *         environment variables or allow an unvalidated database value to control a decision.
 * Flow:   loadGuardrailConfig() validates the JSON values once at job start -> callers pass this immutable-shaped
 *         object through their context -> deterministic rules enforce the bounds before an action executes.
 */

export interface QuietHoursLocal {
  readonly start: number;
  readonly end: number;
}

export interface GuardrailConfig {
  readonly kill_switch: boolean;
  readonly auto_approve_limit_paise: number;
  readonly max_discount_pct: number;
  readonly max_negotiation_rounds: number;
  readonly max_dunning_retries: number;
  readonly dunning_schedule_hours: readonly number[];
  readonly message_cooldown_hours: number;
  readonly quiet_hours_local: QuietHoursLocal;
  readonly daily_discount_budget_paise: number;
  readonly attribution_window_hours: number;
  readonly x402_max_amount_paise: number;
  readonly x402_daily_cap_per_payer_paise: number;
}

export const GUARDRAIL_KEYS = [
  'kill_switch',
  'auto_approve_limit_paise',
  'max_discount_pct',
  'max_negotiation_rounds',
  'max_dunning_retries',
  'dunning_schedule_hours',
  'message_cooldown_hours',
  'quiet_hours_local',
  'daily_discount_budget_paise',
  'attribution_window_hours',
  'x402_max_amount_paise',
  'x402_daily_cap_per_payer_paise',
] as const satisfies readonly (keyof GuardrailConfig)[];

export type GuardrailKey = (typeof GUARDRAIL_KEYS)[number];
