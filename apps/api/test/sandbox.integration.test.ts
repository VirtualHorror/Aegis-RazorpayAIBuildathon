import { config as loadDotenv } from 'dotenv';
import pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app';
import { loadConfig } from '../src/config';
import { StubLlmClient } from '../src/llm/stub';
import type { LlmClient, LlmJsonRequest, LlmJsonResult } from '../src/llm/client';
import type { ByokLlmResolver } from '../src/llm/byok';
import { EventOrchestrator } from '../src/orchestrator/EventOrchestrator';
import { MIGRATIONS_DIR, REPO_ROOT_ENV } from '../src/db/paths';
import { migrateUp } from '../src/db/migrate';
import { computeSignature } from '../src/ingress/signature';
import { secretFingerprint } from '../src/sandbox/keys';
import { GUARDRAIL_DEFAULTS } from '../../../db/seed/data/guardrails';

loadDotenv({ path: REPO_ROOT_ENV, quiet: true });

const databaseUrl = process.env.DATABASE_URL_TEST;
const integration = databaseUrl ? describe : describe.skip;
const envSecret = 'test_webhook_secret_16';
const logger = { info: () => undefined, warn: () => undefined, error: () => undefined, debug: () => undefined };
const config = loadConfig({
  DATABASE_URL: databaseUrl ?? 'postgres://aegis:pw@localhost:5432/aegis_test',
  RAZORPAY_WEBHOOK_SECRET: envSecret,
  NODE_ENV: 'test',
});

/** The `aegis_readonly` credentials point at the development database; aim them at the test database instead. */
function readonlyTestUrl(): string | null {
  const readonly = process.env.DATABASE_URL_READONLY;
  if (!readonly || !databaseUrl) return null;
  const url = new URL(readonly);
  url.pathname = new URL(databaseUrl).pathname;
  return url.toString();
}

/** A stub that reports a distinguishable provider, so a test can tell which client actually served a request. */
class LabelledLlmClient implements LlmClient {
  readonly provider: string;
  private readonly inner = new StubLlmClient();

  constructor(provider: string) {
    this.provider = provider;
  }

  async completeJson<T>(req: LlmJsonRequest<T>): Promise<LlmJsonResult<T>> {
    const result = await this.inner.completeJson(req);
    return { ...result, provider: this.provider };
  }
}

function eventBody(accountId: string): string {
  return JSON.stringify({
    entity: 'event',
    account_id: accountId,
    event: 'payment.failed',
    contains: ['payment'],
    payload: { payment: { entity: { entity: 'payment', id: 'pay_sandbox_001', amount: 149900, currency: 'INR', status: 'failed' } } },
    created_at: 1_757_000_000,
  });
}

