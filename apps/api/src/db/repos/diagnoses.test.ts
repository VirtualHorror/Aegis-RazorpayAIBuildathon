import { config as loadDotenv } from 'dotenv';
import pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { MIGRATIONS_DIR, REPO_ROOT_ENV } from '../paths';
import { migrateUp } from '../migrate';
import { withTransaction } from '../tx';
import {
  getDiagnosis,
  getLatestDiagnosisForEntity,
  insertDiagnosis,
  listDiagnosesForEvent,
  parseDiagnosisConfidence,
  type DiagnosisInsertInput,
} from './diagnoses';

loadDotenv({ path: REPO_ROOT_ENV, quiet: true });

const databaseUrl = process.env.DATABASE_URL_TEST;
const integration = databaseUrl ? describe : describe.skip;

const input: DiagnosisInsertInput = {
  eventId: 'evt_diagnosis_repo',
  entityType: 'payment',
  entityId: 'pay_diagnosis_repo',
  hints: {
    entity: 'payment',
    amount_band: 'small',
    prior_failures_24h: 0,
  },
  provider: 'stub',
  model: 'fixture-v1',
  promptVersion: 'v1',
  inputDigest: 'a'.repeat(64),
  output: {
    root_cause: 'THREE_DS_AUTH_FAILED',
    confidence: 0.9,
    intervention_strategy: 'RETRY_LINK_LOCALIZED',
    rationale: 'The payment authentication step failed before capture completed.',
    cross_check: { overridden: false, notes: [] },
  },
  rootCause: 'THREE_DS_AUTH_FAILED',
  confidence: 0.9,
  strategy: 'RETRY_LINK_LOCALIZED',
  rationale: 'The payment authentication step failed before capture completed.',
  latencyMs: 5,
  tokensIn: 0,
  tokensOut: 0,
};

describe('diagnosis repository boundary', () => {
  it('parses PostgreSQL numeric values into numbers and rejects invalid confidence', () => {
    expect(parseDiagnosisConfidence('0.900')).toBe(0.9);
    expect(parseDiagnosisConfidence(0.6)).toBe(0.6);
    expect(() => parseDiagnosisConfidence('not-a-number')).toThrow(/between 0 and 1/);
    expect(() => parseDiagnosisConfidence(1.01)).toThrow(/between 0 and 1/);
  });

  it('normalizes confidence returned by an insert without relying on a live database', async () => {
    const rawRow = {
      id: '00000000-0000-0000-0000-000000000001',
      event_id: input.eventId,
      entity_type: input.entityType,
      entity_id: input.entityId,
      hints: input.hints,
      provider: input.provider,
      model: input.model,
      prompt_version: input.promptVersion,
      input_digest: input.inputDigest,
      output: input.output,
      root_cause: input.rootCause,
      confidence: '0.900',
      strategy: input.strategy,
      rationale: input.rationale,
      degraded: false,
      degraded_reason: null,
      latency_ms: input.latencyMs ?? null,
      tokens_in: input.tokensIn ?? null,
      tokens_out: input.tokensOut ?? null,
      created_at: new Date(),
    };
    const tx = {
      query: async <T>() => ({ rows: [rawRow as unknown as T], rowCount: 1 }),
    } as unknown as pg.PoolClient;

    const row = await insertDiagnosis(tx, input);
    expect(row.confidence).toBe(0.9);
    expect(typeof row.confidence).toBe('number');
  });
});

integration('diagnosis repository persistence', () => {
  let pool: pg.Pool;

  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: databaseUrl, application_name: 'aegis-diagnosis-tests', max: 4 });
    await migrateUp(pool, MIGRATIONS_DIR, { info: () => undefined, warn: () => undefined });
  });

  beforeEach(async () => {
    // Intent: isolate this repository round-trip while preserving the migration-managed schema.
    // Flow: remove diagnoses and their event parents -> insert only the FK row needed by this test.
    await pool.query('TRUNCATE TABLE diagnoses, webhook_events RESTART IDENTITY CASCADE');
    await pool.query(
      `INSERT INTO webhook_events (event_id, event_type, account_id, payload, payload_sha256, signature_valid, status)
       VALUES ($1, 'payment.failed', 'acc_diagnosis_test', '{}'::jsonb, $1, true, 'received')`,
      [input.eventId],
    );
  });

  afterAll(async () => {
    await pool?.end();
  });

  it('round-trips a diagnosis and returns confidence as a number', async () => {
    const inserted = await withTransaction(pool, (tx) => insertDiagnosis(tx, input));
    expect(inserted.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(inserted.confidence).toBe(0.9);
    expect(typeof inserted.confidence).toBe('number');

    const read = await getDiagnosis(pool, inserted.id);
    expect(read).toMatchObject({ event_id: input.eventId, entity_type: input.entityType, entity_id: input.entityId });
    expect(read?.confidence).toBe(0.9);
    expect(typeof read?.confidence).toBe('number');

    const byEvent = await listDiagnosesForEvent(pool, input.eventId);
    expect(byEvent).toHaveLength(1);
    expect(byEvent[0]?.confidence).toBe(0.9);

    const latest = await getLatestDiagnosisForEntity(pool, input.entityType, input.entityId);
    expect(latest?.id).toBe(inserted.id);
  });
});
