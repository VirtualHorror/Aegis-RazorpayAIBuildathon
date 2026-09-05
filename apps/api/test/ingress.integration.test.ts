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

function paymentBody(event = 'payment.failed'): string {
  return JSON.stringify({
    entity: 'event',
    account_id: 'acc_test',
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
});
