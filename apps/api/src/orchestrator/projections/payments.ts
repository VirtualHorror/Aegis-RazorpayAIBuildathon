import type pg from 'pg';
import {
  assertSafePaise,
  PAYMENT_STATUS_RANK,
  PAYMENT_STATUSES,
  type PaymentStatus,
  type RazorpayWebhook,
  shouldApplyPaymentTransition,
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

interface PaymentRow extends ProjectionRow {
  readonly order_id: string | null;
  readonly customer_id: string | null;
  readonly amount_paise: number;
  readonly currency: string;
  readonly status: PaymentStatus;
  readonly status_rank: number;
  readonly method: string | null;
  readonly card_network: string | null;
  readonly card_type: string | null;
  readonly card_issuer: string | null;
  readonly card_country: string | null;
  readonly international: boolean;
  readonly error_code: string | null;
  readonly error_description: string | null;
  readonly error_source: string | null;
  readonly error_step: string | null;
  readonly error_reason: string | null;
  readonly email: string | null;
  readonly contact: string | null;
  readonly notes: Record<string, unknown>;
  readonly rzp_created_at: Date | null;
  readonly last_event_id: string | null;
  readonly last_event_at: Date | null;
  readonly created_at: Date;
  readonly updated_at: Date;
}

function eventStatus(eventType: string): PaymentStatus | undefined {
  const suffix = eventType.split('.').at(-1);
  return suffix && PAYMENT_STATUSES.includes(suffix as PaymentStatus) ? (suffix as PaymentStatus) : undefined;
}

/**
 * Project a payment under a row lock and monotonic status precedence.
 * Intent: captured/refunded payments must not regress to an older authorization or failure on delayed delivery.
 * Flow: lock payment -> reject duplicate/rank-regressing event -> reserve order slot -> upsert customer -> link order and payment.
 */
export async function projectPayment(tx: pg.PoolClient, payload: RazorpayWebhook, context?: ProjectionContext | string | null): Promise<EntitySnapshot> {
  const entity = payload.payload.payment?.entity;
  if (!entity) throw new Error(`event ${payload.event} has no payment entity`);
  const ctx = asContext(context);
  const incomingAt = eventDate(payload, ctx);
  const currentResult = await tx.query<PaymentRow>('SELECT * FROM payments WHERE id = $1 FOR UPDATE', [entity.id]);
  const current = currentResult.rows[0];
  const incomingStatus = entity.status ?? eventStatus(payload.event) ?? 'created';
  if (current && (sameEvent(current, ctx) || !shouldApplyPaymentTransition(current.status, incomingStatus))) {
    return snapshot('payment', current, await loadCustomer(tx, current.customer_id), false);
  }

  const customerId = definedOr(entity.customer_id, current?.customer_id, null);
  const amount = assertSafePaise(definedOr(entity.amount, current?.amount_paise, 0), 'payment.amount_paise');
  const currency = definedOr(entity.currency, current?.currency, 'INR');
  const orderId = definedOr(entity.order_id, current?.order_id, null);
  // Intent: reserve the order row even on first sighting, closing the absent-row window where a sibling order event
  //         could hold `orders` while this path holds `customers` (B-007).
  // Flow: lock/insert order slot -> upsert customer -> fill the slot's customer FK -> insert or update payment.
  const orderSlotInserted = await lockOrderSlot(tx, orderId, amount, currency);
  const customer = await projectCustomer(tx, entity);
  if (orderId !== null && orderSlotInserted) {
    await tx.query(
      'UPDATE orders SET customer_id = COALESCE(customer_id, $2), updated_at = now() WHERE id = $1',
      [orderId, customerId],
    );
  } else if (orderId !== null && customerId !== null) {
    // Intent: repair a legacy NULL-customer placeholder without replacing a customer already owned by the order.
    // Flow: the order slot is locked above -> fill only a missing FK -> insert/update the payment below.
    await tx.query(
      'UPDATE orders SET customer_id = COALESCE(customer_id, $2), updated_at = now() WHERE id = $1 AND customer_id IS NULL',
      [orderId, customerId],
    );
  }

  const status = incomingStatus;
  const sourceId = sourceEventId(ctx, current?.last_event_id);
  const providerCreatedAt = entityCreatedAt(entity) ?? current?.rzp_created_at ?? null;
  const result = await tx.query<PaymentRow>(
    `INSERT INTO payments
       (id, order_id, customer_id, amount_paise, currency, status, status_rank,
        method, card_network, card_type, card_issuer, card_country, international,
        error_code, error_description, error_source, error_step, error_reason,
        email, contact, notes, rzp_created_at, last_event_id, last_event_at, version)
     VALUES ($1, $2, $3, $4, $5, $6, $7,
             $8, $9, $10, $11, $12, $13,
             $14, $15, $16, $17, $18,
             $19, $20, $21::jsonb, $22, $23, $24, 1)
     ON CONFLICT (id) DO UPDATE SET
       order_id = EXCLUDED.order_id,
       customer_id = EXCLUDED.customer_id,
       amount_paise = EXCLUDED.amount_paise,
       currency = EXCLUDED.currency,
       status = EXCLUDED.status,
       status_rank = EXCLUDED.status_rank,
       method = EXCLUDED.method,
       card_network = EXCLUDED.card_network,
       card_type = EXCLUDED.card_type,
       card_issuer = EXCLUDED.card_issuer,
       card_country = EXCLUDED.card_country,
       international = EXCLUDED.international,
       error_code = EXCLUDED.error_code,
       error_description = EXCLUDED.error_description,
       error_source = EXCLUDED.error_source,
       error_step = EXCLUDED.error_step,
       error_reason = EXCLUDED.error_reason,
       email = EXCLUDED.email,
       contact = EXCLUDED.contact,
       notes = EXCLUDED.notes,
       rzp_created_at = EXCLUDED.rzp_created_at,
       last_event_id = EXCLUDED.last_event_id,
       last_event_at = EXCLUDED.last_event_at,
       version = payments.version + 1,
       updated_at = now()
     WHERE payments.last_event_id IS DISTINCT FROM EXCLUDED.last_event_id
       AND (payments.status <> 'failed' OR EXCLUDED.status = 'failed')
       AND EXCLUDED.status_rank >= payments.status_rank
     RETURNING *`,
    [
      entity.id,
      orderId,
      customerId,
      amount,
      currency,
      status,
      PAYMENT_STATUS_RANK[status],
      definedOr(entity.method, current?.method, null),
      definedOr(entity.card_network, current?.card_network, null),
      definedOr(entity.card_type, current?.card_type, null),
      definedOr(entity.card_issuer, current?.card_issuer, null),
      definedOr(entity.card_country, current?.card_country, null),
      definedOr(entity.international, current?.international, false),
      definedOr(entity.error_code, current?.error_code, null),
      definedOr(entity.error_description, current?.error_description, null),
      definedOr(entity.error_source, current?.error_source, null),
      definedOr(entity.error_step, current?.error_step, null),
      definedOr(entity.error_reason, current?.error_reason, null),
      definedOr(entity.email, current?.email, null),
      definedOr(entity.contact, current?.contact, null),
      JSON.stringify(definedOr(entity.notes, current?.notes, {})),
      providerCreatedAt,
      sourceId,
      incomingAt,
    ],
  );
  // Intent: a concurrent insert may win between the initial absent-row read and this upsert.
  // Flow: the conflict WHERE above rejects a duplicate/regression -> lock and return the winner's row as unapplied.
  const row = result.rows[0] ?? (await tx.query<PaymentRow>('SELECT * FROM payments WHERE id = $1 FOR UPDATE', [entity.id])).rows[0];
  if (!row) throw new Error(`payment projection returned no row for ${entity.id}`);
  const applied = result.rows.length === 1;
  return snapshot('payment', row, customer ?? await loadCustomer(tx, row.customer_id), applied);
}

export const applyPaymentProjection = projectPayment;
