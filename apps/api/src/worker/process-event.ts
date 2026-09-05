import {
  RazorpayWebhookSchema,
  type RazorpayWebhook,
} from '@aegis/shared';
import { withTransaction } from '../db/tx';
import { applyProjection } from '../orchestrator/projections';
import { runWithLlmChaos } from '../llm/resilient';
import type { JobHandler, JobHandlerContext, JobRow } from './registry';

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
 * Read the exact chaos mode persisted by development/test ingress.
 * Intent: the worker accepts only the one bounded mode understood by the resilient LLM client; arbitrary job payload
 * values must never become an implicit control channel.
 * Flow: inspect the JSON payload -> accept the literal `llm_down` -> leave every other value unset.
 */
export function chaosFromJobPayload(payload: Record<string, unknown>): 'llm_down' | undefined {
  return payload.chaos === 'llm_down' ? 'llm_down' : undefined;
}

/**
 * Re-enter the request-scoped chaos context for work that may call the diagnostician.
 * Intent: AsyncLocalStorage context does not cross the durable queue boundary, so the worker must explicitly restore the
 * ingress decision before invoking the orchestrator/LLM path (B-009).
 * Flow: read the validated job field -> install `runWithLlmChaos` context -> run the handler body -> restore context.
 */
export function runProcessEventWithChaos<T>(job: Pick<JobRow, 'payload'>, callback: () => T): T {
  return runWithLlmChaos(chaosFromJobPayload(job.payload), callback);
}

export const processEventHandler: JobHandler = async (job, ctx) => runProcessEventWithChaos(job, () => processEvent(job, ctx));

/**
 * Process one durable webhook event and its projection in one transaction.
 * Intent: the worker must authenticate from the persisted ingress row again; a queued job is not proof of a valid signature.
 * Flow: lock and re-read event -> reject signature-invalid rows before parsing/projecting -> parse raw JSONB -> project under
 *       entity locks -> mark the event processed. A projection failure rolls the event status back for retry.
 */
async function processEvent(job: JobRow, ctx: JobHandlerContext): Promise<void> {
  const eventId = eventIdFromJob(job.payload);
  if (ctx.orchestrator) {
    // Intent: projection and diagnosis belong to the orchestrator once the app is fully wired; keep the legacy branch
    // available for projection-focused tests and migration tooling that deliberately omit an orchestrator.
    // Flow: worker restores chaos context -> orchestrator locks/project commits -> diagnosis and actions run post-commit.
    await ctx.orchestrator.handle(eventId, ctx.workerId);
    return;
  }
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
