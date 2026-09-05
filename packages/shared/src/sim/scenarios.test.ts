import { describe, expect, it } from 'vitest';
import {
  SIM_SCENARIO_BUILDERS,
  SIM_SCENARIO_NAMES,
  buildAllScenarios,
  buildScenario,
  buildWebhook,
  type SimScenario,
} from './scenarios';
import { createIdFactory } from './ids';
import { RazorpayWebhookSchema } from '../razorpay/webhook';

function entity(scenario: SimScenario, key: string): Record<string, unknown> {
  const wrapped = Object.entries(scenario.webhook.payload).find(([entryKey]) => entryKey === key)?.[1];
  if (typeof wrapped !== 'object' || wrapped === null || !('entity' in wrapped)) throw new Error(`missing ${key} entity`);
  const value = wrapped.entity;
  if (typeof value !== 'object' || value === null) throw new Error(`invalid ${key} entity`);
  return Object.fromEntries(Object.entries(value));
}

describe('simulator ids', () => {
  it('uses deterministic, distinct natural-key ids for a seeded run', () => {
    const first = createIdFactory(42);
    const second = createIdFactory(42);
    const firstIds = [first.paymentId(), first.orderId(), first.subscriptionId(), first.invoiceId(), first.disputeId(), first.eventId()];
    const secondIds = [second.paymentId(), second.orderId(), second.subscriptionId(), second.invoiceId(), second.disputeId(), second.eventId()];

    expect(firstIds).toEqual(secondIds);
    expect(new Set(firstIds).size).toBe(firstIds.length);
    expect(firstIds).toEqual(expect.arrayContaining([
      expect.stringMatching(/^pay_/),
      expect.stringMatching(/^order_/),
      expect.stringMatching(/^sub_/),
      expect.stringMatching(/^inv_/),
      expect.stringMatching(/^disp_/),
      expect.stringMatching(/^evt_/),
    ]));
  });
});

describe('simulator scenario builders', () => {
  it.each(SIM_SCENARIO_NAMES)('builds a schema-valid %s webhook', (name) => {
    const scenario = buildScenario(name, { seed: 7, createdAt: 1_757_000_000 });
    expect(RazorpayWebhookSchema.safeParse(scenario.webhook).success).toBe(true);
    expect(scenario.name).toBe(name);
    expect(scenario.eventId).toMatch(/^evt_/);
    expect(scenario.webhook.entity).toBe('event');
    expect(scenario.webhook.contains).toEqual([scenario.entityKey]);
    expect(scenario.signatureValid).toBe(name !== 'bad_signature');
  });

  it('exposes all 14 named builders without an untyped dispatch escape hatch', () => {
    expect(Object.keys(SIM_SCENARIO_BUILDERS)).toEqual([...SIM_SCENARIO_NAMES]);
  });

  it('builds the exact provider envelope shape', () => {
    const body = buildWebhook({
      event: 'payment.failed',
      entityKey: 'payment',
      entity: { entity: 'payment', id: 'pay_envelope', amount: 1, status: 'failed' },
      accountId: 'acc_test',
      createdAt: 1_757_000_000,
    });
    expect(body).toEqual({
      entity: 'event',
      account_id: 'acc_test',
      event: 'payment.failed',
      contains: ['payment'],
      payload: { payment: { entity: { entity: 'payment', id: 'pay_envelope', amount: 1, status: 'failed' } } },
      created_at: 1_757_000_000,
    });
  });

  it('is byte-reproducible for a complete seeded run', () => {
    const first = buildAllScenarios({ seed: 'replay-me', createdAt: 1_757_000_000 });
    const second = buildAllScenarios({ seed: 'replay-me', createdAt: 1_757_000_000 });
    expect(first).toEqual(second);
    expect(new Set(first.map((scenario) => scenario.eventId)).size).toBe(SIM_SCENARIO_NAMES.length);
  });

  it('attributes the retry capture to the first failure order and keeps lifecycle ids shared', () => {
    const scenarios = buildAllScenarios({ seed: 99, createdAt: 1_757_000_000 });
    expect(new Set(scenarios.map((scenario) => scenario.name))).toEqual(new Set(SIM_SCENARIO_NAMES));
    const failure = scenarios[0];
    const capture = scenarios[1];
    const pending = scenarios[5];
    const halted = scenarios[6];
    const charged = scenarios[7];
    const expired = scenarios[8];
    const paid = scenarios[9];
    if (!failure || !capture || !pending || !halted || !charged || !expired || !paid) throw new Error('incomplete scenario set');
    expect(failure.name).toBe('payment_failed_3ds_intl');
    expect(capture.name).toBe('payment_captured_after_retry');

    const failureEntity = entity(failure, 'payment');
    const captureEntity = entity(capture, 'payment');
    expect(capture.attribution).toEqual({ orderId: failureEntity.order_id, priorFailureEventId: failure.eventId });
    expect(captureEntity.order_id).toBe(failureEntity.order_id);
    expect(captureEntity.id).not.toBe(failureEntity.id);
    expect(entity(halted, 'subscription').id).toBe(entity(pending, 'subscription').id);
    expect(entity(charged, 'subscription').id).toBe(entity(pending, 'subscription').id);
    expect(entity(paid, 'invoice').id).toBe(entity(expired, 'invoice').id);
  });

  it('keeps a separately constructed retry payment/event fresh when prior attribution is supplied', () => {
    const failure = buildScenario('payment_failed_3ds_intl', { seed: 101 });
    const failurePayment = entity(failure, 'payment');
    const capture = buildScenario('payment_captured_after_retry', {
      seed: 101,
      priorFailureOrderId: String(failurePayment.order_id),
      priorFailureEventId: failure.eventId,
    });
    const capturePayment = entity(capture, 'payment');
    expect(capturePayment.order_id).toBe(failurePayment.order_id);
    expect(capturePayment.id).not.toBe(failurePayment.id);
    expect(capture.eventId).not.toBe(failure.eventId);
  });

  it('keeps the unknown event and forged signature distinct from verified deliveries', () => {
    const scenarios = buildAllScenarios({ seed: 13 });
    const unknown = scenarios.find((scenario) => scenario.name === 'unknown_event');
    const forged = scenarios.find((scenario) => scenario.name === 'bad_signature');
    if (!unknown || !forged) throw new Error('edge scenarios missing');
    expect(unknown.webhook.event).toBe('settlement.processed');
    expect(forged.signatureValid).toBe(false);
    expect(forged.eventId).not.toBe(unknown.eventId);
    expect(forged.eventId).toMatch(/^evt_/);
  });
});
