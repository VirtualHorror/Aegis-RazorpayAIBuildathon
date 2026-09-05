import { createHash } from 'node:crypto';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { RazorpayWebhookSchema } from '@aegis/shared';
import type { Config } from '../config';
import type { RawBodyRequest } from '../types/fastify';
import { reconcile, type ReconcileResult } from './reconciler';
import { verifySignature } from './signature';
import type pg from 'pg';
import { runWithLlmChaos } from '../llm/resilient';

export interface IngressEventNotification {
  eventId: string;
  eventType: string;
  status: 'accepted' | 'duplicate' | 'rejected' | 'ignored';
  signatureValid: boolean;
}

export interface RazorpayWebhookHandlerOptions {
  config: Pick<Config, 'RAZORPAY_WEBHOOK_SECRET'> & Partial<Pick<Config, 'NODE_ENV'>>;
  db: pg.Pool | null;
  onEvent?: (notification: IngressEventNotification) => void | Promise<void>;
}

function headerValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function recordValue(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function dateFromCreatedAt(value: unknown): Date | null {
  // Intent: Razorpay normally sends Unix seconds while hand-crafted tests may use ISO timestamps.
  // Flow: convert numeric seconds (including numeric strings) -> parse ISO strings -> reject invalid dates as null.
  if (typeof value === 'number' && Number.isInteger(value) && value >= 0) {
    const date = new Date(value * 1000);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  if (typeof value === 'string' && value.length > 0) {
    if (/^\d+$/.test(value)) {
      const date = new Date(Number(value) * 1000);
      return Number.isNaN(date.getTime()) ? null : date;
    }
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  return null;
}

function hashBody(rawBody: Buffer): string {
  return createHash('sha256').update(rawBody).digest('hex');
}

/**
 * Choose the idempotency key that `webhook_events.event_id` will hold.
 * Intent: `x-razorpay-event-id` is attacker-controlled until the HMAC passes, so an unauthenticated caller must never be
 *   able to occupy the key a genuine delivery will use (C-C1 orders verification before the upsert). Without this split a
 *   forged 401 request claiming `evt_X` inserts the row first; Razorpay's real `evt_X` then hits ON CONFLICT, is answered
 *   `200 {"status":"duplicate"}`, enqueues no job, and is dropped forever because a 200 stops Razorpay retrying.
 * Flow: signature valid -> trust the provider's event id (or the body hash when the header is absent);
 *   signature invalid -> key into a separate `unverified:` namespace derived only from bytes we hashed ourselves.
 */
function ingressKey(claimedEventId: string, sha256: string, signatureValid: boolean): string {
  return signatureValid ? claimedEventId : `unverified:${sha256}`;
}

async function notify(
  request: FastifyRequest,
  options: RazorpayWebhookHandlerOptions,
  notification: IngressEventNotification,
): Promise<void> {
  if (!options.onEvent) return;
  try {
    await options.onEvent(notification);
  } catch (error) {
    // Intent: a notification consumer must never turn a committed webhook into a retrying 5xx response.
    // Flow: event transaction commits -> hook is attempted -> hook failure is logged and the HTTP result is retained.
    request.log.warn({ err: error, event_id: notification.eventId }, 'webhook event hook failed');
  }
}

async function reconcileRejected(
  options: RazorpayWebhookHandlerOptions,
  input: {
    eventId: string;
    eventType: string;
    accountId: string | null;
    payload: Record<string, unknown>;
    sha256: string;
    signatureValid: boolean;
    rzpCreatedAt: Date | null;
    lastError: string;
  },
): Promise<ReconcileResult | null> {
  if (!options.db) return null;
  return reconcile(options.db, { ...input, status: 'ignored' });
}

/**
 * Handle the real Razorpay ingress contract.
 * Intent: authenticate bytes before trusting event fields; rejected and malformed deliveries remain auditable but inert.
 * Flow: raw bytes -> HMAC -> JSON parse -> zod envelope -> transactional reconcile -> post-commit notification -> response.
 */
export async function handleRazorpayWebhook(
  request: FastifyRequest,
  reply: FastifyReply,
  options: RazorpayWebhookHandlerOptions,
): Promise<void> {
  const chaosHeader = headerValue(request.headers['x-aegis-chaos']);
  const chaos = (options.config.NODE_ENV === 'development' || options.config.NODE_ENV === 'test') && chaosHeader === 'llm_down'
    ? 'llm_down'
    : undefined;
  return runWithLlmChaos(chaos, () => handleRazorpayWebhookInContext(request, reply, options, chaos));
}

/** Handle a request after its development-only chaos context has been installed. */
async function handleRazorpayWebhookInContext(
  request: FastifyRequest,
  reply: FastifyReply,
  options: RazorpayWebhookHandlerOptions,
  chaos?: 'llm_down',
): Promise<void> {
  if (!options.db) {
    await reply.code(503).send({ error: 'database_unavailable' });
    return;
  }

  const raw = (request as RawBodyRequest).rawBody ?? Buffer.alloc(0);
  const sha256 = hashBody(raw);
  const signature = headerValue(request.headers['x-razorpay-signature']);
  const signatureValid = verifySignature(raw, signature, options.config.RAZORPAY_WEBHOOK_SECRET);
  const eventIdHeader = headerValue(request.headers['x-razorpay-event-id']);
  const claimedEventId = eventIdHeader ?? `sha256:${sha256}`;
  const eventId = ingressKey(claimedEventId, sha256, signatureValid);

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw.toString('utf8'));
  } catch (error) {
    // Intent: invalid bytes are still counted, but `{}` is the only valid JSONB placeholder for a malformed body.
    // Flow: parse fails -> reconcile an ignored unknown event -> 401 for bad HMAC or 400 for an authenticated bad body.
    request.log.warn({ err: error, event_id: eventId }, 'webhook body JSON parse failed');
    await reconcileRejected(options, {
      eventId,
      eventType: 'unknown',
      accountId: null,
      payload: {},
      sha256,
      signatureValid,
      rzpCreatedAt: null,
      lastError: signatureValid ? 'invalid_json' : 'invalid_signature',
    });
    await notify(request, options, { eventId, eventType: 'unknown', status: signatureValid ? 'ignored' : 'rejected', signatureValid });
    if (!signatureValid) {
      await reply.code(401).send({ error: 'invalid_signature' });
    } else {
      await reply.code(400).send({ error: 'invalid_json' });
    }
    return;
  }

  const rawRecord = recordValue(parsed);
  const rawEventType = stringValue(rawRecord.event) ?? 'unknown';
  const rawAccountId = stringValue(rawRecord.account_id) ?? null;
  const rawCreatedAt = dateFromCreatedAt(rawRecord.created_at);

  if (!signatureValid) {
    // Intent: keep the rejected delivery auditable without letting it name a real event (see `ingressKey`).
    // Flow: log the id the caller claimed -> persist under the `unverified:` key -> 401 so Razorpay retries a genuine send.
    request.log.warn(
      { event_id: eventId, claimed_event_id: claimedEventId, event_type: rawEventType },
      'webhook signature verification failed',
    );
    await reconcileRejected(options, {
      eventId,
      eventType: rawEventType,
      accountId: rawAccountId,
      payload: rawRecord,
      sha256,
      signatureValid: false,
      rzpCreatedAt: rawCreatedAt,
      lastError: 'invalid_signature',
    });
    await notify(request, options, { eventId, eventType: rawEventType, status: 'rejected', signatureValid: false });
    await reply.code(401).send({ error: 'invalid_signature' });
    return;
  }

  const parsedEnvelope = RazorpayWebhookSchema.safeParse(parsed);
  if (!parsedEnvelope.success) {
    await reconcileRejected(options, {
      eventId,
      eventType: rawEventType,
      accountId: rawAccountId,
      payload: rawRecord,
      sha256,
      signatureValid: true,
      rzpCreatedAt: rawCreatedAt,
      lastError: 'schema_validation_failed',
    });
    await notify(request, options, { eventId, eventType: rawEventType, status: 'ignored', signatureValid: true });
    await reply.code(202).send({ status: 'ignored', reason: 'schema' });
    return;
  }

  const payload = parsedEnvelope.data;
  const result = await reconcile(options.db, {
    eventId,
    eventType: payload.event,
    accountId: payload.account_id ?? null,
    // Intent: persist the validated object's original fields so schema defaults never rewrite the signed provider payload.
    // Flow: zod validates `parsed` -> `rawRecord` supplies the unchanged JSON object to the transaction.
    payload: rawRecord,
    sha256,
    signatureValid: true,
    rzpCreatedAt: dateFromCreatedAt(payload.created_at),
    chaos,
  });
  const status = result.inserted ? 'accepted' : 'duplicate';
  await notify(request, options, { eventId, eventType: payload.event, status, signatureValid: true });
  await reply.code(200).send({ status, event_id: eventId, duplicate_count: result.duplicateCount });
}
