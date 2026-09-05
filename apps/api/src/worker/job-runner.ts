import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import { backoff } from './backoff';
import { withTransaction } from '../db/tx';
import { startSweeper, type SweeperHandle } from './sweeper';
import {
  NOOP_WORKER_LOGGER,
  readWritePool,
  resolveHandler,
  type JobHandlerMap,
  type JobRegistry,
  type JobRow,
  type WorkerLogger,
  type WorkerPoolSource,
} from './registry';

/** Keep this statement identical to the queue contract in Checklist.md §4.1. */
export const CLAIM_JOB_SQL = `UPDATE jobs SET status = 'running', locked_by = $1, locked_at = now(), attempts = attempts + 1, updated_at = now()
WHERE id = (SELECT id FROM jobs WHERE status = 'queued' AND run_at <= now() ORDER BY run_at, id FOR UPDATE SKIP LOCKED LIMIT 1)
RETURNING *;`;

interface RawJobRow {
  id: unknown;
  kind: unknown;
  payload: unknown;
  dedupe_key: unknown;
  status: unknown;
  attempts: unknown;
  max_attempts: unknown;
  run_at: unknown;
  locked_by: unknown;
  locked_at: unknown;
  last_error: unknown;
  created_at: unknown;
  updated_at: unknown;
}

export interface WorkerOptions {
  pools: WorkerPoolSource;
  logger?: WorkerLogger;
  handlers: JobRegistry | JobHandlerMap;
  concurrency: number;
  pollIntervalMs?: number;
  workerIdFactory?: (index: number) => string;
  /** Injectable retry delay for deterministic tests; production defaults to the bounded jittered backoff. */
  backoffFn?: (attempts: number) => number;
  sweeperIntervalMs?: number;
  disableSweeper?: boolean;
}

export interface WorkerHandle {
  stop(): Promise<void>;
}

/**
 * Atomically claim the oldest due queued job.
 * Intent: PostgreSQL owns concurrency; `FOR UPDATE SKIP LOCKED` means one worker never waits behind another worker's claim.
 * Flow: one UPDATE locks a candidate subquery row -> marks it running and increments attempts -> returns the claimed row.
 */
export async function claimJob(source: WorkerPoolSource, workerId: string): Promise<JobRow | null> {
  const pool = readWritePool(source);
  const result = await pool.query<RawJobRow>(CLAIM_JOB_SQL, [workerId]);
  const row = result.rows[0];
  return row ? normalizeJobRow(row) : null;
}

/**
 * Start worker loops and the stale-lock sweeper.
 * Intent: jobs remain durable across process crashes while handlers execute outside the claim statement's lock lifetime.
 * Flow: each loop claims -> dispatches a registered handler -> marks success or schedules bounded retry/DLQ; stop drains loops.
 */
export function startWorker(options: WorkerOptions): WorkerHandle {
  const pool = readWritePool(options.pools);
  const logger = options.logger ?? NOOP_WORKER_LOGGER;
  const concurrency = validatePositiveInteger(options.concurrency, 'concurrency');
  const pollIntervalMs = validatePositiveNumber(options.pollIntervalMs ?? 500, 'pollIntervalMs');
  const workerIdFactory = options.workerIdFactory ?? ((index: number) => `worker-${index}-${randomUUID()}`);
  const backoffFn = options.backoffFn ?? backoff;

  let stopping = false;
  let stopPromise: Promise<void> | undefined;
  const wakeWaiters = new Set<() => void>();
  const loops: Promise<void>[] = [];
  const sweeper: SweeperHandle | undefined = options.disableSweeper
    ? undefined
    : startSweeper({ pools: pool, logger, intervalMs: options.sweeperIntervalMs });

  const waitForPoll = (durationMs: number): Promise<void> => {
    if (stopping) return Promise.resolve();
    return new Promise<void>((resolve) => {
      let settled = false;
      const finish = (): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        wakeWaiters.delete(cancel);
        resolve();
      };
      const cancel = (): void => finish();
      const timer = setTimeout(finish, durationMs);
      timer.unref();
      // Register after defining both callbacks so stop can wake long poll intervals immediately.
      wakeWaiters.add(cancel);
    });
  };

  const runLoop = async (workerId: string): Promise<void> => {
    while (!stopping) {
      let job: JobRow | null;
      try {
        job = await claimJob(pool, workerId);
      } catch (error) {
        logger.error({ err: error, worker_id: workerId }, 'job claim failed');
        await waitForPoll(pollIntervalMs);
        continue;
      }

      if (!job) {
        await waitForPoll(pollIntervalMs);
        continue;
      }

      try {
        const handler = resolveHandler(options.handlers, job.kind);
        if (!handler) throw new Error(`no handler registered for job kind ${job.kind}`);
        await handler(job, { db: pool, logger, workerId });
        const updated = await markSucceeded(pool, job, workerId);
        if (!updated) logger.warn({ job_id: job.id, worker_id: workerId }, 'job success ignored after lease changed');
      } catch (error) {
        await markFailed(pool, job, workerId, error, logger, backoffFn);
      }
    }
  };

  for (let index = 0; index < concurrency; index += 1) {
    loops.push(runLoop(workerIdFactory(index)));
  }

  return {
    stop: async (): Promise<void> => {
      if (stopPromise) return stopPromise;
      stopping = true;
      for (const wake of wakeWaiters) wake();
      stopPromise = Promise.all(loops)
        .then(async () => {
          await sweeper?.stop();
        })
        .then(() => undefined);
      return stopPromise;
    },
  };
}

