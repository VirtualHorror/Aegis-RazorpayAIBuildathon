import { describe, expect, it } from 'vitest';
import { LlmUnavailableError } from '../llm/client';
import type { Hints } from './schema';
import { fallbackDiagnosis, ruleBasedDiagnosis } from './fallback';

const baseHints: Hints = {
  entity: 'payment',
  is_international: false,
  method: 'card',
  error_step: null,
  error_reason: null,
  error_source: 'issuer',
  amount_band: 'small',
  customer_locale: 'en-IN',
  prior_failures_24h: 0,
};

describe('ruleBasedDiagnosis', () => {
  it.each([
    ['payment_authentication', 'THREE_DS_AUTH_FAILED', 'RETRY_LINK_LOCALIZED'],
    ['payment_cancelled', 'CUSTOMER_ABANDONED_CHECKOUT', 'CART_RECOVERY_NUDGE'],
    ['insufficient_funds', 'INSUFFICIENT_FUNDS', 'RETRY_ALTERNATE_METHOD'],
    ['international_transaction_not_allowed', 'CARD_NOT_ENABLED_INTERNATIONAL', 'RETRY_ALTERNATE_METHOD'],
  ] as const)('maps payment signal %s to the bounded fixture', (signal, rootCause, strategy) => {
    const result = ruleBasedDiagnosis({
      ...baseHints,
      ...(signal === 'payment_authentication' ? { error_step: signal } : { error_reason: signal }),
    });
    expect(result).toMatchObject({ root_cause: rootCause, intervention_strategy: strategy, confidence: 0.6 });
    expect(result.rationale).toMatch(/^rule-based fallback:/);
  });

  it('maps an explicit subscription mandate signal to dunning', () => {
    const result = ruleBasedDiagnosis({
      ...baseHints,
      entity: 'subscription',
      error_reason: 'subscription_mandate_failed',
    });
    expect(result).toMatchObject({ root_cause: 'SUBSCRIPTION_MANDATE_FAILED', intervention_strategy: 'SUBSCRIPTION_DUNNING' });
  });

  it('escalates an unknown payment or signal-free subscription', () => {
    expect(ruleBasedDiagnosis(baseHints)).toMatchObject({ root_cause: 'UNKNOWN', intervention_strategy: 'ESCALATE_HUMAN' });
    expect(ruleBasedDiagnosis({ ...baseHints, entity: 'subscription' })).toMatchObject({ root_cause: 'UNKNOWN', intervention_strategy: 'ESCALATE_HUMAN' });
  });
});
describe('fallbackDiagnosis', () => {
  it('marks the deterministic output degraded and preserves the LLM error message', () => {
    const result = fallbackDiagnosis(baseHints, new LlmUnavailableError('timeout'));
    expect(result).toMatchObject({
      degraded: true,
      degradedReason: 'timeout',
      provider: 'fallback',
      model: 'rules-v1',
      confidence: 0.6,
    });
    expect(result.rationale).toMatch(/^rule-based fallback:/);
  });
});
