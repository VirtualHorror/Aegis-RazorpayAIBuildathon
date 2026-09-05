import { config as loadDotenv } from 'dotenv';
import pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app';
import { loadConfig } from '../src/config';
import { EventBus } from '../src/bus/event-bus';
import { StubLlmClient } from '../src/llm/stub';
import { EventOrchestrator } from '../src/orchestrator/EventOrchestrator';
import { attributeRecovery } from '../src/orchestrator/attribution';
import { insertAction } from '../src/db/repos/actions';
import { MIGRATIONS_DIR, REPO_ROOT_ENV } from '../src/db/paths';
import { migrateUp } from '../src/db/migrate';
import type { ActionModule, ActionProposal, ExecutionResult, GuardResult } from '../src/orchestrator/types';
import type { EntitySnapshot } from '../src/orchestrator/entity';
import { GUARDRAIL_DEFAULTS } from '../../../db/seed/data/guardrails';

loadDotenv({ path: REPO_ROOT_ENV, quiet: true });

const databaseUrl = process.env.DATABASE_URL_TEST;
const integration = databaseUrl ? describe : describe.skip;
const now = new Date('2026-09-05T12:00:00.000Z');
const logger = { info: () => undefined, warn: () => undefined, error: () => undefined, debug: () => undefined };

async function seedGuardrails(pool: pg.Pool): Promise<void> {
  for (const guardrail of GUARDRAIL_DEFAULTS) {
    await pool.query(
      `INSERT INTO guardrail_config (key, value, description, updated_by) VALUES ($1, $2::jsonb, $3, 'test')`,
      [guardrail.key, JSON.stringify(guardrail.value), guardrail.description],
    );
  }
}

async function seedPayment(pool: pg.Pool, paymentId: string, customerId: string, orderId: string): Promise<void> {
  await pool.query(`INSERT INTO customers (id, contact, country, locale) VALUES ($1, '+919876543210', 'IN', 'en-IN')`, [customerId]);
  await pool.query(`INSERT INTO orders (id, customer_id, amount_paise, currency, status) VALUES ($1, $2, 1200, 'INR', 'paid')`, [orderId, customerId]);
  await pool.query(
    `INSERT INTO payments (id, order_id, customer_id, amount_paise, currency, status, status_rank, last_event_at)
     VALUES ($1, $2, $3, 1200, 'INR', 'captured', 2, $4)`,
    [paymentId, orderId, customerId, now],
  );
}

async function seedTriggerEvent(pool: pg.Pool, eventId: string): Promise<void> {
  await pool.query(
    `INSERT INTO webhook_events (event_id, event_type, payload, payload_sha256, signature_valid, rzp_created_at, status)
     VALUES ($1, 'payment.failed', '{"entity":"event","event":"payment.failed","contains":["payment"],"payload":{}}'::jsonb, $2, true, $3, 'processed')`,
    [eventId, `sha-${eventId}`, now],
  );
}

function paymentSnapshot(paymentId: string, customerId: string, orderId: string): EntitySnapshot {
  return {
    type: 'payment',
    row: { id: paymentId, version: 1, order_id: orderId, customer_id: customerId, amount_paise: 1200 },
    customer: null,
    applied: true,
  };
}

function approvalModule(calls: string[]): ActionModule {
  const proposal: ActionProposal = {
    module: 'approval_test', moduleVersion: 'v1', idempotencyKey: 'approval_test:payment:pay_approval:1',
    entityType: 'payment', entityId: 'pay_approval', customerId: 'cus_approval', kind: 'approval_test', summary: 'approval test',
    moneyImpactPaise: 0, expectedRecoveryPaise: 0, requiresApproval: true, payload: {}, explanation: ['test'],
  };
  return {
    name: 'approval_test', version: 'v1', handles: ['payment.failed'],
    canHandle: () => true,
    propose: async () => proposal,
    guard: (): GuardResult => ({ pass: true, rules: [] }),
    execute: async (): Promise<ExecutionResult> => { calls.push('execute'); return { status: 'executed', result: { ok: true } }; },
  };
}

