import { describe, expect, it } from 'vitest';
import { KNOWN_EVENT_TYPES } from './events';
import { RazorpayWebhookSchema } from './webhook';

describe('Razorpay webhook schemas', () => {
  it('keeps provider fields that Aegis does not project', () => {
    const parsed = RazorpayWebhookSchema.parse({
      entity: 'event',
      account_id: 'acc_test',
      event: 'payment.failed',
      contains: ['payment'],
      payload: {
        payment: {
          entity: { id: 'pay_test', status: 'failed', provider_new_field: { source: 'razorpay' } },
        },
        provider_payload_version: 2,
      },
      created_at: 1_757_000_000,
    });
    expect(parsed.payload.provider_payload_version).toBe(2);
    expect(parsed.payload.payment?.entity.provider_new_field).toEqual({ source: 'razorpay' });
  });

  it('accepts an unknown event envelope so ingress can mark it ignored', () => {
    const parsed = RazorpayWebhookSchema.safeParse({
      entity: 'event',
      event: 'settlement.processed',
      payload: {},
    });
    expect(parsed.success).toBe(true);
    expect(KNOWN_EVENT_TYPES).not.toContain('settlement.processed');
  });

  it('rejects a known entity wrapper missing its required id', () => {
    const parsed = RazorpayWebhookSchema.safeParse({
      entity: 'event',
      event: 'payment.failed',
      payload: { payment: { entity: { status: 'failed' } } },
    });
    expect(parsed.success).toBe(false);
  });
});
