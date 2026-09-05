import type pg from 'pg';
import type { EventBus } from '../bus/event-bus';
import { LlmUnavailableError, type LlmClient } from '../llm/client';
import { classifyCompliancePrompt } from '../llm/prompts/classify-compliance';
import { prescreen, type KeywordHit } from './keywords';
import { ComplianceAssessmentSchema, type ComplianceAssessment, type ComplianceCategory, type RiskLevel } from './rubric';
import { verifyEvidenceSpan } from './verify';

interface ProductRow { id: string; name: string; description: string; category: string | null }

export interface ComplianceScannerOptions {
  readonly db: pg.Pool;
  readonly llm: LlmClient;
  readonly bus?: EventBus;
  readonly now?: () => Date;
  readonly logger?: { info: (...args: unknown[]) => void; warn: (...args: unknown[]) => void; error: (...args: unknown[]) => void };
}

export interface ScanResult {
  readonly runId: string;
  readonly productsScanned: number;
  readonly flagsCreated: number;
  readonly degradedCount: number;
  readonly provider: string;
  readonly model: string | null;
}

/**
 * Scan active catalog copy in a bounded, restartable batch.
 * Intent: deterministic keyword evidence runs before the fast model; only the description crosses the model boundary
 *         (C-D4), and every model claim is verified before it becomes a flag.
 * Flow: create/load run -> read products -> prescreen -> call fast model outside transactions -> lock/upsert one flag
 *       per product/run -> finish counters and publish committed flags.
 */
export class ComplianceScanner {
  private readonly db: pg.Pool;
  private readonly llm: LlmClient;
  private readonly bus?: EventBus;
  private readonly now: () => Date;
  private readonly logger: NonNullable<ComplianceScannerOptions['logger']>;

  constructor(options: ComplianceScannerOptions) {
    this.db = options.db;
    this.llm = options.llm;
    this.bus = options.bus;
    this.now = options.now ?? (() => new Date());
    this.logger = options.logger ?? { info: () => undefined, warn: () => undefined, error: () => undefined };
  }

  async run(runId?: string): Promise<ScanResult> {
    const id = runId ?? await this.createRun();
    let products: ProductRow[] = [];
    let flagsCreated = 0;
    let degradedCount = 0;
    let provider = this.llm.provider;
    let model: string | null = modelFor(this.llm);
    try {
      products = await this.loadProducts();
      for (const product of products) {
        const keywordHits = prescreen(product.description);
        let assessment: ComplianceAssessment | null = null;
        try {
          const response = await this.llm.completeJson({
            ...classifyCompliancePrompt,
            purpose: 'classify_compliance',
            tier: 'fast',
            user: classifyCompliancePrompt.buildUser(product.description),
          });
          const parsed = ComplianceAssessmentSchema.safeParse(response.data);
          if (!parsed.success) {
            throw new LlmUnavailableError(`compliance_invalid_assessment: ${parsed.error.message}`, { cause: parsed.error });
          }
          assessment = parsed.data;
          provider = response.provider;
          model = response.model;
        } catch (error) {
          if (!(error instanceof LlmUnavailableError)) throw error;
          degradedCount += 1;
        }

        const flag = assessment
          ? buildModelFlag(assessment, product.description, keywordHits)
          : buildDegradedFlag(product.description, keywordHits);
        if (flag === null) continue;
        const inserted = await this.upsertFlag(id, product.id, flag);
        if (inserted) flagsCreated += 1;
        this.bus?.publish('compliance.flag', { runId: id, productId: product.id, flag });
      }
      flagsCreated = await this.finishRun(id, products.length, flagsCreated, provider, model, degradedCount, 'succeeded');
      return { runId: id, productsScanned: products.length, flagsCreated, degradedCount, provider, model };
    } catch (error) {
      await this.finishRun(id, products.length, flagsCreated, provider, model, degradedCount, 'failed');
      this.logger.error({ err: error, run_id: id }, 'compliance scan failed');
      throw error;
    }
  }

  private async createRun(): Promise<string> {
    const result = await this.db.query<{ id: string }>('INSERT INTO compliance_scan_runs (started_at, status) VALUES ($1, \'running\') RETURNING id', [this.now()]);
    const id = result.rows[0]?.id;
    if (!id) throw new Error('compliance scan run insert returned no id');
    return id;
  }

  private async loadProducts(): Promise<ProductRow[]> {
    const result = await this.db.query<ProductRow>('SELECT id, name, description, category FROM products WHERE active = true ORDER BY id');
    return result.rows;
  }

