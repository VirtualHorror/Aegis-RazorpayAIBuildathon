import type { DiagnoseOutput } from './schema';
import type { Hints } from './schema';

export interface FallbackDiagnosis extends DiagnoseOutput {
  degraded: true;
  degradedReason: string;
  provider: 'fallback';
  model: 'rules-v1';
}

function output(
  rootCause: DiagnoseOutput['root_cause'],
  strategy: DiagnoseOutput['intervention_strategy'],
  rationale: string,
  customerFacingHint?: string,
): DiagnoseOutput {
  return {
    root_cause: rootCause,
    confidence: 0.6,
    intervention_strategy: strategy,
    rationale: `rule-based fallback: ${rationale}`,
    ...(customerFacingHint === undefined ? {} : { customer_facing_hint: customerFacingHint }),
  };
}

/**
 * Produce a deterministic diagnosis when the model is unavailable.
 * Intent: provider outages must still yield a bounded enum result and never turn a worker event into a failed job (C-A4).
 * Flow: inspect ordered payment signals (or explicit subscription mandate signals) -> select one fixed fixture -> use
 *       UNKNOWN/ESCALATE_HUMAN when no reliable signal is present.
 */
export function ruleBasedDiagnosis(hints: Hints): DiagnoseOutput {
  if (hints.entity === 'payment') {
    const step = hints.error_step ?? '';
    const reason = hints.error_reason ?? '';
    // The stub sees serialized prompt text, so a feature token can originate in either structured error field.
    if (step === 'payment_authentication' || reason === 'payment_authentication') {
      return output(
        'THREE_DS_AUTH_FAILED',
        'RETRY_LINK_LOCALIZED',
        'The payment authentication step failed before capture completed.',
        'Retry securely with your bank authentication step.',
      );
    }
    if (step === 'payment_cancelled' || reason === 'payment_cancelled') {
      return output(
        'CUSTOMER_ABANDONED_CHECKOUT',
        'CART_RECOVERY_NUDGE',
        'The checkout was cancelled by the customer before payment completion.',
        'Your cart is still waiting if you would like to try again.',
      );
    }
    if (step === 'insufficient_funds' || reason === 'insufficient_funds') {
      return output(
        'INSUFFICIENT_FUNDS',
        'RETRY_ALTERNATE_METHOD',
        'The issuer reported insufficient funds for this payment attempt.',
        'Try another payment method or card.',
      );
    }
    if (step === 'international_transaction_not_allowed' || reason === 'international_transaction_not_allowed') {
      return output(
        'CARD_NOT_ENABLED_INTERNATIONAL',
        'RETRY_ALTERNATE_METHOD',
        'The card issuer does not allow this international transaction.',
        'Try a card enabled for international payments.',
      );
    }
    return output(
      'UNKNOWN',
      'ESCALATE_HUMAN',
      'The available payment signals do not identify a reliable root cause.',
    );
  }

  const reason = `${hints.error_step ?? ''} ${hints.error_reason ?? ''}`.toLowerCase();
  if (reason.includes('mandate') || reason.includes('subscription_mandate')) {
    return output(
      'SUBSCRIPTION_MANDATE_FAILED',
      'SUBSCRIPTION_DUNNING',
      'The subscription mandate could not be charged and should enter a bounded retry path.',
    );
  }
  return output(
    'UNKNOWN',
    'ESCALATE_HUMAN',
    'The available subscription signals do not identify a reliable root cause.',
  );
}

/** Attach the required degraded metadata to a rule-based output after an LLM failure. */
export function fallbackDiagnosis(hints: Hints, error: unknown): FallbackDiagnosis {
  const reason = error instanceof Error ? error.message : String(error);
  return {
    ...ruleBasedDiagnosis(hints),
    degraded: true,
    degradedReason: reason,
    provider: 'fallback',
    model: 'rules-v1',
  };
}

/** Compatibility alias for callers that name the operation as a constructor. */
export const createFallbackDiagnosis = fallbackDiagnosis;
