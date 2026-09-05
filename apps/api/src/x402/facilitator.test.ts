import { config as loadDotenv } from 'dotenv';
import pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { GUARDRAIL_DEFAULTS } from '../../../../db/seed/data/guardrails';
import { MIGRATIONS_DIR, REPO_ROOT_ENV } from '../db/paths';
import { migrateUp } from '../db/migrate';
import { EventBus } from '../bus/event-bus';
import { loadConfig } from '../config';
import { signPayment } from './canonical';
import { verifyAndSettle, X402Error, X402PausedError } from './facilitator';
import type { X402Payload } from './types';

loadDotenv({ path: REPO_ROOT_ENV, quiet: true });
const databaseUrl = process.env.DATABASE_URL_TEST;
const integration = databaseUrl ? describe : describe.skip;
const secret = 'x402_test_secret_12345';
const config = loadConfig({ DATABASE_URL: databaseUrl ?? 'postgres://aegis:test@localhost:5432/aegis_test', RAZORPAY_WEBHOOK_SECRET: 'test_webhook_secret_16', NODE_ENV: 'test', X402_SIM_SECRET: secret, X402_PAY_TO: 'merchant:aegis-demo' });

async function seedGuardrails(pool: pg.Pool): Promise<void> {
  for (const item of GUARDRAIL_DEFAULTS) {
    await pool.query(`INSERT INTO guardrail_config (key, value, description, updated_by) VALUES ($1, $2::jsonb, $3, 'test')`, [item.key, JSON.stringify(item.value), item.description]);
  }
}

async function challenge(pool: pg.Pool, nonce: string, amount = 49900, payer: string | null = null, expiresAt = new Date(Date.now() + 60_000)): Promise<string> {
  const result = await pool.query<{ id: string }>(
    `INSERT INTO x402_payments (nonce, resource, method, payer, amount_paise, status, expires_at) VALUES ($1, $2, 'GET', $3, $4, 'challenged', $5) RETURNING id`,
    [nonce, 'http://localhost:4000/x402/products/prod_001/spec', payer, amount, expiresAt],
  );
  const id = result.rows[0]?.id;
  if (!id) throw new Error('challenge insert failed');
  return id;
}

function payment(nonce: string, amount: string, payer = 'agent:test', issuedAt = '2026-09-05T12:00:00.000Z'): X402Payload {
  const unsigned = { nonce, amount, asset: 'INR', payTo: config.X402_PAY_TO, payer, issuedAt } as const;
  return { ...unsigned, signature: signPayment(unsigned, secret) };
}

