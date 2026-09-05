import type pg from 'pg';
import {
  assertSafePaise,
  DISPUTE_PHASES,
  DISPUTE_STATUSES,
  type DisputePhase,
  type DisputeStatus,
  type RazorpayWebhook,
  isStaleSubscriptionEvent,
} from '@aegis/shared';
import type { CustomerRow } from '../../db/repos/customers';
import type { EntitySnapshot, ProjectionRow } from '../entity';
import {
  asContext,
  definedOr,
  eventDate,
  loadCustomer,
  nullableDate,
  sameEvent,
  snapshot,
  sourceEventId,
  type ProjectionContext,
} from './shared';

interface DisputeRow extends ProjectionRow {
  readonly payment_id: string | null;
  readonly amount_paise: number;
  readonly currency: string;
  readonly reason_code: string | null;
  readonly reason_description: string | null;
  readonly phase: DisputePhase;
  readonly status: DisputeStatus;
  readonly respond_by: Date | null;
  readonly last_event_id: string | null;
  readonly last_event_at: Date | null;
  readonly created_at: Date;
  readonly updated_at: Date;
}

function eventStatus(eventType: string): DisputeStatus | undefined {
  const suffix = eventType.split('.').at(-1);
  return suffix && DISPUTE_STATUSES.includes(suffix as DisputeStatus) ? (suffix as DisputeStatus) : undefined;
}

function eventPhase(eventType: string): DisputePhase | undefined {
  const suffix = eventType.split('.').at(-1);
  return suffix && DISPUTE_PHASES.includes(suffix as DisputePhase) ? (suffix as DisputePhase) : undefined;
}

async function ensurePayment(
  tx: pg.PoolClient,
  paymentId: string | null,
  amount: number,
  currency: string,
): Promise<void> {
  if (paymentId === null) return;
  const existing = await tx.query<{ id: string }>('SELECT id FROM payments WHERE id = $1 FOR UPDATE', [paymentId]);
  if (existing.rows[0]) return;
  await tx.query(
    `INSERT INTO payments (id, amount_paise, currency, status, status_rank, notes, version)
     VALUES ($1, $2, $3, 'created', 0, '{}'::jsonb, 1)
     ON CONFLICT (id) DO NOTHING`,
    [paymentId, amount, currency],
  );
}

async function customerForPayment(tx: pg.PoolClient, paymentId: string | null): Promise<CustomerRow | null> {
  if (paymentId === null) return null;
  const result = await tx.query<{ customer_id: string | null }>('SELECT customer_id FROM payments WHERE id = $1', [paymentId]);
  return loadCustomer(tx, result.rows[0]?.customer_id ?? null);
}

function eventEntityDate(value: number | null | undefined, current: Date | null | undefined): Date | null {
  return value === undefined ? current ?? null : nullableDate(value);
}

/**
 * Project a dispute while preserving its payment FK and timestamp precedence.
 * Intent: disputes may arrive before a payment projection, so create a minimal payment parent before writing the dispute.
 * Flow: lock dispute -> reject duplicate/older event -> ensure payment parent -> upsert dispute and version.
 */
export async function projectDispute(
  tx: pg.PoolClient,
  payload: RazorpayWebhook,
  context?: ProjectionContext | string | null,
): Promise<EntitySnapshot> {
  const entity = payload.payload.dispute?.entity;
  if (!entity) throw new Error(`event ${payload.event} has no dispute entity`);
  const ctx = asContext(context);
  const incomingAt = eventDate(payload, ctx);
  const currentResult = await tx.query<DisputeRow>('SELECT * FROM disputes WHERE id = $1 FOR UPDATE', [entity.id]);
  const current = currentResult.rows[0];
  if (current && (sameEvent(current, ctx) || isStaleSubscriptionEvent(current.last_event_at, incomingAt))) {
    return snapshot('dispute', current, await customerForPayment(tx, current.payment_id), false);
  }

  const paymentId = definedOr(entity.payment_id, current?.payment_id, null);
  const amount = assertSafePaise(definedOr(entity.amount, current?.amount_paise, 0), 'dispute.amount_paise');
  const currency = definedOr(entity.currency, current?.currency, 'INR');
  await ensurePayment(tx, paymentId, amount, currency);
  const status = definedOr(eventStatus(payload.event), current?.status, 'open');
  const phase = definedOr(entity.phase ?? eventPhase(payload.event), current?.phase, 'retrieval');
  const sourceId = sourceEventId(ctx, current?.last_event_id);
  const result = await tx.query<DisputeRow>(
    `INSERT INTO disputes
       (id, payment_id, amount_paise, currency, reason_code, reason_description, phase, status, respond_by,
        last_event_id, last_event_at, version)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 1)
     ON CONFLICT (id) DO UPDATE SET
       payment_id = EXCLUDED.payment_id,
       amount_paise = EXCLUDED.amount_paise,
       currency = EXCLUDED.currency,
       reason_code = EXCLUDED.reason_code,
       reason_description = EXCLUDED.reason_description,
       phase = EXCLUDED.phase,
       status = EXCLUDED.status,
       respond_by = EXCLUDED.respond_by,
       last_event_id = EXCLUDED.last_event_id,
       last_event_at = EXCLUDED.last_event_at,
       version = disputes.version + 1,
       updated_at = now()
     WHERE disputes.last_event_id IS DISTINCT FROM EXCLUDED.last_event_id
       AND (disputes.last_event_at IS NULL OR EXCLUDED.last_event_at >= disputes.last_event_at)
     RETURNING *`,
    [
      entity.id,
      paymentId,
      amount,
      currency,
      definedOr(entity.reason_code, current?.reason_code, null),
      definedOr(entity.reason_description, current?.reason_description, null),
      phase,
      status,
      eventEntityDate(entity.respond_by, current?.respond_by),
      sourceId,
      incomingAt,
    ],
  );
  // Intent: two concurrent first sightings must still honor event-time precedence after one INSERT wins.
  // Flow: stale conflict is rejected -> lock and return the winner as unapplied.
  const row = result.rows[0] ?? (await tx.query<DisputeRow>('SELECT * FROM disputes WHERE id = $1 FOR UPDATE', [entity.id])).rows[0];
  if (!row) throw new Error(`dispute projection returned no row for ${entity.id}`);
  const applied = result.rows.length === 1;
  return snapshot('dispute', row, await customerForPayment(tx, row.payment_id), applied);
}

export const applyDisputeProjection = projectDispute;
