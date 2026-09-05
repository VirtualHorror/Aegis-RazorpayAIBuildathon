import { config as loadDotenv } from 'dotenv';
import pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { migrateUp } from '../../db/migrate';
import { MIGRATIONS_DIR, REPO_ROOT_ENV } from '../../db/paths';
import { assemble } from './assemble';

loadDotenv({ path: REPO_ROOT_ENV, quiet: true });
const databaseUrl = process.env.DATABASE_URL_TEST;
const integration = databaseUrl ? describe : describe.skip;

integration('chargeback evidence assembly', () => {
  let pool: pg.Pool;

  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: databaseUrl, application_name: 'aegis-evidence-tests', max: 4 });
    await migrateUp(pool, MIGRATIONS_DIR, { info: () => undefined, warn: () => undefined });
  });

  beforeEach(async () => {
    await pool.query('TRUNCATE TABLE evidence_packets, outbound_messages, actions, disputes, payments, orders, customers, webhook_events CASCADE');
    await pool.query(
      `INSERT INTO customers (id, name, country, locale, created_at)
       VALUES ('cus_evidence_test', 'Customer', 'IN', 'en-IN', '2026-09-01T00:00:00Z')`,
    );
    await pool.query(
      `INSERT INTO orders (id, customer_id, amount_paise, currency, status, receipt, items, notes)
       VALUES ('order_evidence_test', 'cus_evidence_test', 899900, 'INR', 'paid', 'receipt-1',
               '[{"sku":"sku-1","name":"Widget","quantity":1}]'::jsonb,
               '{"delivery":{"carrier":"DHL","tracking":"TRACK-1","delivered_at":"2026-09-03T00:00:00Z","proof_url":"https://example.test/proof"},"refund_policy":{"url":"https://example.test/refunds","summary":"Refunds are available within 30 days."}}'::jsonb)`,
    );
    await pool.query(
      `INSERT INTO payments (id, order_id, customer_id, amount_paise, currency, status, status_rank, method, card_network, international, notes, rzp_created_at)
       VALUES ('pay_evidence_test', 'order_evidence_test', 'cus_evidence_test', 899900, 'INR', 'captured', 2, 'card', 'visa', false, '{"card_last4":"4242"}'::jsonb, '2026-09-03T00:00:00Z')`,
    );
    await pool.query(
      `INSERT INTO disputes (id, payment_id, amount_paise, currency, reason_code, reason_description, phase, status, respond_by, created_at)
       VALUES ('disp_evidence_test', 'pay_evidence_test', 899900, 'INR', 'product_not_received', 'The buyer says the product was not received.', 'retrieval', 'open', '2026-09-10T00:00:00Z', '2026-09-04T00:00:00Z')`,
    );
    await pool.query(
      `INSERT INTO webhook_events (event_id, event_type, payload, payload_sha256, signature_valid, status)
       VALUES ('evt_evidence_message', 'payment.failed', '{}'::jsonb, 'sha-evidence-message', true, 'processed')`,
    );
    await pool.query(
      `INSERT INTO actions (id, idempotency_key, module, module_version, trigger_event_id, entity_type, entity_id, customer_id, kind, summary, proposal, bounds, status)
       VALUES ('00000000-0000-4000-8000-000000000001', 'evidence-message-action', 'checkout_recovery', 'v1', 'evt_evidence_message', 'payment', 'pay_evidence_test', 'cus_evidence_test', 'message', 'message', '{}'::jsonb, '[]'::jsonb, 'executed')`,
    );
    await pool.query(
      `INSERT INTO outbound_messages (action_id, channel, recipient_masked, locale, template, payload, status)
       VALUES ('00000000-0000-4000-8000-000000000001', 'email', 'c••••@example.test', 'en-IN', 'receipt', '{}'::jsonb, 'simulated_sent')`,
    );
  });

  afterAll(async () => {
    await pool?.end();
  });

  it('assembles every available section in disputes-to-customers order', async () => {
    const packet = await assemble(pool, 'disp_evidence_test');
    expect(packet.missing).toEqual([]);
    expect(packet.payment).toMatchObject({ id: 'pay_evidence_test', card_last4: '4242', captured_at: '2026-09-03T00:00:00.000Z' });
    expect(packet.customer.id_masked).not.toContain('cus_evidence_test');
    expect(packet.delivery).toMatchObject({ carrier: 'DHL', tracking: 'TRACK-1' });
    expect(packet.communications).toHaveLength(1);
    expect(packet.prior_disputes).toBe(0);
  });

  it('records delivery as missing when the order has no delivery proof', async () => {
    await pool.query(`UPDATE orders SET notes = '{"refund_policy":{"summary":"Refunds are available."}}'::jsonb WHERE id = 'order_evidence_test'`);
    const packet = await assemble(pool, 'disp_evidence_test');
    expect(packet.missing).toContain('delivery');
    expect(packet.delivery).toBeNull();
  });
});
