import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app';
import { loadConfig } from '../src/config';
import type { DbProbeResult } from '../src/db/pool';

const config = loadConfig({
  DATABASE_URL: 'postgres://aegis:pw@localhost:5432/aegis',
  RAZORPAY_WEBHOOK_SECRET: 'test_webhook_secret_16',
  NODE_ENV: 'test',
});
let app: Awaited<ReturnType<typeof buildApp>> | undefined;
afterEach(async () => {
  await app?.close();
});

async function appWithProbe(result: DbProbeResult) {
  app = await buildApp({ config, probeDb: async () => result, logger: false });
  return app;
}

describe('GET /health', () => {
  it('reports ok when the database answers', async () => {
    const res = await (await appWithProbe({ ok: true, latencyMs: 3 })).inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ status: 'ok', db: 'ok', db_latency_ms: 3, version: expect.any(String) });
  });
  it('stays up and reports degraded when the database is unreachable', async () => {
    const res = await (await appWithProbe({ ok: false, latencyMs: 1500, error: 'ECONNREFUSED' })).inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ status: 'degraded', db: 'unavailable', error: 'ECONNREFUSED' });
  });
});

describe('error shape', () => {
  it('returns a consistent 404 body with a request id', async () => {
    const res = await (await appWithProbe({ ok: true, latencyMs: 1 })).inject({ method: 'GET', url: '/nope' });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toMatchObject({ error: 'not_found', request_id: expect.any(String) });
  });
});

describe('simulation route guard', () => {
  it('refuses a run whose burst and dupes multiply past the route cap', async () => {
    // Intent: the development route is unauthenticated, and `burst` x `dupes` is what actually decides how much work one
    //         request schedules -- 10,000 x 1,000 is inside both individual bounds and would wedge the API.
    // Flow: ask for an oversized run -> expect a 400 before any delivery is injected into the ingress.
    const response = await (await appWithProbe({ ok: true, latencyMs: 1 })).inject({
      method: 'POST',
      url: '/api/v1/sim/run',
      payload: { scenario: 'burst', burst: 10_000, dupes: 1_000 },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ error: 'simulation_too_large' });
  });

  it('does not mount the simulator in production', async () => {
    const productionConfig = loadConfig({
      DATABASE_URL: 'postgres://aegis:pw@localhost:5432/aegis',
      RAZORPAY_WEBHOOK_SECRET: 'test_webhook_secret_16',
      NODE_ENV: 'production',
    });
    const productionApp = await buildApp({ config: productionConfig, probeDb: async () => ({ ok: true, latencyMs: 1 }), logger: false });
    try {
      const response = await productionApp.inject({ method: 'POST', url: '/api/v1/sim/run', payload: { scenario: 'all' } });
      expect(response.statusCode).toBe(404);
    } finally {
      await productionApp.close();
    }
  });
});
