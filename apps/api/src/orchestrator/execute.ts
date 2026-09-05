import type pg from 'pg';
import { getActionForUpdate, markActionExecution } from '../db/repos/actions';
import { insertAuditLog } from '../db/repos/audit';
import { enqueue } from '../db/repos/jobs';
import { insertLedgerEntry } from '../db/repos/ledger';
import { insertOutboundMessage } from '../db/repos/outbound-messages';
import type { ActionModule, ActionRow, EventContext, ExecutionDeps, ExecutionResult } from './types';
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

    const persisted = await withClientTransaction(lockClient, async (tx) => {
      const current = await getActionForUpdate(tx, actionId);
      if (!current) throw new Error(`action ${actionId} disappeared during execution`);
      if (current.status === 'executed') return { action: current, duplicate: true };
      if (current.status !== 'approved') throw new Error(`action ${actionId} changed to ${current.status} during execution`);

      if (execution.outbound) await insertOutboundMessage(tx, actionId, execution.outbound);
      for (const ledger of execution.ledger ?? []) await insertLedgerEntry(tx, { ...ledger, refId: ledger.refId || actionId });
      if (execution.status === 'executed') {
        const followUp = followUpFromProposal(current.proposal);
        if (followUp) await enqueue(tx, followUp);
      }
      const updated = await markActionExecution(tx, actionId, execution.status, execution.result, execution.error ?? null);
      if (!updated) throw new Error(`action ${actionId} execution update returned no row`);
      await insertAuditLog(tx, {
        actor: `module:${input.module.name}`,
        action: execution.status === 'executed' ? 'action.executed' : 'action.failed',
        entityType: updated.entity_type,
        entityId: updated.entity_id,
        before: current,
        after: updated,
        metadata: { idempotency_key: updated.idempotency_key, error: execution.error ?? null },
      });
      return { action: updated, duplicate: false };
    });

    if (!persisted.duplicate) {
      const statusEvent = execution.status === 'executed' ? 'action.executed' : 'action.failed';
      input.bus.publish(statusEvent, { actionId, action: persisted.action, result: execution.result, error: execution.error });
      if (execution.outbound) input.bus.publish('message.simulated_sent', { actionId, message: execution.outbound });
    }
    return execution;
  });
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
