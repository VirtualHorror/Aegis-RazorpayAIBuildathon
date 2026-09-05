import type pg from 'pg';
import { withTransaction } from '../db/tx';
import { LlmUnavailableError, type LlmClient } from '../llm/client';
import { nlToForecastSpecPrompt } from '../llm/prompts/nl-to-forecast-spec';
import { summarizeQueryResultPrompt } from '../llm/prompts/summarize-query-result';
import { textToSqlPrompt } from '../llm/prompts/text-to-sql';
import { forecast, type ForecastResult } from './forecast';
import { classifyIntent, metricFromQuestion, type AskIntent, type ForecastMetric } from './intent';
import { metricQuery, type DailyMetricPoint } from './metrics';
import { validateSql, type ValidationResult } from './validator';

export interface AskServiceOptions {
  readonly db: pg.Pool;
  readonly readonlyDb?: pg.Pool | null;
  readonly llm: LlmClient;
  readonly now?: () => Date;
}

export interface AskQueryResponse {
  readonly kind: 'query';
  readonly sql: string | null;
  readonly validation: { readonly ok: boolean; readonly errors?: string[] };
  readonly rows: readonly Record<string, unknown>[];
  readonly summary: string | null;
  readonly executed: boolean;
  readonly degraded: boolean;
  readonly error?: string;
  readonly queryId?: string;
}

export interface AskForecastResponse {
  readonly kind: 'forecast';
  readonly sql: string;
  readonly metric: ForecastMetric;
  readonly series: readonly DailyMetricPoint[];
  readonly forecast: ForecastResult;
  readonly summary: string;
  readonly executed: boolean;
  readonly degraded: boolean;
  readonly error?: string;
  readonly queryId?: string;
}

export type AskResponse = AskQueryResponse | AskForecastResponse;

export interface AskHistoryRow {
  readonly id: string;
  readonly question: string;
  readonly generated_sql: string | null;
  readonly validated: boolean;
  readonly validation_errors: unknown;
  readonly executed: boolean;
  readonly row_count: number | null;
  readonly latency_ms: number | null;
  readonly provider: string | null;
  readonly model: string | null;
  readonly degraded: boolean;
  readonly summary: string | null;
  readonly error: string | null;
  readonly created_at: Date;
}

/**
 * Ask Aegis service boundary.
 * Intent: the model can propose language (SQL or a summary), while routing, validation, execution, and forecast math
 *         remain deterministic and auditable.
 * Flow: classify -> model call outside locks -> persist generated SQL -> validate/readonly transaction -> summarise or
 *       forecast in TypeScript -> update the durable nl_queries row.
 */
export class AskService {
  private readonly db: pg.Pool;
  private readonly readonlyDb: pg.Pool;
  private readonly llm: LlmClient;
  private readonly now: () => Date;

  constructor(options: AskServiceOptions) {
    this.db = options.db;
    // Tests commonly provide one pool. Production passes the separate aegis_readonly pool from createPools().
    this.readonlyDb = options.readonlyDb ?? options.db;
    this.llm = options.llm;
    this.now = options.now ?? (() => new Date());
  }

  async ask(question: string): Promise<AskResponse> {
    const normalized = question.trim();
    if (normalized.length === 0) throw new TypeError('question must not be empty');
    const intent = classifyIntent(normalized);
    return intent.kind === 'forecast' ? this.askForecast(normalized, intent) : this.askQuery(normalized);
  }

  async history(limit = 50): Promise<AskHistoryRow[]> {
    const bounded = Number.isSafeInteger(limit) ? Math.max(1, Math.min(100, limit)) : 50;
    const result = await this.db.query<AskHistoryRow>(
      `SELECT id, question, generated_sql, validated, validation_errors, executed, row_count, latency_ms,
              provider, model, degraded, summary, error, created_at
       FROM nl_queries ORDER BY created_at DESC LIMIT $1`,
      [bounded],
    );
    return result.rows;
  }

