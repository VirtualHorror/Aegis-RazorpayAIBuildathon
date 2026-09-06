import { createHash } from 'node:crypto';
import { config as loadDotenv } from 'dotenv';
import pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app';
import { loadConfig } from '../src/config';
import { MIGRATIONS_DIR, REPO_ROOT_ENV } from '../src/db/paths';
import { migrateUp } from '../src/db/migrate';
import { computeSignature } from '../src/ingress/signature';

loadDotenv({ path: REPO_ROOT_ENV, quiet: true });

const databaseUrl = process.env.DATABASE_URL_TEST;
const integration = databaseUrl ? describe : describe.skip;
const secret = 'test_webhook_secret_16';
const config = loadConfig({
  DATABASE_URL: databaseUrl ?? 'postgres://aegis:pw@localhost:5432/aegis_test',
  RAZORPAY_WEBHOOK_SECRET: secret,
  NODE_ENV: 'test',
});

interface IngressResponse {
  status: string;
  event_id?: string;
  duplicate_count?: number;
  error?: string;
}

function paymentBody(event = 'payment.failed', accountId = 'acc_test'): string {
  return JSON.stringify({
    entity: 'event',
    account_id: accountId,
    event,
    contains: ['payment'],
    payload: {
      payment: {
        entity: {
          entity: 'payment',
          id: 'pay_test_001',
          amount: 149900,
          currency: 'INR',
          status: 'failed',
          order_id: 'order_test_001',
          error_step: 'payment_authentication',
        },
      },
    },
    created_at: 1_757_000_000,
  });
}

function signedHeaders(body: string, eventId?: string, signature = computeSignature(Buffer.from(body), secret)) {
  return {
    'content-type': 'application/json',
    'x-razorpay-signature': signature,
    ...(eventId ? { 'x-razorpay-event-id': eventId } : {}),
  };
}

