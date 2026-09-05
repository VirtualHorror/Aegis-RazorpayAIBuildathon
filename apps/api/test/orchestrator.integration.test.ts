import { config as loadDotenv } from 'dotenv';
import pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { RazorpayWebhookSchema } from '@aegis/shared';
import { GUARDRAIL_DEFAULTS } from '../../../db/seed/data/guardrails';
import { MIGRATIONS_DIR, REPO_ROOT_ENV } from '../src/db/paths';
import { migrateUp } from '../src/db/migrate';
import { EventBus } from '../src/bus/event-bus';
import { StubLlmClient } from '../src/llm/stub';
import { EventOrchestrator } from '../src/orchestrator/EventOrchestrator';
import { executeAction } from '../src/orchestrator/execute';
import { insertAction } from '../src/db/repos/actions';
import { loadGuardrailConfig } from '../src/db/repos/guardrails';
import { checkoutRecovery } from '../src/modules/checkout-recovery';
import { applyProjection } from '../src/orchestrator/projections';
import { withTransaction } from '../src/db/tx';
import type { ActionModule, ActionProposal, EventContext, ExecutionDeps, ExecutionResult, GuardResult, ActionRow } from '../src/orchestrator/types';

loadDotenv({ path: REPO_ROOT_ENV, quiet: true });
const databaseUrl = process.env.DATABASE_URL_TEST;
const integration = databaseUrl ? describe : describe.skip;

const now = new Date('2026-09-05T12:00:00.000Z');

function paymentPayload(paymentId: string, customerId: string, errorStep = 'payment_authentication') {
  return RazorpayWebhookSchema.parse({
    entity: 'event',
    account_id: 'acc_orchestrator_test',
    event: 'payment.failed',
    contains: ['payment'],
    payload: {
      payment: {
        entity: {
          entity: 'payment',
          id: paymentId,
          amount: 149_900,
          currency: 'INR',
          status: 'failed',
          customer_id: customerId,
          order_id: `order_${paymentId}`,
          contact: '+919876543210',
          error_step: errorStep,
          error_reason: 'authentication_failed',
        },
      },
    },
    created_at: Math.floor(now.getTime() / 1_000),
  });
}

async function insertEvent(pool: pg.Pool, eventId: string, payload: ReturnType<typeof paymentPayload>): Promise<void> {
  await pool.query(
    `INSERT INTO webhook_events (event_id, event_type, account_id, payload, payload_sha256, signature_valid, rzp_created_at, status)
     VALUES ($1, $2, $3, $4::jsonb, $5, true, $6, 'received')`,
    [eventId, payload.event, payload.account_id ?? null, JSON.stringify(payload), `sha-${eventId}`, now],
  );
}

async function seedGuardrails(pool: pg.Pool): Promise<void> {
  for (const guardrail of GUARDRAIL_DEFAULTS) {
    await pool.query(
      `INSERT INTO guardrail_config (key, value, description, updated_by) VALUES ($1, $2::jsonb, $3, 'test')`,
      [guardrail.key, JSON.stringify(guardrail.value), guardrail.description],
    );
  }
}

function fakeProposal(moduleName: string, paymentId: string, moneyImpactPaise = 0, withFollowUp = false): ActionProposal {
  return {
    module: moduleName,
    moduleVersion: 'v1',
    idempotencyKey: `${moduleName}:payment:${paymentId}:1`,
    entityType: 'payment',
    entityId: paymentId,
    customerId: 'cus_fake_module',
    kind: 'fake_action',
    summary: 'fake action for orchestrator contract coverage',
    moneyImpactPaise,
    expectedRecoveryPaise: 0,
    requiresApproval: false,
    payload: { test: true },
    explanation: ['test proposal'],
    ...(withFollowUp
      ? {
          scheduleFollowUp: {
            kind: 'fake_follow_up',
            runAt: new Date(now.getTime() + 3_600_000),
            payload: { paymentId, step: 1 },
            dedupeKey: `fake_follow_up:${paymentId}:1`,
          },
        }
      : {}),
  };
}

