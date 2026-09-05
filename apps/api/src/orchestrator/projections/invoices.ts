import type pg from 'pg';
import {
  assertSafePaise,
  INVOICE_STATUSES,
  type InvoiceStatus,
  type RazorpayInvoiceEntity,
  type RazorpayWebhook,
  isStaleSubscriptionEvent,
} from '@aegis/shared';
import type { EntitySnapshot, ProjectionRow } from '../entity';
import {
  asContext,
  definedOr,
  entityCreatedAt,
  eventDate,
  loadCustomer,
  nullableDate,
  projectCustomer,
  sameEvent,
  snapshot,
  sourceEventId,
  type ProjectionContext,
} from './shared';

interface InvoiceRow extends ProjectionRow {
  readonly customer_id: string | null;
  readonly amount_paise: number;
  readonly floor_amount_paise: number;
  readonly currency: string;
  readonly status: InvoiceStatus;
  readonly due_by: Date | null;
  readonly line_items: readonly unknown[];
  readonly negotiation_state: string;
  readonly negotiation_round: number;
  readonly current_offer_paise: number | null;
  readonly notes: Record<string, unknown>;
  readonly rzp_created_at: Date | null;
  readonly last_event_id: string | null;
  readonly last_event_at: Date | null;
  readonly created_at: Date;
  readonly updated_at: Date;
}

function eventStatus(eventType: string): InvoiceStatus | undefined {
  const suffix = eventType.split('.').at(-1);
  return suffix && INVOICE_STATUSES.includes(suffix as InvoiceStatus) ? (suffix as InvoiceStatus) : undefined;
}

function amountFromEntity(entity: RazorpayInvoiceEntity): number | undefined {
  return entity.amount ?? entity.amount_paid ?? entity.amount_due;
}

function eventEntityDate(value: number | null | undefined, current: Date | null | undefined): Date | null {
  return value === undefined ? current ?? null : nullableDate(value);
}

/**
 * Project an invoice with timestamp precedence and an immutable inserted floor.
 * Intent: invoice discounts must fail closed. The merchant's own floor is the only value that may open room for a
 *         discount, so it is read from the invoice notes (`notes.floor_amount_paise`) and validated as integer paise
 *         inside [0, amount]; anything missing, malformed or above the amount falls back to floor = amount, which
 *         leaves the negotiator no discount to give (B-014, D-063).
 * Flow: lock row -> reject duplicate/older event -> upsert customer and invoice (floor set only on INSERT).
 */
export async function projectInvoice(
  tx: pg.PoolClient,
  payload: RazorpayWebhook,
  context?: ProjectionContext | string | null,
): Promise<EntitySnapshot> {
  const entity = payload.payload.invoice?.entity;
  if (!entity) throw new Error(`event ${payload.event} has no invoice entity`);
  const ctx = asContext(context);
  const incomingAt = eventDate(payload, ctx);
  const currentResult = await tx.query<InvoiceRow>('SELECT * FROM invoices WHERE id = $1 FOR UPDATE', [entity.id]);
  const current = currentResult.rows[0];
  if (current && (sameEvent(current, ctx) || isStaleSubscriptionEvent(current.last_event_at, incomingAt))) {
    return snapshot('invoice', current, await loadCustomer(tx, current.customer_id), false);
  }

  const customer = await projectCustomer(tx, entity);
  const customerId = definedOr(entity.customer_id, current?.customer_id, null);
  const amount = assertSafePaise(definedOr(amountFromEntity(entity), current?.amount_paise, 0), 'invoice.amount_paise');
  const currency = definedOr(entity.currency, current?.currency, 'INR');
  const status = definedOr(entity.status ?? eventStatus(payload.event), current?.status, 'issued');
  const dueBy = eventEntityDate(entity.due_by, current?.due_by);
  const lineItems = definedOr(entity.line_items, current?.line_items, []);
  const notes = definedOr(entity.notes, current?.notes, {});
  const floor = merchantFloorPaise(notes, amount);
  const sourceId = sourceEventId(ctx, current?.last_event_id);
  const providerCreatedAt = entityCreatedAt(entity) ?? current?.rzp_created_at ?? null;

  const result = await tx.query<InvoiceRow>(
    `INSERT INTO invoices
       (id, customer_id, amount_paise, floor_amount_paise, currency, status, due_by, line_items, negotiation_state,
        negotiation_round, current_offer_paise, notes, rzp_created_at, last_event_id, last_event_at, version)
     VALUES ($1, $2, $3, $15, $4, $5, $6, $7::jsonb, $8, $9, $10, $11::jsonb, $12, $13, $14, 1)
     ON CONFLICT (id) DO UPDATE SET
       customer_id = EXCLUDED.customer_id,
       amount_paise = EXCLUDED.amount_paise,
       currency = EXCLUDED.currency,
       status = EXCLUDED.status,
       due_by = EXCLUDED.due_by,
       line_items = EXCLUDED.line_items,
       negotiation_state = EXCLUDED.negotiation_state,
       negotiation_round = EXCLUDED.negotiation_round,
       current_offer_paise = EXCLUDED.current_offer_paise,
       notes = EXCLUDED.notes,
       rzp_created_at = EXCLUDED.rzp_created_at,
       last_event_id = EXCLUDED.last_event_id,
       last_event_at = EXCLUDED.last_event_at,
       version = invoices.version + 1,
       updated_at = now()
     WHERE invoices.last_event_id IS DISTINCT FROM EXCLUDED.last_event_id
       AND (invoices.last_event_at IS NULL OR EXCLUDED.last_event_at >= invoices.last_event_at)
     RETURNING *`,
    [
      entity.id,
      customerId,
      amount,
      currency,
      status,
      dueBy,
      JSON.stringify(lineItems),
      current?.negotiation_state ?? 'none',
      current?.negotiation_round ?? 0,
      current?.current_offer_paise ?? null,
      JSON.stringify(notes),
      providerCreatedAt,
      sourceId,
      incomingAt,
      floor,
    ],
  );
  // Intent: a stale invoice conflict must not overwrite a negotiated or paid state during concurrent delivery.
  // Flow: SQL timestamp/event predicates reject it -> lock and return the committed winner as unapplied.
  const row = result.rows[0] ?? (await tx.query<InvoiceRow>('SELECT * FROM invoices WHERE id = $1 FOR UPDATE', [entity.id])).rows[0];
  if (!row) throw new Error(`invoice projection returned no row for ${entity.id}`);
  const applied = result.rows.length === 1;
  return snapshot('invoice', row, customer ?? await loadCustomer(tx, row.customer_id), applied);
}

/**
 * The merchant's negotiating floor for this invoice, in integer paise.
 * Intent: money bounds are never inferred and never authored by a model (C-A1); the merchant states the floor on the
 *         invoice and anything unusable falls back to the full amount, which permits no discount at all.
 * Flow: read `notes.floor_amount_paise` -> require a safe non-negative integer no greater than the amount -> else amount.
 */
export function merchantFloorPaise(notes: unknown, amountPaise: number): number {
  if (typeof notes !== 'object' || notes === null || Array.isArray(notes)) return amountPaise;
  const raw = (notes as Record<string, unknown>).floor_amount_paise;
  const value = typeof raw === 'number' ? raw : typeof raw === 'string' && raw.trim() !== '' ? Number(raw) : Number.NaN;
  if (!Number.isSafeInteger(value) || value < 0 || value > amountPaise) return amountPaise;
  return value;
}

export const applyInvoiceProjection = projectInvoice;
