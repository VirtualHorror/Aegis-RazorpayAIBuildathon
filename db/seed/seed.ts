import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { config as loadDotenv } from 'dotenv';
import { loadConfig } from '../../apps/api/src/config';
import { REPO_ROOT_ENV } from '../../apps/api/src/db/paths';
import { CUSTOMERS } from './data/customers';
import { GUARDRAIL_DEFAULTS } from './data/guardrails';
import { PRODUCTS } from './data/products';

interface SeedInvoice {
  readonly id: string;
  readonly customerId: string;
  readonly amountPaise: number;
  readonly floorAmountPaise: number;
}

interface SeedSubscription {
  readonly id: string;
  readonly planId: string;
  readonly customerId: string;
  readonly amountPaise: number;
}

interface SeedOrder {
  readonly id: string;
  readonly customerId: string;
  readonly amountPaise: number;
  readonly status: 'created' | 'attempted' | 'paid' | 'abandoned';
  readonly items: readonly { readonly productId: string; readonly quantity: number }[];
}

// Intent: these rows make downstream recovery, negotiation, and projection screens useful immediately after setup.
// Flow:   customers are inserted first for foreign keys -> invoices/subscriptions/orders reference those stable ids -> counts are printed.
const INVOICES: readonly SeedInvoice[] = [
  { id: 'inv_001', customerId: 'cus_005', amountPaise: 42_000_000, floorAmountPaise: 35_700_000 },
  { id: 'inv_002', customerId: 'cus_006', amountPaise: 12_500_000, floorAmountPaise: 10_625_000 },
  { id: 'inv_003', customerId: 'cus_007', amountPaise: 6_000_000, floorAmountPaise: 5_100_000 },
];

const SUBSCRIPTIONS: readonly SeedSubscription[] = [
  { id: 'sub_001', planId: 'plan_pro', customerId: 'cus_001', amountPaise: 249_900 },
  { id: 'sub_002', planId: 'plan_team', customerId: 'cus_002', amountPaise: 499_900 },
  { id: 'sub_003', planId: 'plan_pro', customerId: 'cus_003', amountPaise: 249_900 },
  { id: 'sub_004', planId: 'plan_starter', customerId: 'cus_004', amountPaise: 99_900 },
];

const ORDERS: readonly SeedOrder[] = [
  { id: 'order_001', customerId: 'cus_001', amountPaise: 49_900, status: 'paid', items: [{ productId: 'prod_001', quantity: 1 }] },
  { id: 'order_002', customerId: 'cus_002', amountPaise: 99_900, status: 'attempted', items: [{ productId: 'prod_002', quantity: 1 }] },
  { id: 'order_003', customerId: 'cus_003', amountPaise: 29_900, status: 'created', items: [{ productId: 'prod_003', quantity: 1 }] },
  { id: 'order_004', customerId: 'cus_004', amountPaise: 79_900, status: 'abandoned', items: [{ productId: 'prod_004', quantity: 1 }] },
  { id: 'order_005', customerId: 'cus_005', amountPaise: 69_900, status: 'paid', items: [{ productId: 'prod_005', quantity: 1 }] },
  { id: 'order_006', customerId: 'cus_008', amountPaise: 9_900, status: 'created', items: [{ productId: 'prod_006', quantity: 1 }] },
];

export interface SeedCounts {
  readonly customers: number;
  readonly products: number;
  readonly guardrails: number;
  readonly invoices: number;
  readonly subscriptions: number;
  readonly orders: number;
}

/**
 * Apply the complete demo fixture atomically and return row counts.
 * Intent: a failed seed must leave no half-written demo state, while a rerun must safely refresh every fixture row.
 * Flow:   connect -> BEGIN -> upsert each fixture group in dependency order -> COMMIT -> count rows -> close the pool.
 */
export async function seedDatabase(databaseUrl: string): Promise<SeedCounts> {
  const pool = new pg.Pool({
    connectionString: databaseUrl,
    application_name: 'aegis-seed',
    connectionTimeoutMillis: 2_000,
  });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await insertCustomers(client);
    await insertProducts(client);
    await insertGuardrails(client);
    await insertInvoices(client);
    await insertSubscriptions(client);
    await insertOrders(client);
    await client.query('COMMIT');
  } catch (error) {
    // Intent: preserve the original seed failure while making rollback failures visible to the operator.
    // Flow:   attempt rollback -> log rollback failure if needed -> rethrow the original error to the CLI.
    try {
      await client.query('ROLLBACK');
    } catch (rollbackError) {
      console.error('seed rollback failed', rollbackError);
    }
    throw error;
  } finally {
    client.release();
    await pool.end();
  }

  const countsPool = new pg.Pool({
    connectionString: databaseUrl,
    application_name: 'aegis-seed-counts',
    connectionTimeoutMillis: 2_000,
  });
  try {
    // Intent: report database truth after commit so operators can verify idempotency from the command output.
    // Flow:   count each seeded table -> return only the rows this task owns.
    return {
      customers: await countRows(countsPool, 'customers'),
      products: await countRows(countsPool, 'products'),
      guardrails: await countRows(countsPool, 'guardrail_config'),
      invoices: await countRows(countsPool, 'invoices'),
      subscriptions: await countRows(countsPool, 'subscriptions'),
      orders: await countRows(countsPool, 'orders'),
    };
  } finally {
    await countsPool.end();
  }
}

