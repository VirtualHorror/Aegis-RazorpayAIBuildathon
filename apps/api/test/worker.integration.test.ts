import { config as loadDotenv } from 'dotenv';
import pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app';
import { loadConfig } from '../src/config';
import type { JobHandler, WorkerLogger } from '../src/worker/registry';
import { createRegistry } from '../src/worker/registry';
import { startWorker } from '../src/worker/job-runner';
import { processEventHandler } from '../src/worker/process-event';
import { sweepStaleJobs } from '../src/worker/sweeper';
import { MIGRATIONS_DIR, REPO_ROOT_ENV } from '../src/db/paths';
import { migrateUp } from '../src/db/migrate';
import { computeSignature } from '../src/ingress/signature';

loadDotenv({ path: REPO_ROOT_ENV, quiet: true });

const databaseUrl = process.env.DATABASE_URL_TEST;
const integration = databaseUrl ? describe : describe.skip;
const webhookSecret = 'test_worker_webhook_secret_16';
const appConfig = loadConfig({
  DATABASE_URL: databaseUrl ?? 'postgres://aegis:pw@localhost:5432/aegis_test',
  RAZORPAY_WEBHOOK_SECRET: webhookSecret,
  NODE_ENV: 'test',
});
const logger: WorkerLogger = {
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
  debug: () => undefined,
};

interface JobState {
  id: number;
  status: string;
  attempts: number;
  max_attempts: number;
  last_error: string | null;
}

interface ProjectionState {
  status: string;
  version: number;
  last_event_id: string | null;
  last_event_at: Date | null;
}

function webhookPayload(event: string, entity: Record<string, unknown>, createdAt: number): Record<string, unknown> {
  const entityType = event.startsWith('payment.dispute.') || event.startsWith('dispute.') ? 'dispute' : event.split('.')[0] ?? 'payment';
  return {
    entity: 'event',
    account_id: 'acc_worker_test',
    event,
    contains: [entityType],
    payload: { [entityType]: { entity } },
    created_at: createdAt,
  };
}

async function insertEvent(
  pool: pg.Pool,
  eventId: string,
  event: string,
  payload: Record<string, unknown>,
  signatureValid = true,
): Promise<void> {
  await pool.query(
    `INSERT INTO webhook_events
       (event_id, event_type, account_id, payload, payload_sha256, signature_valid, rzp_created_at, status)
     VALUES ($1, $2, 'acc_worker_test', $3::jsonb, $4, $5, to_timestamp(($6)::double precision), $7)`,
    [eventId, event, JSON.stringify(payload), `sha-${eventId}`, signatureValid, payload.created_at, signatureValid ? 'received' : 'ignored'],
  );
}

async function insertJob(pool: pg.Pool, eventId: string | null, kind: string, dedupeKey: string, maxAttempts = 5): Promise<number> {
  const result = await pool.query<{ id: number }>(
    `INSERT INTO jobs (kind, payload, dedupe_key, max_attempts, run_at)
     VALUES ($1, $2::jsonb, $3, $4, now())
     RETURNING id`,
    [kind, JSON.stringify(eventId === null ? {} : { eventId }), dedupeKey, maxAttempts],
  );
  const id = result.rows[0]?.id;
  if (id === undefined) throw new Error('job insert returned no id');
  return id;
}

async function jobState(pool: pg.Pool, id: number): Promise<JobState> {
  const result = await pool.query<JobState>('SELECT id, status, attempts, max_attempts, last_error FROM jobs WHERE id = $1', [id]);
  const row = result.rows[0];
  if (!row) throw new Error(`job ${id} not found`);
  return row;
}

async function waitFor(check: () => Promise<boolean>, timeoutMs = 10_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await check()) return;
    await new Promise<void>((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`condition did not become true within ${timeoutMs}ms`);
}

/**
 * Run a single-threaded worker until `jobId` succeeds.
 * Intent: a test about event *precedence* must fix the arrival order itself; leaving two queued jobs to a concurrent
 *         worker asserts on whichever one `SKIP LOCKED` happened to claim first (B-008).
 * Flow: start one loop -> wait for this job alone -> stop the worker before the next phase is enqueued.
 */
