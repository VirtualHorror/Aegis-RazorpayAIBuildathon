import { describe, expect, it } from 'vitest';
import type { DiagnoseOutput } from './schema';
import type { Hints } from './schema';
import { crossCheck } from './cross-check';

const baseOutput: DiagnoseOutput = {
  root_cause: 'ISSUER_DECLINED',
  confidence: 0.9,
  intervention_strategy: 'RETRY_ALTERNATE_METHOD',
  rationale: 'The issuer declined the payment after the available checks.',
};

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

function hints(patch: Partial<Hints>): Hints {
  return { ...baseHints, ...patch };
}

describe('crossCheck', () => {
  it('overrides an incompatible payment authentication root cause and records a note', () => {
    const result = crossCheck(baseOutput, hints({ error_step: 'payment_authentication' }));
    expect(result.output.root_cause).toBe('THREE_DS_AUTH_FAILED');
    expect(result.crossCheck.overridden).toBe(true);
    expect(result.crossCheck.notes).toHaveLength(1);
    expect(result.crossCheck.notes[0]).toContain('payment_authentication');
  });

  it('overrides cancelled checkout root and strategy together', () => {
    const result = crossCheck(baseOutput, hints({ error_reason: 'payment_cancelled' }));
    expect(result.output).toMatchObject({ root_cause: 'CUSTOMER_ABANDONED_CHECKOUT', intervention_strategy: 'CART_RECOVERY_NUDGE' });
    expect(result.crossCheck.notes[0]).toContain('payment_cancelled');
  });

  it('forces the international-card root and alternate method strategy', () => {
    const result = crossCheck(baseOutput, hints({ error_reason: 'international_transaction_not_allowed' }));
    expect(result.output).toMatchObject({ root_cause: 'CARD_NOT_ENABLED_INTERNATIONAL', intervention_strategy: 'RETRY_ALTERNATE_METHOD' });
    expect(result.crossCheck.notes[0]).toContain('international_transaction_not_allowed');
  });

  it('forces insufficient funds root cause', () => {
    const result = crossCheck(baseOutput, hints({ error_reason: 'insufficient_funds' }));
    expect(result.output.root_cause).toBe('INSUFFICIENT_FUNDS');
    expect(result.crossCheck.notes[0]).toContain('insufficient_funds');
  });

  it.each(['SUBSCRIPTION_DUNNING', 'B2B_NEGOTIATE'] as const)('does not use %s for a payment', (strategy) => {
    const result = crossCheck({ ...baseOutput, intervention_strategy: strategy }, baseHints);
    expect(result.output.intervention_strategy).toBe('ESCALATE_HUMAN');
    expect(result.crossCheck.notes[0]).toContain('payment entities');
  });

  it('limits subscription strategies to dunning, no action, or escalation', () => {
    const result = crossCheck(
      { ...baseOutput, intervention_strategy: 'RETRY_LINK_LOCALIZED' },
      hints({ entity: 'subscription' }),
    );
    expect(result.output.intervention_strategy).toBe('SUBSCRIPTION_DUNNING');
    expect(result.crossCheck.notes[0]).toContain('subscription entities');
  });

  it('escalates low confidence without changing the root cause', () => {
    const result = crossCheck({ ...baseOutput, confidence: 0.49 }, baseHints);
    expect(result.output).toMatchObject({ root_cause: 'ISSUER_DECLINED', intervention_strategy: 'ESCALATE_HUMAN' });
    expect(result.crossCheck.notes[0]).toContain('confidence below 0.5');
  });

  it('escalates after three prior failures as a stopping rule', () => {
    const result = crossCheck(baseOutput, hints({ prior_failures_24h: 3 }));
    expect(result.output.intervention_strategy).toBe('ESCALATE_HUMAN');
    expect(result.crossCheck.notes[0]).toContain('prior_failures_24h >= 3');
  });

  it('returns a copy and no notes when no rule fires', () => {
    const result = crossCheck(baseOutput, baseHints);
    expect(result.output).toEqual(baseOutput);
    expect(result.output).not.toBe(baseOutput);
    expect(result.crossCheck).toEqual({ overridden: false, notes: [] });
  });

  it('retains one note per independently firing rule', () => {
    const result = crossCheck(
      { ...baseOutput, confidence: 0.4, intervention_strategy: 'B2B_NEGOTIATE' },
      hints({ prior_failures_24h: 3 }),
    );
    expect(result.crossCheck.notes).toHaveLength(3);
    expect(result.output.intervention_strategy).toBe('ESCALATE_HUMAN');
  });
});
