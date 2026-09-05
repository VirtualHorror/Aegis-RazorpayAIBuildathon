import type pg from 'pg';

export type WebhookStatus = 'received' | 'ignored';

export interface WebhookEventUpsertInput {
  eventId: string;
  eventType: string;
  accountId: string | null;
  payload: Record<string, unknown>;
  sha256: string;
  signatureValid: boolean;
  rzpCreatedAt: Date | null;
  status: WebhookStatus;
}

export interface WebhookEventUpsertResult {
  inserted: boolean;
  duplicateCount: number;
}

/**
 * Insert an ingress row or atomically count a duplicate delivery.
 * Intent: let PostgreSQL's unique index serialize concurrent deliveries of one Razorpay event.
 * Flow: INSERT -> conflict UPDATE duplicate_count/last_duplicate_at -> return the tuple insertion marker.
 */
export async function upsertWebhookEvent(tx: pg.PoolClient, input: WebhookEventUpsertInput): Promise<WebhookEventUpsertResult> {
  // Intent: distinguish the winner of a concurrent INSERT from a duplicate conflict UPDATE without a second query.
  // Flow: PostgreSQL returns xmax=0 for a fresh tuple -> a conflict UPDATE returns a non-zero tuple xmax -> map it to `inserted`.
  const result = await tx.query<{ inserted: boolean; duplicate_count: number }>(
    `INSERT INTO webhook_events (event_id, event_type, account_id, payload, payload_sha256, signature_valid, rzp_created_at, status)
     VALUES ($1,$2,$3,$4::jsonb,$5,$6,$7,$8)
     ON CONFLICT (event_id) DO UPDATE SET duplicate_count = webhook_events.duplicate_count + 1, last_duplicate_at = now()
     RETURNING (xmax = 0) AS inserted, duplicate_count`,
    [
      input.eventId,
      input.eventType,
      input.accountId,
      JSON.stringify(input.payload),
      input.sha256,
      input.signatureValid,
      input.rzpCreatedAt,
      input.status,
    ],
  );
  const row = result.rows[0];
  if (!row) throw new Error('webhook event upsert returned no row');
  return { inserted: row.inserted, duplicateCount: Number(row.duplicate_count) };
}

export async function setWebhookEventError(tx: pg.PoolClient, eventId: string, lastError: string): Promise<void> {
  await tx.query('UPDATE webhook_events SET last_error = $2 WHERE event_id = $1', [eventId, lastError]);
}

export async function markWebhookEventIgnored(tx: pg.PoolClient, eventId: string): Promise<void> {
  await tx.query("UPDATE webhook_events SET status = 'ignored' WHERE event_id = $1", [eventId]);
}
