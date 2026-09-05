import type { Pool, PoolClient } from 'pg';
import type { EntityType } from '@aegis/shared';
import type { RootCause, Strategy } from '../../diagnosis/schema';

/**
 * The fields written by the diagnostician after its model call and deterministic cross-check.
 * Intent: keep persistence input in application naming while the SQL layer owns the snake_case mapping.
 * Flow: validate/serialize JSON values -> insert the complete audit row -> normalize the returned numeric value.
 */
export interface DiagnosisInsertInput {
  readonly eventId: string;
  readonly entityType: EntityType;
  readonly entityId: string;
  readonly hints: Record<string, unknown>;
  readonly provider: string;
  readonly model: string;
  readonly promptVersion: string;
  readonly inputDigest: string;
  /** Validated model output with `{ cross_check: { overridden, notes } }` added by the caller. */
  readonly output: Record<string, unknown>;
  readonly rootCause: RootCause;
  readonly confidence: number;
  readonly strategy: Strategy;
  readonly rationale: string;
  readonly degraded?: boolean;
  readonly degradedReason?: string | null;
  readonly latencyMs?: number | null;
  readonly tokensIn?: number | null;
  readonly tokensOut?: number | null;
}

/** Shape returned from the diagnoses table with JSON fields decoded by node-postgres. */
export interface DiagnosisRow {
  readonly id: string;
  readonly event_id: string;
  readonly entity_type: EntityType;
  readonly entity_id: string;
  readonly hints: Record<string, unknown>;
  readonly provider: string;
  readonly model: string;
  readonly prompt_version: string;
  readonly input_digest: string;
  readonly output: Record<string, unknown>;
  readonly root_cause: RootCause;
  readonly confidence: number;
  readonly strategy: Strategy;
  readonly rationale: string;
  readonly degraded: boolean;
  readonly degraded_reason: string | null;
  readonly latency_ms: number | null;
  readonly tokens_in: number | null;
  readonly tokens_out: number | null;
  readonly created_at: Date;
}

type RawDiagnosisRow = Omit<DiagnosisRow, 'confidence' | 'hints' | 'output'> & {
  readonly confidence: number | string;
  readonly hints: unknown;
  readonly output: unknown;
};

type QueryDatabase = Pool | PoolClient;

const DIAGNOSIS_COLUMNS = `
  id, event_id, entity_type, entity_id, hints, provider, model, prompt_version, input_digest,
  output, root_cause, confidence, strategy, rationale, degraded, degraded_reason,
  latency_ms, tokens_in, tokens_out, created_at`;

/**
 * Convert node-postgres numeric values at the repository boundary.
 * Intent: PostgreSQL `numeric(4,3)` is returned as a string by default; callers must never compare that string to a
 * threshold or expose it as a wire-level confidence value (C-A1).
 * Flow: accept the driver number/string -> parse -> reject non-finite or out-of-range data -> return a JS number.
 */
export function parseDiagnosisConfidence(value: unknown): number {
  const parsed = typeof value === 'number' ? value : typeof value === 'string' && value.trim().length > 0 ? Number(value) : NaN;
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 1) {
    throw new RangeError(`diagnoses.confidence must be a finite number between 0 and 1; received ${String(value)}`);
  }
  return parsed;
}

function jsonObject(value: unknown, column: 'hints' | 'output'): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new TypeError(`diagnoses.${column} must be a JSON object`);
  }
  return value as Record<string, unknown>;
}

function mapDiagnosisRow(row: RawDiagnosisRow): DiagnosisRow {
  return {
    ...row,
    hints: jsonObject(row.hints, 'hints'),
    output: jsonObject(row.output, 'output'),
    confidence: parseDiagnosisConfidence(row.confidence),
  };
}

/**
 * Persist one validated diagnosis and its audit metadata.
 * Intent: diagnosis output and cross-check evidence are immutable facts for an event; no upsert can silently erase a
 * prior model result or hide repeated diagnosis attempts.
 * Flow: serialize deterministic hints/output -> INSERT -> map the returned row (including numeric confidence).
 */
export async function insertDiagnosis(db: QueryDatabase, input: DiagnosisInsertInput): Promise<DiagnosisRow> {
  const confidence = parseDiagnosisConfidence(input.confidence);
  const result = await db.query<RawDiagnosisRow>(
    `INSERT INTO diagnoses
       (event_id, entity_type, entity_id, hints, provider, model, prompt_version, input_digest,
        output, root_cause, confidence, strategy, rationale, degraded, degraded_reason,
        latency_ms, tokens_in, tokens_out)
     VALUES ($1, $2, $3, $4::jsonb, $5, $6, $7, $8, $9::jsonb, $10, $11, $12, $13, $14, $15, $16, $17, $18)
     RETURNING ${DIAGNOSIS_COLUMNS}`,
    [
      input.eventId,
      input.entityType,
      input.entityId,
      JSON.stringify(input.hints),
      input.provider,
      input.model,
      input.promptVersion,
      input.inputDigest,
      JSON.stringify(input.output),
      input.rootCause,
      confidence,
      input.strategy,
      input.rationale,
      input.degraded ?? false,
      input.degradedReason ?? null,
      input.latencyMs ?? null,
      input.tokensIn ?? null,
      input.tokensOut ?? null,
    ],
  );
  const row = result.rows[0];
  if (!row) throw new Error(`diagnosis insert returned no row for event ${input.eventId}`);
  return mapDiagnosisRow(row);
}

/** Read one diagnosis by its UUID, normalizing numeric confidence just like INSERT RETURNING. */
export async function getDiagnosis(db: QueryDatabase, diagnosisId: string): Promise<DiagnosisRow | null> {
  const result = await db.query<RawDiagnosisRow>(
    `SELECT ${DIAGNOSIS_COLUMNS} FROM diagnoses WHERE id = $1`,
    [diagnosisId],
  );
  const row = result.rows[0];
  return row ? mapDiagnosisRow(row) : null;
}

/** Return all diagnosis attempts for one event in insertion order. */
export async function listDiagnosesForEvent(db: QueryDatabase, eventId: string): Promise<DiagnosisRow[]> {
  const result = await db.query<RawDiagnosisRow>(
    `SELECT ${DIAGNOSIS_COLUMNS} FROM diagnoses WHERE event_id = $1 ORDER BY created_at ASC, id ASC`,
    [eventId],
  );
  return result.rows.map(mapDiagnosisRow);
}

/** Return the most recently persisted diagnosis for an entity, useful to action modules and event detail views. */
export async function getLatestDiagnosisForEntity(
  db: QueryDatabase,
  entityType: EntityType,
  entityId: string,
): Promise<DiagnosisRow | null> {
  const result = await db.query<RawDiagnosisRow>(
    `SELECT ${DIAGNOSIS_COLUMNS}
     FROM diagnoses
     WHERE entity_type = $1 AND entity_id = $2
     ORDER BY created_at DESC, id DESC
     LIMIT 1`,
    [entityType, entityId],
  );
  const row = result.rows[0];
  return row ? mapDiagnosisRow(row) : null;
}

// Explicit aliases keep read call sites descriptive without duplicating SQL or mapping logic.
export const getDiagnosisById = getDiagnosis;
export const getDiagnosisByEvent = listDiagnosesForEvent;
export const findDiagnosisByEventId = listDiagnosesForEvent;
export const findDiagnosesByEventId = listDiagnosesForEvent;
