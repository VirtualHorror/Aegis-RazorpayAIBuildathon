import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app';
import { loadConfig } from '../src/config';
import type { DbProbeResult } from '../src/db/pool';

const config = loadConfig({ DATABASE_URL: 'postgres://aegis:pw@localhost:5432/aegis', NODE_ENV: 'test' });
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