function fakeDiagnosis(id: string) {
  return {
    id,
    rootCause: 'THREE_DS_AUTH_FAILED' as const,
    strategy: 'RETRY_LINK_LOCALIZED' as const,
    confidence: 0.9,
    rationale: 'fake diagnosis for orchestrator contract coverage',
    degraded: false,
    crossCheck: { overridden: false, notes: [] },
    provider: 'skipped',
    model: 'rules-v1',
  };
}

function fakeModule(
  moduleName: string,
  calls: string[],
  proposal: ActionProposal | null,
): ActionModule {
  return {
    name: moduleName,
    version: 'v1',
    handles: ['payment.failed'],
    canHandle: (_ctx: EventContext): boolean => {
      calls.push('canHandle');
      return true;
    },
    propose: async (_ctx: EventContext): Promise<ActionProposal | null> => {
      calls.push('propose');
      return proposal;
    },
    guard: (_proposal: ActionProposal, _ctx: EventContext): GuardResult => {
      calls.push('guard');
      return { pass: true, rules: [{ rule: 'fake', limit: true, actual: true, pass: true }] };
    },
    execute: async (_action: ActionRow, _ctx: EventContext, _deps: ExecutionDeps): Promise<ExecutionResult> => {
      calls.push('execute');
      return { status: 'executed', result: { fake: true } };
    },
  };
}

