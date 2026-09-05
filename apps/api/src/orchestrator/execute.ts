import type pg from 'pg';
import { getActionForUpdate, markActionExecution } from '../db/repos/actions';
import { insertAuditLog } from '../db/repos/audit';
import { enqueue } from '../db/repos/jobs';
import { insertLedgerEntry } from '../db/repos/ledger';
import { insertOutboundMessage } from '../db/repos/outbound-messages';
import type { ActionModule, ActionRow, EntityStateUpdate, EventContext, ExecutionDeps, ExecutionResult } from './types';
import type { EventBus } from '../bus/event-bus';

export interface ExecuteActionInput {
  readonly db: pg.Pool;
  readonly action: ActionRow | string;
  readonly module: ActionModule;
  readonly ctx: EventContext;
  readonly bus: EventBus;
  readonly llm: ExecutionDeps['llm'];
  readonly logger: EventContext['logger'];
  readonly now?: Date;
}

const executionsInFlight = new WeakMap<pg.Pool, Map<string, Promise<ExecutionResult | null>>>();

type TransactionClientCallback<T> = (tx: pg.PoolClient) => Promise<T>;

const ENTITY_UPDATE_COLUMNS = {
  subscriptions: ['salvage_state', 'retry_count', 'next_retry_at', 'notes'],
  invoices: ['negotiation_state', 'negotiation_round', 'current_offer_paise', 'notes'],
  disputes: ['status', 'phase'],
} as const satisfies Record<EntityStateUpdate['table'], readonly string[]>;

class EntityStateUpdateConflictError extends Error {
  override name = 'EntityStateUpdateConflictError';
}

/**
 * Execute one approved action with a two-phase database boundary.
 * Intent: lock and validate the action, release row locks before module code (and any possible model call), then lock
 *         again to persist the simulated side effects atomically (C-A6/C-B1).
 * Flow: SELECT FOR UPDATE -> early-return executed/non-approved -> module.execute outside transaction -> lock action
 *       -> persist result/messages/ledger/follow-up/audit -> commit -> publish bus events.
 */
export async function executeAction(input: ExecuteActionInput): Promise<ExecutionResult | null> {
  const actionId = typeof input.action === 'string' ? input.action : input.action.id;
  const poolExecutions = executionsInFlight.get(input.db) ?? new Map<string, Promise<ExecutionResult | null>>();
  executionsInFlight.set(input.db, poolExecutions);
  const existing = poolExecutions.get(actionId);
  if (existing) {
    // Intent: workers in one process must not invoke a side-effecting module twice for one idempotency key.
    // Flow: wait for the first two-phase execution -> re-read the action -> return its executed result early.
    await existing;
    return executeActionUnlocked(input);
  }
  const execution = executeActionUnlocked(input);
  poolExecutions.set(actionId, execution);
  try {
    return await execution;
  } finally {
    if (poolExecutions.get(actionId) === execution) poolExecutions.delete(actionId);
    if (poolExecutions.size === 0) executionsInFlight.delete(input.db);
  }
}

