import { createHash } from 'node:crypto';
import { z } from 'zod';
import type { LlmPurpose } from '../client';

/** The common shape keeps prompt text, input construction, and output validation together for auditability. */
export interface PromptDefinition<Input, Output> {
  version: string;
  system: string;
  buildUser: (input: Input) => string;
  schema: z.ZodType<Output>;
}

export type PromptSpec<Input, Output> = PromptDefinition<Input, Output>;

export interface DiagnoseInput {
  hints: Record<string, unknown>;
  payloadMasked: unknown;
  entity?: unknown;
}

export const ROOT_CAUSES = [
  'THREE_DS_AUTH_FAILED',
  'ISSUER_DECLINED',
  'INSUFFICIENT_FUNDS',
  'CARD_NOT_ENABLED_INTERNATIONAL',
  'CUSTOMER_ABANDONED_CHECKOUT',
  'NETWORK_TIMEOUT',
  'RISK_BLOCKED',
  'SUBSCRIPTION_MANDATE_FAILED',
  'UNKNOWN',
] as const;

export const STRATEGIES = [
  'RETRY_LINK_LOCALIZED',
  'RETRY_ALTERNATE_METHOD',
  'CART_RECOVERY_NUDGE',
  'SUBSCRIPTION_DUNNING',
  'B2B_NEGOTIATE',
  'NO_ACTION',
  'ESCALATE_HUMAN',
] as const;

export const DiagnoseOutputSchema = z.object({
  root_cause: z.enum(ROOT_CAUSES),
  confidence: z.number().min(0).max(1),
  intervention_strategy: z.enum(STRATEGIES),
  rationale: z.string().min(10).max(600),
  customer_facing_hint: z.string().max(240).optional(),
});

export type DiagnoseOutput = z.infer<typeof DiagnoseOutputSchema>;

const diagnosisSystem = [
  'You classify payment or subscription failures for Aegis.',
  `root_cause must be exactly one of: ${ROOT_CAUSES.join(', ')}.`,
  `intervention_strategy must be exactly one of: ${STRATEGIES.join(', ')}.`,
  'Return a single JSON object only. Do not include prose, markdown, or code fences outside JSON.',
].join(' ');

function buildDiagnosisUser(input: DiagnoseInput): string {
  // Intent: serialize only the caller-provided masked payload and deterministic hints into the user turn (C-A7).
  // Flow: construct a stable object -> JSON.stringify -> provider adapter receives plain text and validates its reply.
  return JSON.stringify({ hints: input.hints, payload: input.payloadMasked, entity: input.entity });
}

export const diagnosePaymentFailure: PromptDefinition<DiagnoseInput, DiagnoseOutput> = {
  version: 'v1',
  system: diagnosisSystem,
  buildUser: buildDiagnosisUser,
  schema: DiagnoseOutputSchema,
};

export const diagnoseSubscriptionFailure: PromptDefinition<DiagnoseInput, DiagnoseOutput> = {
  version: 'v1',
  system: diagnosisSystem,
  buildUser: buildDiagnosisUser,
  schema: DiagnoseOutputSchema,
};

// The erased registry is only for lookup; callers retain the concrete definition type for schema-safe calls. `never`
// keeps the input side contravariant while `unknown` captures any validated output without using `any`.
export type PromptRegistry = Partial<Record<LlmPurpose, PromptDefinition<never, unknown>>>;

export const prompts = {
  diagnose_payment_failure: diagnosePaymentFailure,
  diagnose_subscription_failure: diagnoseSubscriptionFailure,
} as const;

/** Registry lookup is intentionally explicit; adding a purpose requires a schema and prompt definition. */
export const promptRegistry: PromptRegistry = prompts;

/** Callers persist this digest with a diagnosis so the exact prompt input is auditable without storing PII. */
export function inputDigest(system: string, user: string): string {
  return createHash('sha256').update(system + user).digest('hex');
}
