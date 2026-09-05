import { config as loadDotenv } from 'dotenv';
import pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  RazorpayWebhookSchema,
  type RazorpayWebhook,
} from '@aegis/shared';
import { LlmUnavailableError, type LlmClient, type LlmJsonRequest, type LlmJsonResult } from '../llm/client';
import { StubLlmClient } from '../llm/stub';
import type { CustomerRow } from '../db/repos/customers';
import { getDiagnosis, listDiagnosesForEvent } from '../db/repos/diagnoses';
import { MIGRATIONS_DIR, REPO_ROOT_ENV } from '../db/paths';
import { migrateUp } from '../db/migrate';
import type { EntitySnapshot } from '../orchestrator/entity';
import { Diagnostician, type WebhookEventRow } from './diagnostician';

loadDotenv({ path: REPO_ROOT_ENV, quiet: true });

const databaseUrl = process.env.DATABASE_URL_TEST;
const integration = databaseUrl ? describe : describe.skip;

const customer: CustomerRow = {
  id: 'cus_diagnostician',
  name: 'Aegis Test Customer',
  email: 'customer@example.test',
  contact: '+919876543210',
  country: 'IN',
  locale: 'en-IN',
  opted_out: false,
  notes: {},
  created_at: new Date(0),
  updated_at: new Date(0),
};

function paymentPayload(eventId: string, reason: string, step: string | null, amount = 79_900): RazorpayWebhook {
  return RazorpayWebhookSchema.parse({
    entity: 'event',
    event: 'payment.failed',
    contains: ['payment'],
    payload: {
      payment: {
        entity: {
          entity: 'payment',
          id: `pay_${eventId}`,
          amount,
          currency: 'INR',
          status: 'failed',
          customer_id: customer.id,
          method: 'card',
          international: reason === 'international_transaction_not_allowed',
          error_step: step,
          error_reason: reason,
          error_source: 'issuer',
          email: customer.email,
          contact: customer.contact,
          card: { number: '4111111111111111', cvv: '123' },
          notes: { locale: customer.locale },
        },
      },
    },
    created_at: 1_757_000_000,
  });
}

function subscriptionPayload(event: 'subscription.pending' | 'subscription.halted', eventId: string): RazorpayWebhook {
  return RazorpayWebhookSchema.parse({
    entity: 'event',
    event,
    contains: ['subscription'],
    payload: {
      subscription: {
        entity: {
          entity: 'subscription',
          id: `sub_${eventId}`,
          amount: 249_900,
          currency: 'INR',
          status: 'pending',
          customer_id: customer.id,
          notes: { locale: customer.locale },
        },
      },
    },
    created_at: 1_757_000_000,
  });
}

function eventRow(eventId: string, eventType: string, payload: RazorpayWebhook): WebhookEventRow {
  return {
    event_id: eventId,
    event_type: eventType,
    payload,
    signature_valid: true,
    rzp_created_at: new Date(1_757_000_000_000),
    status: 'processed',
  };
}

function entitySnapshot(
  type: 'payment' | 'subscription',
  id: string,
  fields: Record<string, unknown>,
  applied = true,
): EntitySnapshot {
  return {
    type,
    row: { id, version: 1, ...fields },
    customer,
    applied,
  };
}

class RecordingStub implements LlmClient {
  readonly provider = 'stub';
  readonly requests: Array<LlmJsonRequest<unknown>> = [];
  private readonly inner = new StubLlmClient();

  completeJson<T>(request: LlmJsonRequest<T>): Promise<LlmJsonResult<T>> {
    this.requests.push(request as LlmJsonRequest<unknown>);
    return this.inner.completeJson(request);
  }
}

function throwingClient(message: string): LlmClient {
  return {
    provider: 'throwing',
    completeJson: async <T>(_request: LlmJsonRequest<T>): Promise<LlmJsonResult<T>> => {
      throw new LlmUnavailableError(message);
    },
  };
}

describe('Diagnostician input boundaries', () => {
  it('does not call the model or persist an unapplied snapshot', async () => {
    const calls: string[] = [];
    const llm: LlmClient = {
      provider: 'test',
      completeJson: async <T>(_request: LlmJsonRequest<T>) => {
        calls.push('called');
        throw new Error('should not call model');
      },
    };
    const db = { query: async () => ({ rows: [], rowCount: 0 }) } as unknown as pg.Pool;
    const service = new Diagnostician({ db, llm });
    const payload = paymentPayload('stale', 'payment_cancelled', null);
    const result = await service.diagnose({
      event: eventRow('evt_stale', 'payment.failed', payload),
      payload,
      entity: entitySnapshot('payment', 'pay_stale', { amount_paise: 79_900, error_reason: 'payment_cancelled' }, false),
    });
    expect(calls).toEqual([]);
    expect(result.id).toBe('skipped:evt_stale');
    expect(result.degradedReason).toBe('entity_not_applied');
  });
});