async function executeActionUnlocked(input: ExecuteActionInput): Promise<ExecutionResult | null> {
  const actionId = typeof input.action === 'string' ? input.action : input.action.id;
  // Intent: the unique idempotency key prevents duplicate rows, while this session lock prevents two workers from
  // invoking a side-effecting module concurrently before either worker can persist its result (C-C2).
  // Flow: pin one pool client -> acquire the action advisory lock -> validate/commit -> execute outside row locks ->
  //       lock/persist/commit -> publish -> release the advisory lock and client.
  return withActionAdvisoryLock(input.db, actionId, async (lockClient) => {
    const initial = await withClientTransaction(lockClient, async (tx) => getActionForUpdate(tx, actionId));
    if (!initial) throw new Error(`action ${actionId} not found`);
    if (initial.status === 'executed') return { status: 'executed', result: initial.result ?? { alreadyExecuted: true } };
    if (initial.status !== 'approved') throw new Error(`action ${actionId} is ${initial.status}, expected approved`);

    let execution: ExecutionResult;
    try {
      // Intent: module code runs after the validation transaction commits, so an LLM-capable module can never run while
      // the action row is locked. Current modules only produce simulated side effects.
      execution = await input.module.execute(initial, input.ctx, {
        db: input.db,
        bus: input.bus,
        llm: input.llm,
        now: input.now ?? input.ctx.now,
        logger: input.logger,
      });
    } catch (error) {
      execution = {
        status: 'failed',
        result: {},
        error: error instanceof Error ? error.message : String(error),
      };
    }

    let effectiveExecution = execution;
    const persisted = await withClientTransaction(lockClient, async (tx) => {
      const current = await getActionForUpdate(tx, actionId);
      if (!current) throw new Error(`action ${actionId} disappeared during execution`);
      if (current.status === 'executed') return { action: current, duplicate: true };
      if (current.status !== 'approved') throw new Error(`action ${actionId} changed to ${current.status} during execution`);

      // Intent: optimistic entity expectations turn concurrent action attempts into an auditable failed action rather
      // than allowing a second retry/message to advance the projection twice. The action row is already locked here,
      // so this follows the global `actions -> entity` lock order (C-C3).
      // Flow: lock/check every declarative update -> on conflict mark this action failed -> otherwise persist all effects.
      if (execution.status === 'executed') {
        try {
          for (const update of execution.entityUpdates ?? []) await applyEntityStateUpdate(tx, update);
        } catch (error) {
          if (!(error instanceof EntityStateUpdateConflictError)) throw error;
          effectiveExecution = {
            status: 'failed',
            result: { ...execution.result, entityUpdateConflict: true },
            error: error.message,
          };
        }
      }

      if (effectiveExecution.status === 'executed' && effectiveExecution.outbound) {
        await insertOutboundMessage(tx, actionId, effectiveExecution.outbound);
      }
      if (effectiveExecution.status === 'executed') {
        for (const ledger of effectiveExecution.ledger ?? []) await insertLedgerEntry(tx, { ...ledger, refId: ledger.refId || actionId });
        const followUp = followUpFromProposal(current.proposal);
        if (followUp) await enqueue(tx, followUp);
      }
      const updated = await markActionExecution(tx, actionId, effectiveExecution.status, effectiveExecution.result, effectiveExecution.error ?? null);
      if (!updated) throw new Error(`action ${actionId} execution update returned no row`);
      await insertAuditLog(tx, {
        actor: `module:${input.module.name}`,
        action: effectiveExecution.status === 'executed' ? 'action.executed' : 'action.failed',
        entityType: updated.entity_type,
        entityId: updated.entity_id,
        before: current,
        after: updated,
        metadata: { idempotency_key: updated.idempotency_key, error: effectiveExecution.error ?? null },
      });
      return { action: updated, duplicate: false };
    });

    if (!persisted.duplicate) {
      const statusEvent = effectiveExecution.status === 'executed' ? 'action.executed' : 'action.failed';
      input.bus.publish(statusEvent, { actionId, action: persisted.action, result: effectiveExecution.result, error: effectiveExecution.error });
      if (effectiveExecution.status === 'executed' && effectiveExecution.outbound) {
        input.bus.publish('message.simulated_sent', { actionId, message: effectiveExecution.outbound });
      }
    }
    return effectiveExecution;
  });
}

/**
 * Apply one module-declared projection update while the action transaction owns the entity lock.
 * Intent: table/column names are closed at compile time and runtime; arbitrary module input must never become SQL.
 * Flow: validate scalar fields -> SELECT the target FOR UPDATE -> compare optimistic expectations -> UPDATE allowlisted
 *       columns using parameters. A missing row is a hard failure, not an implicit insert/reservation.
 */
async function applyEntityStateUpdate(tx: pg.PoolClient, update: EntityStateUpdate): Promise<void> {
  if (typeof update.id !== 'string' || update.id.trim().length === 0) throw new TypeError('entity update id must be non-empty');
  const columns = ENTITY_UPDATE_COLUMNS[update.table];
  if (!columns) throw new TypeError(`entity update table is unsupported: ${String(update.table)}`);
  if (!isRecord(update.set) || Object.keys(update.set).length === 0) throw new TypeError('entity update set must be non-empty');
  const setEntries = Object.entries(update.set);
  for (const [column, value] of setEntries) {
    assertEntityColumn(columns, column);
    assertEntityScalar(value, `entity update ${update.table}.${column}`);
  }
  if (update.expect !== undefined) {
    if (!isRecord(update.expect)) throw new TypeError('entity update expect must be an object');
    for (const [column, value] of Object.entries(update.expect)) {
      assertEntityColumn(columns, column);
      if (value !== null && typeof value !== 'string' && typeof value !== 'number') {
        throw new TypeError(`entity update expectation ${update.table}.${column} must be string, number, or null`);
      }
    }
  }

  const currentResult = await tx.query<Record<string, unknown>>(
    `SELECT ${columns.map((column) => `"${column}"`).join(', ')} FROM ${update.table} WHERE id = $1 FOR UPDATE`,
    [update.id],
  );
  const current = currentResult.rows[0];
  if (!current) throw new EntityStateUpdateConflictError(`${update.table} ${update.id} disappeared before execution`);
  for (const [column, expected] of Object.entries(update.expect ?? {})) {
    if (!sameEntityScalar(current[column], expected)) {
      throw new EntityStateUpdateConflictError(
        `${update.table} ${update.id} expectation failed for ${column}: expected ${String(expected)}, got ${String(current[column])}`,
      );
    }
  }

  const values: unknown[] = [update.id];
  const assignments = setEntries.map(([column, value], index) => {
    values.push(value);
    return `"${column}" = $${index + 2}`;
  });
  await tx.query(`UPDATE ${update.table} SET ${assignments.join(', ')}, updated_at = now() WHERE id = $1`, values);
}

