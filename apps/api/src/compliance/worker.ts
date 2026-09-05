import type { EventBus } from '../bus/event-bus';
import type { LlmClient } from '../llm/client';
import { ComplianceScanner } from './scanner';
import type { JobHandler } from '../worker/registry';
import type pg from 'pg';
import { withTransaction } from '../db/tx';
import { enqueue } from '../db/repos/jobs';

const SIX_HOURS_MS = 6 * 60 * 60 * 1_000;

/** Queue one durable scan and its run row in the same transaction. */
export async function enqueueComplianceScan(db: pg.Pool, runAt?: Date): Promise<string> {
  return withTransaction(db, async (tx) => {
    const inserted = await tx.query<{ id: string }>(
      `INSERT INTO compliance_scan_runs (status, started_at) VALUES ('running', now()) RETURNING id`,
    );
    const runId = inserted.rows[0]?.id;
    if (!runId) throw new Error('compliance scan run insert returned no id');
    await enqueue(tx, { kind: 'compliance_scan', payload: { runId }, dedupeKey: `compliance_scan:${runId}`, runAt });
    return runId;
  });
}

export interface ComplianceCronHandle {
  stop(): void;
}

/**
 * Start the optional six-hour catalog scan schedule.
 * Intent: cron is an explicit opt-in and uses the same durable queue path as the HTTP route.
 * Flow: enqueue one run at startup -> schedule the next enqueue on a six-hour unref'd timer -> log failures without
 *       taking down the API process; shutdown clears the timer.
 */
export function startComplianceCron(
  db: pg.Pool,
  logger: { info: (...args: unknown[]) => void; warn: (...args: unknown[]) => void },
  intervalMs = SIX_HOURS_MS,
): ComplianceCronHandle {
  let stopped = false;
  const enqueueRun = async (): Promise<void> => {
    if (stopped) return;
    try {
      const runId = await enqueueComplianceScan(db);
      logger.info({ run_id: runId }, 'compliance scan queued');
    } catch (error) {
      logger.warn({ err: error }, 'compliance cron enqueue failed');
    }
  };
  void enqueueRun();
  const timer = setInterval(() => void enqueueRun(), intervalMs);
  timer.unref();
  return {
    stop: (): void => {
      stopped = true;
      clearInterval(timer);
    },
  };
}

export function createComplianceScanHandler(llm: LlmClient, bus?: EventBus): JobHandler {
  return async (job, ctx) => {
    const runId = job.payload.runId;
    if (typeof runId !== 'string' || runId.length === 0) throw new Error('compliance_scan payload must contain runId');
    await new ComplianceScanner({ db: ctx.db, llm, bus, logger: ctx.logger }).run(runId);
  };
}