integration('T13 approvals and attribution', () => {
  let pool: pg.Pool;

  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: databaseUrl, application_name: 'aegis-t13-tests', max: 12 });
    await migrateUp(pool, MIGRATIONS_DIR, { info: () => undefined, warn: () => undefined });
  });

  beforeEach(async () => {
    await pool.query('TRUNCATE TABLE jobs, webhook_events, disputes, invoices, subscriptions, payments, orders, customers, actions, outbound_messages, ledger_entries, audit_log, diagnoses, guardrail_config CASCADE');
    await seedGuardrails(pool);
  });

  afterAll(async () => {
    await pool?.end();
  });

  it('attributes a capture once and updates the action result', async () => {
    await seedPayment(pool, 'pay_attr', 'cus_attr', 'ord_attr');
    await seedTriggerEvent(pool, 'evt_attr');
    const action = await insertAction(pool, {
      proposal: {
        module: 'checkout_recovery', moduleVersion: 'v1', idempotencyKey: 'checkout_recovery:payment:pay_attr:1',
        entityType: 'payment', entityId: 'pay_attr', customerId: 'cus_attr', kind: 'whatsapp_retry_link', summary: 'retry',
        moneyImpactPaise: 0, expectedRecoveryPaise: 1500, requiresApproval: false, payload: {}, explanation: ['test'],
      },
      triggerEventId: 'evt_attr', diagnosisId: null, bounds: [], status: 'executed',
    });
    if (!action) throw new Error('action insert failed');
    await pool.query(`UPDATE actions SET executed_at = $2, result = '{"link":"test"}'::jsonb WHERE id = $1`, [action.id, new Date(now.getTime() - 3_600_000)]);
    const bus = new EventBus();
    const events: string[] = [];
    bus.subscribe((event) => events.push(event.name));
    const result = await attributeRecovery(pool, {
      eventType: 'payment.captured', entity: paymentSnapshot('pay_attr', 'cus_attr', 'ord_attr'), capturedAt: now, attributionWindowHours: 72,
    }, bus);
    expect(result?.amountPaise).toBe(1200);
    expect(events).toEqual(['action.recovered']);
    expect((await pool.query(`SELECT account, ref_type, ref_id, credit_paise FROM ledger_entries`)).rows).toMatchObject([
      { account: 'recovered_revenue', ref_type: 'action', ref_id: action.id, credit_paise: 1200 },
    ]);
    expect((await pool.query<{ result: Record<string, unknown> }>(`SELECT result FROM actions WHERE id = $1`, [action.id])).rows[0]?.result)
      .toMatchObject({ link: 'test', recovered_paise: 1200 });
    expect(await attributeRecovery(pool, {
      eventType: 'order.paid', entity: paymentSnapshot('pay_attr', 'cus_attr', 'ord_attr'), capturedAt: now, attributionWindowHours: 72,
    })).toBeNull();
  });

  it('serializes concurrent attribution attempts to one action credit', async () => {
    await seedPayment(pool, 'pay_race', 'cus_race', 'ord_race');
    await seedTriggerEvent(pool, 'evt_race');
    const action = await insertAction(pool, {
      proposal: {
        module: 'checkout_recovery', moduleVersion: 'v1', idempotencyKey: 'checkout_recovery:payment:pay_race:1',
        entityType: 'payment', entityId: 'pay_race', customerId: 'cus_race', kind: 'whatsapp_retry_link', summary: 'retry',
        moneyImpactPaise: 0, expectedRecoveryPaise: 1200, requiresApproval: false, payload: {}, explanation: ['test'],
      },
      triggerEventId: 'evt_race', diagnosisId: null, bounds: [], status: 'executed',
    });
    if (!action) throw new Error('action insert failed');
    await pool.query(`UPDATE actions SET executed_at = $2 WHERE id = $1`, [action.id, new Date(now.getTime() - 3_600_000)]);
    const input = { eventType: 'payment.captured' as const, entity: paymentSnapshot('pay_race', 'cus_race', 'ord_race'), capturedAt: now, attributionWindowHours: 72 };
    const results = await Promise.all([attributeRecovery(pool, input), attributeRecovery(pool, { ...input, eventType: 'order.paid' })]);
    expect(results.filter((value) => value !== null)).toHaveLength(1);
    expect((await pool.query(`SELECT count(*)::int AS count FROM ledger_entries WHERE account='recovered_revenue' AND ref_type='action' AND ref_id=$1`, [action.id])).rows[0]?.count)
      .toBe(1);
  });

  it('returns one success and one conflict for concurrent approval clicks', async () => {
    await seedPayment(pool, 'pay_approval', 'cus_approval', 'ord_approval');
    const payload = {
      entity: 'event', event: 'payment.failed', contains: ['payment'], created_at: Math.floor(now.getTime() / 1000),
      payload: { payment: { entity: { entity: 'payment', id: 'pay_approval', amount: 1200, currency: 'INR', status: 'failed', customer_id: 'cus_approval', order_id: 'ord_approval' } } },
    };
    await pool.query(`INSERT INTO webhook_events (event_id, event_type, payload, payload_sha256, signature_valid, rzp_created_at, status) VALUES ('evt_approval', 'payment.failed', $1::jsonb, 'approval', true, $2, 'processed')`, [JSON.stringify(payload), now]);
    const proposal: ActionProposal = {
      module: 'approval_test', moduleVersion: 'v1', idempotencyKey: 'approval_test:payment:pay_approval:1', entityType: 'payment', entityId: 'pay_approval', customerId: 'cus_approval',
      kind: 'approval_test', summary: 'approval test', moneyImpactPaise: 0, expectedRecoveryPaise: 0, requiresApproval: true, payload: {}, explanation: ['test'],
    };
    const action = await insertAction(pool, { proposal, triggerEventId: 'evt_approval', diagnosisId: null, bounds: [], status: 'pending_approval' });
    if (!action) throw new Error('action insert failed');
    const calls: string[] = [];
    const orchestrator = new EventOrchestrator({ db: pool, llm: new StubLlmClient(), modules: [approvalModule(calls)], now: () => now, logger });
    const config = loadConfig({ DATABASE_URL: databaseUrl!, RAZORPAY_WEBHOOK_SECRET: 'test_webhook_secret_16', NODE_ENV: 'test' });
    const app = await buildApp({ config, db: pool, probeDb: async () => ({ ok: true, latencyMs: 1 }), orchestrator, llm: new StubLlmClient(), logger: false });
    try {
      const responses = await Promise.all([
        app.inject({ method: 'POST', url: `/api/v1/actions/${action.id}/decision`, payload: { decision: 'approve', note: 'approve now', actor: 'human:a' } }),
        app.inject({ method: 'POST', url: `/api/v1/actions/${action.id}/decision`, payload: { decision: 'approve', note: 'approve now', actor: 'human:b' } }),
      ]);
      expect(responses.map((response) => response.statusCode).sort()).toEqual([200, 409]);
      expect(calls).toEqual(['execute']);
      expect((await pool.query(`SELECT status FROM actions WHERE id = $1`, [action.id])).rows[0]?.status).toBe('executed');
    } finally {
      await app.close();
    }
  });

  it('returns an ISO cursor that the events and actions lists accept as `before` (B-012)', async () => {
    for (const [index, offsetMinutes] of [[1, 3], [2, 2], [3, 1]] as const) {
      const receivedAt = new Date(now.getTime() - offsetMinutes * 60_000);
      await pool.query(
        `INSERT INTO webhook_events (event_id, event_type, payload, payload_sha256, signature_valid, rzp_created_at, received_at, status)
         VALUES ($1, 'payment.failed', '{"entity":"event","event":"payment.failed","contains":["payment"],"payload":{}}'::jsonb, $2, true, $3, $3, 'processed')`,
        [`evt_cursor_${index}`, `sha-cursor-${index}`, receivedAt],
      );
    }
    const orchestrator = new EventOrchestrator({ db: pool, llm: new StubLlmClient(), modules: [], now: () => now, logger });
    const config = loadConfig({ DATABASE_URL: databaseUrl!, RAZORPAY_WEBHOOK_SECRET: 'test_webhook_secret_16', NODE_ENV: 'test' });
    const app = await buildApp({ config, db: pool, probeDb: async () => ({ ok: true, latencyMs: 1 }), orchestrator, llm: new StubLlmClient(), logger: false });
    try {
      const first = await app.inject({ method: 'GET', url: '/api/v1/events?limit=2' });
      expect(first.statusCode).toBe(200);
      const page = first.json() as { items: { event_id: string }[]; next: string | null };
      expect(page.items.map((row) => row.event_id)).toEqual(['evt_cursor_3', 'evt_cursor_2']);
      expect(page.next).not.toBeNull();
      expect(new Date(page.next!).toISOString()).toBe(page.next);
      const second = await app.inject({ method: 'GET', url: `/api/v1/events?limit=2&before=${encodeURIComponent(page.next!)}` });
      expect(second.statusCode).toBe(200);
      const rest = second.json() as { items: { event_id: string }[]; next: string | null };
      expect(rest.items.map((row) => row.event_id)).toEqual(['evt_cursor_1']);
      expect(rest.next).toBeNull();
      const actions = await app.inject({ method: 'GET', url: '/api/v1/actions?limit=1' });
      expect(actions.statusCode).toBe(200);
      expect((actions.json() as { next: string | null }).next).toBeNull();
    } finally {
      await app.close();
    }
  });

  it('counts model calls per diagnosis, not per provider (B-013)', async () => {
    await pool.query(
      `INSERT INTO webhook_events (event_id, event_type, payload, payload_sha256, signature_valid, rzp_created_at, status)
       VALUES ('evt_llm_1', 'payment.failed', '{"entity":"event","event":"payment.failed","contains":["payment"],"payload":{}}'::jsonb, 'sha-llm-1', true, $1, 'processed')`,
      [now],
    );
    const insert = (provider: string, degraded: boolean, latency: number | null) =>
      pool.query(
        `INSERT INTO diagnoses (event_id, entity_type, entity_id, hints, provider, model, prompt_version, input_digest, output, root_cause, confidence, strategy, rationale, degraded, latency_ms)
         VALUES ('evt_llm_1', 'payment', 'pay_llm', '{}'::jsonb, $1, 'm', 'v1', 'digest', '{}'::jsonb, 'CARD_DECLINED', 0.9, 'RETRY_LINK', 'r', $2, $3)`,
        [provider, degraded, latency],
      );
    await insert('openai', false, 100);
    await insert('openai', false, 300);
    await insert('fallback', true, null);
    const orchestrator = new EventOrchestrator({ db: pool, llm: new StubLlmClient(), modules: [], now: () => now, logger });
    const config = loadConfig({ DATABASE_URL: databaseUrl!, RAZORPAY_WEBHOOK_SECRET: 'test_webhook_secret_16', NODE_ENV: 'test' });
    const app = await buildApp({ config, db: pool, probeDb: async () => ({ ok: true, latencyMs: 1 }), orchestrator, llm: new StubLlmClient(), logger: false });
    try {
      const response = await app.inject({ method: 'GET', url: '/api/v1/metrics/summary?window=all' });
      expect(response.statusCode).toBe(200);
      const llm = (response.json() as { llm: { calls: number; degraded: number; degraded_rate: number; avg_latency_ms: number; by_provider: Record<string, number> } }).llm;
      expect(llm).toMatchObject({ calls: 3, degraded: 1, avg_latency_ms: 200, by_provider: { openai: 2, fallback: 1 } });
      expect(llm.degraded_rate).toBeCloseTo(1 / 3, 5);
    } finally {
      await app.close();
    }
  });
});
