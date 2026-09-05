import { config as loadDotenv } from 'dotenv';
import pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { LlmUnavailableError, type LlmClient, type LlmJsonRequest, type LlmJsonResult } from '../llm/client';
import { StubLlmClient } from '../llm/stub';
import type { ComplianceAssessment } from './rubric';
import { ComplianceScanner } from './scanner';
import { MIGRATIONS_DIR, REPO_ROOT_ENV } from '../db/paths';
import { migrateUp } from '../db/migrate';

loadDotenv({ path: REPO_ROOT_ENV, quiet: true });

const databaseUrl = process.env.DATABASE_URL_TEST;
const integration = databaseUrl ? describe : describe.skip;

function assessmentClient(factory: (description: string) => ComplianceAssessment): LlmClient {
  return {
    provider: 'test',
    completeJson: async <T>(request: LlmJsonRequest<T>): Promise<LlmJsonResult<T>> => {
      const value = factory(request.user);
      const data = request.schema.parse(value);
      return {
        data,
        provider: 'test',
        model: 'test-fast',
        latencyMs: 0,
        tokensIn: 0,
        tokensOut: 0,
        raw: JSON.stringify(value),
      };
    },
  };
}

integration('compliance scanner', () => {
  let pool: pg.Pool;

  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: databaseUrl, application_name: 'aegis-compliance-tests', max: 10 });
    await migrateUp(pool, MIGRATIONS_DIR, { info: () => undefined, warn: () => undefined });
  });

  beforeEach(async () => {
    await pool.query('TRUNCATE TABLE compliance_flags, compliance_scan_runs, products RESTART IDENTITY CASCADE');
  });

  afterAll(async () => {
    await pool?.end();
  });

  it('flags seeded risky descriptions with the deterministic keyword categories', async () => {
    await pool.query(
      `INSERT INTO products (id, merchant_id, name, description, category, price_paise, agent_purchasable)
       VALUES
       ('risk_finance', 'merchant_test', 'Returns', 'Course promising guaranteed returns every month.', 'financial_services', 100, false),
       ('risk_health', 'merchant_test', 'Wellness', 'A supplement that cures diabetes quickly.', 'health', 100, false),
       ('risk_counterfeit', 'merchant_test', 'Replica', 'A replica branded watch for collectors.', 'counterfeit', 100, false),
       ('risk_tobacco', 'merchant_test', 'Vape', 'Nicotine vape pods and refill accessories.', 'tobacco', 100, false),
       ('risk_gambling', 'merchant_test', 'Lottery', 'Lottery ticket bundle with betting odds.', 'gambling', 100, false),
       ('risk_weapon', 'merchant_test', 'Firearm', 'A firearm accessory for target practice.', 'weapons', 100, false)`,
    );

    const result = await new ComplianceScanner({ db: pool, llm: new StubLlmClient() }).run();
    expect(result.productsScanned).toBe(6);
    expect(result.flagsCreated).toBe(6);
    const flags = await pool.query<{ product_id: string; category: string; status: string }>(
      'SELECT product_id, category, status FROM compliance_flags ORDER BY product_id',
    );
    expect(flags.rows.map((row) => row.category)).toEqual([
      'counterfeit_ip',
      'financial_guarantees_mlm',
      'gambling_lottery',
      'medical_claims_unapproved',
      'tobacco_vape',
      'weapons',
    ]);
    expect(flags.rows.every((row) => row.status === 'needs_review')).toBe(true);
  });

  it('retains a review note when the model fabricates an evidence span', async () => {
    await pool.query(
      `INSERT INTO products (id, merchant_id, name, description, price_paise, agent_purchasable)
       VALUES ('risk_fabricated', 'merchant_test', 'Weapon', 'A legal firearm accessory.', 100, false)`,
    );
    const llm = assessmentClient(() => ({
      risk_level: 'high',
      category: 'weapons',
      evidence_span: 'not present in source',
      recommendation: 'Review this product.',
      reasoning: 'The model found a weapon.',
    }));
    const result = await new ComplianceScanner({ db: pool, llm }).run();
    expect(result.flagsCreated).toBe(1);
    const flag = await pool.query<{ status: string; recommendation: string }>('SELECT status, recommendation FROM compliance_flags');
    expect(flag.rows[0]).toMatchObject({ status: 'needs_review' });
    expect(flag.rows[0]?.recommendation).toContain('case-sensitive substring');
  });

  it('falls back to a medium-risk keyword flag when the model is unavailable', async () => {
    await pool.query(
      `INSERT INTO products (id, merchant_id, name, description, price_paise, agent_purchasable)
       VALUES ('risk_down', 'merchant_test', 'Vape', 'Nicotine vape pods.', 100, false)`,
    );
    const llm: LlmClient = {
      provider: 'offline',
      completeJson: async () => { throw new LlmUnavailableError('provider_down'); },
    };
    const result = await new ComplianceScanner({ db: pool, llm }).run();
    expect(result).toMatchObject({ flagsCreated: 1, degradedCount: 1, provider: 'offline' });
    const flag = await pool.query<{ risk_level: string; llm_assessment: unknown; status: string }>('SELECT risk_level, llm_assessment, status FROM compliance_flags');
    expect(flag.rows[0]).toEqual({ risk_level: 'medium', llm_assessment: null, status: 'needs_review' });
  });

  it('treats a malformed model payload as unavailable instead of persisting unvalidated JSON', async () => {
    await pool.query(
      `INSERT INTO products (id, merchant_id, name, description, price_paise, agent_purchasable)
       VALUES ('risk_malformed', 'merchant_test', 'Returns', 'Guaranteed returns course.', 100, false)`,
    );
    const llm: LlmClient = {
      provider: 'malformed',
      completeJson: async <T>(): Promise<LlmJsonResult<T>> => ({
        data: {} as T,
        provider: 'malformed',
        model: 'bad-fixture',
        latencyMs: 0,
        tokensIn: 0,
        tokensOut: 0,
        raw: '{}',
      }),
    };
    const result = await new ComplianceScanner({ db: pool, llm }).run();
    expect(result).toMatchObject({ flagsCreated: 1, degradedCount: 1 });
    const flag = await pool.query<{ llm_assessment: unknown; risk_level: string }>('SELECT llm_assessment, risk_level FROM compliance_flags');
    expect(flag.rows[0]).toEqual({ llm_assessment: null, risk_level: 'medium' });
  });

  it('serializes concurrent scans so a run has one flag per product', async () => {
    await pool.query(
      `INSERT INTO products (id, merchant_id, name, description, price_paise, agent_purchasable)
       VALUES ('risk_concurrent', 'merchant_test', 'Returns', 'Guaranteed returns course.', 100, false)`,
    );
    const inserted = await pool.query<{ id: string }>("INSERT INTO compliance_scan_runs (status) VALUES ('running') RETURNING id");
    const runId = inserted.rows[0]?.id;
    if (!runId) throw new Error('test run insert returned no id');
    await Promise.all([
      new ComplianceScanner({ db: pool, llm: new StubLlmClient() }).run(runId),
      new ComplianceScanner({ db: pool, llm: new StubLlmClient() }).run(runId),
    ]);
    const count = await pool.query<{ count: string }>('SELECT count(*)::text AS count FROM compliance_flags WHERE scan_run_id = $1', [runId]);
    expect(count.rows[0]?.count).toBe('1');
  });
});