integration('T25 sandbox / BYOK keys', () => {
  let pool: pg.Pool;
  let app: Awaited<ReturnType<typeof buildApp>>;

  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: databaseUrl, application_name: 'aegis-t25-tests', max: 10 });
    await migrateUp(pool, MIGRATIONS_DIR, { info: () => undefined, warn: () => undefined });
    const orchestrator = new EventOrchestrator({ db: pool, llm: new StubLlmClient(), modules: [], logger });
    app = await buildApp({ config, db: pool, probeDb: async () => ({ ok: true, latencyMs: 1 }), orchestrator, llm: new StubLlmClient(), logger: false });
  });

  beforeEach(async () => {
    await pool.query('TRUNCATE TABLE jobs, webhook_events, audit_log, guardrail_config CASCADE');
    for (const guardrail of GUARDRAIL_DEFAULTS) {
      await pool.query(`INSERT INTO guardrail_config (key, value, description, updated_by) VALUES ($1, $2::jsonb, $3, 'test')`, [
        guardrail.key,
        JSON.stringify(guardrail.value),
        guardrail.description,
      ]);
    }
  });

  afterAll(async () => {
    await app?.close();
    await pool?.end();
  });

  it('stores the secret under sandbox_secret_<account_id> and answers with a fingerprint, never the secret', async () => {
    const secret = 'whsec_tenant_alpha_secret';
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/sandbox/keys',
      payload: { account_id: 'acc_alpha', webhook_secret: secret, actor: 'human:test' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      sandbox: { account_id: 'acc_alpha', key: 'sandbox_secret_acc_alpha', webhook_secret_fingerprint: secretFingerprint(secret), updated_by: 'human:test' },
    });
    expect(response.body).not.toContain(secret);

    const stored = await pool.query<{ value: string; description: string }>('SELECT value, description FROM guardrail_config WHERE key = $1', [
      'sandbox_secret_acc_alpha',
    ]);
    expect(stored.rows[0]?.value).toBe(secret);
  });

  it('rotates the secret in place instead of creating a second row', async () => {
    await app.inject({ method: 'POST', url: '/api/v1/sandbox/keys', payload: { account_id: 'acc_alpha', webhook_secret: 'whsec_first_secret', actor: 'human:test' } });
    const second = await app.inject({ method: 'POST', url: '/api/v1/sandbox/keys', payload: { account_id: 'acc_alpha', webhook_secret: 'whsec_second_secret', actor: 'human:test' } });

    expect(second.statusCode).toBe(200);
    expect(second.json()).toMatchObject({ sandbox: { webhook_secret_fingerprint: secretFingerprint('whsec_second_secret') } });
    const rows = await pool.query<{ count: number; value: string }>(
      "SELECT count(*)::int AS count, min(value #>> '{}') AS value FROM guardrail_config WHERE key LIKE 'sandbox\\_secret\\_%'",
    );
    expect(rows.rows[0]).toMatchObject({ count: 1, value: 'whsec_second_secret' });
  });

  it('rejects an account id or secret it would not be safe to store', async () => {
    const badAccount = await app.inject({ method: 'POST', url: '/api/v1/sandbox/keys', payload: { account_id: "acc'; DROP TABLE guardrail_config; --", webhook_secret: 'whsec_valid_secret' } });
    const shortSecret = await app.inject({ method: 'POST', url: '/api/v1/sandbox/keys', payload: { account_id: 'acc_alpha', webhook_secret: 'short' } });
    const spacedSecret = await app.inject({ method: 'POST', url: '/api/v1/sandbox/keys', payload: { account_id: 'acc_alpha', webhook_secret: 'whsec with spaces' } });

    expect(badAccount.statusCode).toBe(400);
    expect(shortSecret.statusCode).toBe(400);
    expect(spacedSecret.statusCode).toBe(400);
    expect((await pool.query("SELECT count(*)::int AS count FROM guardrail_config WHERE key LIKE 'sandbox\\_secret\\_%'")).rows[0]?.count).toBe(0);
  });

  it('keeps sandbox secrets out of the guardrails the settings page lists', async () => {
    await app.inject({ method: 'POST', url: '/api/v1/sandbox/keys', payload: { account_id: 'acc_alpha', webhook_secret: 'whsec_tenant_alpha_secret' } });

    const listed = await app.inject({ method: 'GET', url: '/api/v1/guardrails' });
    const items = listed.json<{ items: { key: string }[] }>().items;

    expect(items.length).toBe(GUARDRAIL_DEFAULTS.length);
    expect(items.some((item) => item.key.startsWith('sandbox_secret_'))).toBe(false);
    expect(listed.body).not.toContain('whsec_tenant_alpha_secret');
  });

  it('audits the save without writing the secret into audit_log', async () => {
    await app.inject({ method: 'POST', url: '/api/v1/sandbox/keys', payload: { account_id: 'acc_alpha', webhook_secret: 'whsec_tenant_alpha_secret', actor: 'human:test' } });

    const audit = await pool.query<{ actor: string; action: string; entity_type: string; entity_id: string; metadata: Record<string, unknown> }>(
      'SELECT actor, action, entity_type, entity_id, metadata, before, after FROM audit_log',
    );
    expect(audit.rows).toHaveLength(1);
    expect(audit.rows[0]).toMatchObject({ actor: 'human:test', action: 'sandbox.keys_saved', entity_type: 'sandbox_key', entity_id: 'sandbox_secret_acc_alpha' });
    expect(JSON.stringify(audit.rows[0])).not.toContain('whsec_tenant_alpha_secret');
    expect(audit.rows[0]?.metadata).toMatchObject({ webhook_secret_fingerprint: secretFingerprint('whsec_tenant_alpha_secret') });
  });

  it('accepts a live webhook signed with the secret registered through the API', async () => {
    const secret = 'whsec_tenant_alpha_secret';
    await app.inject({ method: 'POST', url: '/api/v1/sandbox/keys', payload: { account_id: 'acc_alpha', webhook_secret: secret } });

    const body = eventBody('acc_alpha');
    const delivered = await app.inject({
      method: 'POST',
      url: '/webhooks/razorpay',
      headers: { 'content-type': 'application/json', 'x-razorpay-signature': computeSignature(Buffer.from(body), secret), 'x-razorpay-event-id': 'evt_sandbox_live' },
      payload: body,
    });

    expect(delivered.statusCode).toBe(200);
    expect(delivered.json()).toMatchObject({ status: 'accepted', event_id: 'evt_sandbox_live' });
    expect((await pool.query("SELECT count(*)::int AS count FROM jobs WHERE dedupe_key = 'process_event:evt_sandbox_live'")).rows[0]?.count).toBe(1);
  });

  it.skipIf(readonlyTestUrl() === null)('hides sandbox secrets from the read-only role model-authored SQL runs as', async () => {
    await app.inject({ method: 'POST', url: '/api/v1/sandbox/keys', payload: { account_id: 'acc_alpha', webhook_secret: 'whsec_tenant_alpha_secret' } });

    const readonlyPool = new pg.Pool({ connectionString: readonlyTestUrl() ?? undefined, application_name: 'aegis-t25-readonly', max: 2 });
    try {
      const visible = await readonlyPool.query<{ key: string }>('SELECT key FROM guardrail_config ORDER BY key');
      expect(visible.rows.some((row) => row.key.startsWith('sandbox_secret_'))).toBe(false);
      expect(visible.rows.some((row) => row.key === 'kill_switch')).toBe(true);
      const targeted = await readonlyPool.query("SELECT value FROM guardrail_config WHERE key = 'sandbox_secret_acc_alpha'");
      expect(targeted.rows).toHaveLength(0);
    } finally {
      await readonlyPool.end();
    }
  });

  describe('caller-supplied model key', () => {
    const callerKey = 'sk-proj-caller-key-0123456789';
    const bootLlm = new LabelledLlmClient('boot');
    const callerLlm = new LabelledLlmClient('caller');
    const remembered = new Map<string, LlmClient>();
    const byok: ByokLlmResolver = {
      clientFor: () => callerLlm,
      remember: (apiKey) => {
        const fingerprint = secretFingerprint(apiKey);
        remembered.set(fingerprint, callerLlm);
        return fingerprint;
      },
      byFingerprint: (fingerprint) => remembered.get(fingerprint) ?? null,
    };
    let byokApp: Awaited<ReturnType<typeof buildApp>>;

    beforeAll(async () => {
      const orchestrator = new EventOrchestrator({ db: pool, llm: bootLlm, modules: [], logger });
      byokApp = await buildApp({ config, db: pool, probeDb: async () => ({ ok: true, latencyMs: 1 }), orchestrator, llm: bootLlm, byok, logger: false });
    });

    afterAll(async () => {
      await byokApp?.close();
    });

    it('answers Ask Aegis with the boot client when no key is supplied', async () => {
      const response = await byokApp.inject({ method: 'POST', url: '/api/v1/ask', payload: { question: 'How many payments failed today?' } });

      expect(response.statusCode).toBe(200);
      const row = await pool.query<{ provider: string }>('SELECT provider FROM nl_queries ORDER BY created_at DESC LIMIT 1');
      expect(row.rows[0]?.provider).toBe('boot');
    });

    it('answers Ask Aegis with the caller key client when x-aegis-llm-key is present', async () => {
      const response = await byokApp.inject({
        method: 'POST',
        url: '/api/v1/ask',
        headers: { 'x-aegis-llm-key': callerKey },
        payload: { question: 'How many payments failed today?' },
      });

      expect(response.statusCode).toBe(200);
      const row = await pool.query<{ provider: string }>('SELECT provider FROM nl_queries ORDER BY created_at DESC LIMIT 1');
      expect(row.rows[0]?.provider).toBe('caller');
    });

    it('queues a manual compliance scan carrying only the fingerprint of the caller key', async () => {
      const response = await byokApp.inject({ method: 'POST', url: '/api/v1/compliance/scan', headers: { 'x-aegis-llm-key': callerKey } });

      expect(response.statusCode).toBe(202);
      const job = await pool.query<{ payload: Record<string, unknown> }>("SELECT payload FROM jobs WHERE kind = 'compliance_scan' ORDER BY id DESC LIMIT 1");
      expect(job.rows[0]?.payload).toMatchObject({ llmKeyFingerprint: secretFingerprint(callerKey) });
      expect(JSON.stringify(job.rows[0]?.payload)).not.toContain(callerKey);
    });
  });
});