integration('x402 facilitator', () => {
  let pool: pg.Pool;
  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: databaseUrl, application_name: 'aegis-x402-tests', max: 16 });
    await migrateUp(pool, MIGRATIONS_DIR, { info: () => undefined, warn: () => undefined });
  });
  beforeEach(async () => {
    await pool.query('TRUNCATE TABLE x402_payments, ledger_entries, audit_log, guardrail_config CASCADE');
    await seedGuardrails(pool);
  });
  afterAll(async () => { await pool?.end(); });

  it('settles a valid payment and writes the ledger/audit rows', async () => {
    await challenge(pool, 'nonce_happy');
    const bus = new EventBus();
    const names: string[] = [];
    bus.subscribe((event) => names.push(event.name));
    const result = await verifyAndSettle(pool, payment('nonce_happy', '49900'), 49900, config, bus, { resource: 'http://localhost:4000/x402/products/prod_001/spec', method: 'GET' });
    expect(result.txId).toEqual(expect.any(String));
    expect(names).toEqual(['x402.settled']);
    expect((await pool.query(`SELECT status, amount_paise, payer FROM x402_payments WHERE nonce='nonce_happy'`)).rows[0]).toMatchObject({ status: 'settled', amount_paise: 49900, payer: 'agent:test' });
    expect((await pool.query(`SELECT account, ref_type, credit_paise FROM ledger_entries`)).rows).toMatchObject([{ account: 'x402_revenue', ref_type: 'x402_payment', credit_paise: 49900 }]);
  });

  it('rejects replay, expiry, tampered signatures, and policy caps with exact reasons', async () => {
    await challenge(pool, 'nonce_replay');
    await verifyAndSettle(pool, payment('nonce_replay', '49900'), 49900, config, new EventBus(), { resource: 'http://localhost:4000/x402/products/prod_001/spec', method: 'GET' });
    await expect(verifyAndSettle(pool, payment('nonce_replay', '49900'), 49900, config, new EventBus(), { resource: 'http://localhost:4000/x402/products/prod_001/spec', method: 'GET' })).rejects.toMatchObject({ reason: 'nonce_already_settled' });

    await challenge(pool, 'nonce_expired', 49900, null, new Date(Date.now() - 1_000));
    await expect(verifyAndSettle(pool, payment('nonce_expired', '49900'), 49900, config, new EventBus())).rejects.toMatchObject({ reason: 'nonce_expired' });
    expect((await pool.query(`SELECT status FROM x402_payments WHERE nonce='nonce_expired'`)).rows[0]?.status).toBe('expired');

    await challenge(pool, 'nonce_tampered');
    const signed = payment('nonce_tampered', '49900');
    await expect(verifyAndSettle(pool, { ...signed, amount: '59900' }, 49900, config, new EventBus())).rejects.toMatchObject({ reason: 'bad_signature' });

    await challenge(pool, 'nonce_request_cap', 100);
    await pool.query(`UPDATE guardrail_config SET value='500'::jsonb WHERE key='x402_max_amount_paise'`);
    await expect(verifyAndSettle(pool, payment('nonce_request_cap', '600'), 100, config, new EventBus())).rejects.toMatchObject({ reason: 'amount_exceeds_policy' });

    await challenge(pool, 'nonce_daily', 100);
    await pool.query(`INSERT INTO x402_payments (nonce, resource, method, payer, amount_paise, status, expires_at) VALUES ('nonce_prior', 'r', 'GET', 'agent:test', 499950, 'settled', now() + interval '1 hour')`);
    await expect(verifyAndSettle(pool, payment('nonce_daily', '100'), 100, config, new EventBus())).rejects.toMatchObject({ reason: 'payer_daily_cap_exceeded' });
  });

  it('allows only one concurrent settlement for a nonce', async () => {
    await challenge(pool, 'nonce_race');
    const input = { db: pool, payload: payment('nonce_race', '49900'), requiredPaise: 49900, config, bus: new EventBus(), requestContext: { resource: 'http://localhost:4000/x402/products/prod_001/spec', method: 'GET' } } as const;
    const results = await Promise.allSettled([
      verifyAndSettle(input.db, input.payload, input.requiredPaise, input.config, input.bus, input.requestContext),
      verifyAndSettle(input.db, input.payload, input.requiredPaise, input.config, input.bus, input.requestContext),
    ]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((result) => result.status === 'rejected' && result.reason instanceof X402Error && result.reason.reason === 'nonce_already_settled')).toHaveLength(1);
    expect((await pool.query(`SELECT count(*)::int AS count FROM ledger_entries WHERE account='x402_revenue'`)).rows[0]?.count).toBe(1);
  });

  it('honours the guardrail kill switch without consuming the challenge', async () => {
    await challenge(pool, 'nonce_paused');
    await pool.query(`UPDATE guardrail_config SET value='true'::jsonb WHERE key='kill_switch'`);
    await expect(verifyAndSettle(pool, payment('nonce_paused', '49900'), 49900, config, new EventBus())).rejects.toBeInstanceOf(X402PausedError);
    expect((await pool.query(`SELECT status FROM x402_payments WHERE nonce='nonce_paused'`)).rows[0]?.status).toBe('challenged');
  });
});