integration('Diagnostician', () => {
  let pool: pg.Pool;

  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: databaseUrl, application_name: 'aegis-diagnostician-tests', max: 4 });
    await migrateUp(pool, MIGRATIONS_DIR, { info: () => undefined, warn: () => undefined });
  });

  beforeEach(async () => {
    await pool.query('TRUNCATE TABLE diagnoses, webhook_events RESTART IDENTITY CASCADE');
  });

  afterAll(async () => {
    await pool?.end();
  });

  it.each([
    ['payment_failed_3ds', 'payment.failed', 'THREE_DS_AUTH_FAILED', 'RETRY_LINK_LOCALIZED', 'payment_authentication', 'authentication_failed', false],
    ['payment_failed_cart', 'payment.failed', 'CUSTOMER_ABANDONED_CHECKOUT', 'CART_RECOVERY_NUDGE', null, 'payment_cancelled', false],
    ['payment_failed_funds', 'payment.failed', 'INSUFFICIENT_FUNDS', 'RETRY_ALTERNATE_METHOD', null, 'insufficient_funds', true],
    ['payment_failed_international', 'payment.failed', 'CARD_NOT_ENABLED_INTERNATIONAL', 'RETRY_ALTERNATE_METHOD', null, 'international_transaction_not_allowed', true],
  ] as const)('persists the %s payment diagnosis through the stub', async (eventId, eventType, rootCause, strategy, step, reason, overridden) => {
    const llm = new RecordingStub();
    const service = new Diagnostician({ db: pool, llm });
    const payload = paymentPayload(eventId, reason, step);
    await pool.query(
      `INSERT INTO webhook_events (event_id, event_type, account_id, payload, payload_sha256, signature_valid, status)
       VALUES ($1, $2, 'acc_diagnosis_test', $3::jsonb, $1, true, 'processed')`,
      [`evt_${eventId}`, eventType, JSON.stringify(payload)],
    );

    const diagnosis = await service.diagnose({
      event: eventRow(`evt_${eventId}`, eventType, payload),
      payload,
      entity: entitySnapshot('payment', `pay_${eventId}`, {
        amount_paise: 79_900,
        international: reason === 'international_transaction_not_allowed',
        method: 'card',
        error_step: step,
        error_reason: reason,
        error_source: 'issuer',
      }),
    });

    expect(diagnosis).toMatchObject({ id: expect.any(String), rootCause, strategy, confidence: expect.any(Number), degraded: false, provider: 'stub', model: 'fixture-v1' });
    expect(diagnosis.crossCheck.overridden).toBe(overridden);
    expect(llm.requests).toHaveLength(1);
    const user = llm.requests[0]?.user ?? '';
    expect(user).not.toContain('4111111111111111');
    expect(user).not.toContain('123');

    const read = await getDiagnosis(pool, diagnosis.id);
    expect(read?.confidence).toBe(diagnosis.confidence);
    expect(typeof read?.confidence).toBe('number');
    expect(read?.output.cross_check).toEqual(diagnosis.crossCheck);
  });

  it.each([
    ['subscription_pending', 'subscription.pending'],
    ['subscription_halted', 'subscription.halted'],
  ] as const)('persists the %s subscription diagnosis through the stub', async (eventId, eventType) => {
    const service = new Diagnostician({ db: pool, llm: new StubLlmClient() });
    const payload = subscriptionPayload(eventType, eventId);
    await pool.query(
      `INSERT INTO webhook_events (event_id, event_type, account_id, payload, payload_sha256, signature_valid, status)
       VALUES ($1, $2, 'acc_diagnosis_test', $3::jsonb, $1, true, 'processed')`,
      [`evt_${eventId}`, eventType, JSON.stringify(payload)],
    );

    const diagnosis = await service.diagnose({
      event: eventRow(`evt_${eventId}`, eventType, payload),
      payload,
      entity: entitySnapshot('subscription', `sub_${eventId}`, { amount_paise: 249_900, status: 'pending' }),
    });

    expect(diagnosis).toMatchObject({ rootCause: 'SUBSCRIPTION_MANDATE_FAILED', strategy: 'SUBSCRIPTION_DUNNING', confidence: 0.82, degraded: false });
    expect((await listDiagnosesForEvent(pool, `evt_${eventId}`))).toHaveLength(1);
  });

  it('falls back and persists degraded metadata when the client throws', async () => {
    const service = new Diagnostician({ db: pool, llm: throwingClient('throwing_client_down') });
    const payload = paymentPayload('fallback', 'insufficient_funds', null);
    await pool.query(
      `INSERT INTO webhook_events (event_id, event_type, account_id, payload, payload_sha256, signature_valid, status)
       VALUES ('evt_fallback', 'payment.failed', 'acc_diagnosis_test', $1::jsonb, 'evt_fallback', true, 'processed')`,
      [JSON.stringify(payload)],
    );

    const diagnosis = await service.diagnose({
      event: eventRow('evt_fallback', 'payment.failed', payload),
      payload,
      entity: entitySnapshot('payment', 'pay_fallback', { amount_paise: 249_900, error_reason: 'insufficient_funds' }),
    });

    expect(diagnosis).toMatchObject({ rootCause: 'INSUFFICIENT_FUNDS', strategy: 'RETRY_ALTERNATE_METHOD', confidence: 0.6, degraded: true, degradedReason: 'throwing_client_down', provider: 'fallback', model: 'rules-v1' });
    expect(diagnosis.rationale).toMatch(/^rule-based fallback:/);
    const read = await getDiagnosis(pool, diagnosis.id);
    expect(read?.degraded).toBe(true);
    expect(read?.degraded_reason).toBe('throwing_client_down');
    expect(read?.output).not.toHaveProperty('provider');
    expect(read?.output).not.toHaveProperty('degraded');
  });
});
