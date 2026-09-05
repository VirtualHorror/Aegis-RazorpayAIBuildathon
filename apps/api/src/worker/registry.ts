import type pg from 'pg';

/** A deliberately small logger surface so worker code is usable outside Fastify (for tests and scripts). */
export interface WorkerLogger {
  info: (...args: unknown[]) => void;
  warn: (...args: unknown[]) => void;
  error: (...args: unknown[]) => void;
  debug: (...args: unknown[]) => void;
}

export type JobStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'dead_letter' | 'cancelled';

/** Shape returned by `UPDATE ... RETURNING *` in the jobs claim query. */
export interface JobRow {
  id: number;
  kind: string;
  payload: Record<string, unknown>;
  dedupe_key: string | null;
  status: JobStatus;
  attempts: number;
  max_attempts: number;
  run_at: Date;
  locked_by: string | null;
  locked_at: Date | null;
  last_error: string | null;
  created_at: Date;
  updated_at: Date;
}

export interface JobHandlerContext {
  db: pg.Pool;
  logger: WorkerLogger;
  workerId: string;
  /** Optional orchestrator supplied by the production composition; omitted by projection-only tests. */
  orchestrator?: {
    handle(eventId: string, workerId: string): Promise<unknown>;
    handleSynthetic?(input: { kind: 'dunning_step'; subscriptionId: string }): Promise<unknown>;
  };
}

export interface WorkerPools {
  readonly rw: pg.Pool;
}
export type WorkerPoolSource = pg.Pool | WorkerPools;

export function readWritePool(source: WorkerPoolSource): pg.Pool {
  return 'rw' in source ? source.rw : source;
}

export const NOOP_WORKER_LOGGER: WorkerLogger = Object.freeze({
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
  debug: () => undefined,
});

export type JobHandler = (job: JobRow, ctx: JobHandlerContext) => Promise<void>;
export type JobHandlerMap = Readonly<Record<string, JobHandler>>;
export type JobRegistry = ReadonlyMap<string, JobHandler>;

/**
 * Build an immutable handler registry from the kind -> handler map used at boot.
 * Intent: dispatch names are explicit and deterministic; an unknown kind is an error rather than silently dropped work.
 * Flow: copy own map entries -> expose a read-only Map -> job-runner resolves one handler per claimed row.
 */
export function createRegistry(handlers: JobHandlerMap | JobRegistry): JobRegistry {
  if (handlers instanceof Map) return new Map(handlers);
  return new Map(Object.entries(handlers));
}

/** Resolve a handler while accepting either a registry or a plain map for convenient test setup. */
export function resolveHandler(handlers: JobRegistry | JobHandlerMap, kind: string): JobHandler | undefined {
  if (handlers instanceof Map) return handlers.get(kind);
  return (handlers as JobHandlerMap)[kind];
}

/** Alias retained for callers that prefer the longer name in wiring code. */
export const createHandlerRegistry = createRegistry;
