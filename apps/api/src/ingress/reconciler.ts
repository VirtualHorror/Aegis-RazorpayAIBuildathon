import type pg from 'pg';
import { KNOWN_EVENT_TYPES } from '@aegis/shared';
import { enqueue } from '../db/repos/jobs';
import {
  markWebhookEventIgnored,
  setWebhookEventError,
  upsertWebhookEvent,
  type WebhookStatus,
} from '../db/repos/webhook-events';

export interface ReconcileInput {
  eventId: string;
  eventType: string;
  accountId: string | null;
  payload: Record<string, unknown>;
  sha256: string;
  signatureValid: boolean;
  rzpCreatedAt: Date | null;
  status?: WebhookStatus;
  lastError?: string;
  /** Development-only LLM chaos mode captured by ingress and carried to the worker. */
  chaos?: 'llm_down';
}

export interface ReconcileResult {
  inserted: boolean;
  duplicateCount: number;
  enqueued: boolean;
}

function isKnownEventType(eventType: string): boolean {
  return KNOWN_EVENT_TYPES.some((known) => known === eventType);
}

/**
 * Reconcile one delivery and its work item atomically.
 * Intent: a successful HTTP acknowledgement must imply both the durable event row and its outbox job are committed.
 * Flow: BEGIN -> event INSERT/duplicate UPDATE -> optional job or ignored update -> COMMIT; rollback on any failure.
 */
export async function reconcile(db: pg.Pool, input: ReconcileInput): Promise<ReconcileResult> {
  const client = await db.connect();
  // Intent: an invalid signature can never enter the worker queue, even if a caller supplied a known event name.
  // Flow: force unsigned deliveries to `ignored` -> persist them for audit -> skip the outbox branch below.
  const status: WebhookStatus = input.signatureValid ? input.status ?? 'received' : 'ignored';
  const lastError = input.lastError ?? (input.signatureValid ? undefined : 'invalid_signature');
  try {
    await client.query('BEGIN');
    const event = await upsertWebhookEvent(client, { ...input, status });
    if (event.inserted && lastError) await setWebhookEventError(client, input.eventId, lastError);

    let enqueued = false;
    if (event.inserted && input.signatureValid && status !== 'ignored' && isKnownEventType(input.eventType)) {
      const job = await enqueue(client, {
        kind: 'process_event',
        payload: input.chaos === 'llm_down'
          ? { eventId: input.eventId, chaos: input.chaos }
          : { eventId: input.eventId },
        dedupeKey: `process_event:${input.eventId}`,
      });
      enqueued = job.inserted;
    } else if (event.inserted && input.signatureValid && status !== 'ignored') {
      await markWebhookEventIgnored(client, input.eventId);
    }

    await client.query('COMMIT');
    return { inserted: event.inserted, duplicateCount: event.duplicateCount, enqueued };
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch (rollbackError) {
      throw new Error(
        `webhook reconciliation failed and rollback failed: ${error instanceof Error ? error.message : String(error)}; ` +
          `${rollbackError instanceof Error ? rollbackError.message : String(rollbackError)}`,
        { cause: rollbackError },
      );
    }
    throw error;
  } finally {
    client.release();
  }
}
