import type pg from 'pg';

export interface EnqueueInput {
  kind: string;
  payload: Record<string, unknown>;
  dedupeKey: string;
  runAt?: Date | null;
}

export interface EnqueueResult {
  inserted: boolean;
  id: number | null;
}

/**
 * Add durable work to the transactional outbox.
 * Intent: a unique dedupe key prevents retries or concurrent callers from creating a second process job.
 * Flow: serialize the JSON payload -> insert queued work -> ON CONFLICT leaves the existing job untouched.
 */
export async function enqueue(tx: pg.PoolClient, input: EnqueueInput): Promise<EnqueueResult> {
  const result = await tx.query<{ id: number }>(
    `INSERT INTO jobs (kind, payload, dedupe_key, run_at)
     VALUES ($1, $2::jsonb, $3, COALESCE($4::timestamptz, now()))
     ON CONFLICT (dedupe_key) DO NOTHING
     RETURNING id`,
    [input.kind, JSON.stringify(input.payload), input.dedupeKey, input.runAt ?? null],
  );
  const id = result.rows[0]?.id;
  return { inserted: result.rowCount === 1 && id !== undefined, id: id ?? null };
}
