import type pg from 'pg';
import {
  NOOP_WORKER_LOGGER,
  readWritePool,
  type WorkerLogger,
  type WorkerPoolSource,
} from './registry';

const DEFAULT_SWEEP_INTERVAL_MS = 30_000;

const SWEEP_SQL = `UPDATE jobs
SET status = 'queued', locked_by = NULL, locked_at = NULL, updated_at = now()
WHERE status = 'running' AND locked_at < now() - interval '2 minutes'`;

export interface SweeperHandle {
  stop(): Promise<void>;
  sweepNow(): Promise<number>;
}

export interface SweeperOptions {
  pools?: WorkerPoolSource;
  pool?: pg.Pool;
  db?: pg.Pool;
  logger?: WorkerLogger;
  intervalMs?: number;
}

/**
 * Re-queue jobs abandoned by a crashed worker.
 * Intent: a worker process may die while a job is `running`; the two-minute lease prevents permanent loss.
 * Flow: atomically clear stale locks -> make rows queued again -> next worker claim applies normal retry handling.
 */
export async function sweepStaleJobs(pool: pg.Pool): Promise<number> {
  const result = await pool.query(SWEEP_SQL);
  return result.rowCount ?? 0;
}

/**
 * Start the periodic stale-lock sweep. A sweep never overlaps itself, and stop waits for an active query.
 * Intent: interval callbacks must not create unhandled rejections or pile up when PostgreSQL is slow.
 * Flow: optional immediate sweep -> at most one query per interval -> log failures -> stop clears timer and drains query.
 */
export function startSweeper(options: SweeperOptions): SweeperHandle;
export function startSweeper(pool: pg.Pool, logger?: WorkerLogger, intervalMs?: number): SweeperHandle;
export function startSweeper(
  input: SweeperOptions | pg.Pool,
  loggerArg: WorkerLogger = NOOP_WORKER_LOGGER,
  intervalArg = DEFAULT_SWEEP_INTERVAL_MS,
): SweeperHandle {
  const options: SweeperOptions = isPool(input)
    ? { pool: input, logger: loggerArg, intervalMs: intervalArg }
    : input;
  const pool = options.pool ?? options.db ?? (options.pools ? readWritePool(options.pools) : undefined);
  if (!pool) throw new TypeError('startSweeper requires a PostgreSQL pool');
  const logger = options.logger ?? NOOP_WORKER_LOGGER;
  const intervalMs = options.intervalMs ?? DEFAULT_SWEEP_INTERVAL_MS;
  if (!Number.isFinite(intervalMs) || intervalMs < 1) throw new RangeError(`intervalMs must be positive, got ${String(intervalMs)}`);

  let stopped = false;
  let inFlight: Promise<number> | undefined;
  const run = (): Promise<number> => {
    if (stopped) return Promise.resolve(0);
    if (inFlight) return inFlight;
    inFlight = sweepStaleJobs(pool)
      .then((count) => {
        if (count > 0) logger.info({ count }, 're-queued stale jobs');
        return count;
      })
      .catch((error: unknown) => {
        logger.error({ err: error }, 'stale job sweep failed');
        return 0;
      })
      .finally(() => {
        inFlight = undefined;
      });
    return inFlight;
  };

  // Run once on startup so jobs abandoned before boot do not wait for the first 30-second tick.
  void run();
  const timer = setInterval(() => void run(), intervalMs);
  timer.unref();

  return {
    sweepNow: run,
    stop: async () => {
      if (stopped) return;
      stopped = true;
      clearInterval(timer);
      await inFlight;
    },
  };
}

function isPool(input: SweeperOptions | pg.Pool): input is pg.Pool {
  return 'query' in input && typeof input.query === 'function';
}

export { DEFAULT_SWEEP_INTERVAL_MS, SWEEP_SQL };