function assertEntityColumn(columns: readonly string[], column: string): void {
  if (!columns.includes(column)) throw new TypeError(`entity update column is not allowlisted: ${column}`);
}

function assertEntityScalar(value: unknown, label: string): void {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return;
  if (typeof value === 'number' && Number.isSafeInteger(value)) return;
  throw new TypeError(`${label} must be a string, safe integer, boolean, or null`);
}

function sameEntityScalar(actual: unknown, expected: string | number | null): boolean {
  if (expected === null) return actual === null || actual === undefined;
  if (actual === null || actual === undefined) return false;
  if (typeof expected === 'number') return Number(actual) === expected;
  return String(actual) === expected;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

interface PersistedFollowUp {
  readonly kind: string;
  readonly payload: Record<string, unknown>;
  readonly runAt: Date;
  readonly dedupeKey: string;
}

/**
 * Recover a scheduled follow-up from the JSON proposal only after execution succeeds.
 * Intent: blocked and pending-approval actions must not place runnable work on the queue before their guard/approval.
 * Flow: inspect the persisted proposal -> validate the bounded job fields -> normalize the JSON date -> enqueue in the
 *       same transaction as the executed action and its side effects.
 */
function followUpFromProposal(proposal: Record<string, unknown>): PersistedFollowUp | null {
  const candidate = proposal.scheduleFollowUp;
  if (candidate === undefined || candidate === null) return null;
  if (typeof candidate !== 'object' || Array.isArray(candidate)) throw new TypeError('action.scheduleFollowUp must be an object');
  const value = candidate as Record<string, unknown>;
  const kind = value.kind;
  const dedupeKey = value.dedupeKey;
  const payload = value.payload;
  const rawRunAt = value.runAt;
  if (typeof kind !== 'string' || kind.length === 0) throw new TypeError('action.scheduleFollowUp.kind must be a non-empty string');
  if (typeof dedupeKey !== 'string' || dedupeKey.length === 0) throw new TypeError('action.scheduleFollowUp.dedupeKey must be a non-empty string');
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) throw new TypeError('action.scheduleFollowUp.payload must be an object');
  const runAt = rawRunAt instanceof Date ? rawRunAt : typeof rawRunAt === 'string' ? new Date(rawRunAt) : new Date(Number.NaN);
  if (Number.isNaN(runAt.getTime())) throw new TypeError('action.scheduleFollowUp.runAt must be a valid date');
  return { kind, dedupeKey, payload: payload as Record<string, unknown>, runAt };
}

async function withActionAdvisoryLock<T>(
  db: pg.Pool,
  actionId: string,
  callback: (client: pg.PoolClient) => Promise<T>,
): Promise<T> {
  const client = await db.connect();
  const lockKey = `aegis:action:${actionId}`;
  let acquired = false;
  let destroyClient = false;
  try {
    await client.query('SELECT pg_advisory_lock(hashtextextended($1, 0))', [lockKey]);
    acquired = true;
    return await callback(client);
  } finally {
    if (acquired) {
      try {
        await client.query('SELECT pg_advisory_unlock(hashtextextended($1, 0))', [lockKey]);
      } catch (error) {
        // Intent: a pooled client must not retain a session advisory lock when explicit cleanup fails.
        // Flow: report the unlock failure -> destroy this client on release (which drops the PostgreSQL session lock) ->
        //       preserve the callback's original result/error rather than replacing it with cleanup noise.
        destroyClient = true;
        const message = error instanceof Error ? error.message : String(error);
        process.emitWarning(`action advisory unlock failed for ${actionId}: ${message}`, { code: 'AEGIS_ACTION_UNLOCK' });
      }
    }
    client.release(destroyClient);
  }
}

async function withClientTransaction<T>(client: pg.PoolClient, callback: TransactionClientCallback<T>): Promise<T> {
  let began = false;
  try {
    await client.query('BEGIN');
    began = true;
    const result = await callback(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    if (!began) throw error;
    try {
      await client.query('ROLLBACK');
    } catch (rollbackError) {
      throw new Error(
        `transaction failed and rollback failed: ${error instanceof Error ? error.message : String(error)}; ` +
          `${rollbackError instanceof Error ? rollbackError.message : String(rollbackError)}`,
        { cause: rollbackError },
      );
    }
    throw error;
  }
}

/** Convenience form for callers that already have an action row and dependencies assembled. */
export async function executeActionWithDeps(
  action: ActionRow,
  module: ActionModule,
  ctx: EventContext,
  deps: ExecutionDeps,
): Promise<ExecutionResult | null> {
  return executeAction({ db: deps.db, action, module, ctx, bus: deps.bus, llm: deps.llm, logger: deps.logger, now: deps.now });
}