async function markSucceeded(pool: pg.Pool, job: JobRow, workerId: string): Promise<boolean> {
  const eventId = eventIdFromPayload(job.payload);
  return withTransaction(pool, async (tx) => {
    const result = await tx.query(
      `UPDATE jobs
       SET status = 'succeeded', locked_by = NULL, locked_at = NULL, last_error = NULL, updated_at = now()
       WHERE id = $1 AND status = 'running' AND locked_by = $2`,
      [job.id, workerId],
    );
    if ((result.rowCount ?? 0) !== 1) return false;
    if (eventId) {
      await tx.query(
        `UPDATE webhook_events
         SET status = 'processed', processed_at = COALESCE(processed_at, now()), last_error = NULL
         WHERE event_id = $1 AND signature_valid = true AND status <> 'ignored'`,
        [eventId],
      );
    }
    return true;
  });
}

async function markFailed(
  pool: pg.Pool,
  job: JobRow,
  workerId: string,
  error: unknown,
  logger: WorkerLogger,
  backoffFn: (attempts: number) => number,
): Promise<void> {
  const message = error instanceof Error ? error.message : String(error);
  try {
    await withTransaction(pool, async (tx) => {
      const exhausted = job.attempts >= job.max_attempts;
      const nextStatus = exhausted ? 'dead_letter' : 'queued';
      const eventId = eventIdFromPayload(job.payload);
      const delayMs = exhausted ? null : backoffFn(job.attempts);
      const result = await tx.query(
        `UPDATE jobs
         SET status = $3::text, run_at = CASE WHEN $4::integer IS NULL THEN run_at ELSE now() + ($4::double precision * interval '1 millisecond') END,
             locked_by = NULL, locked_at = NULL, last_error = $2, updated_at = now()
         WHERE id = $1 AND status = 'running' AND locked_by = $5`,
        [job.id, message, nextStatus, delayMs, workerId],
      );
      if ((result.rowCount ?? 0) !== 1) {
        logger.warn({ job_id: job.id, worker_id: workerId }, 'job failure ignored after lease changed');
        return;
      }

      if (eventId) {
        await tx.query(
          `UPDATE webhook_events
           SET status = $2::text, last_error = $3
           WHERE event_id = $1 AND signature_valid = true`,
          [eventId, exhausted ? 'dead_letter' : 'failed', message],
        );
      }
    });
  } catch (updateError) {
    // Intent: preserve the original failure while making a failed state transition observable; the sweeper can recover
    // a row left running if PostgreSQL was unavailable during this update.
    // Flow: log both errors -> loop continues -> stale lock is re-queued after the lease timeout.
    logger.error({ err: updateError, job_id: job.id, original_error: message }, 'job failure update failed');
  }
}

function normalizeJobRow(row: RawJobRow): JobRow {
  return {
    id: integer(row.id, 'jobs.id'),
    kind: string(row.kind, 'jobs.kind'),
    payload: jsonObject(row.payload, 'jobs.payload'),
    dedupe_key: nullableString(row.dedupe_key),
    status: jobStatus(row.status),
    attempts: integer(row.attempts, 'jobs.attempts'),
    max_attempts: integer(row.max_attempts, 'jobs.max_attempts'),
    run_at: date(row.run_at, 'jobs.run_at'),
    locked_by: nullableString(row.locked_by),
    locked_at: nullableDate(row.locked_at),
    last_error: nullableString(row.last_error),
    created_at: date(row.created_at, 'jobs.created_at'),
    updated_at: date(row.updated_at, 'jobs.updated_at'),
  };
}

function integer(value: unknown, label: string): number {
  const parsed = typeof value === 'number' ? value : typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : Number.NaN;
  if (!Number.isSafeInteger(parsed)) throw new Error(`${label} is not a safe integer`);
  return parsed;
}

function string(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.length === 0) throw new Error(`${label} is not a non-empty string`);
  return value;
}

function nullableString(value: unknown): string | null {
  return value === null || value === undefined ? null : typeof value === 'string' ? value : String(value);
}

function date(value: unknown, label: string): Date {
  const parsed = value instanceof Date ? value : typeof value === 'string' || typeof value === 'number' ? new Date(value) : null;
  if (!parsed || Number.isNaN(parsed.getTime())) throw new Error(`${label} is not a valid timestamp`);
  return parsed;
}

function nullableDate(value: unknown): Date | null {
  return value === null || value === undefined ? null : date(value, 'jobs.locked_at');
}

function jsonObject(value: unknown, label: string): Record<string, unknown> {
  const candidate = typeof value === 'string' ? parseJson(value, label) : value;
  if (typeof candidate !== 'object' || candidate === null || Array.isArray(candidate)) throw new Error(`${label} is not a JSON object`);
  return candidate as Record<string, unknown>;
}

function parseJson(value: string, label: string): unknown {
  try {
    return JSON.parse(value);
  } catch (error) {
    throw new Error(`${label} is not valid JSON`, { cause: error });
  }
}

function jobStatus(value: unknown): JobRow['status'] {
  if (value === 'queued' || value === 'running' || value === 'succeeded' || value === 'failed' || value === 'dead_letter' || value === 'cancelled') {
    return value;
  }
  throw new Error(`jobs.status is invalid: ${String(value)}`);
}

function eventIdFromPayload(payload: Record<string, unknown>): string | null {
  const value = payload.eventId ?? payload.event_id;
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function validatePositiveInteger(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 1) throw new RangeError(`${label} must be a positive integer, got ${String(value)}`);
  return value;
}

function validatePositiveNumber(value: number, label: string): number {
  if (!Number.isFinite(value) || value < 1) throw new RangeError(`${label} must be positive, got ${String(value)}`);
  return value;
}

export { eventIdFromPayload, normalizeJobRow };
export type { JobHandler, JobHandlerContext, JobHandlerMap, JobRegistry, JobRow, WorkerLogger, WorkerPoolSource } from './registry';
