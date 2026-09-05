import type { DiagnoseOutput, RootCause, Strategy } from './schema';
import type { Hints } from './schema';

export interface CrossCheckMetadata {
  overridden: boolean;
  notes: string[];
}

/** Result after applying all deterministic rules to a validated model result. */
export interface CrossCheckResult {
  output: DiagnoseOutput;
  /** Alias retained for callers that call the validated model result `data`. */
  data: DiagnoseOutput;
  crossCheck: CrossCheckMetadata;
  /** Convenience aliases for callers that persist normalized fields directly. */
  rootCause: RootCause;
  strategy: Strategy;
  root_cause: RootCause;
  intervention_strategy: Strategy;
  overridden: boolean;
  notes: string[];
}

function note(notes: string[], message: string): void {
  notes.push(message);
}

/**
 * Apply the diagnosis cross-check table in the documented order.
 * Intent: enum output from a model is bounded but not authoritative; structured payment signals and stopping rules
 *         can override it, with every firing rule retained for the audit trail (C-A3/C-B3).
 * Flow: copy model output -> evaluate eight rules -> update root/strategy -> return output plus override notes.
 */
export function crossCheck(output: DiagnoseOutput, hints: Hints): CrossCheckResult {
  let rootCause: RootCause = output.root_cause;
  let strategy: Strategy = output.intervention_strategy;
  const notes: string[] = [];

  if (
    hints.error_step === 'payment_authentication'
    && rootCause !== 'THREE_DS_AUTH_FAILED'
    && rootCause !== 'NETWORK_TIMEOUT'
  ) {
    rootCause = 'THREE_DS_AUTH_FAILED';
    note(notes, 'error_step=payment_authentication requires root_cause THREE_DS_AUTH_FAILED or NETWORK_TIMEOUT; overridden to THREE_DS_AUTH_FAILED');
  }

  if (hints.error_reason === 'payment_cancelled' && rootCause !== 'CUSTOMER_ABANDONED_CHECKOUT') {
    rootCause = 'CUSTOMER_ABANDONED_CHECKOUT';
    strategy = 'CART_RECOVERY_NUDGE';
    note(notes, 'error_reason=payment_cancelled requires CUSTOMER_ABANDONED_CHECKOUT and CART_RECOVERY_NUDGE');
  }

  if (hints.error_reason === 'international_transaction_not_allowed') {
    rootCause = 'CARD_NOT_ENABLED_INTERNATIONAL';
    strategy = 'RETRY_ALTERNATE_METHOD';
    note(notes, 'error_reason=international_transaction_not_allowed requires CARD_NOT_ENABLED_INTERNATIONAL and RETRY_ALTERNATE_METHOD');
  }

  if (hints.error_reason === 'insufficient_funds') {
    rootCause = 'INSUFFICIENT_FUNDS';
    note(notes, 'error_reason=insufficient_funds requires root_cause INSUFFICIENT_FUNDS');
  }

  if (hints.entity === 'payment' && (strategy === 'SUBSCRIPTION_DUNNING' || strategy === 'B2B_NEGOTIATE')) {
    strategy = 'ESCALATE_HUMAN';
    note(notes, 'payment entities cannot use subscription dunning or B2B negotiation; strategy overridden to ESCALATE_HUMAN');
  }

  if (
    hints.entity === 'subscription'
    && strategy !== 'SUBSCRIPTION_DUNNING'
    && strategy !== 'NO_ACTION'
    && strategy !== 'ESCALATE_HUMAN'
  ) {
    strategy = 'SUBSCRIPTION_DUNNING';
    note(notes, 'subscription entities require SUBSCRIPTION_DUNNING, NO_ACTION, or ESCALATE_HUMAN; overridden to SUBSCRIPTION_DUNNING');
  }

  if (output.confidence < 0.5) {
    strategy = 'ESCALATE_HUMAN';
    note(notes, 'confidence below 0.5 requires strategy ESCALATE_HUMAN');
  }

  if (hints.prior_failures_24h >= 3) {
    strategy = 'ESCALATE_HUMAN';
    note(notes, 'prior_failures_24h >= 3 stops customer retries; strategy overridden to ESCALATE_HUMAN');
  }

  const finalOutput: DiagnoseOutput = {
    ...output,
    root_cause: rootCause,
    intervention_strategy: strategy,
  };
  const crossCheckMetadata = { overridden: notes.length > 0, notes };
  return {
    output: finalOutput,
    data: finalOutput,
    crossCheck: crossCheckMetadata,
    rootCause,
    strategy,
    root_cause: rootCause,
    intervention_strategy: strategy,
    overridden: crossCheckMetadata.overridden,
    notes,
  };
}

/** Alias for callers that prefer a verb describing the operation. */
export const applyCrossCheck = crossCheck;
