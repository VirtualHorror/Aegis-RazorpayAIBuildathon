import { config as loadDotenv } from 'dotenv';
import pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { buildApp } from '../src/app';
import { loadConfig } from '../src/config';
import { MIGRATIONS_DIR, REPO_ROOT_ENV } from '../src/db/paths';
import { migrateUp } from '../src/db/migrate';
import { computeSignature } from '../src/ingress/signature';
import { LlmUnavailableError, type LlmClient, type LlmJsonRequest, type LlmJsonResult } from '../src/llm/client';
import { ResilientLlmClient } from '../src/llm/resilient';

loadDotenv({ path: REPO_ROOT_ENV, quiet: true });

const databaseUrl = process.env.DATABASE_URL_TEST;
const integration = databaseUrl ? describe : describe.skip;
const secret = 'test_chaos_webhook_secret_16';

/**
 * `x-aegis-chaos: llm_down` must reach the LLM boundary through `AsyncLocalStorage` in development, and must be inert
 * in production (C-D5). The probe runs inside the ingress `onEvent` hook, which the handler awaits inside the chaos
 * context, so this exercises the real header -> request context -> resilient client path rather than the storage alone.
 */
function chaosApp(nodeEnv: 'development' | 'production', pool: pg.Pool, probe: () => Promise<void>) {
  return buildApp({
    config: loadConfig({
      DATABASE_URL: databaseUrl ?? 'postgres://aegis:pw@localhost:5432/aegis_test',
      RAZORPAY_WEBHOOK_SECRET: secret,
      NODE_ENV: nodeEnv,
      AEGIS_LLM_PROVIDER: 'stub',
    }),
    db: pool,
    probeDb: async () => ({ ok: true, latencyMs: 1 }),
    logger: false,
    onEvent: probe,
  });
}

const request: LlmJsonRequest<{ ok: boolean }> = {
  purpose: 'diagnose_payment_failure',
  system: 'system',
  user: 'user',
  schema: z.object({ ok: z.boolean() }),
};

function body(eventId: string): string {
  return JSON.stringify({
    entity: 'event',
    account_id: 'acc_chaos',
    event: 'payment.failed',
    contains: ['payment'],
    payload: { payment: { entity: { entity: 'payment', id: eventId, amount: 1000, currency: 'INR', status: 'failed' } } },
    created_at: 1_757_000_000,
  });
}

integration('development-only LLM chaos header', () => {
  let pool: pg.Pool;
  const apps: Array<Awaited<ReturnType<typeof buildApp>>> = [];

  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: databaseUrl, application_name: 'aegis-chaos-tests', max: 4 });
    await migrateUp(pool, MIGRATIONS_DIR, { info: () => undefined, warn: () => undefined });
  });

  beforeEach(async () => {
    await pool.query('TRUNCATE TABLE jobs, webhook_events RESTART IDENTITY CASCADE');
  });

  afterAll(async () => {
    for (const app of apps) await app.close();
    await pool?.end();
  });

  /** Records what the LLM boundary did for one request, and proves the provider was never reached under chaos. */
  async function inject(nodeEnv: 'development' | 'production', headers: Record<string, string>, eventId: string) {
    let providerCalls = 0;
    const inner: LlmClient = {
      provider: 'test',
      completeJson: async <T>(req: LlmJsonRequest<T>): Promise<LlmJsonResult<T>> => {
        providerCalls += 1;
        const parsed = req.schema.parse({ ok: true });
        return { data: parsed, provider: 'test', model: 'test-model', latencyMs: 1, tokensIn: 0, tokensOut: 0, raw: '{"ok":true}' };
      },
    };
    const llm = new ResilientLlmClient(inner);
    const outcome: { error?: string; ok?: boolean } = {};
    const app = await chaosApp(nodeEnv, pool, async () => {
      // Await twice before the call so the assertion also proves the context survives async boundaries.
      await Promise.resolve();
      await Promise.resolve();
      try {
        await llm.completeJson(request);
        outcome.ok = true;
      } catch (error) {
        outcome.error = error instanceof LlmUnavailableError ? error.reason : String(error);
      }
    });
    apps.push(app);
    const payload = body(eventId);
    const response = await app.inject({
      method: 'POST',
      url: '/webhooks/razorpay',
      headers: {
        'content-type': 'application/json',
        'x-razorpay-signature': computeSignature(Buffer.from(payload), secret),
        'x-razorpay-event-id': eventId,
        ...headers,
      },
      payload,
    });
    return { outcome, providerCalls, statusCode: response.statusCode };
  }

  it('forces LlmUnavailableError inside the request and never reaches the provider', async () => {
    const result = await inject('development', { 'x-aegis-chaos': 'llm_down' }, 'evt_chaos_dev');

    expect(result.statusCode).toBe(200);
    expect(result.outcome.error).toBe('chaos_llm_down');
    expect(result.providerCalls).toBe(0);
  });

  it('persists the development chaos mode on the process_event job for the worker', async () => {
    const result = await inject('development', { 'x-aegis-chaos': 'llm_down' }, 'evt_chaos_worker');

    expect(result.statusCode).toBe(200);
    const jobs = await pool.query<{ payload: Record<string, unknown> }>(
      "SELECT payload FROM jobs WHERE dedupe_key = 'process_event:evt_chaos_worker'",
    );
    expect(jobs.rows).toHaveLength(1);
    expect(jobs.rows[0]?.payload).toEqual({ eventId: 'evt_chaos_worker', chaos: 'llm_down' });
  });

  it('ignores the chaos header in production (C-D5)', async () => {
    const result = await inject('production', { 'x-aegis-chaos': 'llm_down' }, 'evt_chaos_prod');

    expect(result.statusCode).toBe(200);
    expect(result.outcome.ok).toBe(true);
    expect(result.providerCalls).toBe(1);
    const jobs = await pool.query<{ payload: Record<string, unknown> }>(
      "SELECT payload FROM jobs WHERE dedupe_key = 'process_event:evt_chaos_prod'",
    );
    expect(jobs.rows[0]?.payload).toEqual({ eventId: 'evt_chaos_prod' });
  });

  it('leaves the LLM path untouched when the header is absent', async () => {
    const result = await inject('development', {}, 'evt_chaos_none');

    expect(result.statusCode).toBe(200);
    expect(result.outcome.ok).toBe(true);
    expect(result.providerCalls).toBe(1);
  });

  it('does not leak the chaos context outside the request that carried the header', async () => {
    await inject('development', { 'x-aegis-chaos': 'llm_down' }, 'evt_chaos_leak');
    const after = new ResilientLlmClient({
      provider: 'test',
      completeJson: async <T>(req: LlmJsonRequest<T>): Promise<LlmJsonResult<T>> => ({
        data: req.schema.parse({ ok: true }),
        provider: 'test',
        model: 'test-model',
        latencyMs: 1,
        tokensIn: 0,
        tokensOut: 0,
        raw: '{"ok":true}',
      }),
    });

    await expect(after.completeJson(request)).resolves.toMatchObject({ data: { ok: true } });
  });
});