  private async askQuery(question: string): Promise<AskQueryResponse> {
    const started = Date.now();
    let generatedSql: string | null = null;
    let provider = this.llm.provider;
    let model: string | null = modelFor(this.llm);
    let degraded = false;
    let validation: ValidationResult;
    try {
      const result = await this.llm.completeJson({ ...textToSqlPrompt, purpose: 'text_to_sql', user: textToSqlPrompt.buildUser(question) });
      generatedSql = result.data.sql;
      provider = result.provider;
      model = result.model;
      validation = validateSql(generatedSql);
    } catch (error) {
      degraded = true;
      validation = { ok: false, errors: [error instanceof Error ? error.message : String(error)] };
    }

    const queryId = await insertQuery(this.db, {
      question,
      generatedSql,
      validated: validation.ok,
      validationErrors: validation.ok ? null : validation.errors,
      provider,
      model,
      degraded,
    });
    if (!validation.ok) {
      const error = validation.errors.join('; ');
      await finishQuery(this.db, queryId, { executed: false, rowCount: 0, latencyMs: Date.now() - started, error });
      return { kind: 'query', sql: generatedSql, validation: { ok: false, errors: validation.errors }, rows: [], summary: null, executed: false, degraded, error, queryId };
    }

    let rows: Record<string, unknown>[] = [];
    let executionError: string | undefined;
    try {
      rows = await executeReadonly(this.readonlyDb, validation.sql);
    } catch (error) {
      executionError = error instanceof Error ? error.message : String(error);
    }
    if (executionError) {
      await finishQuery(this.db, queryId, { executed: false, rowCount: 0, latencyMs: Date.now() - started, error: executionError });
      return { kind: 'query', sql: generatedSql, validation: { ok: true }, rows: [], summary: null, executed: false, degraded, error: executionError, queryId };
    }

    let summary: string;
    try {
      const result = await this.llm.completeJson({
        ...summarizeQueryResultPrompt,
        purpose: 'summarize_query_result',
        user: summarizeQueryResultPrompt.buildUser({ question, rows }),
      });
      summary = result.data.summary;
      provider = result.provider;
      model = result.model;
    } catch (error) {
      if (!(error instanceof LlmUnavailableError)) throw error;
      degraded = true;
      summary = fallbackSummary(rows);
    }
    await finishQuery(this.db, queryId, { executed: true, rowCount: rows.length, latencyMs: Date.now() - started, summary, provider, model, error: null });
    return { kind: 'query', sql: generatedSql, validation: { ok: true }, rows, summary, executed: true, degraded, queryId };
  }

  private async askForecast(question: string, intent: Extract<AskIntent, { kind: 'forecast' }>): Promise<AskForecastResponse> {
    const started = Date.now();
    let metric = intent.metric ?? metricFromQuestion(question) ?? 'recovered_revenue';
    let windowDays = intent.windowDays ?? 30;
    let horizonDays = intent.horizonDays ?? 7;
    let provider = this.llm.provider;
    let model: string | null = modelFor(this.llm);
    let degraded = false;
    try {
      const result = await this.llm.completeJson({ ...nlToForecastSpecPrompt, purpose: 'nl_to_forecast_spec', user: nlToForecastSpecPrompt.buildUser(question) });
      provider = result.provider;
      model = result.model;
      // Explicit metric/day phrases in the user's question take precedence over a model's generic fallback fixture.
      metric = metricFromQuestion(question) ?? result.data.metric;
      windowDays = intent.windowDays ?? result.data.window_days;
      horizonDays = intent.horizonDays ?? result.data.horizon_days;
    } catch (error) {
      if (!(error instanceof LlmUnavailableError)) throw error;
      degraded = true;
    }
    windowDays = clampDays(windowDays, 30);
    horizonDays = clampDays(horizonDays, 7);
    const metricSql = metricQuery(metric, windowDays);
    const queryId = await insertQuery(this.db, {
      question,
      generatedSql: metricSql.sql,
      validated: true,
      validationErrors: null,
      provider,
      model,
      degraded,
    });
    let series: DailyMetricPoint[];
    try {
      series = await executeReadonlyMetric(this.readonlyDb, metricSql.sql, metricSql.params);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await finishQuery(this.db, queryId, { executed: false, rowCount: 0, latencyMs: Date.now() - started, error: message });
      return {
        kind: 'forecast', sql: metricSql.sql, metric, series: [], forecast: emptyForecast(horizonDays), summary: 'Forecast could not be computed.',
        executed: false, degraded, error: message, queryId,
      };
    }
    const result = forecast(series, horizonDays);
    const summary = `${series.length} daily points for ${metric}; ${result.points.length}-day deterministic forecast (${result.method}).`;
    await finishQuery(this.db, queryId, { executed: true, rowCount: series.length, latencyMs: Date.now() - started, summary, provider, model, error: null });
    return { kind: 'forecast', sql: metricSql.sql, metric, series, forecast: result, summary, executed: true, degraded, queryId };
  }
}

