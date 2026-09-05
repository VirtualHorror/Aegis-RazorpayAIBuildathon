import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { config as loadDotenv } from 'dotenv';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { REPO_ROOT_ENV, MIGRATIONS_DIR } from '../src/db/paths';
import { migrateDown, migrateUp } from '../src/db/migrate';
import { loadGuardrailConfig } from '../src/db/repos/guardrails';
import { GUARDRAIL_DEFAULTS } from '../../../db/seed/data/guardrails';

loadDotenv({ path: REPO_ROOT_ENV, quiet: true });

const databaseUrl = process.env.DATABASE_URL_TEST;
const readonlyUrl = process.env.DATABASE_URL_READONLY;
const integration = databaseUrl ? describe : describe.skip;

const EXPECTED_TABLES = [
  'schema_migrations',
  'webhook_events',
  'jobs',
  'customers',
  'orders',
  'payments',
  'subscriptions',
  'invoices',
  'disputes',
  'evidence_packets',
  'diagnoses',
  'actions',
  'outbound_messages',
  'ledger_entries',
  'products',
  'compliance_scan_runs',
  'compliance_flags',
  'x402_payments',
  'nl_queries',
  'guardrail_config',
  'audit_log',
] as const;

const log = {
  info: (_message: string) => undefined,
  warn: (message: string) => console.warn(message),
};

integration('core schema migrations', () => {
  let pool: pg.Pool;

  beforeAll(async () => {
    // Intent: run against the dedicated test database so rollback coverage cannot delete development data.
    // Flow:   create one pool -> apply every pending migration -> each test observes the same committed schema.
    pool = new pg.Pool({ connectionString: databaseUrl, application_name: 'aegis-schema-tests' });
    await migrateUp(pool, MIGRATIONS_DIR, log);
  });

  afterAll(async () => {
    await pool?.end();
  });

  it('creates every Architecture.md section 6 table', async () => {
    // Intent: guard the evaluator-facing contract so a missing table cannot hide behind a successful migration row.
    // Flow:   query PostgreSQL's catalog -> compare the expected set -> report any missing table by name.
    const result = await pool.query<{ table_name: string }>(
      `SELECT table_name
       FROM information_schema.tables
       WHERE table_schema = 'public' AND table_name = ANY($1::text[])
       ORDER BY table_name`,
      [EXPECTED_TABLES],
    );
    expect(result.rows.map((row) => row.table_name).sort()).toEqual([...EXPECTED_TABLES].sort());
  });

  it('supports a full down/up round trip', async () => {
    // Intent: prove both down files are resolvable and leave the runner usable for a clean rebuild.
    // Flow:   revert grants -> revert schema -> reapply schema -> reapply grants -> verify migration status rows.
    expect((await migrateDown(pool, MIGRATIONS_DIR, log)).reverted).toBe('0002_readonly_grants');
    expect((await migrateDown(pool, MIGRATIONS_DIR, log)).reverted).toBe('0001_init');
    const afterDown = await pool.query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.tables
       WHERE table_schema = 'public' AND table_name = ANY($1::text[])`,
      [[...EXPECTED_TABLES].filter((table) => table !== 'schema_migrations')],
    );
    expect(afterDown.rows).toHaveLength(0);
    const up = await migrateUp(pool, MIGRATIONS_DIR, log);
    expect(up.applied).toEqual(['0001_init', '0002_readonly_grants']);
  });

  it('rejects checksum drift for an applied migration', async () => {
    // Intent: prove a historical migration cannot be silently edited after PostgreSQL recorded its checksum.
    // Flow:   apply an isolated probe migration -> edit only its temporary file -> require MigrationError -> roll the probe back.
    const dir = mkdtempSync(join(tmpdir(), 'aegis-drift-'));
    const upPath = join(dir, '9999_checksum_probe.sql');
    const downPath = join(dir, '9999_checksum_probe.down.sql');
    writeFileSync(upPath, 'CREATE TABLE checksum_probe (id integer);\n');
    writeFileSync(downPath, 'DROP TABLE checksum_probe;\n');
    try {
      expect((await migrateUp(pool, dir, log)).applied).toEqual(['9999_checksum_probe']);
      writeFileSync(upPath, 'CREATE TABLE checksum_probe (id bigint);\n');
      await expect(migrateUp(pool, dir, log)).rejects.toThrow(/9999_checksum_probe/);
      writeFileSync(upPath, 'CREATE TABLE checksum_probe (id integer);\n');
      expect((await migrateDown(pool, dir, log)).reverted).toBe('9999_checksum_probe');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('excludes customer email from the readonly role', async () => {
    if (!readonlyUrl) {
      console.warn('SKIP readonly grant assertion: DATABASE_URL_READONLY is not configured');
      return;
    }
    const role = await pool.query<{ exists: boolean }>("SELECT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'aegis_readonly') AS exists");
    if (!role.rows[0]?.exists) {
      console.warn('SKIP readonly grant assertion: role aegis_readonly is not present');
      return;
    }

    // Intent: connect as the actual AI SQL role; application-level filtering is not enough for this security boundary.
    // Flow:   point the readonly credentials at aegis_test -> request an omitted PII column -> require PostgreSQL denial.
    const source = new URL(readonlyUrl);
    const testDatabase = new URL(databaseUrl!);
    source.pathname = testDatabase.pathname;
    const readonlyPool = new pg.Pool({ connectionString: source.toString(), application_name: 'aegis-readonly-test' });
    try {
      await expect(readonlyPool.query('SELECT email FROM customers LIMIT 1')).rejects.toThrow(/permission denied/i);
    } finally {
      await readonlyPool.end();
    }
  });

  it('loads all seeded guardrails into the typed snapshot', async () => {
    // Intent: verify the worker-facing repository fails closed only after validating every seeded bound.
    // Flow:   insert the shared test fixtures after the round-trip -> read guardrail_config through the repository -> assert representative bounds.
    for (const guardrail of GUARDRAIL_DEFAULTS) {
      await pool.query(
        `INSERT INTO guardrail_config (key, value, description, updated_by)
         VALUES ($1, $2::jsonb, $3, 'test')
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, description = EXCLUDED.description, updated_by = 'test', updated_at = now()`,
        [guardrail.key, JSON.stringify(guardrail.value), guardrail.description],
      );
    }
    const config = await loadGuardrailConfig(pool);
    expect(config).toMatchObject({
      kill_switch: false,
      auto_approve_limit_paise: 200000,
      max_discount_pct: 15,
      dunning_schedule_hours: [24, 72, 168],
      quiet_hours_local: { start: 21, end: 8 },
      x402_max_amount_paise: 100000,
    });
  });
});