integration('EventOrchestrator', () => {
  let pool: pg.Pool;

  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: databaseUrl, application_name: 'aegis-orchestrator-tests', max: 10 });
    await migrateUp(pool, MIGRATIONS_DIR, { info: () => undefined, warn: () => undefined });
  });

  beforeEach(async () => {
    await pool.query('TRUNCATE TABLE jobs, webhook_events, disputes, invoices, subscriptions, payments, orders, customers, actions, outbound_messages, ledger_entries, audit_log, diagnoses, guardrail_config CASCADE');
    await seedGuardrails(pool);
  });

  afterAll(async () => {
    await pool?.end();
  });

  it('projects, diagnoses, persists, and executes one idempotent checkout action', async () => {
    const eventId = 'evt_orchestrator_checkout';
    const payload = paymentPayload('pay_orchestrator_checkout', 'cus_orchestrator_checkout');
    await insertEvent(pool, eventId, payload);
    const bus = new EventBus();
    const seen: string[] = [];
    bus.subscribe((event) => seen.push(event.name));
    const orchestrator = new EventOrchestrator({
      db: pool,
      llm: new StubLlmClient(),
      modules: [checkoutRecovery],
      bus,
      now: () => now,
      logger: { info: () => undefined, warn: () => undefined, error: () => undefined, debug: () => undefined },
    });

    const result = await orchestrator.handle(eventId, 'worker:orchestrator-test');
    expect(result.status).toBe('processed');
    expect(result.actions).toHaveLength(1);
    expect(result.actions[0]?.status).toBe('executed');
    expect(seen).toContain('diagnosis.created');
    expect(seen).toContain('action.executed');
    const outbound = await pool.query<{ recipient_masked: string; status: string; payload: Record<string, unknown> }>(
      `SELECT recipient_masked, status, payload FROM outbound_messages WHERE action_id = $1`,
      [result.actions[0]?.id],
    );
    expect(outbound.rows[0]?.recipient_masked).toBe('+91••••••3210');
    expect(outbound.rows[0]?.status).toBe('simulated_sent');
    expect(JSON.stringify(outbound.rows[0]?.payload)).not.toContain('9876543210');
    expect((await orchestrator.handle(eventId, 'worker:orchestrator-test')).actions).toHaveLength(0);
    expect((await pool.query('SELECT count(*)::int AS count FROM actions')).rows[0]?.count).toBe(1);
  });

  it('blocks proposals with the kill switch and keeps every evaluated bound', async () => {
    await pool.query(`UPDATE guardrail_config SET value = 'true'::jsonb WHERE key = 'kill_switch'`);
    const eventId = 'evt_orchestrator_kill';
    await insertEvent(pool, eventId, paymentPayload('pay_orchestrator_kill', 'cus_orchestrator_kill'));
    const orchestrator = new EventOrchestrator({
      db: pool,
      llm: new StubLlmClient(),
      modules: [checkoutRecovery],
      now: () => now,
      logger: { info: () => undefined, warn: () => undefined, error: () => undefined, debug: () => undefined },
    });
    const result = await orchestrator.handle(eventId, 'worker:orchestrator-test');
    expect(result.actions[0]?.status).toBe('blocked');
    expect(result.actions[0]?.bounds.find((rule) => rule.rule === 'kill_switch')).toMatchObject({ pass: false, actual: true });
  });

  it('feeds prior failed payments into diagnosis so the stopping rule suppresses another retry', async () => {
    await pool.query(
      `INSERT INTO customers (id, contact, country, locale) VALUES ('cus_prior_failures', '+919876543210', 'IN', 'en-IN')`,
    );
    for (let index = 0; index < 3; index += 1) {
      await pool.query(
        `INSERT INTO payments (id, customer_id, amount_paise, currency, status, status_rank, last_event_at)
         VALUES ($1, 'cus_prior_failures', 149900, 'INR', 'failed', 4, $2)`,
        [`pay_prior_${index}`, new Date(now.getTime() - (index + 1) * 3_600_000)],
      );
    }
    const eventId = 'evt_orchestrator_prior';
    await insertEvent(pool, eventId, paymentPayload('pay_orchestrator_prior', 'cus_prior_failures'));
    const orchestrator = new EventOrchestrator({
      db: pool,
      llm: new StubLlmClient(),
      modules: [checkoutRecovery],
      now: () => now,
      logger: { info: () => undefined, warn: () => undefined, error: () => undefined, debug: () => undefined },
    });
    const result = await orchestrator.handle(eventId, 'worker:orchestrator-test');
    expect(result.actions).toHaveLength(0);
    const diagnosis = await pool.query<{ strategy: string; hints: Record<string, unknown> }>(
      'SELECT strategy, hints FROM diagnoses WHERE event_id = $1', [eventId],
    );
    expect(diagnosis.rows[0]?.strategy).toBe('ESCALATE_HUMAN');
    expect(diagnosis.rows[0]?.hints.prior_failures_24h).toBe(3);
  });

  it('keeps the module contract deterministic and skips guard when propose returns null', async () => {
    const eventId = 'evt_orchestrator_null_proposal';
    const paymentId = 'pay_orchestrator_null_proposal';
    await insertEvent(pool, eventId, paymentPayload(paymentId, 'cus_fake_module'));
    const calls: string[] = [];
    const module = fakeModule('fake_null', calls, null);
    const orchestrator = new EventOrchestrator({
      db: pool,
      llm: new StubLlmClient(),
      modules: [module],
      diagnostician: { diagnose: async () => fakeDiagnosis('skipped:fake-null') },
      now: () => now,
      logger: { info: () => undefined, warn: () => undefined, error: () => undefined, debug: () => undefined },
    });

    const result = await orchestrator.handle(eventId, 'worker:orchestrator-test');
    expect(result.actions).toHaveLength(0);
    expect(calls).toEqual(['canHandle', 'propose']);
  });

  it('persists a high-impact proposal as pending approval without executing it', async () => {
    const eventId = 'evt_orchestrator_pending';
    const paymentId = 'pay_orchestrator_pending';
    await insertEvent(pool, eventId, paymentPayload(paymentId, 'cus_fake_module'));
    const calls: string[] = [];
    const module = fakeModule('fake_pending', calls, fakeProposal('fake_pending', paymentId, -300_000));
    const orchestrator = new EventOrchestrator({
      db: pool,
      llm: new StubLlmClient(),
      modules: [module],
      diagnostician: { diagnose: async () => fakeDiagnosis('skipped:fake-pending') },
      now: () => now,
      logger: { info: () => undefined, warn: () => undefined, error: () => undefined, debug: () => undefined },
    });

    const result = await orchestrator.handle(eventId, 'worker:orchestrator-test');
    expect(result.actions[0]?.status).toBe('pending_approval');
    expect(result.actions[0]?.reason).toBeNull();
    expect(calls).toEqual(['canHandle', 'propose', 'guard']);
  });

  it('queues a scheduled follow-up only after an approved action executes', async () => {
    const eventId = 'evt_orchestrator_follow_up';
    const paymentId = 'pay_orchestrator_follow_up';
    const payload = paymentPayload(paymentId, 'cus_fake_module');
    await insertEvent(pool, eventId, payload);
    const calls: string[] = [];
    const module = fakeModule('fake_follow_up', calls, fakeProposal('fake_follow_up', paymentId, -300_000, true));
    const orchestrator = new EventOrchestrator({
      db: pool,
      llm: new StubLlmClient(),
      modules: [module],
      diagnostician: { diagnose: async () => fakeDiagnosis('skipped:fake-follow-up') },
      now: () => now,
      logger: { info: () => undefined, warn: () => undefined, error: () => undefined, debug: () => undefined },
    });

    const result = await orchestrator.handle(eventId, 'worker:orchestrator-test');
    const action = result.actions[0];
    if (!action || !result.entity) throw new Error('expected pending action and entity');
    expect(action.status).toBe('pending_approval');
    expect((await pool.query('SELECT count(*)::int AS count FROM jobs WHERE dedupe_key = $1', [`fake_follow_up:${paymentId}:1`])).rows[0]?.count).toBe(0);

    await pool.query(`UPDATE actions SET status = 'approved' WHERE id = $1`, [action.id]);
    const config = await loadGuardrailConfig(pool);
    const ctx: EventContext = {
      event: {
        event_id: eventId,
        event_type: payload.event,
        payload,
        signature_valid: true,
        rzp_created_at: now,
        status: 'processed',
      },
      payload,
      entity: result.entity,
      diagnosis: result.diagnosis ?? null,
      config,
      now,
      logger: { info: () => undefined, warn: () => undefined, error: () => undefined, debug: () => undefined },
    };
    await executeAction({ db: pool, action, module, ctx, bus: new EventBus(), llm: new StubLlmClient(), logger: ctx.logger, now });
    expect((await pool.query('SELECT count(*)::int AS count FROM jobs WHERE dedupe_key = $1', [`fake_follow_up:${paymentId}:1`])).rows[0]?.count).toBe(1);
    expect((await pool.query<{ payload: Record<string, unknown> }>('SELECT payload FROM jobs WHERE dedupe_key = $1', [`fake_follow_up:${paymentId}:1`])).rows[0]?.payload)
      .toMatchObject({ paymentId, step: 1 });
  });

  it('resumes an approved action left behind by a crashed worker', async () => {
    // Intent: a worker may commit an auto-approved action and exit before executeAction; the next delivery must recover
    // that durable row without proposing a second action or spending another model call (D-051).
    // Flow: project once -> persist an approved action -> retry the same event as an unapplied projection -> execute the
    // existing row through the advisory lock -> mark the event processed.
    const eventId = 'evt_orchestrator_crash_recovery';
    const paymentId = 'pay_orchestrator_crash_recovery';
    const payload = paymentPayload(paymentId, 'cus_fake_module');
    await insertEvent(pool, eventId, payload);
    await withTransaction(pool, (tx) => applyProjection(tx, payload, { eventId, eventAt: now }));
    await pool.query(`UPDATE webhook_events SET status = 'processing' WHERE event_id = $1`, [eventId]);
    const proposal = fakeProposal('fake_crash_recovery', paymentId);
    const persisted = await insertAction(pool, {
      proposal,
      triggerEventId: eventId,
      diagnosisId: null,
      bounds: [{ rule: 'fake', limit: true, actual: true, pass: true }],
      status: 'approved',
    });
    if (!persisted) throw new Error('expected approved action');
    const calls: string[] = [];
    const module = fakeModule('fake_crash_recovery', calls, proposal);
    const orchestrator = new EventOrchestrator({
      db: pool,
      llm: new StubLlmClient(),
      modules: [module],
      diagnostician: { diagnose: async () => fakeDiagnosis('skipped:fake-crash-recovery') },
      now: () => now,
      logger: { info: () => undefined, warn: () => undefined, error: () => undefined, debug: () => undefined },
    });

    const result = await orchestrator.handle(eventId, 'worker:orchestrator-recovery');
    expect(result.entity?.applied).toBe(false);
    expect(result.actions[0]?.status).toBe('executed');
    expect(calls).toEqual(['execute']);
    expect((await pool.query('SELECT status FROM actions WHERE id = $1', [persisted.id])).rows[0]?.status).toBe('executed');
    expect((await pool.query('SELECT status FROM webhook_events WHERE event_id = $1', [eventId])).rows[0]?.status).toBe('processed');
  });

  it('executes an approved action once across separate pool instances', async () => {
    const eventId = 'evt_orchestrator_execution_race';
    const paymentId = 'pay_orchestrator_execution_race';
    const payload = paymentPayload(paymentId, 'cus_fake_module');
    await insertEvent(pool, eventId, payload);
    const calls: string[] = [];
    const baseModule = fakeModule('fake_execution_race', calls, fakeProposal('fake_execution_race', paymentId, -300_000));
    const module: ActionModule = {
      ...baseModule,
      execute: async (_action, _ctx, _deps): Promise<ExecutionResult> => {
        calls.push('execute');
        await new Promise<void>((resolve) => setTimeout(resolve, 20));
        return { status: 'executed', result: { fake: true } };
      },
    };
    const orchestrator = new EventOrchestrator({
      db: pool,
      llm: new StubLlmClient(),
      modules: [module],
      diagnostician: { diagnose: async () => fakeDiagnosis('skipped:fake-race') },
      now: () => now,
      logger: { info: () => undefined, warn: () => undefined, error: () => undefined, debug: () => undefined },
    });

    const proposalResult = await orchestrator.handle(eventId, 'worker:orchestrator-test');
    const action = proposalResult.actions[0];
    if (!action || !proposalResult.entity) throw new Error('expected pending action and entity');
    await pool.query(`UPDATE actions SET status = 'approved' WHERE id = $1`, [action.id]);
    calls.length = 0;
    const config = await loadGuardrailConfig(pool);
    const ctx: EventContext = {
      event: {
        event_id: eventId,
        event_type: payload.event,
        payload,
        signature_valid: true,
        rzp_created_at: now,
        status: 'processed',
      },
      payload,
      entity: proposalResult.entity,
      diagnosis: proposalResult.diagnosis ?? null,
      config,
      now,
      logger: { info: () => undefined, warn: () => undefined, error: () => undefined, debug: () => undefined },
    };
    const poolTwo = new pg.Pool({ connectionString: databaseUrl, application_name: 'aegis-orchestrator-race', max: 2 });
    try {
      const results = await Promise.all([
        executeAction({ db: pool, action, module, ctx, bus: new EventBus(), llm: new StubLlmClient(), logger: ctx.logger, now }),
        executeAction({ db: poolTwo, action: action.id, module, ctx, bus: new EventBus(), llm: new StubLlmClient(), logger: ctx.logger, now }),
      ]);
      expect(results).toHaveLength(2);
      expect(results.every((result) => result?.status === 'executed')).toBe(true);
      expect(calls).toEqual(['execute']);
      expect((await pool.query('SELECT status FROM actions WHERE id = $1', [action.id])).rows[0]?.status).toBe('executed');
    } finally {
      await poolTwo.end();
    }
  });
});
