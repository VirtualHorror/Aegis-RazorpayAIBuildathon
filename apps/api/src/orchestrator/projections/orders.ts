import type pg from 'pg';
import {
  assertSafePaise,
  type OrderStatus,
  type RazorpayOrderEntity,
  type RazorpayWebhook,
  isStaleSubscriptionEvent,
} from '@aegis/shared';
import type { EntitySnapshot, ProjectionRow } from '../entity';
import {
  asContext,
  definedOr,
  entityCreatedAt,
  eventDate,
  lockOrderSlot,
  loadCustomer,
  projectCustomer,
  sameEvent,
  snapshot,
  sourceEventId,
  type ProjectionContext,
} from './shared';

interface OrderRow extends ProjectionRow {
  readonly customer_id: string | null;
  readonly amount_paise: number;
  readonly currency: string;
  readonly status: OrderStatus;
  readonly receipt: string | null;
  readonly items: readonly unknown[];
  readonly notes: Record<string, unknown>;
  readonly rzp_created_at: Date | null;
  readonly last_event_id: string | null;
  readonly last_event_at: Date | null;
  readonly created_at: Date;
  readonly updated_at: Date;
}

function eventStatus(eventType: string): OrderStatus | undefined {
  const suffix = eventType.split('.').at(-1);
  if (suffix === 'attempted' || suffix === 'paid') return suffix;
  return undefined;
}

function amountFromEntity(entity: RazorpayOrderEntity): number | undefined {
  return entity.amount ?? entity.amount_paid ?? entity.amount_due;
}

/**
 * Project an order while serializing updates on that order's row.
 * Intent: delayed order events must not overwrite newer state, while a payment can safely create its missing order parent.
 * Flow: reserve/lock order slot -> reject duplicate/stale event -> upsert customer -> fill or update the order row.
 */
export async function projectOrder(tx: pg.PoolClient, payload: RazorpayWebhook, context?: ProjectionContext | string | null): Promise<EntitySnapshot> {
  const entity = payload.payload.order?.entity;
  if (!entity) throw new Error(`event ${payload.event} has no order entity`);
  const ctx = asContext(context);
  const incomingAt = eventDate(payload, ctx);
  const seedCurrency = entity.currency ?? 'INR';
  // Intent: the reservation row is temporary; defer provider amount validation until after duplicate/stale checks.
  // Flow: insert a zero-valued placeholder when needed -> apply precedence -> validate and write the event amount.
  const slotInserted = await lockOrderSlot(tx, entity.id, 0, seedCurrency);
  const currentResult = await tx.query<OrderRow>('SELECT * FROM orders WHERE id = $1 FOR UPDATE', [entity.id]);
  const current = currentResult.rows[0];
  if (current && (sameEvent(current, ctx) || isStaleSubscriptionEvent(current.last_event_at, incomingAt))) {
    return snapshot('order', current, await loadCustomer(tx, current.customer_id), false);
  }

  const customer = await projectCustomer(tx, entity);
  const customerId = definedOr(entity.customer_id, current?.customer_id, null);
  const amount = assertSafePaise(definedOr(amountFromEntity(entity), current?.amount_paise, 0), 'order.amount_paise');
  const currency = definedOr(entity.currency, current?.currency, 'INR');
  const status = definedOr(entity.status ?? eventStatus(payload.event), current?.status, 'created');
  const receipt = definedOr(entity.receipt, current?.receipt, null);
  const items = definedOr(entity.items, current?.items, []);
  const notes = definedOr(entity.notes, current?.notes, {});
  const sourceId = sourceEventId(ctx, current?.last_event_id);
  const providerCreatedAt = entityCreatedAt(entity) ?? current?.rzp_created_at ?? null;

  const result = slotInserted
    ? await tx.query<OrderRow>(
      `UPDATE orders
       SET customer_id = $2,
           amount_paise = $3,
           currency = $4,
           status = $5,
           receipt = $6,
           items = $7::jsonb,
           notes = $8::jsonb,
           rzp_created_at = $9,
           last_event_id = $10,
           last_event_at = $11,
           updated_at = now()
       WHERE id = $1
       RETURNING *`,
      [entity.id, customerId, amount, currency, status, receipt, JSON.stringify(items), JSON.stringify(notes), providerCreatedAt, sourceId, incomingAt],
    )
    : await tx.query<OrderRow>(
      `INSERT INTO orders
         (id, customer_id, amount_paise, currency, status, receipt, items, notes, rzp_created_at, last_event_id, last_event_at, version)
       VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb, $9, $10, $11, 1)
       ON CONFLICT (id) DO UPDATE SET
         customer_id = EXCLUDED.customer_id,
         amount_paise = EXCLUDED.amount_paise,
         currency = EXCLUDED.currency,
         status = EXCLUDED.status,
         receipt = EXCLUDED.receipt,
         items = EXCLUDED.items,
         notes = EXCLUDED.notes,
         rzp_created_at = EXCLUDED.rzp_created_at,
         last_event_id = EXCLUDED.last_event_id,
         last_event_at = EXCLUDED.last_event_at,
         version = orders.version + 1,
         updated_at = now()
       WHERE orders.last_event_id IS DISTINCT FROM EXCLUDED.last_event_id
         AND (orders.last_event_at IS NULL OR EXCLUDED.last_event_at >= orders.last_event_at)
       RETURNING *`,
      [entity.id, customerId, amount, currency, status, receipt, JSON.stringify(items), JSON.stringify(notes), providerCreatedAt, sourceId, incomingAt],
    );
  // Intent: another transaction can insert this order after our initial absent-row read.
  // Flow: timestamp/event predicates reject a stale conflict -> lock and return the winner as unapplied.
  const row = result.rows[0] ?? (await tx.query<OrderRow>('SELECT * FROM orders WHERE id = $1 FOR UPDATE', [entity.id])).rows[0];
  if (!row) throw new Error(`order projection returned no row for ${entity.id}`);
  const applied = result.rows.length === 1;
  return snapshot('order', row, customer ?? await loadCustomer(tx, row.customer_id), applied);
}

export const applyOrderProjection = projectOrder;
