import { config as loadDotenv } from 'dotenv';
import pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { RazorpayWebhookSchema, type RazorpayWebhook } from '@aegis/shared';
import { MIGRATIONS_DIR, REPO_ROOT_ENV } from '../../db/paths';
import { migrateUp } from '../../db/migrate';
import { withTransaction } from '../../db/tx';
import { applyProjection, projectOrder, projectPayment } from './index';

loadDotenv({ path: REPO_ROOT_ENV, quiet: true });

const databaseUrl = process.env.DATABASE_URL_TEST;
const integration = databaseUrl ? describe : describe.skip;

function webhook(event: string, key: 'payment' | 'order' | 'subscription' | 'invoice' | 'dispute', entity: Record<string, unknown>, createdAt: number): RazorpayWebhook {
  return RazorpayWebhookSchema.parse({
    entity: 'event',
    account_id: 'acc_projection_test',
    event,
    contains: [key],
    payload: { [key]: { entity } },
    created_at: createdAt,
  });
}

async function insertEvent(pool: pg.Pool, eventId: string, payload: RazorpayWebhook): Promise<void> {
  await pool.query(
    `INSERT INTO webhook_events (event_id, event_type, account_id, payload, payload_sha256, signature_valid, rzp_created_at, status)
     VALUES ($1, $2, $3, $4::jsonb, $5, true, $6, 'received')`,
    [eventId, payload.event, payload.account_id ?? null, JSON.stringify(payload), eventId, new Date(Number(payload.created_at) * 1_000)],
  );
}

