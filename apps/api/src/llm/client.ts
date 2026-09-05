import type { z } from 'zod';

/**
 * The capability that a caller is asking the model to perform.
 * Intent: keeping this as a closed union makes provider calls auditable and prevents an arbitrary prompt from
 *         silently becoming a new production capability.
 */
export type LlmPurpose =
  | 'diagnose_payment_failure'
  | 'diagnose_subscription_failure'
  | 'draft_negotiation_message'
  | 'draft_evidence_narrative'
  | 'text_to_sql'
  | 'summarize_query_result'
  | 'nl_to_forecast_spec'
  | 'classify_compliance';

export interface LlmJsonRequest<T> {
  purpose: LlmPurpose;
  system: string;
  user: string;
  schema: z.ZodType<T>;
  maxTokens?: number;
  tier?: 'default' | 'fast';
}

export interface LlmJsonResult<T> {
  data: T;
  provider: string;
  model: string;
  latencyMs: number;
  tokensIn: number;
  tokensOut: number;
  raw: string;
}

export interface LlmClient {
  readonly provider: string;
  completeJson<T>(req: LlmJsonRequest<T>): Promise<LlmJsonResult<T>>;
}

/**
 * Error returned when a provider cannot produce a validated result.
 * Intent: callers can catch one typed error and apply their deterministic fallback (C-A4), while the message
 *         preserves provider/error-class information for the resilience wrapper and audit logs.
 * Flow: provider failure or invalid output -> adapter throws this error -> caller records degraded=true/fallback.
 */
export class LlmUnavailableError extends Error {
  readonly reason: string;

  constructor(reason: string, options?: { cause?: unknown }) {
    super(reason, options);
    this.name = 'LlmUnavailableError';
    this.reason = reason;
  }
}
