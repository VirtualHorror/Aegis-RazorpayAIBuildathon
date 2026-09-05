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
    await pool.query('TRUNCATE TABLE jobs, webhook_events, disputes, invoices, subscriptions, payments, orders, customers, actions, outbound_messages, ledger_entries, audit_log, diagnoses, guardrail_config, compliance_flags, compliance_scan_runs, products, x402_payments CASCADE');
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

  it('lists actions with the provider and degraded flag of their diagnosis', async () => {
    await seedPayment(pool, 'pay_list', 'cus_list', 'ord_list');
    await seedTriggerEvent(pool, 'evt_list');
    const diagnosis = await pool.query<{ id: string }>(
      `INSERT INTO diagnoses (event_id, entity_type, entity_id, hints, provider, model, prompt_version, input_digest, output, root_cause, confidence, strategy, rationale, degraded, degraded_reason)
       VALUES ('evt_list', 'payment', 'pay_list', '{}'::jsonb, 'fallback', 'rules-v1', 'v1', 'digest', '{}'::jsonb, 'UNKNOWN', 0.5, 'ESCALATE_HUMAN', 'r', true, 'circuit_open') RETURNING id`,
    );
    const proposal: ActionProposal = {
      module: 'checkout_recovery', moduleVersion: 'v1', idempotencyKey: 'checkout_recovery:payment:pay_list:1', entityType: 'payment', entityId: 'pay_list', customerId: 'cus_list',
      kind: 'retry_link', summary: 'list test', moneyImpactPaise: 0, expectedRecoveryPaise: 1200, requiresApproval: false, payload: {}, explanation: ['test'],
    };
    await insertAction(pool, { proposal, triggerEventId: 'evt_list', diagnosisId: diagnosis.rows[0]!.id, bounds: [], status: 'blocked', reason: 'quiet_hours_local' });
    const orchestrator = new EventOrchestrator({ db: pool, llm: new StubLlmClient(), modules: [], now: () => now, logger });
    const config = loadConfig({ DATABASE_URL: databaseUrl!, RAZORPAY_WEBHOOK_SECRET: 'test_webhook_secret_16', NODE_ENV: 'test' });
    const app = await buildApp({ config, db: pool, probeDb: async () => ({ ok: true, latencyMs: 1 }), orchestrator, llm: new StubLlmClient(), logger: false });
    try {
      const all = await app.inject({ method: 'GET', url: '/api/v1/actions' });
      expect(all.statusCode).toBe(200);
      const items = (all.json() as { items: { module: string; status: string; diagnosis_degraded: boolean | null; diagnosis_provider: string | null }[] }).items;
      expect(items).toHaveLength(1);
      expect(items[0]).toMatchObject({ module: 'checkout_recovery', status: 'blocked', diagnosis_degraded: true, diagnosis_provider: 'fallback' });
      const filtered = await app.inject({ method: 'GET', url: '/api/v1/actions?status=executed&module=checkout_recovery' });
      expect((filtered.json() as { items: unknown[] }).items).toHaveLength(0);
    } finally {
      await app.close();
    }
  });

  it('returns the flagged product copy with each compliance flag and keeps the filters working (B-015)', async () => {
    await pool.query(
      `INSERT INTO products (id, merchant_id, name, description, category, price_paise, currency, active, agent_purchasable)
       VALUES ('prod_flag_1', 'acc_test', 'Lucky Draw Bundle', 'Lottery ticket bundle with a chance to win a cash prize.', 'services', 9900, 'INR', true, false)`,
    );
    const run = await pool.query<{ id: string }>(`INSERT INTO compliance_scan_runs (status) VALUES ('succeeded') RETURNING id`);
    await pool.query(
      `INSERT INTO compliance_flags (product_id, scan_run_id, keyword_hits, llm_assessment, risk_level, category, evidence_span, recommendation, status)
       VALUES ('prod_flag_1', $1, '[{"category":"gambling_lottery","pattern":"lottery"}]'::jsonb, NULL, 'prohibited', 'gambling_lottery', 'Lottery ticket bundle', 'Reject the listing.', 'open')`,
      [run.rows[0]!.id],
    );
    const orchestrator = new EventOrchestrator({ db: pool, llm: new StubLlmClient(), modules: [], now: () => now, logger });
    const config = loadConfig({ DATABASE_URL: databaseUrl!, RAZORPAY_WEBHOOK_SECRET: 'test_webhook_secret_16', NODE_ENV: 'test' });
    const app = await buildApp({ config, db: pool, probeDb: async () => ({ ok: true, latencyMs: 1 }), orchestrator, llm: new StubLlmClient(), logger: false });
    try {
      const all = await app.inject({ method: 'GET', url: '/api/v1/compliance/flags' });
      expect(all.statusCode).toBe(200);
      const rows = all.json() as { id: string; product_id: string; product_name: string; product_description: string; evidence_span: string }[];
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ product_id: 'prod_flag_1', product_name: 'Lucky Draw Bundle' });
      // The page highlights the span inside this text, so the span must appear in it verbatim.
      expect(rows[0]!.product_description).toContain(rows[0]!.evidence_span);
      const filtered = await app.inject({ method: 'GET', url: '/api/v1/compliance/flags?status=open&risk=prohibited' });
      expect((filtered.json() as unknown[]).length).toBe(1);
      const none = await app.inject({ method: 'GET', url: '/api/v1/compliance/flags?status=resolved' });
      expect((none.json() as unknown[]).length).toBe(0);
      // The status decision answers with the same shape, so the dashboard can replace the row it is showing.
      const decided = await app.inject({ method: 'POST', url: `/api/v1/compliance/flags/${rows[0]!.id}/status`, payload: { status: 'acknowledged', actor: 'human:test' } });
      expect(decided.statusCode).toBe(200);
      expect((decided.json() as { flag: Record<string, unknown> }).flag).toMatchObject({
        status: 'acknowledged',
        reviewed_by: 'human:test',
        product_name: 'Lucky Draw Bundle',
        product_description: 'Lottery ticket bundle with a chance to win a cash prize.',
      });
    } finally {
      await app.close();
    }
  });

  it('signs an x402 payment header without ever exposing the facilitator secret (T21)', async () => {
    await pool.query(
      `INSERT INTO products (id, merchant_id, name, description, category, price_paise, currency, active, agent_purchasable)
       VALUES ('prod_x402_lab', 'acc_test', 'Aegis USB-C Hub', 'Seven-port hub.', 'electronics', 49900, 'INR', true, true)`,
    );
    const orchestrator = new EventOrchestrator({ db: pool, llm: new StubLlmClient(), modules: [], now: () => now, logger });
    const config = loadConfig({ DATABASE_URL: databaseUrl!, RAZORPAY_WEBHOOK_SECRET: 'test_webhook_secret_16', NODE_ENV: 'test', X402_SIM_SECRET: 'x402_test_secret_16_chars', X402_PAY_TO: 'merchant:test' });
    const app = await buildApp({ config, db: pool, probeDb: async () => ({ ok: true, latencyMs: 1 }), orchestrator, llm: new StubLlmClient(), logger: false });
    try {
      const challenged = await app.inject({ method: 'GET', url: '/x402/products/prod_x402_lab/spec' });
      expect(challenged.statusCode).toBe(402);
      const accepts = (challenged.json() as { accepts: { maxAmountRequired: string; extra: { nonce: string } }[] }).accepts[0]!;

      const signed = await app.inject({ method: 'POST', url: '/api/v1/sim/x402-sign', payload: { nonce: accepts.extra.nonce, amount: accepts.maxAmountRequired, payer: 'agent:test' } });
      expect(signed.statusCode).toBe(200);
      const body = signed.json() as { header: string; payload: { signature: string; payTo: string } };
      // The response must never carry the secret, and only a truncated signature for display.
      expect(JSON.stringify(body)).not.toContain('x402_test_secret_16_chars');
      expect(body.payload.signature).toMatch(/^[0-9a-f]{8}…$/);
      expect(body.payload.payTo).toBe('merchant:test');

      const paid = await app.inject({ method: 'GET', url: '/x402/products/prod_x402_lab/spec', headers: { 'x-payment': body.header } });
      expect(paid.statusCode).toBe(200);
      expect(paid.headers['x-payment-response']).toBeTruthy();
      const replay = await app.inject({ method: 'GET', url: '/x402/products/prod_x402_lab/spec', headers: { 'x-payment': body.header } });
      expect(replay.statusCode).toBe(402);
      expect(replay.json()).toMatchObject({ error: 'nonce_already_settled' });

      const bad = await app.inject({ method: 'POST', url: '/api/v1/sim/x402-sign', payload: { nonce: accepts.extra.nonce, amount: 'not-a-number' } });
      expect(bad.statusCode).toBe(400);
    } finally {
      await app.close();
    }
  });

  it('lists guardrail edits from the audit log for the settings page (T21)', async () => {
    const orchestrator = new EventOrchestrator({ db: pool, llm: new StubLlmClient(), modules: [], now: () => now, logger });
    const config = loadConfig({ DATABASE_URL: databaseUrl!, RAZORPAY_WEBHOOK_SECRET: 'test_webhook_secret_16', NODE_ENV: 'test' });
    const app = await buildApp({ config, db: pool, probeDb: async () => ({ ok: true, latencyMs: 1 }), orchestrator, llm: new StubLlmClient(), logger: false });
    try {
      expect((await app.inject({ method: 'GET', url: '/api/v1/guardrails/history' })).json()).toMatchObject({ items: [], next: null });
      const updated = await app.inject({ method: 'PUT', url: '/api/v1/guardrails/max_discount_pct', payload: { value: 12, actor: 'human:test' } });
      expect(updated.statusCode).toBe(200);
      const history = await app.inject({ method: 'GET', url: '/api/v1/guardrails/history' });
      expect(history.statusCode).toBe(200);
      const items = (history.json() as { items: { actor: string; entity_id: string; before: { value: unknown }; after: { value: unknown } }[] }).items;
      expect(items).toHaveLength(1);
      expect(items[0]).toMatchObject({ actor: 'human:test', entity_id: 'max_discount_pct' });
      expect(items[0]!.before.value).toBe(15);
      expect(items[0]!.after.value).toBe(12);
      // Only guardrail rows: an action decision writes audit rows too and must not appear here.
      await pool.query(`INSERT INTO audit_log (actor, action, entity_type, entity_id, metadata) VALUES ('human:test', 'action.rejected', 'action', 'a1', '{}'::jsonb)`);
      expect((((await app.inject({ method: 'GET', url: '/api/v1/guardrails/history' })).json()) as { items: unknown[] }).items).toHaveLength(1);
    } finally {
      await app.close();
    }
  });

  it('publishes system.kill_switch so every dashboard sees the stop at once (B-017)', async () => {
    const orchestrator = new EventOrchestrator({ db: pool, llm: new StubLlmClient(), modules: [], now: () => now, logger });
    const config = loadConfig({ DATABASE_URL: databaseUrl!, RAZORPAY_WEBHOOK_SECRET: 'test_webhook_secret_16', NODE_ENV: 'test' });
    const bus = new EventBus();
    const seen: { name: string; data: unknown }[] = [];
    bus.subscribe((event) => seen.push({ name: event.name, data: event.data }));
    const app = await buildApp({ config, db: pool, probeDb: async () => ({ ok: true, latencyMs: 1 }), orchestrator, llm: new StubLlmClient(), logger: false, bus });
    try {
      const on = await app.inject({ method: 'PUT', url: '/api/v1/guardrails/kill_switch', payload: { value: true, actor: 'human:test' } });
      expect(on.statusCode).toBe(200);
      expect(seen).toContainEqual({ name: 'system.kill_switch', data: { enabled: true } });
      const off = await app.inject({ method: 'PUT', url: '/api/v1/guardrails/kill_switch', payload: { value: false, actor: 'human:test' } });
      expect(off.statusCode).toBe(200);
      expect(seen.filter((event) => event.name === 'system.kill_switch')).toHaveLength(2);
      // A non-kill-switch edit must not publish it.
      await app.inject({ method: 'PUT', url: '/api/v1/guardrails/max_discount_pct', payload: { value: 11, actor: 'human:test' } });
      expect(seen.filter((event) => event.name === 'system.kill_switch')).toHaveLength(2);
    } finally {
      await app.close();
    }
  });
});
