import { z } from 'zod';
import type { LlmPurpose } from './client';

/** Diagnosis values shared by the deterministic stub and the later diagnostician prompt. */
export const STUB_ROOT_CAUSES = [
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

export const STUB_STRATEGIES = [
  'RETRY_LINK_LOCALIZED',
  'RETRY_ALTERNATE_METHOD',
  'CART_RECOVERY_NUDGE',
  'SUBSCRIPTION_DUNNING',
  'B2B_NEGOTIATE',
  'NO_ACTION',
  'ESCALATE_HUMAN',
] as const;

/**
 * The canonical diagnosis shape used by stub fixtures.
 * Intent: keeping this schema alongside the fixtures gives smoke tests and Task 7 a single, validated contract.
 * Flow: choose a fixture from input features -> parse it with the request's schema -> return only validated data.
 */
export const DIAGNOSE_OUTPUT_SCHEMA = z.object({
  root_cause: z.enum(STUB_ROOT_CAUSES),
  confidence: z.number().min(0).max(1),
  intervention_strategy: z.enum(STUB_STRATEGIES),
  rationale: z.string().min(10).max(600),
  customer_facing_hint: z.string().max(240).optional(),
});

// Aliases keep the schema discoverable for prompt/smoke callers while retaining the fixture-oriented name.
export const DiagnoseOutputSchema = DIAGNOSE_OUTPUT_SCHEMA;
export const DiagnosisSchema = DIAGNOSE_OUTPUT_SCHEMA;

export type DiagnoseOutput = z.infer<typeof DIAGNOSE_OUTPUT_SCHEMA>;

export type StubFixture = Readonly<Record<string, unknown>>;

const paymentFeatureFixtures: ReadonlyArray<{
  feature: string;
  output: DiagnoseOutput;
}> = [
  {
    feature: 'payment_authentication',
    output: {
      root_cause: 'THREE_DS_AUTH_FAILED',
      confidence: 0.9,
      intervention_strategy: 'RETRY_LINK_LOCALIZED',
      rationale: 'The payment authentication step failed before capture completed.',
      customer_facing_hint: 'Retry securely with your bank authentication step.',
    },
  },
  {
    feature: 'payment_cancelled',
    output: {
      root_cause: 'CUSTOMER_ABANDONED_CHECKOUT',
      confidence: 0.86,
      intervention_strategy: 'CART_RECOVERY_NUDGE',
      rationale: 'The checkout was cancelled by the customer before payment completion.',
      customer_facing_hint: 'Your cart is still waiting if you would like to try again.',
    },
  },
  {
    feature: 'insufficient_funds',
    output: {
      root_cause: 'INSUFFICIENT_FUNDS',
      confidence: 0.9,
      intervention_strategy: 'RETRY_ALTERNATE_METHOD',
      rationale: 'The issuer reported insufficient funds for this payment attempt.',
      customer_facing_hint: 'Try another payment method or card.',
    },
  },
  {
    feature: 'international_transaction_not_allowed',
    output: {
      root_cause: 'CARD_NOT_ENABLED_INTERNATIONAL',
      confidence: 0.92,
      intervention_strategy: 'RETRY_ALTERNATE_METHOD',
      rationale: 'The card issuer does not allow this international transaction.',
      customer_facing_hint: 'Try a card enabled for international payments.',
    },
  },
];

const unknownPaymentFixture: DiagnoseOutput = {
  root_cause: 'UNKNOWN',
  confidence: 0.4,
  intervention_strategy: 'ESCALATE_HUMAN',
  rationale: 'The available payment signals do not identify a reliable root cause.',
};

/** Selects a payment diagnosis using only deterministic provider fields embedded in the prompt. */
export function fixtureForPaymentFailure(user: string): DiagnoseOutput {
  // Intent: simulator payloads include stable error_step/error_reason tokens; matching those tokens keeps the stub reproducible.
  // Flow: scan the ordered feature table -> return the first matching fixture -> otherwise escalate as unknown.
  const match = paymentFeatureFixtures.find(({ feature }) => user.includes(feature));
  return match?.output ?? unknownPaymentFixture;
}

/** Return one stable, schema-friendly fixture for each capability until a live provider is configured. */
export function fixtureForPurpose(purpose: LlmPurpose, user: string): StubFixture {
  switch (purpose) {
    case 'diagnose_payment_failure':
      return fixtureForPaymentFailure(user);
    case 'diagnose_subscription_failure':
      return {
        root_cause: 'SUBSCRIPTION_MANDATE_FAILED',
        confidence: 0.82,
        intervention_strategy: 'SUBSCRIPTION_DUNNING',
        rationale: 'The subscription mandate could not be charged and should enter a bounded retry path.',
      } satisfies DiagnoseOutput;
    case 'draft_negotiation_message':
      return {
        subject: 'A practical way to settle your invoice',
        body: 'We can offer {{OFFER_AMOUNT}} if payment is completed by {{VALID_UNTIL}}.',
      };
    case 'draft_evidence_narrative':
      return {
        narrative: 'The packet contains the payment, order, and delivery records for human review.',
        confidence_note: 'Narrative is a summary of the supplied evidence only.',
      };
    case 'text_to_sql':
      return { sql: 'SELECT 1' };
    case 'summarize_query_result':
      return { summary: 'The query returned a deterministic fixture result.' };
    case 'nl_to_forecast_spec':
      return { metric: 'recovered_revenue', window_days: 30, horizon_days: 7 };
    case 'classify_compliance':
      return {
        risk_level: 'none',
        category: 'none',
        evidence_span: '',
        recommendation: 'No policy action is required.',
        reasoning: 'No prohibited or restricted claims were found in the supplied description.',
      };
  }
}