export function createAskService(options: AskServiceOptions): AskService {
  return new AskService(options);
}

export async function ask(options: AskServiceOptions, question: string): Promise<AskResponse> {
  return new AskService(options).ask(question);
}

export async function executeReadonly(db: pg.Pool, sql: string): Promise<Record<string, unknown>[]> {
  return withTransaction(db, async (tx) => {
    await tx.query("SET LOCAL statement_timeout = '5000ms'");
    const result = await tx.query<Record<string, unknown>>(sql);
    return result.rows;
  });
}

async function executeReadonlyMetric(db: pg.Pool, sql: string, params: readonly unknown[]): Promise<DailyMetricPoint[]> {
  return withTransaction(db, async (tx) => {
    await tx.query("SET LOCAL statement_timeout = '5000ms'");
    const result = await tx.query<{ date: string | Date; value: string | number }>(sql, [...params]);
    return result.rows.map((row) => ({ date: row.date instanceof Date ? row.date.toISOString().slice(0, 10) : String(row.date), value: Number(row.value) }));
  });
}

interface InsertQueryInput {
  question: string;
  generatedSql: string | null;
  validated: boolean;
  validationErrors: readonly string[] | null;
  provider: string | null;
  model: string | null;
  degraded: boolean;
}

async function insertQuery(db: pg.Pool, input: InsertQueryInput): Promise<string> {
  const result = await db.query<{ id: string }>(
    `INSERT INTO nl_queries (question, generated_sql, validated, validation_errors, provider, model, degraded)
     VALUES ($1, $2, $3, $4::jsonb, $5, $6, $7) RETURNING id`,
    [input.question, input.generatedSql, input.validated, input.validationErrors === null ? null : JSON.stringify(input.validationErrors), input.provider, input.model, input.degraded],
  );
  const id = result.rows[0]?.id;
  if (!id) throw new Error('nl_queries insert returned no id');
  return id;
}

async function finishQuery(db: pg.Pool, id: string, input: { executed: boolean; rowCount: number; latencyMs: number; summary?: string | null; provider?: string | null; model?: string | null; error?: string | null }): Promise<void> {
  await db.query(
    `UPDATE nl_queries SET executed = $2, row_count = $3, latency_ms = $4, summary = COALESCE($5, summary),
       provider = COALESCE($6, provider), model = COALESCE($7, model), error = $8 WHERE id = $1`,
    [id, input.executed, input.rowCount, input.latencyMs, input.summary ?? null, input.provider ?? null, input.model ?? null, input.error ?? null],
  );
}

function fallbackSummary(rows: readonly Record<string, unknown>[]): string {
  const first = rows[0];
  return `${rows.length} rows; first row: ${first === undefined ? 'none' : JSON.stringify(first)}`;
}

function modelFor(llm: LlmClient): string | null {
  if ('describe' in llm && typeof llm.describe === 'function') return llm.describe().model;
  if ('model' in llm && typeof llm.model === 'string') return llm.model;
  return null;
}

function clampDays(value: number, fallback: number): number {
  return Number.isSafeInteger(value) && value >= 1 && value <= 365 ? value : fallback;
}

function emptyForecast(horizonDays: number): ForecastResult {
  const points = Array.from({ length: horizonDays }, () => ({ date: '', value: 0, lower: 0, upper: 0 }));
  return { points, method: 'ols+ma7', slopePerDay: 0, r2: 0, intercept: 0, movingAverage7: 0, residualStddev: 0 };
}
