import {
  RazorpayWebhookSchema,
  type RazorpayWebhook,
} from '@aegis/shared';
import { withTransaction } from '../db/tx';
import { applyProjection } from '../orchestrator/projections';
import type { JobHandler } from './registry';

interface WebhookEventRow {
  event_id: string;
  event_type: string;
  payload: unknown;
  signature_valid: boolean;
  rzp_created_at: Date | null;
  status: string;
}

function eventIdFromJob(payload: Record<string, unknown>): string {
  const eventId = payload.eventId;
  if (typeof eventId !== 'string' || eventId.length === 0) {
    throw new Error('process_event job payload must contain a non-empty eventId');
  }
  return eventId;
}

function createdAt(value: RazorpayWebhook['created_at']): Date | null {
  if (typeof value === 'number' && Number.isInteger(value) && value >= 0) {
    const date = new Date(value * 1000);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  if (typeof value === 'string' && value.length > 0) {
    const date = /^\d+$/.test(value) ? new Date(Number(value) * 1000) : new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  return null;
}

/**
 * Process one durable webhook event and its projection in one transaction.
 * Intent: the worker must authenticate from the persisted ingress row again; a queued job is not proof of a valid signature.
 * Flow: lock and re-read event -> reject signature-invalid rows before parsing/projecting -> parse raw JSONB -> project under
 *       entity locks -> mark the event processed. A projection failure rolls the event status back for retry.
 */
export const processEventHandler: JobHandler = async (job, ctx) => {
  const eventId = eventIdFromJob(job.payload);
  await withTransaction(ctx.db, async (tx) => {
    const result = await tx.query<WebhookEventRow>(
      `SELECT event_id, event_type, payload, signature_valid, rzp_created_at, status
       FROM webhook_events
       WHERE event_id = $1
       FOR UPDATE`,
      [eventId],
    );
    const event = result.rows[0];
    if (!event) throw new Error(`webhook event ${eventId} not found`);

    // Intent: defend against a forged or manually queued job even if ingress once persisted a row.
    // Flow: inspect the trusted boolean -> leave invalid deliveries inert and let the queue mark this job terminal.
    if (event.signature_valid !== true) {
      ctx.logger.warn({ event_id: event.event_id }, 'refusing process_event with invalid signature');
      return;
    }

    const payload = RazorpayWebhookSchema.parse(event.payload);
    await tx.query(
      `UPDATE webhook_events
       SET status = 'processing', processed_at = NULL, last_error = NULL
       WHERE event_id = $1 AND signature_valid = TRUE`,
      [event.event_id],
    );
    await applyProjection(tx, payload, {
      eventId: event.event_id,
      eventAt: event.rzp_created_at ?? createdAt(payload.created_at),
    });
    await tx.query(
      `UPDATE webhook_events
       SET status = 'processed', processed_at = now(), last_error = NULL
       WHERE event_id = $1 AND signature_valid = TRUE`,
      [event.event_id],
    );
  });
};
