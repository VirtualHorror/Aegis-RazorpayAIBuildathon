import type pg from 'pg';
import { assertSafePaise, assertSafeSignedPaise } from '@aegis/shared';
import type { ActionProposal, ActionRow, ActionStatus, GuardRule } from '../../orchestrator/types';

type QueryDatabase = pg.Pool | pg.PoolClient;

export interface InsertActionInput {
  readonly proposal: ActionProposal;
  readonly triggerEventId: string;
  readonly diagnosisId?: string | null;
  readonly bounds: readonly GuardRule[];
  readonly status: ActionStatus;
  readonly reason?: string | null;
}

const ACTION_COLUMNS = `id, idempotency_key, module, module_version, trigger_event_id, diagnosis_id,
  entity_type, entity_id, customer_id, kind, summary, proposal, bounds, money_impact_paise,
  expected_recovery_paise, requires_approval, status, reason, decided_by, decided_at,
  executed_at, result, created_at, updated_at`;

function jsonObject(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new TypeError(`${label} must be a JSON object`);
  return value as Record<string, unknown>;
}

function jsonRules(value: unknown): GuardRule[] {
  if (!Array.isArray(value)) throw new TypeError('actions.bounds must be a JSON array');
  return value as GuardRule[];
}

function mapActionRow(row: ActionRow): ActionRow {
  const moneyImpactPaise = assertSafeSignedPaise(Number(row.money_impact_paise), 'actions.money_impact_paise');
  if (moneyImpactPaise > 0) throw new RangeError('actions.money_impact_paise must be <= 0');
  return {
    ...row,
    proposal: jsonObject(row.proposal, 'actions.proposal'),
    bounds: jsonRules(row.bounds),
    money_impact_paise: moneyImpactPaise,
    expected_recovery_paise: assertSafePaise(Number(row.expected_recovery_paise), 'actions.expected_recovery_paise'),
  };
}

/** Persist a proposal exactly once by its module/entity/step idempotency key. */
export async function insertAction(db: QueryDatabase, input: InsertActionInput): Promise<ActionRow | null> {
  const p = input.proposal;
  // Intent: enforce the money contract at the repository boundary before a JSON proposal or SQL bigint can carry an
  // unsafe value; the database CHECK remains a second line of defence for persisted rows.
  // Flow: validate signed impact -> reject positive costs -> validate non-negative expected recovery -> INSERT once.
  const moneyImpactPaise = assertSafeSignedPaise(p.moneyImpactPaise, 'action.moneyImpactPaise');
  if (moneyImpactPaise > 0) throw new RangeError('action.moneyImpactPaise must be <= 0');
  const expectedRecoveryPaise = assertSafePaise(p.expectedRecoveryPaise, 'action.expectedRecoveryPaise');
  const result = await db.query<ActionRow>(
    `INSERT INTO actions
       (idempotency_key, module, module_version, trigger_event_id, diagnosis_id, entity_type, entity_id, customer_id,
        kind, summary, proposal, bounds, money_impact_paise, expected_recovery_paise, requires_approval, status, reason)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb, $12::jsonb, $13, $14, $15, $16, $17)
     ON CONFLICT (idempotency_key) DO NOTHING
     RETURNING ${ACTION_COLUMNS}`,
    [
      p.idempotencyKey,
      p.module,
      p.moduleVersion,
      input.triggerEventId,
      input.diagnosisId ?? null,
      p.entityType,
      p.entityId,
      p.customerId ?? null,
      p.kind,
      p.summary,
      JSON.stringify(p),
      JSON.stringify(input.bounds),
      moneyImpactPaise,
      expectedRecoveryPaise,
      p.requiresApproval,
      input.status,
      input.reason ?? null,
    ],
  );
  return result.rows[0] ? mapActionRow(result.rows[0]) : null;
}

/** Read an action with the same JSON normalization used by INSERT RETURNING. */
export async function getAction(db: QueryDatabase, actionId: string): Promise<ActionRow | null> {
  const result = await db.query<ActionRow>(`SELECT ${ACTION_COLUMNS} FROM actions WHERE id = $1`, [actionId]);
  return result.rows[0] ? mapActionRow(result.rows[0]) : null;
}

/** Read an action by its durable proposal key so a retried worker can resume an approved action. */
export async function getActionByIdempotencyKey(db: QueryDatabase, idempotencyKey: string): Promise<ActionRow | null> {
  const result = await db.query<ActionRow>(`SELECT ${ACTION_COLUMNS} FROM actions WHERE idempotency_key = $1`, [idempotencyKey]);
  return result.rows[0] ? mapActionRow(result.rows[0]) : null;
}

/** Return approved actions for one event, used only to recover a crash between proposal persistence and execution. */
export async function listApprovedActionsForEvent(db: QueryDatabase, eventId: string): Promise<ActionRow[]> {
  const result = await db.query<ActionRow>(
    `SELECT ${ACTION_COLUMNS} FROM actions WHERE trigger_event_id = $1 AND status = 'approved' ORDER BY created_at ASC, id ASC`,
    [eventId],
  );
  return result.rows.map(mapActionRow);
}

export async function getActionForUpdate(db: QueryDatabase, actionId: string): Promise<ActionRow | null> {
  const result = await db.query<ActionRow>(`SELECT ${ACTION_COLUMNS} FROM actions WHERE id = $1 FOR UPDATE`, [actionId]);
  return result.rows[0] ? mapActionRow(result.rows[0]) : null;
}

/** Update a proposal's terminal/approval state while retaining the full guardrail explanation. */
export async function updateActionStatus(
  db: QueryDatabase,
  actionId: string,
  status: ActionStatus,
  reason: string | null = null,
): Promise<ActionRow | null> {
  const result = await db.query<ActionRow>(
    `UPDATE actions SET status = $2, reason = $3, updated_at = now() WHERE id = $1 RETURNING ${ACTION_COLUMNS}`,
    [actionId, status, reason],
  );
  return result.rows[0] ? mapActionRow(result.rows[0]) : null;
}

export async function decideAction(
  db: QueryDatabase,
  actionId: string,
  decision: 'approve' | 'reject',
  actor: string,
  note: string | null,
): Promise<ActionRow | null> {
  const status: ActionStatus = decision === 'approve' ? 'approved' : 'rejected';
  const result = await db.query<ActionRow>(
    `UPDATE actions SET status = $2, reason = $3, decided_by = $4, decided_at = now(), updated_at = now()
     WHERE id = $1 AND status = 'pending_approval' RETURNING ${ACTION_COLUMNS}`,
    [actionId, status, note, actor],
  );
  return result.rows[0] ? mapActionRow(result.rows[0]) : null;
}

export async function markActionExecution(
  db: QueryDatabase,
  actionId: string,
  status: Extract<ActionStatus, 'executed' | 'failed'>,
  resultValue: Record<string, unknown> | null,
  error: string | null,
): Promise<ActionRow | null> {
  const result = await db.query<ActionRow>(
    `UPDATE actions
     SET status = $2, result = $3::jsonb, reason = $4, executed_at = CASE WHEN $2 = 'executed' THEN now() ELSE executed_at END,
         updated_at = now()
     WHERE id = $1 RETURNING ${ACTION_COLUMNS}`,
    [actionId, status, resultValue === null ? null : JSON.stringify(resultValue), error],
  );
  return result.rows[0] ? mapActionRow(result.rows[0]) : null;
}