  private async upsertFlag(runId: string, productId: string, flag: FlagDraft): Promise<boolean> {
    const client = await this.db.connect();
    try {
      await client.query('BEGIN');
      // Intent: a missing row cannot be locked by SELECT FOR UPDATE, so concurrent workers could both insert a flag.
      // Flow: serialize this exact run/product pair with a transaction advisory lock -> inspect -> update or insert.
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [`compliance_flag:${runId}:${productId}`]);
      const existing = await client.query<{ id: string }>('SELECT id FROM compliance_flags WHERE product_id = $1 AND scan_run_id = $2 FOR UPDATE', [productId, runId]);
      if (existing.rows[0]?.id) {
        await client.query(
          `UPDATE compliance_flags SET keyword_hits = $3::jsonb, llm_assessment = $4::jsonb, risk_level = $5,
             category = $6, evidence_span = $7, recommendation = $8, status = $9 WHERE id = $1 AND product_id = $2`,
          [existing.rows[0].id, productId, JSON.stringify(flag.keywordHits), flag.llmAssessment === null ? null : JSON.stringify(flag.llmAssessment), flag.riskLevel, flag.category, flag.evidenceSpan, flag.recommendation, flag.status],
        );
        await client.query('COMMIT');
        return false;
      }
      await client.query(
        `INSERT INTO compliance_flags (product_id, scan_run_id, keyword_hits, llm_assessment, risk_level, category, evidence_span, recommendation, status)
         VALUES ($1, $2, $3::jsonb, $4::jsonb, $5, $6, $7, $8, $9)`,
        [productId, runId, JSON.stringify(flag.keywordHits), flag.llmAssessment === null ? null : JSON.stringify(flag.llmAssessment), flag.riskLevel, flag.category, flag.evidenceSpan, flag.recommendation, flag.status],
      );
      await client.query('COMMIT');
      return true;
    } catch (error) {
      try {
        await client.query('ROLLBACK');
      } catch (rollbackError) {
        this.logger.error({ err: rollbackError, run_id: runId, product_id: productId }, 'compliance flag rollback failed');
      }
      throw error;
    } finally {
      client.release();
    }
  }

  private async finishRun(runId: string, productsScanned: number, flagsCreated: number, provider: string, model: string | null, degradedCount: number, status: 'succeeded' | 'failed'): Promise<number> {
    // Intent: the durable row is the source of truth when a retry or two workers finish the same run.
    // Flow: count persisted flags -> update counters and terminal status in one statement.
    const count = await this.db.query<{ count: string }>('SELECT count(*)::text AS count FROM compliance_flags WHERE scan_run_id = $1', [runId]);
    const persistedFlags = Number(count.rows[0]?.count ?? flagsCreated);
    await this.db.query(
      `UPDATE compliance_scan_runs SET finished_at = $2, products_scanned = $3, flags_created = $4, provider = $5, model = $6, degraded_count = $7, status = $8 WHERE id = $1`,
      [runId, this.now(), productsScanned, persistedFlags, provider, model, degradedCount, status],
    );
    return persistedFlags;
  }
}

export interface FlagDraft {
  readonly keywordHits: readonly KeywordHit[];
  readonly llmAssessment: ComplianceAssessment | null;
  readonly riskLevel: RiskLevel;
  readonly category: ComplianceCategory;
  readonly evidenceSpan: string | null;
  readonly recommendation: string;
  readonly status: 'open' | 'needs_review';
}

function buildModelFlag(assessment: ComplianceAssessment, description: string, keywordHits: readonly KeywordHit[]): FlagDraft | null {
  const verified = verifyEvidenceSpan(assessment, description, keywordHits);
  if (assessment.risk_level === 'none' && keywordHits.length === 0) return null;
  const category = verified.category === 'none' && keywordHits[0] ? keywordHits[0].category : verified.category;
  // Keep the deterministic review reason even when the model filled the full recommendation budget.
  const recommendation = verified.note
    ? `${verified.note}${assessment.recommendation ? `: ${assessment.recommendation}` : ''}`.slice(0, 300)
    : assessment.recommendation;
  return {
    keywordHits,
    llmAssessment: assessment,
    riskLevel: verified.riskLevel,
    category,
    evidenceSpan: assessment.evidence_span || keywordHits[0]?.pattern || null,
    recommendation,
    status: verified.status,
  };
}

function buildDegradedFlag(description: string, keywordHits: readonly KeywordHit[]): FlagDraft | null {
  if (keywordHits.length === 0) return null;
  const first = keywordHits[0];
  const evidenceSpan = first ? actualSpan(description, first.pattern) : null;
  return {
    keywordHits,
    llmAssessment: null,
    riskLevel: 'medium',
    category: first?.category ?? 'none',
    evidenceSpan,
    recommendation: 'Human review required because the compliance model was unavailable.',
    status: 'needs_review',
  };
}

function actualSpan(description: string, pattern: string): string | null {
  const index = description.toLowerCase().indexOf(pattern.toLowerCase());
  return index < 0 ? null : description.slice(index, index + pattern.length);
}

function modelFor(llm: LlmClient): string | null {
  if ('describe' in llm && typeof llm.describe === 'function') return llm.describe().modelFast;
  if ('modelFast' in llm && typeof llm.modelFast === 'string') return llm.modelFast;
  if ('model' in llm && typeof llm.model === 'string') return llm.model;
  return null;
}

export const ComplianceScanService = ComplianceScanner;
