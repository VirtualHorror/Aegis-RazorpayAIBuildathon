import { config as loadDotenv } from 'dotenv';
import pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../app';
import { EventBus } from '../bus/event-bus';
import { loadConfig } from '../config';
import { MIGRATIONS_DIR, REPO_ROOT_ENV } from '../db/paths';
import { migrateUp } from '../db/migrate';
import { signPayment } from './canonical';
import { GUARDRAIL_DEFAULTS } from '../../../../db/seed/data/guardrails';

loadDotenv({ path: REPO_ROOT_ENV, quiet: true });
const databaseUrl = process.env.DATABASE_URL_TEST;
const integration = databaseUrl ? describe : describe.skip;
const secret = 'x402_routes_test_secret';
const config = loadConfig({ DATABASE_URL: databaseUrl ?? 'postgres://aegis:test@localhost:5432/aegis_test', RAZORPAY_WEBHOOK_SECRET: 'test_webhook_secret_16', NODE_ENV: 'test', X402_SIM_SECRET: secret, X402_PAY_TO: 'merchant:aegis-demo' });

integration('x402 HTTP routes', () => {
  let pool: pg.Pool;
  let app: Awaited<ReturnType<typeof buildApp>>;

  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: databaseUrl, application_name: 'aegis-x402-route-tests', max: 8 });
    await migrateUp(pool, MIGRATIONS_DIR, { info: () => undefined, warn: () => undefined });
    app = await buildApp({ config, db: pool, probeDb: async () => ({ ok: true, latencyMs: 1 }), bus: new EventBus(), logger: false });
  });
  beforeEach(async () => {
    await pool.query('TRUNCATE TABLE x402_payments, products, ledger_entries, audit_log CASCADE');
    for (const item of GUARDRAIL_DEFAULTS) {
      await pool.query(`INSERT INTO guardrail_config (key, value, description, updated_by) VALUES ($1, $2::jsonb, $3, 'route-test') ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value, description=EXCLUDED.description, updated_by='route-test'`, [item.key, JSON.stringify(item.value), item.description]);
    }
    await pool.query(`INSERT INTO products (id, merchant_id, name, description, category, price_paise, currency, active, agent_purchasable) VALUES ('prod_route', 'merchant:test', 'Route Product', 'A paid route fixture', 'test', 49900, 'INR', true, true)`);
  });
  afterAll(async () => { await app?.close(); await pool?.end(); });

  it('returns the exact 402 challenge shape, then settles and returns the resource', async () => {
    const challengeResponse = await app.inject({ method: 'GET', url: '/x402/products/prod_route/spec' });
    expect(challengeResponse.statusCode).toBe(402);
    const challenge = challengeResponse.json() as { x402Version: number; error: string; accepts: Array<Record<string, unknown>> };
    expect(challenge).toMatchObject({ x402Version: 1, error: 'X-PAYMENT header is required' });
    const accepted = challenge.accepts[0];
    if (!accepted) throw new Error('challenge has no accepts entry');
    expect(accepted).toMatchObject({ scheme: 'exact', network: 'aegis-sim', maxAmountRequired: '49900', description: 'Route Product', mimeType: 'application/json', payTo: 'merchant:aegis-demo', maxTimeoutSeconds: 60, asset: 'INR' });
    const extra = accepted.extra as { nonce: string; expiresAt: string; simulated: boolean };
    const issuedAt = '2026-09-05T12:00:00.000Z';
    const unsigned = { nonce: extra.nonce, amount: '49900', asset: 'INR', payTo: 'merchant:aegis-demo', payer: 'agent:route', issuedAt } as const;
    const encoded = Buffer.from(JSON.stringify({ x402Version: 1, scheme: 'exact', network: 'aegis-sim', payload: { ...unsigned, signature: signPayment(unsigned, secret) } })).toString('base64');
    const paid = await app.inject({ method: 'GET', url: '/x402/products/prod_route/spec', headers: { 'x-payment': encoded } });
    expect(paid.statusCode).toBe(200);
    expect(paid.json()).toMatchObject({ id: 'prod_route', pricePaise: 49900 });
    const response = paid.headers['x-payment-response'];
    expect(typeof response).toBe('string');
    expect(JSON.parse(Buffer.from(response as string, 'base64').toString('utf8'))).toMatchObject({ success: true, network: 'aegis-sim', txId: expect.any(String), settledAt: expect.any(String) });
  });

  it('returns invalid_payment_header for malformed or schema-invalid payment headers', async () => {
    const response = await app.inject({ method: 'GET', url: '/x402/products/prod_route/spec', headers: { 'x-payment': 'not-base64-json' } });
    expect(response.statusCode).toBe(402);
    expect(response.json()).toEqual({ x402Version: 1, error: 'invalid_payment_header' });
  });

  it('keeps the free catalog outside the payment middleware', async () => {
    const response = await app.inject({ method: 'GET', url: '/x402/catalog' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ items: [{ id: 'prod_route', price_paise: 49900 }] });
  });
});