async function drainJob(pool: pg.Pool, jobId: number): Promise<void> {
  const worker = startWorker({
    pools: pool,
    logger,
    handlers: createRegistry({ process_event: processEventHandler }),
    concurrency: 1,
    pollIntervalMs: 1,
    backoffFn: () => 0,
    disableSweeper: true,
  });
  try {
    await waitFor(async () => (await jobState(pool, jobId)).status === 'succeeded');
  } finally {
    await worker.stop();
  }
}

async function runOneEvent(pool: pg.Pool, eventId: string, event: string, entity: Record<string, unknown>): Promise<void> {
  const payload = webhookPayload(event, entity, 1_757_000_000);
  await insertEvent(pool, eventId, event, payload);
  await drainJob(pool, await insertJob(pool, eventId, 'process_event', `process_event:${eventId}`));
}

integration('worker queue and projections', () => {
  let pool: pg.Pool;

  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: databaseUrl, application_name: 'aegis-worker-tests', max: 20 });
    await migrateUp(pool, MIGRATIONS_DIR, { info: () => undefined, warn: () => undefined });
  });

  beforeEach(async () => {
    // Intent: every scenario starts with no queue or projection rows so counts expose only this test's transactions.
    // Flow: truncate children and parents together -> reset jobs identity -> insert the exact adversarial sequence under test.
    await pool.query('TRUNCATE TABLE jobs, webhook_events, disputes, invoices, subscriptions, payments, orders, customers RESTART IDENTITY CASCADE');
  });

  afterAll(async () => {
    await pool?.end();
  });

  it('claims 100 jobs exactly once across four concurrent loops', async () => {
    for (let index = 0; index < 100; index += 1) {
      await insertJob(pool, null, 'claim_test', `claim-test:${index}`);
    }
    const claimed = new Set<number>();
    const handler: JobHandler = async (job) => {
      claimed.add(job.id);
      await new Promise<void>((resolve) => setImmediate(resolve));
    };
    const worker = startWorker({
      pools: pool,
      logger,
      handlers: createRegistry({ claim_test: handler }),
      concurrency: 4,
      pollIntervalMs: 1,
      disableSweeper: true,
    });
    try {
      await waitFor(async () => {
        const result = await pool.query<{ count: string }>("SELECT count(*)::text AS count FROM jobs WHERE status = 'succeeded'");
        return result.rows[0]?.count === '100';
      });
    } finally {
      await worker.stop();
    }
    const rows = await pool.query<{ count: string; attempts: number }>('SELECT count(*)::text AS count, max(attempts) AS attempts FROM jobs');
    expect(rows.rows[0]).toMatchObject({ count: '100', attempts: 1 });
    expect(claimed).toHaveProperty('size', 100);
  }, 20_000);

  it('retries twice then succeeds on the third attempt with attempts=3', async () => {
    const jobId = await insertJob(pool, null, 'retry_test', 'retry-test:1');
    let calls = 0;
    const worker = startWorker({
      pools: pool,
      logger,
      handlers: createRegistry({
        retry_test: async () => {
          calls += 1;
          if (calls < 3) throw new Error(`transient-${calls}`);
        },
      }),
      concurrency: 1,
      pollIntervalMs: 1,
      backoffFn: () => 0,
      disableSweeper: true,
    });
    try {
      await waitFor(async () => (await jobState(pool, jobId)).status === 'succeeded');
    } finally {
      await worker.stop();
    }
    await expect(jobState(pool, jobId)).resolves.toMatchObject({ status: 'succeeded', attempts: 3, last_error: null });
  });

  it('dead-letters an exhausted job and mirrors the error to its webhook event', async () => {
    const eventId = 'evt_worker_dead_letter';
    const payload = webhookPayload('payment.failed', { entity: 'payment', id: 'pay_dead_letter', amount: 100, status: 'failed' }, 1_757_000_000);
    await insertEvent(pool, eventId, 'payment.failed', payload);
    const jobId = await insertJob(pool, eventId, 'dead_letter_test', 'dead-letter-test:1', 2);
    const worker = startWorker({
      pools: pool,
      logger,
      handlers: createRegistry({ dead_letter_test: async () => { throw new Error('permanent failure'); } }),
      concurrency: 1,
      pollIntervalMs: 1,
      backoffFn: () => 0,
      disableSweeper: true,
    });
    try {
      await waitFor(async () => (await jobState(pool, jobId)).status === 'dead_letter');
    } finally {
      await worker.stop();
    }
    expect(await jobState(pool, jobId)).toMatchObject({ status: 'dead_letter', attempts: 2, last_error: 'permanent failure' });
    const event = await pool.query<{ status: string; last_error: string }>('SELECT status, last_error FROM webhook_events WHERE event_id = $1', [eventId]);
    expect(event.rows[0]).toEqual({ status: 'dead_letter', last_error: 'permanent failure' });
  });

  it('sweeps a stale running lease back to queued so a crash cannot lose the job', async () => {
    const jobId = await insertJob(pool, null, 'stale_test', 'stale-test:1');
    await pool.query("UPDATE jobs SET status = 'running', locked_by = 'crashed-worker', locked_at = now() - interval '5 minutes' WHERE id = $1", [jobId]);
    await expect(sweepStaleJobs(pool)).resolves.toBe(1);
    expect(await jobState(pool, jobId)).toMatchObject({ status: 'queued' });
    const lock = await pool.query<{ locked_by: string | null; locked_at: Date | null }>('SELECT locked_by, locked_at FROM jobs WHERE id = $1', [jobId]);
    expect(lock.rows[0]).toEqual({ locked_by: null, locked_at: null });
  });

  it('projects a duplicate event once when two workers claim duplicate jobs concurrently', async () => {
    const eventId = 'evt_duplicate_projection';
    const payload = webhookPayload(
      'payment.captured',
      {
        entity: 'payment',
        id: 'pay_duplicate_projection',
        amount: 149900,
        currency: 'INR',
        status: 'captured',
        order_id: 'order_duplicate_projection',
        customer_id: 'cus_duplicate_projection',
        contact: '+91******42',
      },
      1_757_000_000,
    );
    await insertEvent(pool, eventId, 'payment.captured', payload);
    const first = await insertJob(pool, eventId, 'process_event', 'duplicate-projection:1');
    const second = await insertJob(pool, eventId, 'process_event', 'duplicate-projection:2');
    const worker = startWorker({
      pools: pool,
      logger,
      handlers: createRegistry({ process_event: processEventHandler }),
      concurrency: 2,
      pollIntervalMs: 1,
      disableSweeper: true,
    });
    try {
      await waitFor(async () => {
        const result = await pool.query<{ count: string }>("SELECT count(*)::text AS count FROM jobs WHERE status = 'succeeded' AND id = ANY($1::bigint[])", [[first, second]]);
        return result.rows[0]?.count === '2';
      });
    } finally {
      await worker.stop();
    }
    const payment = await pool.query<{ version: number; status: string; last_event_id: string }>('SELECT version, status, last_event_id FROM payments WHERE id = $1', ['pay_duplicate_projection']);
    expect(payment.rows[0]).toEqual({ version: 1, status: 'captured', last_event_id: eventId });
    expect((await pool.query('SELECT count(*)::int AS count FROM orders WHERE id = $1', ['order_duplicate_projection'])).rows[0]?.count).toBe(1);
    expect((await pool.query('SELECT count(*)::int AS count FROM customers WHERE id = $1', ['cus_duplicate_projection'])).rows[0]?.count).toBe(1);
  });

  it('keeps one projection when duplicate webhooks arrive while two workers claim', async () => {
    const body = JSON.stringify(webhookPayload('payment.captured', {
      entity: 'payment',
      id: 'pay_duplicate_webhook_race',
      amount: 149900,
      currency: 'INR',
      status: 'captured',
      order_id: 'order_duplicate_webhook_race',
      customer_id: 'cus_duplicate_webhook_race',
      contact: '+91******42',
    }, 1_757_000_000));
    const app = await buildApp({ config: appConfig, db: pool, probeDb: async () => ({ ok: true, latencyMs: 1 }), logger: false });
    const worker = startWorker({
      pools: pool,
      logger,
      handlers: createRegistry({ process_event: processEventHandler }),
      concurrency: 2,
      pollIntervalMs: 1,
      disableSweeper: true,
    });
    try {
      const headers = {
        'content-type': 'application/json',
        'x-razorpay-signature': computeSignature(Buffer.from(body), webhookSecret),
        'x-razorpay-event-id': 'evt_duplicate_webhook_race',
      };
      const responses = await Promise.all([
        app.inject({ method: 'POST', url: '/webhooks/razorpay', headers, payload: body }),
        app.inject({ method: 'POST', url: '/webhooks/razorpay', headers, payload: body }),
      ]);
      expect(responses.every((response) => response.statusCode === 200)).toBe(true);
      const statuses = responses.map((response) => response.json<{ status: string }>().status);
      expect(statuses.filter((status) => status === 'accepted')).toHaveLength(1);
      expect(statuses.filter((status) => status === 'duplicate')).toHaveLength(1);
      await waitFor(async () => {
        const result = await pool.query<{ count: string }>("SELECT count(*)::text AS count FROM jobs WHERE status = 'succeeded'");
        return result.rows[0]?.count === '1';
      });
    } finally {
      await worker.stop();
      await app.close();
    }
    const event = await pool.query<{ duplicate_count: number; status: string }>('SELECT duplicate_count, status FROM webhook_events WHERE event_id = $1', ['evt_duplicate_webhook_race']);
    expect(event.rows[0]).toEqual({ duplicate_count: 1, status: 'processed' });
    const payment = await pool.query<{ version: number; status: string }>('SELECT version, status FROM payments WHERE id = $1', ['pay_duplicate_webhook_race']);
    expect(payment.rows[0]).toEqual({ version: 1, status: 'captured' });
  });

  it('retries after a post-projection crash without incrementing the entity version twice', async () => {
    const eventId = 'evt_projection_retry_race';
    const payload = webhookPayload('payment.captured', {
      entity: 'payment',
      id: 'pay_projection_retry',
      amount: 5000,
      currency: 'INR',
      status: 'captured',
    }, 1_757_000_000);
    await insertEvent(pool, eventId, 'payment.captured', payload);
    const jobId = await insertJob(pool, eventId, 'process_event', 'projection-retry:1');
    let first = true;
    const worker = startWorker({
      pools: pool,
      logger,
      handlers: createRegistry({
        process_event: async (job, ctx) => {
          await processEventHandler(job, ctx);
          if (first) {
            first = false;
            throw new Error('crash after projection commit');
          }
        },
      }),
      concurrency: 1,
      pollIntervalMs: 1,
      backoffFn: () => 0,
      disableSweeper: true,
    });
    try {
      await waitFor(async () => (await jobState(pool, jobId)).status === 'succeeded');
    } finally {
      await worker.stop();
    }
    const payment = await pool.query<ProjectionState>('SELECT status, version, last_event_id, last_event_at FROM payments WHERE id = $1', ['pay_projection_retry']);
    expect(payment.rows[0]).toMatchObject({ status: 'captured', version: 1, last_event_id: eventId });
    const event = await pool.query<{ status: string; last_error: string | null }>('SELECT status, last_error FROM webhook_events WHERE event_id = $1', [eventId]);
    expect(event.rows[0]).toEqual({ status: 'processed', last_error: null });
  });

  it('refuses a queued invalid-signature event before parsing or projecting it', async () => {
    const eventId = 'evt_invalid_signature_job';
    const payload = webhookPayload('payment.captured', {
      entity: 'payment',
      id: 'pay_invalid_signature',
      amount: 1000,
      status: 'captured',
      order_id: 'order_invalid_signature',
    }, 1_757_000_000);
    await insertEvent(pool, eventId, 'payment.captured', payload, false);
    const jobId = await insertJob(pool, eventId, 'process_event', 'invalid-signature:1');
    const worker = startWorker({
      pools: pool,
      logger,
      handlers: createRegistry({ process_event: processEventHandler }),
      concurrency: 1,
      pollIntervalMs: 1,
      disableSweeper: true,
    });
    try {
      await waitFor(async () => (await jobState(pool, jobId)).status === 'succeeded');
    } finally {
      await worker.stop();
    }
    expect((await pool.query('SELECT count(*)::int AS count FROM payments')).rows[0]?.count).toBe(0);
    expect((await pool.query('SELECT count(*)::int AS count FROM orders')).rows[0]?.count).toBe(0);
    expect((await pool.query('SELECT count(*)::int AS count FROM customers')).rows[0]?.count).toBe(0);
    expect(await jobState(pool, jobId)).toMatchObject({ status: 'succeeded', attempts: 1 });
    expect((await pool.query<{ status: string; signature_valid: boolean }>('SELECT status, signature_valid FROM webhook_events WHERE event_id = $1', [eventId])).rows[0]).toEqual({ status: 'ignored', signature_valid: false });
  });

  it('creates unseen customer and order parents before a payment projection', async () => {
    const eventId = 'evt_unseen_parents';
    await runOneEvent(pool, eventId, 'payment.authorized', {
      entity: 'payment',
      id: 'pay_unseen_parents',
      amount: 149900,
      currency: 'INR',
      status: 'authorized',
      order_id: 'order_unseen_parents',
      customer_id: 'cus_unseen_parents',
      email: 'customer@example.test',
      contact: '+44 20 7946 0958',
      notes: { locale: 'en-GB' },
    });
    const rows = await pool.query<{ payment: string; order: string; customer: string; country: string; locale: string }>(
      `SELECT
         (SELECT count(*)::text FROM payments WHERE id = 'pay_unseen_parents') AS payment,
         (SELECT count(*)::text FROM orders WHERE id = 'order_unseen_parents') AS order,
         (SELECT count(*)::text FROM customers WHERE id = 'cus_unseen_parents') AS customer,
         (SELECT country FROM customers WHERE id = 'cus_unseen_parents') AS country,
         (SELECT locale FROM customers WHERE id = 'cus_unseen_parents') AS locale`,
    );
    expect(rows.rows[0]).toEqual({ payment: '1', order: '1', customer: '1', country: 'GB', locale: 'en-GB' });
  });

  it('applies payment precedence and duplicate guards, including terminal failed state', async () => {
    await runOneEvent(pool, 'evt_payment_authorized', 'payment.authorized', { entity: 'payment', id: 'pay_precedence', amount: 1000, status: 'authorized' });
    await runOneEvent(pool, 'evt_payment_captured', 'payment.captured', { entity: 'payment', id: 'pay_precedence', amount: 1000, status: 'captured' });
    await runOneEvent(pool, 'evt_payment_authorized_late', 'payment.authorized', { entity: 'payment', id: 'pay_precedence', amount: 1000, status: 'authorized' });
    await runOneEvent(pool, 'evt_payment_failed_late', 'payment.failed', { entity: 'payment', id: 'pay_precedence', amount: 1000, status: 'failed' });
    const captured = await pool.query<ProjectionState>('SELECT status, version, last_event_id, last_event_at FROM payments WHERE id = $1', ['pay_precedence']);
    expect(captured.rows[0]).toMatchObject({ status: 'captured', version: 2, last_event_id: 'evt_payment_captured' });

    await runOneEvent(pool, 'evt_payment_failed_terminal', 'payment.failed', { entity: 'payment', id: 'pay_failed_terminal', amount: 1000, status: 'failed' });
    await runOneEvent(pool, 'evt_payment_captured_after_failed', 'payment.captured', { entity: 'payment', id: 'pay_failed_terminal', amount: 1000, status: 'captured' });
    const failed = await pool.query<ProjectionState>('SELECT status, version, last_event_id, last_event_at FROM payments WHERE id = $1', ['pay_failed_terminal']);
    expect(failed.rows[0]).toMatchObject({ status: 'failed', version: 1, last_event_id: 'evt_payment_failed_terminal' });
  }, 20_000);

  it('ignores an older subscription event and preserves its version', async () => {
    const first = webhookPayload('subscription.pending', { entity: 'subscription', id: 'sub_stale', amount: 2000, status: 'pending', customer_id: 'cus_sub_stale' }, 1_757_000_100);
    const stale = webhookPayload('subscription.activated', { entity: 'subscription', id: 'sub_stale', amount: 2000, status: 'active', customer_id: 'cus_sub_stale' }, 1_757_000_000);
    await insertEvent(pool, 'evt_sub_new', 'subscription.pending', first);
    await insertEvent(pool, 'evt_sub_old', 'subscription.activated', stale);
    // Intent: `isStaleSubscriptionEvent` only fires when a newer projection already exists, so the newer event must be
    //         projected before the older one is released — otherwise the older event legitimately creates the row and
    //         the newer one supersedes it at version 2 (B-008).
    // Flow: drain evt_sub_new -> then enqueue and drain evt_sub_old -> assert the stale event wrote nothing.
    await drainJob(pool, await insertJob(pool, 'evt_sub_new', 'process_event', 'sub-stale:1'));
    await drainJob(pool, await insertJob(pool, 'evt_sub_old', 'process_event', 'sub-stale:2'));
    const subscription = await pool.query<ProjectionState>('SELECT status, version, last_event_id, last_event_at FROM subscriptions WHERE id = $1', ['sub_stale']);
    expect(subscription.rows[0]).toMatchObject({ status: 'pending', version: 1, last_event_id: 'evt_sub_new' });
  });

  it('creates an unseen payment parent before a dispute and keeps invoice floor immutable', async () => {
    await runOneEvent(pool, 'evt_dispute_created', 'payment.dispute.created', {
      entity: 'dispute',
      id: 'dispute_unseen_payment',
      payment_id: 'pay_unseen_dispute',
      amount: 3000,
      currency: 'INR',
      phase: 'fraud',
      status: 'open',
    });
    expect((await pool.query('SELECT count(*)::int AS count FROM payments WHERE id = $1', ['pay_unseen_dispute'])).rows[0]?.count).toBe(1);
    expect((await pool.query('SELECT count(*)::int AS count FROM disputes WHERE id = $1', ['dispute_unseen_payment'])).rows[0]?.count).toBe(1);

    const invoiceOne = webhookPayload('invoice.issued', { entity: 'invoice', id: 'inv_floor', amount: 10000, status: 'issued' }, 1_757_000_000);
    const invoiceTwo = webhookPayload('invoice.updated', { entity: 'invoice', id: 'inv_floor', amount: 20000, status: 'issued' }, 1_757_000_001);
    await insertEvent(pool, 'evt_invoice_one', 'invoice.issued', invoiceOne);
    await insertEvent(pool, 'evt_invoice_two', 'invoice.updated', invoiceTwo);
    const firstJob = await insertJob(pool, 'evt_invoice_one', 'process_event', 'invoice-floor:1');
    const secondJob = await insertJob(pool, 'evt_invoice_two', 'process_event', 'invoice-floor:2');
    const worker = startWorker({
      pools: pool,
      logger,
      handlers: createRegistry({ process_event: processEventHandler }),
      concurrency: 1,
      pollIntervalMs: 1,
      disableSweeper: true,
    });
    try {
      await waitFor(async () => {
        const result = await pool.query<{ count: string }>("SELECT count(*)::text AS count FROM jobs WHERE status = 'succeeded' AND id = ANY($1::bigint[])", [[firstJob, secondJob]]);
        return result.rows[0]?.count === '2';
      });
    } finally {
      await worker.stop();
    }
    const invoice = await pool.query<{ amount_paise: number; floor_amount_paise: number; version: number }>('SELECT amount_paise, floor_amount_paise, version FROM invoices WHERE id = $1', ['inv_floor']);
    expect(invoice.rows[0]).toEqual({ amount_paise: 20000, floor_amount_paise: 10000, version: 2 });
  });
});
