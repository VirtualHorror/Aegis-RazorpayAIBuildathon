import pg from 'pg';
import type { DbInspector, DeliveryResult, PreparedScenario } from './types';

interface DurableEvent {
  readonly status: string;
  readonly jobCount: number;
}

export async function inspectEvent(inspector: DbInspector | undefined, eventId: string): Promise<DurableEvent | undefined> {
  if (!inspector) return undefined;
  try {
    const result = await inspector.pool.query<{ status: string; job_count: number }>(
      `SELECT e.status, (SELECT count(*)::int FROM jobs j WHERE j.payload->>'eventId' = e.event_id) AS job_count
       FROM webhook_events e WHERE e.event_id = $1`,
      [eventId],
    );
    const row = result.rows[0];
    return row ? { status: row.status, jobCount: Number(row.job_count) } : undefined;
  } catch (error) {
    console.warn(`warning: database classification lookup failed: ${error instanceof Error ? error.message : String(error)}`);
    return undefined;
  }
}

export function createDbInspector(): DbInspector | undefined {
  const connectionString = process.env.DATABASE_URL ?? process.env.DATABASE_URL_TEST;
  if (!connectionString) {
    console.warn('warning: DATABASE_URL/DATABASE_URL_TEST is unset; runs requiring durable simulator checks will fail closed');
    return undefined;
  }
  const pool = new pg.Pool({ connectionString, application_name: 'aegis-simulator', max: 1, connectionTimeoutMillis: 2_000 });
  return { pool, close: () => pool.end() };
}

/**
 * Verify that forged deliveries use the ingress quarantine namespace.
 * Intent: an invalid signature must never claim a trusted `evt_` idempotency key.
 * Flow: find the forged fixture -> query its body-hash key -> require ignored/invalid durable state.
 */
export async function verifyBadSignatureNamespace(
  results: readonly DeliveryResult[],
  prepared: readonly PreparedScenario[],
  inspector: DbInspector | undefined,
): Promise<void> {
  const bad = prepared.find((item) => !item.scenario.signatureValid);
  if (!bad || !results.some((result) => result.eventId === bad.scenario.eventId && result.category === 'rejected')) return;
  if (!inspector) throw new Error('cannot verify bad_signature quarantine; DATABASE_URL/DATABASE_URL_TEST is required');
  try {
    const result = await inspector.pool.query<{ event_id: string; status: string; signature_valid: boolean }>(
      'SELECT event_id, status, signature_valid FROM webhook_events WHERE event_id = $1',
      [bad.unverifiedKey],
    );
    const row = result.rows[0];
    if (!row || !row.event_id.startsWith('unverified:') || row.signature_valid !== false || row.status !== 'ignored') {
      throw new Error(`bad_signature was not quarantined under ${bad.unverifiedKey}`);
    }
    console.log(`bad_signature namespace=${row.event_id}`);
  } catch (error) {
    throw new Error(`bad_signature namespace verification failed: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
  }
}

/**
 * Verify durable worker completion after a concurrent burst.
 * Intent: retries can hide lock-order regressions, so any attempt above one is a critical failure.
 * Flow: query accepted event IDs until every job succeeds -> fail immediately on attempts > 1 -> report the terminal proof.
 */
export async function verifyBurst(
  results: readonly DeliveryResult[],
  prepared: readonly PreparedScenario[],
  inspector: DbInspector | undefined,
): Promise<void> {
  if (!inspector) throw new Error('cannot verify burst jobs; DATABASE_URL/DATABASE_URL_TEST is required');
  const acceptedIds = new Set(
    results.filter((result) => result.category === 'accepted').map((result) => result.eventId),
  );
  if (acceptedIds.size === 0) return;
  const ids = [...acceptedIds];
  const deadline = Date.now() + 30_000;
  let rows: Array<{ status: string; attempts: number; event_id: string }> = [];
  while (Date.now() < deadline) {
    const query = await inspector.pool.query<{ status: string; attempts: number; event_id: string }>(
      `SELECT status, attempts, payload->>'eventId' AS event_id FROM jobs WHERE payload->>'eventId' = ANY($1::text[])`,
      [ids],
    );
    rows = query.rows;
    const maxAttempts = rows.reduce((maximum, row) => Math.max(maximum, Number(row.attempts)), 0);
    if (maxAttempts > 1) {
      const deadlock = rows.find((row) => Number(row.attempts) > 1);
      throw new Error(`CRITICAL lock-order regression: burst job ${deadlock?.event_id ?? 'unknown'} has attempts=${deadlock?.attempts ?? maxAttempts}`);
    }
    if (rows.length >= ids.length && rows.every((row) => row.status === 'succeeded')) break;
    await new Promise<void>((resolve) => setTimeout(resolve, 100));
  }
  const maxAttempts = rows.reduce((maximum, row) => Math.max(maximum, Number(row.attempts)), 0);
  if (maxAttempts > 1) throw new Error(`CRITICAL lock-order regression: burst max(attempts)=${maxAttempts}`);
  const succeeded = rows.filter((row) => row.status === 'succeeded').length;
  if (rows.length < ids.length || succeeded < ids.length) {
    throw new Error(`burst verification incomplete: jobs=${rows.length}/${ids.length} succeeded=${succeeded}/${ids.length}`);
  }
  console.log(`burst verification jobs=${rows.length}/${prepared.length} succeeded=${succeeded} max_attempts=${maxAttempts}`);
}