integration('Razorpay webhook ingress', () => {
  let pool: pg.Pool;
  let app: Awaited<ReturnType<typeof buildApp>>;

  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: databaseUrl, application_name: 'aegis-ingress-tests', max: 10 });
    await migrateUp(pool, MIGRATIONS_DIR, { info: () => undefined, warn: () => undefined });
    app = await buildApp({
      config,
      db: pool,
      probeDb: async () => ({ ok: true, latencyMs: 1 }),
      logger: false,
    });
  });

  beforeEach(async () => {
    // Intent: each assertion starts from an empty outbox so counts prove this test's transaction behavior alone.
    // Flow: truncate event/job rows -> reset the job sequence -> inject requests against the real PostgreSQL schema.
    await pool.query('TRUNCATE TABLE jobs, webhook_events RESTART IDENTITY CASCADE');
  });

  afterAll(async () => {
    await app?.close();
    await pool?.end();
  });

  it('persists a verified event and exactly one process job', async () => {
    const body = paymentBody();
    const response = await app.inject({
      method: 'POST',
      url: '/webhooks/razorpay',
      headers: signedHeaders(body, 'evt_ingress_001'),
      payload: body,
    });
    expect(response.statusCode).toBe(200);
    expect(response.json<IngressResponse>()).toMatchObject({ status: 'accepted', event_id: 'evt_ingress_001', duplicate_count: 0 });

    const event = await pool.query<{ count: string; signature_valid: boolean; status: string }>(
      'SELECT count(*)::text AS count, bool_and(signature_valid) AS signature_valid, min(status) AS status FROM webhook_events',
    );
    expect(event.rows[0]).toMatchObject({ count: '1', signature_valid: true, status: 'received' });
    const jobs = await pool.query<{ count: string; event_id: string; dedupe_key: string }>(
      "SELECT count(*)::text AS count, min(payload->>'eventId') AS event_id, min(dedupe_key) AS dedupe_key FROM jobs",
    );
    expect(jobs.rows[0]).toMatchObject({ count: '1', event_id: 'evt_ingress_001', dedupe_key: 'process_event:evt_ingress_001' });
  });

  it('counts a sequential duplicate without inserting another job', async () => {
    const body = paymentBody();
    const headers = signedHeaders(body, 'evt_ingress_002');
    const first = await app.inject({ method: 'POST', url: '/webhooks/razorpay', headers, payload: body });
    const second = await app.inject({ method: 'POST', url: '/webhooks/razorpay', headers, payload: body });
    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(200);
    expect(second.json<IngressResponse>()).toMatchObject({ status: 'duplicate', event_id: 'evt_ingress_002', duplicate_count: 1 });

    const counts = await pool.query<{ events: string; duplicate_count: number; jobs: string }>(
      'SELECT (SELECT count(*)::text FROM webhook_events) AS events, (SELECT duplicate_count FROM webhook_events) AS duplicate_count, (SELECT count(*)::text FROM jobs) AS jobs',
    );
    expect(counts.rows[0]).toMatchObject({ events: '1', duplicate_count: 1, jobs: '1' });
  });

  it('serializes 20 concurrent identical posts into one row, 19 duplicates, and one job', async () => {
    const body = paymentBody();
    const headers = signedHeaders(body, 'evt_ingress_concurrent');
    const responses = await Promise.all(
      Array.from({ length: 20 }, () => app.inject({ method: 'POST', url: '/webhooks/razorpay', headers, payload: body })),
    );
    expect(responses.every((response) => response.statusCode === 200)).toBe(true);
    const resultStatuses = responses.map((response) => response.json<IngressResponse>().status);
    expect(resultStatuses.filter((status) => status === 'accepted')).toHaveLength(1);
    expect(resultStatuses.filter((status) => status === 'duplicate')).toHaveLength(19);

    const counts = await pool.query<{ events: string; duplicate_count: number; jobs: string }>(
      'SELECT (SELECT count(*)::text FROM webhook_events) AS events, (SELECT duplicate_count FROM webhook_events) AS duplicate_count, (SELECT count(*)::text FROM jobs) AS jobs',
    );
    expect(counts.rows[0]).toMatchObject({ events: '1', duplicate_count: 19, jobs: '1' });
  });

  it('records a bad signature as ignored and never enqueues it', async () => {
    const body = paymentBody();
    const response = await app.inject({
      method: 'POST',
      url: '/webhooks/razorpay',
      headers: signedHeaders(body, 'evt_ingress_bad_sig', '0'.repeat(64)),
      payload: body,
    });
    expect(response.statusCode).toBe(401);
    expect(response.json<IngressResponse>()).toEqual({ error: 'invalid_signature' });

    const event = await pool.query<{ signature_valid: boolean; status: string; event_type: string }>(
      'SELECT signature_valid, status, event_type FROM webhook_events',
    );
    expect(event.rows[0]).toMatchObject({ signature_valid: false, status: 'ignored', event_type: 'payment.failed' });
    expect((await pool.query('SELECT count(*)::int AS count FROM jobs')).rows[0].count).toBe(0);
  });

  it('accepts a verified unknown event as ignored without a job', async () => {
    const body = paymentBody('settlement.processed');
    const response = await app.inject({
      method: 'POST',
      url: '/webhooks/razorpay',
      headers: signedHeaders(body, 'evt_ingress_unknown'),
      payload: body,
    });
    expect(response.statusCode).toBe(200);
    expect(response.json<IngressResponse>()).toMatchObject({ status: 'accepted', duplicate_count: 0 });
    const event = await pool.query<{ status: string }>('SELECT status FROM webhook_events');
    expect(event.rows[0]?.status).toBe('ignored');
    expect((await pool.query('SELECT count(*)::int AS count FROM jobs')).rows[0].count).toBe(0);
  });

  it('records a schema-invalid verified body as ignored with a reason and no job', async () => {
    const body = JSON.stringify({ entity: 'event', event: 'payment.failed', payload: { payment: { entity: { status: 'failed' } } } });
    const response = await app.inject({
      method: 'POST',
      url: '/webhooks/razorpay',
      headers: signedHeaders(body, 'evt_ingress_schema'),
      payload: body,
    });
    expect(response.statusCode).toBe(202);
    expect(response.json<IngressResponse>()).toEqual({ status: 'ignored', reason: 'schema' });
    const event = await pool.query<{ status: string; last_error: string }>('SELECT status, last_error FROM webhook_events');
    expect(event.rows[0]).toMatchObject({ status: 'ignored', last_error: 'schema_validation_failed' });
    expect((await pool.query('SELECT count(*)::int AS count FROM jobs')).rows[0].count).toBe(0);
  });

  it('uses a sha256 idempotency key when the event header is absent', async () => {
    const body = paymentBody('payment.authorized');
    const response = await app.inject({
      method: 'POST',
      url: '/webhooks/razorpay',
      headers: signedHeaders(body),
      payload: body,
    });
    expect(response.statusCode).toBe(200);
    const result = response.json<IngressResponse>();
    expect(result.event_id).toMatch(/^sha256:[a-f0-9]{64}$/);
    const event = await pool.query<{ event_id: string }>('SELECT event_id FROM webhook_events');
    expect(event.rows[0]?.event_id).toBe(result.event_id);
  });

  it('does not let an unsigned request claim the idempotency key of a genuine event', async () => {
    // Intent: regression for the ingress key-poisoning defect found verifying T3 (Bug-Feature B-004, C-C1/C-D2).
    // Flow: forged 401 naming `evt_victim_001` -> genuine signed delivery of the same id -> must still be `accepted` with a job.
    const eventId = 'evt_victim_001';
    const forged = await app.inject({
      method: 'POST',
      url: '/webhooks/razorpay',
      headers: { 'content-type': 'application/json', 'x-razorpay-signature': '0'.repeat(64), 'x-razorpay-event-id': eventId },
      payload: JSON.stringify({ entity: 'event', event: 'payment.captured', contains: [], payload: {} }),
    });
    expect(forged.statusCode).toBe(401);

    const body = paymentBody('payment.captured');
    const genuine = await app.inject({
      method: 'POST',
      url: '/webhooks/razorpay',
      headers: signedHeaders(body, eventId),
      payload: body,
    });
    expect(genuine.statusCode).toBe(200);
    expect(genuine.json<IngressResponse>()).toMatchObject({ status: 'accepted', event_id: eventId, duplicate_count: 0 });

    const rows = await pool.query<{ event_id: string; status: string; signature_valid: boolean }>(
      'SELECT event_id, status, signature_valid FROM webhook_events ORDER BY event_id',
    );
    // The forged delivery is still auditable, but under a namespace no signed event can ever occupy.
    expect(rows.rows).toHaveLength(2);
    expect(rows.rows[0]).toMatchObject({ event_id: eventId, status: 'received', signature_valid: true });
    expect(rows.rows[1]?.event_id).toMatch(/^unverified:[a-f0-9]{64}$/);
    expect(rows.rows[1]).toMatchObject({ status: 'ignored', signature_valid: false });

    const jobs = await pool.query<{ count: string; dedupe_key: string }>(
      "SELECT count(*)::text AS count, min(dedupe_key) AS dedupe_key FROM jobs",
    );
    expect(jobs.rows[0]).toMatchObject({ count: '1', dedupe_key: `process_event:${eventId}` });
  });

  it('verifies the HMAC over the raw bytes, not a re-serialised body', async () => {
    // Intent: prove C-D2 — a body whose key order and whitespace JSON.stringify would not reproduce must still verify.
    // Flow: sign these exact bytes -> ingress hashes request.rawBody -> accepted, and payload_sha256 matches the bytes sent.
    const raw =
      '{\n  "event" : "payment.authorized",\n  "entity":"event",\n  "contains":["payment"],\n' +
      '  "payload": {"payment":{"entity":{"id":"pay_raw_001","entity":"payment","amount":100,"currency":"INR"}}},\n' +
      '  "account_id":"acc_test","created_at":1757000000\n}';
    expect(JSON.stringify(JSON.parse(raw))).not.toBe(raw);

    const response = await app.inject({
      method: 'POST',
      url: '/webhooks/razorpay',
      headers: signedHeaders(raw, 'evt_raw_bytes'),
      payload: raw,
    });
    expect(response.statusCode).toBe(200);
    expect(response.json<IngressResponse>()).toMatchObject({ status: 'accepted', event_id: 'evt_raw_bytes' });

    const stored = await pool.query<{ payload_sha256: string }>('SELECT payload_sha256 FROM webhook_events');
    expect(stored.rows[0]?.payload_sha256).toBe(createHash('sha256').update(Buffer.from(raw)).digest('hex'));
  });

  it('returns 400 for authenticated invalid JSON but 401 for unauthenticated invalid JSON', async () => {
    const raw = '{"event":';
    const validSignature = computeSignature(Buffer.from(raw), secret);
    const validResponse = await app.inject({
      method: 'POST',
      url: '/webhooks/razorpay',
      headers: { 'content-type': 'application/json', 'x-razorpay-signature': validSignature, 'x-razorpay-event-id': 'evt_bad_json_valid' },
      payload: raw,
    });
    expect(validResponse.statusCode).toBe(400);

    const invalidResponse = await app.inject({
      method: 'POST',
      url: '/webhooks/razorpay',
      headers: { 'content-type': 'application/json', 'x-razorpay-signature': '0'.repeat(64), 'x-razorpay-event-id': 'evt_bad_json_invalid' },
      payload: raw,
    });
    expect(invalidResponse.statusCode).toBe(401);
  });

  describe('sandbox / BYOK webhook secret (T25)', () => {
    // Intent: a merchant in Live mode registers their own Razorpay webhook secret, keyed by the account id Razorpay
    //         stamps on every delivery. The signature must be checked against that secret over the unaltered bytes.
    // Flow: seed `guardrail_config.sandbox_secret_<account_id>` -> deliver signed with it -> accepted; deliver signed
    //       with the `.env` secret -> 401, because the tenant secret replaces the default rather than joining it.
    const sandboxAccount = 'acc_sandbox_1';
    const sandboxSecret = 'whsec_tenant_one_secret';

    beforeEach(async () => {
      await pool.query("DELETE FROM guardrail_config WHERE key LIKE 'sandbox\\_secret\\_%'");
      await pool.query(
        `INSERT INTO guardrail_config (key, value, description, updated_by)
         VALUES ($1, $2::jsonb, 'sandbox webhook secret', 'ingress-test')
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
        [`sandbox_secret_${sandboxAccount}`, JSON.stringify(sandboxSecret)],
      );
    });

    afterAll(async () => {
      await pool.query("DELETE FROM guardrail_config WHERE key LIKE 'sandbox\\_secret\\_%'");
    });

    it('verifies the delivery against the secret registered for its account_id', async () => {
      const body = paymentBody('payment.failed', sandboxAccount);
      const response = await app.inject({
        method: 'POST',
        url: '/webhooks/razorpay',
        headers: signedHeaders(body, 'evt_sandbox_ok', computeSignature(Buffer.from(body), sandboxSecret)),
        payload: body,
      });

      expect(response.statusCode).toBe(200);
      expect(response.json<IngressResponse>()).toMatchObject({ status: 'accepted', event_id: 'evt_sandbox_ok' });
      const event = await pool.query<{ signature_valid: boolean; account_id: string; payload_sha256: string }>(
        'SELECT signature_valid, account_id, payload_sha256 FROM webhook_events',
      );
      expect(event.rows[0]).toMatchObject({ signature_valid: true, account_id: sandboxAccount });
      // C-D2: the HMAC covered the bytes we received, not a re-serialisation of them.
      expect(event.rows[0]?.payload_sha256).toBe(createHash('sha256').update(Buffer.from(body)).digest('hex'));
    });

    it('rejects a sandbox account delivery signed with the .env secret', async () => {
      const body = paymentBody('payment.failed', sandboxAccount);
      const response = await app.inject({
        method: 'POST',
        url: '/webhooks/razorpay',
        headers: signedHeaders(body, 'evt_sandbox_env_secret'),
        payload: body,
      });

      expect(response.statusCode).toBe(401);
      expect(response.json<IngressResponse>()).toEqual({ error: 'invalid_signature' });
      const rows = await pool.query<{ event_id: string; status: string }>('SELECT event_id, status FROM webhook_events');
      expect(rows.rows[0]?.event_id).toMatch(/^unverified:[a-f0-9]{64}$/);
      expect(rows.rows[0]?.status).toBe('ignored');
      expect((await pool.query('SELECT count(*)::int AS count FROM jobs')).rows[0].count).toBe(0);
    });

    it('falls back to the .env secret for an account with no registered sandbox secret', async () => {
      const body = paymentBody('payment.failed', 'acc_without_sandbox');
      const response = await app.inject({
        method: 'POST',
        url: '/webhooks/razorpay',
        headers: signedHeaders(body, 'evt_sandbox_absent'),
        payload: body,
      });

      expect(response.statusCode).toBe(200);
      expect(response.json<IngressResponse>()).toMatchObject({ status: 'accepted', event_id: 'evt_sandbox_absent' });
    });

    it('keeps the .env secret when the body cannot name a usable account id', async () => {
      // Intent: the lookup runs on unauthenticated bytes, so an unusable `account_id` must fail closed to the default
      //         secret — never to "no secret" and never to a lookup with the caller's own string.
      const body = JSON.stringify({
        entity: 'event',
        account_id: "acc_x'; DROP TABLE guardrail_config; --",
        event: 'payment.failed',
        contains: ['payment'],
        payload: { payment: { entity: { entity: 'payment', id: 'pay_hostile_001', amount: 100, currency: 'INR', status: 'failed' } } },
        created_at: 1_757_000_000,
      });
      const response = await app.inject({
        method: 'POST',
        url: '/webhooks/razorpay',
        headers: signedHeaders(body, 'evt_sandbox_hostile'),
        payload: body,
      });

      expect(response.statusCode).toBe(200);
      expect(response.json<IngressResponse>()).toMatchObject({ status: 'accepted', event_id: 'evt_sandbox_hostile' });
      expect((await pool.query('SELECT count(*)::int AS count FROM guardrail_config')).rows[0].count).toBeGreaterThan(0);
    });
  });
});