/** Wait until one of this suite's connections is parked on a row lock, so an interleaving can be pinned deterministically. */
async function waitForLockWait(pool: pg.Pool, timeoutMs = 5_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const waiting = await pool.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM pg_stat_activity
       WHERE application_name = 'aegis-projection-tests' AND wait_event_type = 'Lock'`,
    );
    if (waiting.rows[0]?.count !== '0') return;
    await new Promise<void>((resolve) => setTimeout(resolve, 20));
  }
  throw new Error('no connection blocked on a lock within the timeout');
}

integration('entity projections', () => {
  let pool: pg.Pool;

  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: databaseUrl, application_name: 'aegis-projection-tests', max: 10 });
    await migrateUp(pool, MIGRATIONS_DIR, { info: () => undefined, warn: () => undefined });
  });

  beforeEach(async () => {
    // Intent: projection assertions must observe only rows produced by that test, including FK parents and event links.
    // Flow: truncate dependents and projections through CASCADE -> reset serial jobs -> insert only the events under test.
    await pool.query('TRUNCATE TABLE jobs, webhook_events, disputes, invoices, subscriptions, payments, orders, customers RESTART IDENTITY CASCADE');
  });

  afterAll(async () => {
    await pool?.end();
  });

  it('applies captured after authorized and increments version once per event', async () => {
    const authorized = webhook('payment.authorized', 'payment', {
      entity: 'payment', id: 'pay_projection_001', amount: 149900, currency: 'INR', status: 'authorized',
      order_id: 'order_projection_001', customer_id: 'cus_projection_001', contact: '+91******42',
    }, 1_757_000_000);
    const captured = webhook('payment.captured', 'payment', {
      entity: 'payment', id: 'pay_projection_001', amount: 149900, currency: 'INR', status: 'captured',
      order_id: 'order_projection_001', customer_id: 'cus_projection_001', contact: '+91******42',
    }, 1_757_000_001);
    await insertEvent(pool, 'evt_projection_auth', authorized);
    await insertEvent(pool, 'evt_projection_capture', captured);

    await withTransaction(pool, (tx) => applyProjection(tx, authorized, { eventId: 'evt_projection_auth', eventAt: new Date(1_757_000_000_000) }));
    const result = await withTransaction(pool, (tx) => applyProjection(tx, captured, { eventId: 'evt_projection_capture', eventAt: new Date(1_757_000_001_000) }));
    expect(result.applied).toBe(true);

    const row = (await pool.query<{ status: string; status_rank: number; version: number; last_event_id: string }>(
      'SELECT status, status_rank, version, last_event_id FROM payments WHERE id = $1', ['pay_projection_001'],
    )).rows[0];
    expect(row).toMatchObject({ status: 'captured', status_rank: 2, version: 2, last_event_id: 'evt_projection_capture' });
  });

  it('ignores rank-regressing and failed events after capture without changing version', async () => {
    const captured = webhook('payment.captured', 'payment', {
      entity: 'payment', id: 'pay_projection_002', amount: 1000, currency: 'INR', status: 'captured',
    }, 1_757_000_010);
    const authorized = webhook('payment.authorized', 'payment', {
      entity: 'payment', id: 'pay_projection_002', amount: 1000, currency: 'INR', status: 'authorized',
    }, 1_757_000_011);
    const failed = webhook('payment.failed', 'payment', {
      entity: 'payment', id: 'pay_projection_002', amount: 1000, currency: 'INR', status: 'failed',
    }, 1_757_000_012);
    await insertEvent(pool, 'evt_projection_capture_2', captured);
    await insertEvent(pool, 'evt_projection_auth_2', authorized);
    await insertEvent(pool, 'evt_projection_failed_2', failed);

    await withTransaction(pool, (tx) => applyProjection(tx, captured, { eventId: 'evt_projection_capture_2', eventAt: new Date(1_757_000_010_000) }));
    const stale = await withTransaction(pool, (tx) => applyProjection(tx, authorized, { eventId: 'evt_projection_auth_2', eventAt: new Date(1_757_000_011_000) }));
    const terminal = await withTransaction(pool, (tx) => applyProjection(tx, failed, { eventId: 'evt_projection_failed_2', eventAt: new Date(1_757_000_012_000) }));
    expect(stale.applied).toBe(false);
    expect(terminal.applied).toBe(false);

    const row = (await pool.query<{ status: string; version: number; last_event_id: string }>(
      'SELECT status, version, last_event_id FROM payments WHERE id = $1', ['pay_projection_002'],
    )).rows[0];
    expect(row).toMatchObject({ status: 'captured', version: 1, last_event_id: 'evt_projection_capture_2' });
  });

  it('treats a duplicate event id as a projection no-op', async () => {
    const payload = webhook('payment.captured', 'payment', {
      entity: 'payment', id: 'pay_projection_003', amount: 2500, currency: 'INR', status: 'captured',
    }, 1_757_000_020);
    await insertEvent(pool, 'evt_projection_duplicate', payload);
    const context = { eventId: 'evt_projection_duplicate', eventAt: new Date(1_757_000_020_000) };
    await withTransaction(pool, (tx) => applyProjection(tx, payload, context));
    const duplicate = await withTransaction(pool, (tx) => applyProjection(tx, payload, context));
    expect(duplicate.applied).toBe(false);
    expect((await pool.query<{ version: number }>('SELECT version FROM payments WHERE id = $1', ['pay_projection_003'])).rows[0]?.version).toBe(1);
  });

  it('re-checks payment precedence when authorized and captured insert concurrently', async () => {
    const authorized = webhook('payment.authorized', 'payment', {
      entity: 'payment', id: 'pay_projection_race', amount: 3200, currency: 'INR', status: 'authorized',
    }, 1_757_000_021);
    const captured = webhook('payment.captured', 'payment', {
      entity: 'payment', id: 'pay_projection_race', amount: 3200, currency: 'INR', status: 'captured',
    }, 1_757_000_022);
    await insertEvent(pool, 'evt_projection_race_auth', authorized);
    await insertEvent(pool, 'evt_projection_race_capture', captured);
    await Promise.all([
      withTransaction(pool, (tx) => applyProjection(tx, authorized, { eventId: 'evt_projection_race_auth', eventAt: new Date(1_757_000_021_000) })),
      withTransaction(pool, (tx) => applyProjection(tx, captured, { eventId: 'evt_projection_race_capture', eventAt: new Date(1_757_000_022_000) })),
    ]);
    // Whichever transaction committed first, the capture must be the surviving event: `version` is 1 when the capture
    // won the insert and the authorization was rejected, 2 when the authorization inserted first and the capture
    // applied on top. A bare `version <= 2` cannot fail here, so assert the winner's identity as well.
    const row = (await pool.query<{ status: string; status_rank: number; version: number; last_event_id: string }>(
      'SELECT status, status_rank, version, last_event_id FROM payments WHERE id = $1', ['pay_projection_race'],
    )).rows[0];
    expect(row).toMatchObject({ status: 'captured', status_rank: 2, last_event_id: 'evt_projection_race_capture' });
    expect([1, 2]).toContain(row?.version);
  });

  it('rejects an older subscription event by last_event_at', async () => {
    const newer = webhook('subscription.active', 'subscription', {
      entity: 'subscription', id: 'sub_projection_001', amount: 9900, currency: 'INR', status: 'active', customer_id: 'cus_sub_001',
    }, 1_757_000_030);
    const older = webhook('subscription.pending', 'subscription', {
      entity: 'subscription', id: 'sub_projection_001', amount: 9900, currency: 'INR', status: 'pending', customer_id: 'cus_sub_001',
    }, 1_757_000_029);
    await insertEvent(pool, 'evt_projection_sub_new', newer);
    await insertEvent(pool, 'evt_projection_sub_old', older);
    await withTransaction(pool, (tx) => applyProjection(tx, newer, { eventId: 'evt_projection_sub_new', eventAt: new Date(1_757_000_030_000) }));
    const stale = await withTransaction(pool, (tx) => applyProjection(tx, older, { eventId: 'evt_projection_sub_old', eventAt: new Date(1_757_000_029_000) }));
    expect(stale.applied).toBe(false);
    expect((await pool.query<{ status: string; version: number }>('SELECT status, version FROM subscriptions WHERE id = $1', ['sub_projection_001'])).rows[0]).toMatchObject({ status: 'active', version: 1 });
  });

  it('creates customer and order parents before a payment that references unseen ids', async () => {
    const payload = webhook('payment.captured', 'payment', {
      entity: 'payment', id: 'pay_projection_parent', amount: 420000, currency: 'INR', status: 'captured',
      order_id: 'order_projection_parent', customer_id: 'cus_projection_parent', email: 'new@example.test', contact: '+1 (212) 555-0100', notes: { locale: 'en-US' },
    }, 1_757_000_040);
    await insertEvent(pool, 'evt_projection_parent', payload);
    const result = await withTransaction(pool, (tx) => applyProjection(tx, payload, { eventId: 'evt_projection_parent', eventAt: new Date(1_757_000_040_000) }));
    expect(result.customer).toMatchObject({ id: 'cus_projection_parent', country: 'US', locale: 'en-US' });

    const rows = await pool.query<{ customers: string; orders: string; payments: string }>(
      `SELECT (SELECT count(*)::text FROM customers WHERE id = 'cus_projection_parent') AS customers,
              (SELECT count(*)::text FROM orders WHERE id = 'order_projection_parent') AS orders,
              (SELECT count(*)::text FROM payments WHERE id = 'pay_projection_parent') AS payments`,
    );
    expect(rows.rows[0]).toEqual({ customers: '1', orders: '1', payments: '1' });
  });

  it('initializes an invoice floor equal to amount and preserves it on updates', async () => {
    const issued = webhook('invoice.issued', 'invoice', {
      entity: 'invoice', id: 'inv_projection_001', amount: 420000, amount_due: 420000, currency: 'INR', status: 'issued', customer_id: 'cus_inv_001',
    }, 1_757_000_050);
    const paid = webhook('invoice.paid', 'invoice', {
      entity: 'invoice', id: 'inv_projection_001', amount: 420000, amount_paid: 420000, currency: 'INR', status: 'paid', customer_id: 'cus_inv_001',
    }, 1_757_000_051);
    await insertEvent(pool, 'evt_projection_inv_issued', issued);
    await insertEvent(pool, 'evt_projection_inv_paid', paid);
    await withTransaction(pool, (tx) => applyProjection(tx, issued, { eventId: 'evt_projection_inv_issued', eventAt: new Date(1_757_000_050_000) }));
    await pool.query('UPDATE invoices SET floor_amount_paise = 300000 WHERE id = $1', ['inv_projection_001']);
    await withTransaction(pool, (tx) => applyProjection(tx, paid, { eventId: 'evt_projection_inv_paid', eventAt: new Date(1_757_000_051_000) }));
    expect((await pool.query<{ amount_paise: number; floor_amount_paise: number; status: string; version: number }>(
      'SELECT amount_paise, floor_amount_paise, status, version FROM invoices WHERE id = $1', ['inv_projection_001'],
    )).rows[0]).toMatchObject({ amount_paise: 420000, floor_amount_paise: 300000, status: 'paid', version: 2 });
  });

  it('does not deadlock when an order event and a payment event share an order and a customer', async () => {
    // Intent: every projection must take rows in one global order (payments -> orders -> customers). When the payment
    //         path took the customer row first it formed an ABBA cycle with `projectOrder` and PostgreSQL aborted one
    //         side with 40P01 (B-006), which is invisible to a Promise.all race that happens to interleave benignly.
    // Flow: transaction A takes the order lock `projectOrder` opens with -> transaction B runs the whole payment
    //       projection and must park on the order row, never on the customer row -> A then runs `projectOrder` to
    //       completion. Before the fix, A's customer upsert closed the cycle and one transaction died with 40P01.
    const paymentEvent = webhook('payment.captured', 'payment', {
      entity: 'payment', id: 'pay_lock_order', amount: 149900, currency: 'INR', status: 'captured',
      order_id: 'order_lock_order', customer_id: 'cus_lock_order', contact: '+91******42',
    }, 1_757_000_060);
    const orderEvent = webhook('order.paid', 'order', {
      entity: 'order', id: 'order_lock_order', amount: 149900, currency: 'INR', status: 'paid', customer_id: 'cus_lock_order',
    }, 1_757_000_061);
    await insertEvent(pool, 'evt_lock_order_payment', paymentEvent);
    await insertEvent(pool, 'evt_lock_order_order', orderEvent);
    // Both parents already exist and are committed: the steady state after either entity's first sighting.
    await pool.query("INSERT INTO customers (id, contact) VALUES ('cus_lock_order', '+91******42')");
    await pool.query("INSERT INTO orders (id, customer_id, amount_paise, currency, status) VALUES ('order_lock_order', 'cus_lock_order', 149900, 'INR', 'created')");

    const orderTx = await pool.connect();
    const paymentTx = await pool.connect();
    try {
      await orderTx.query('BEGIN');
      await paymentTx.query('BEGIN');
      await orderTx.query('SELECT * FROM orders WHERE id = $1 FOR UPDATE', ['order_lock_order']);

      const payment = projectPayment(paymentTx, paymentEvent, { eventId: 'evt_lock_order_payment', eventAt: new Date(1_757_000_060_000) });
      await waitForLockWait(pool);

      const order = await projectOrder(orderTx, orderEvent, { eventId: 'evt_lock_order_order', eventAt: new Date(1_757_000_061_000) });
      await orderTx.query('COMMIT');
      expect(order.applied).toBe(true);

      await payment;
      await paymentTx.query('COMMIT');
    } finally {
      await orderTx.query('ROLLBACK').catch(() => undefined);
      await paymentTx.query('ROLLBACK').catch(() => undefined);
      orderTx.release();
      paymentTx.release();
    }

    expect((await pool.query<{ status: string; version: number }>('SELECT status, version FROM orders WHERE id = $1', ['order_lock_order'])).rows[0])
      .toMatchObject({ status: 'paid', version: 2 });
    expect((await pool.query<{ status: string; order_id: string; version: number }>('SELECT status, order_id, version FROM payments WHERE id = $1', ['pay_lock_order'])).rows[0])
      .toMatchObject({ status: 'captured', order_id: 'order_lock_order', version: 1 });
  }, 20_000);

  it('reserves an unseen order slot before the payment customer lock', async () => {
    // Intent: an absent-row `FOR UPDATE` acquires nothing. A payment that then upserts its customer can deadlock an
    // order transaction holding an uncommitted order row and waiting for that same customer (B-007).
    // Flow: order transaction inserts the unseen order slot -> payment transaction must wait on that slot before
    //       touching customers -> order projection completes and commits -> payment resumes without an ABBA cycle.
    const paymentEvent = webhook('payment.captured', 'payment', {
      entity: 'payment', id: 'pay_cold_start_lock', amount: 149900, currency: 'INR', status: 'captured',
      order_id: 'order_cold_start_lock', customer_id: 'cus_cold_start_lock', contact: '+91******42',
    }, 1_757_000_070);
    const orderEvent = webhook('order.paid', 'order', {
      entity: 'order', id: 'order_cold_start_lock', amount: 149900, currency: 'INR', status: 'paid', customer_id: 'cus_cold_start_lock',
    }, 1_757_000_071);
    await insertEvent(pool, 'evt_cold_start_payment', paymentEvent);
    await insertEvent(pool, 'evt_cold_start_order', orderEvent);

    const orderTx = await pool.connect();
    const paymentTx = await pool.connect();
    try {
      await orderTx.query('BEGIN');
      await paymentTx.query('BEGIN');
      await orderTx.query(
        `INSERT INTO orders (id, customer_id, amount_paise, currency, status, items, notes, version)
         VALUES ($1, NULL, $2, $3, 'created', '[]'::jsonb, '{}'::jsonb, 1)`,
        ['order_cold_start_lock', 149900, 'INR'],
      );

      const payment = projectPayment(paymentTx, paymentEvent, { eventId: 'evt_cold_start_payment', eventAt: new Date(1_757_000_070_000) });
      await waitForLockWait(pool);

      const order = await projectOrder(orderTx, orderEvent, { eventId: 'evt_cold_start_order', eventAt: new Date(1_757_000_071_000) });
      await orderTx.query('COMMIT');
      expect(order.applied).toBe(true);

      await payment;
      await paymentTx.query('COMMIT');
    } finally {
      await orderTx.query('ROLLBACK').catch(() => undefined);
      await paymentTx.query('ROLLBACK').catch(() => undefined);
      orderTx.release();
      paymentTx.release();
    }

    expect((await pool.query<{ status: string; version: number; last_event_id: string }>(
      'SELECT status, version, last_event_id FROM orders WHERE id = $1', ['order_cold_start_lock'],
    )).rows[0]).toMatchObject({ status: 'paid', version: 2, last_event_id: 'evt_cold_start_order' });
    expect((await pool.query<{ status: string; order_id: string; version: number; last_event_id: string }>(
      'SELECT status, order_id, version, last_event_id FROM payments WHERE id = $1', ['pay_cold_start_lock'],
    )).rows[0]).toMatchObject({ status: 'captured', order_id: 'order_cold_start_lock', version: 1, last_event_id: 'evt_cold_start_payment' });
  }, 20_000);
});
