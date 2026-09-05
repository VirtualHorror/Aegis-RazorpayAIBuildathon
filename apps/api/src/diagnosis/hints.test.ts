import { describe, expect, it } from 'vitest';
import { RazorpayWebhookSchema, type RazorpayWebhook } from '@aegis/shared';
import type { EntitySnapshot } from '../orchestrator/entity';
import { deriveHints } from './hints';

function payload(entityType: 'payment' | 'subscription', entity: Record<string, unknown>): RazorpayWebhook {
  return RazorpayWebhookSchema.parse({
    entity: 'event',
    event: entityType === 'payment' ? 'payment.failed' : 'subscription.pending',
    payload: { [entityType]: { entity } },
  });
}

function snapshot(type: 'payment' | 'subscription', row: Record<string, unknown>, locale = 'en-IN'): EntitySnapshot {
  return {
    type,
    row: { id: `${type}_hint`, version: 1, ...row },
    customer: { locale } as EntitySnapshot['customer'],
    applied: true,
  };
}

describe('deriveHints', () => {
  it.each([
    [49_999, 'micro'],
    [50_000, 'small'],
    [499_999, 'small'],
    [500_000, 'medium'],
    [4_999_999, 'medium'],
    [5_000_000, 'large'],
  ] as const)('classifies %s paise as the %s amount band', (amount, band) => {
    const result = deriveHints(
      payload('payment', { id: 'pay_hint', amount }),
      snapshot('payment', { amount_paise: amount, international: true, method: 'card' }, 'hi-IN'),
    );
    expect(result.amount_band).toBe(band);
  });

  it('prefers projected fields and carries caller-supplied failure history', () => {
    const result = deriveHints(
      payload('payment', {
        id: 'pay_hint', amount: 99_900, international: false, method: 'upi',
        error_step: 'provider_step', error_reason: 'provider_reason', error_source: 'provider_source',
      }),
      snapshot('payment', {
        amount_paise: 2_500, international: true, method: 'card',
        error_step: 'payment_authentication', error_reason: 'authentication_failed', error_source: 'issuer',
      }),
      3,
    );
    expect(result).toEqual({
      entity: 'payment',
      is_international: true,
      method: 'card',
      error_step: 'payment_authentication',
      error_reason: 'authentication_failed',
      error_source: 'issuer',
      amount_band: 'micro',
      customer_locale: 'en-IN',
      prior_failures_24h: 3,
    });
  });

  it('uses payload fields when a projection field is not present and defaults locale/history', () => {
    const result = deriveHints(
      payload('payment', {
        id: 'pay_hint_payload', amount: 1_000, international: true, method: 'wallet',
        error_reason: 'insufficient_funds',
      }),
      { ...snapshot('payment', { id: 'pay_hint_payload' }, ''), customer: null },
    );
    expect(result).toMatchObject({
      is_international: true,
      method: 'wallet',
      error_reason: 'insufficient_funds',
      amount_band: 'micro',
      customer_locale: 'en-IN',
      prior_failures_24h: 0,
    });
  });

  it('does not infer payment-only fields for a subscription without signals', () => {
    const result = deriveHints(
      payload('subscription', { id: 'sub_hint', amount: 50_000 }),
      snapshot('subscription', { amount_paise: 50_000 }),
    );
    expect(result).toMatchObject({
      entity: 'subscription', is_international: false, method: null,
      error_step: null, error_reason: null, error_source: null,
      amount_band: 'small', customer_locale: 'en-IN', prior_failures_24h: 0,
    });
  });
});