async function insertCustomers(client: pg.PoolClient): Promise<void> {
  for (const customer of CUSTOMERS) {
    await client.query(
      `INSERT INTO customers (id, name, email, contact, country, locale, opted_out, notes)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)
       ON CONFLICT (id) DO UPDATE SET
         name = EXCLUDED.name, email = EXCLUDED.email, contact = EXCLUDED.contact,
         country = EXCLUDED.country, locale = EXCLUDED.locale, opted_out = EXCLUDED.opted_out,
         notes = EXCLUDED.notes, updated_at = now()`,
      [customer.id, customer.name, customer.email, customer.contact, customer.country, customer.locale, customer.optedOut, JSON.stringify(customer.notes)],
    );
  }
}

async function insertProducts(client: pg.PoolClient): Promise<void> {
  for (const product of PRODUCTS) {
    await client.query(
      `INSERT INTO products (id, merchant_id, name, description, category, price_paise, sku, active, agent_purchasable)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       ON CONFLICT (id) DO UPDATE SET
         merchant_id = EXCLUDED.merchant_id, name = EXCLUDED.name, description = EXCLUDED.description,
         category = EXCLUDED.category, price_paise = EXCLUDED.price_paise, sku = EXCLUDED.sku,
         active = EXCLUDED.active, agent_purchasable = EXCLUDED.agent_purchasable, updated_at = now()`,
      [product.id, product.merchantId, product.name, product.description, product.category, product.pricePaise, product.sku, product.active, product.agentPurchasable],
    );
  }
}

async function insertGuardrails(client: pg.PoolClient): Promise<void> {
  for (const guardrail of GUARDRAIL_DEFAULTS) {
    await client.query(
      `INSERT INTO guardrail_config (key, value, description, updated_by)
       VALUES ($1, $2::jsonb, $3, 'seed')
       ON CONFLICT (key) DO UPDATE SET
         value = EXCLUDED.value, description = EXCLUDED.description, updated_by = 'seed', updated_at = now()`,
      [guardrail.key, JSON.stringify(guardrail.value), guardrail.description],
    );
  }
}

async function insertInvoices(client: pg.PoolClient): Promise<void> {
  for (const invoice of INVOICES) {
    await client.query(
      `INSERT INTO invoices (id, customer_id, amount_paise, floor_amount_paise, status, due_by, line_items)
       VALUES ($1, $2, $3, $4, 'issued', now() + interval '7 days', '[]'::jsonb)
       ON CONFLICT (id) DO UPDATE SET
         customer_id = EXCLUDED.customer_id, amount_paise = EXCLUDED.amount_paise,
         floor_amount_paise = EXCLUDED.floor_amount_paise, status = EXCLUDED.status,
         due_by = EXCLUDED.due_by, line_items = EXCLUDED.line_items, updated_at = now()`,
      [invoice.id, invoice.customerId, invoice.amountPaise, invoice.floorAmountPaise],
    );
  }
}

async function insertSubscriptions(client: pg.PoolClient): Promise<void> {
  for (const subscription of SUBSCRIPTIONS) {
    await client.query(
      `INSERT INTO subscriptions (id, plan_id, customer_id, status, amount_paise, current_start, current_end)
       VALUES ($1, $2, $3, 'active', $4, now() - interval '30 days', now() + interval '30 days')
       ON CONFLICT (id) DO UPDATE SET
         plan_id = EXCLUDED.plan_id, customer_id = EXCLUDED.customer_id, status = EXCLUDED.status,
         amount_paise = EXCLUDED.amount_paise, current_start = EXCLUDED.current_start,
         current_end = EXCLUDED.current_end, updated_at = now()`,
      [subscription.id, subscription.planId, subscription.customerId, subscription.amountPaise],
    );
  }
}

async function insertOrders(client: pg.PoolClient): Promise<void> {
  for (const order of ORDERS) {
    await client.query(
      `INSERT INTO orders (id, customer_id, amount_paise, status, items)
       VALUES ($1, $2, $3, $4, $5::jsonb)
       ON CONFLICT (id) DO UPDATE SET
         customer_id = EXCLUDED.customer_id, amount_paise = EXCLUDED.amount_paise,
         status = EXCLUDED.status, items = EXCLUDED.items, updated_at = now()`,
      [order.id, order.customerId, order.amountPaise, order.status, JSON.stringify(order.items)],
    );
  }
}

type SeedTable = 'customers' | 'products' | 'guardrail_config' | 'invoices' | 'subscriptions' | 'orders';

async function countRows(pool: pg.Pool, table: SeedTable): Promise<number> {
  const result = await pool.query<{ count: number }>(`SELECT count(*)::int AS count FROM ${table}`);
  const count = result.rows[0]?.count;
  if (count === undefined) throw new Error(`count query returned no row for ${table}`);
  return count;
}

async function main(): Promise<void> {
  loadDotenv({ path: REPO_ROOT_ENV, quiet: true });
  const config = loadConfig();
  const counts = await seedDatabase(config.DATABASE_URL);
  console.log(
    `seeded: customers=${counts.customers}, products=${counts.products}, guardrails=${counts.guardrails}, invoices=${counts.invoices}, subscriptions=${counts.subscriptions}, orders=${counts.orders}`,
  );
}

const invokedDirectly = process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  main().catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });
}
