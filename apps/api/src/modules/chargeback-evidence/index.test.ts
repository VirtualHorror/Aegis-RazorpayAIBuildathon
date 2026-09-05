import { config as loadDotenv } from 'dotenv';
import pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { migrateUp } from '../../db/migrate';
import { MIGRATIONS_DIR, REPO_ROOT_ENV } from '../../db/paths';
import { StubLlmClient } from '../../llm/stub';
import { EventBus } from '../../bus/event-bus';
import type { CustomerRow } from '../../db/repos/customers';
import type { ActionRow, EventContext, ExecutionDeps, Logger } from '../../orchestrator/types';
import type { GuardrailConfig } from '../../guardrails/types';
import { ChargebackEvidence } from './index';

loadDotenv({ path: REPO_ROOT_ENV, quiet: true });
const databaseUrl = process.env.DATABASE_URL_TEST;
const integration = databaseUrl ? describe : describe.skip;
const logger: Logger = { info: () => undefined, warn: () => undefined, error: () => undefined, debug: () => undefined };
const config: GuardrailConfig = { kill_switch: false, auto_approve_limit_paise: 200000, max_discount_pct: 15, max_negotiation_rounds: 3, max_dunning_retries: 3, dunning_schedule_hours: [24, 72, 168], message_cooldown_hours: 24, quiet_hours_local: { start: 21, end: 8 }, daily_discount_budget_paise: 5000000, attribution_window_hours: 72, x402_max_amount_paise: 100000, x402_daily_cap_per_payer_paise: 500000 };
const customer: CustomerRow = { id: 'cus_evidence_module_test', name: 'Customer', email: 'buyer@example.test', contact: '+919876543210', country: 'IN', locale: 'en-IN', opted_out: false, notes: {}, created_at: new Date('2026-09-01T00:00:00Z'), updated_at: new Date('2026-09-01T00:00:00Z') };

function context(): EventContext {
  return {
    event: { event_id: 'evt_evidence_module_test', event_type: 'payment.dispute.created', payload: {}, signature_valid: true, rzp_created_at: new Date('2026-09-04T00:00:00Z'), status: 'processed' },
    payload: { entity: 'event', event: 'payment.dispute.created', contains: ['dispute'], payload: {}, created_at: 1 },
    entity: { type: 'dispute', row: { id: 'disp_evidence_module_test', version: 1, status: 'open', phase: 'retrieval', amount_paise: 899900, payment_id: 'pay_evidence_module_test' }, customer, applied: true },
    diagnosis: null,
    config,
    now: new Date('2026-09-05T00:00:00Z'),
    logger,
  };
}

integration('chargeback evidence module', () => {
  let pool: pg.Pool;
  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: databaseUrl, application_name: 'aegis-evidence-module-tests', max: 4 });
    await migrateUp(pool, MIGRATIONS_DIR, { info: () => undefined, warn: () => undefined });
  });
  beforeEach(async () => {
    await pool.query('TRUNCATE TABLE evidence_packets, outbound_messages, actions, disputes, payments, orders, customers, webhook_events CASCADE');
    await pool.query(`INSERT INTO customers (id, country, locale, created_at) VALUES ('cus_evidence_module_test', 'IN', 'en-IN', '2026-09-01T00:00:00Z')`);
    await pool.query(`INSERT INTO payments (id, customer_id, amount_paise, currency, status, status_rank) VALUES ('pay_evidence_module_test', 'cus_evidence_module_test', 899900, 'INR', 'captured', 2)`);
    await pool.query(`INSERT INTO disputes (id, payment_id, amount_paise, currency, phase, status, created_at) VALUES ('disp_evidence_module_test', 'pay_evidence_module_test', 899900, 'INR', 'retrieval', 'open', '2026-09-04T00:00:00Z')`);
  });
  afterAll(async () => { await pool?.end(); });

  it('proposes a packet that always requires human approval', async () => {
    const module = new ChargebackEvidence({ db: pool, llm: new StubLlmClient() });
    const proposal = await module.propose(context());
    expect(proposal).toMatchObject({ kind: 'evidence_packet', requiresApproval: true, moneyImpactPaise: 0, expectedRecoveryPaise: 899900 });
    expect((proposal?.payload as Record<string, unknown> | undefined)?.packet).toBeDefined();
    expect(await pool.query(`SELECT count(*)::int AS count FROM evidence_packets`)).toMatchObject({ rows: [{ count: 0 }] });
  });

  it('persists through onProposed and refuses execution before approval', async () => {
    const module = new ChargebackEvidence({ db: pool, llm: new StubLlmClient() });
    const proposal = await module.propose(context());
    if (!proposal) throw new Error('proposal missing');
    const action = { id: '00000000-0000-4000-8000-000000000002', entity_id: proposal.entityId, proposal } as unknown as ActionRow;
    await module.onProposed?.(action, context(), pool);
    expect((await pool.query(`SELECT review_status FROM evidence_packets WHERE dispute_id = 'disp_evidence_module_test'`)).rows[0]?.review_status).toBe('requires_human_review');
    const deps: ExecutionDeps = { db: pool, bus: new EventBus(), llm: new StubLlmClient(), now: new Date('2026-09-05T00:00:00Z'), logger };
    await expect(module.execute(action, context(), deps)).rejects.toThrow('evidence_requires_approval');
    await pool.query(`UPDATE evidence_packets SET review_status = 'approved' WHERE dispute_id = 'disp_evidence_module_test'`);
    const result = await module.execute(action, context(), deps);
    expect(result).toMatchObject({ status: 'executed', result: { reviewStatus: 'submitted' } });
  });
});
