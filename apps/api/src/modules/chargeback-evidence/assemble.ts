import type pg from 'pg';
import { EvidencePacketSchema, type EvidencePacket } from './packet-schema';

type QueryDatabase = pg.Pool | pg.PoolClient;

interface DisputeRow {
  id: string;
  payment_id: string | null;
  amount_paise: string | number;
  reason_code: string | null;
  reason_description: string | null;
  phase: string;
  respond_by: Date | string | null;
  created_at: Date | string;
}

interface PaymentRow {
  id: string;
  order_id: string | null;
  customer_id: string | null;
  amount_paise: string | number;
  method: string | null;
  card_network: string | null;
  international: boolean;
  notes: Record<string, unknown> | null;
  rzp_created_at: Date | string | null;
  created_at: Date | string;
  updated_at: Date | string;
  status: string;
}

interface OrderRow {
  id: string;
  customer_id: string | null;
  amount_paise: string | number;
  items: unknown[];
  receipt: string | null;
  notes: Record<string, unknown> | null;
}

interface CustomerRow {
  id: string;
  country: string | null;
  locale: string;
  created_at: Date | string;
}

interface CommunicationRow {
  channel: string;
  template: string;
  sent_at: Date | string;
}

/**
 * Assemble a dispute packet using deterministic reads only.
 * Intent: the packet's missing list is an honest inventory of unavailable source sections, and no model output can
 * invent a payment, order, delivery proof, or customer fact.
 * Flow: read disputes -> payments -> orders -> customers -> communications/prior disputes -> validate the closed packet.
 * Plain SELECTs intentionally take no row locks; callers that need a lock must preserve the same parent-to-root order.
 */
export async function assemble(db: QueryDatabase, disputeId: string): Promise<EvidencePacket> {
  if (disputeId.trim().length === 0) throw new TypeError('disputeId must not be empty');
  const missing: string[] = [];

  const disputeResult = await db.query<DisputeRow>(
    `SELECT id, payment_id, amount_paise, reason_code, reason_description, phase, respond_by, created_at
     FROM disputes WHERE id = $1`,
    [disputeId],
  );
  const dispute = disputeResult.rows[0];
  if (!dispute) throw new Error(`dispute ${disputeId} not found`);

  const disputePacket = {
    id: dispute.id,
    amount_paise: integer(dispute.amount_paise),
    reason_code: dispute.reason_code,
    reason_description: dispute.reason_description,
    phase: dispute.phase,
    respond_by: iso(dispute.respond_by),
  };
  if (dispute.payment_id === null) missing.push('payment');

  let payment: PaymentRow | null = null;
  if (dispute.payment_id !== null) {
    const result = await db.query<PaymentRow>(
      `SELECT id, order_id, customer_id, amount_paise, method, card_network, international, notes,
              rzp_created_at, created_at, updated_at, status
       FROM payments WHERE id = $1`,
      [dispute.payment_id],
    );
    payment = result.rows[0] ?? null;
    if (!payment) missing.push('payment');
  }

  const paymentPacket = {
    id: payment?.id ?? dispute.payment_id ?? 'missing',
    amount_paise: integer(payment?.amount_paise ?? dispute.amount_paise),
    method: payment?.method ?? null,
    card_network: payment?.card_network ?? null,
    card_last4: cardLast4(payment?.notes),
    captured_at: payment && payment.status === 'captured' ? iso(payment.rzp_created_at ?? payment.updated_at) : null,
    international: payment?.international ?? false,
  };

  let order: OrderRow | null = null;
  if (payment?.order_id !== null && payment?.order_id !== undefined) {
    const result = await db.query<OrderRow>(
      `SELECT id, customer_id, amount_paise, items, receipt, notes FROM orders WHERE id = $1`,
      [payment.order_id],
    );
    order = result.rows[0] ?? null;
  }
  if (!order) missing.push('order');

  const orderPacket = {
    id: order?.id ?? null,
    items: Array.isArray(order?.items) ? order.items : [],
    amount_paise: integer(order?.amount_paise ?? payment?.amount_paise ?? dispute.amount_paise),
    receipt: order?.receipt ?? null,
  };

  const customerId = order?.customer_id ?? payment?.customer_id ?? null;
  let customer: CustomerRow | null = null;
  if (customerId !== null) {
    const result = await db.query<CustomerRow>(
      `SELECT id, country, locale, created_at FROM customers WHERE id = $1`,
      [customerId],
    );
    customer = result.rows[0] ?? null;
  }
  if (!customer) missing.push('customer');

  const accountAgeDays = customer
    ? Math.max(0, Math.floor((dateValue(dispute.created_at).getTime() - dateValue(customer.created_at).getTime()) / 86_400_000))
    : 0;
  const customerPacket = {
    id_masked: customer ? maskId(customer.id) : 'missing',
    country: customer?.country ?? null,
    locale: customer?.locale ?? 'en-IN',
    account_age_days: accountAgeDays,
  };

  const delivery = deliveryFromNotes(order?.notes);
  if (!delivery) missing.push('delivery');

  let communications: CommunicationRow[] = [];
  if (customerId !== null) {
    const result = await db.query<CommunicationRow>(
      `SELECT om.channel, om.template, om.created_at AS sent_at
       FROM outbound_messages om JOIN actions a ON a.id = om.action_id
       WHERE a.customer_id = $1 ORDER BY om.created_at ASC, om.id ASC`,
      [customerId],
    );
    communications = result.rows;
  }
  if (communications.length === 0) missing.push('communications');

  const policy = refundPolicy(order?.notes);
  if (policy.url === null && policy.summary === 'No refund policy recorded') missing.push('refund_policy');

  let priorDisputes = 0;
  if (customerId !== null) {
    const result = await db.query<{ count: string | number }>(
      `SELECT count(*)::int AS count
       FROM disputes d JOIN payments p ON p.id = d.payment_id
       WHERE p.customer_id = $1 AND d.id <> $2`,
      [customerId, dispute.id],
    );
    priorDisputes = integer(result.rows[0]?.count ?? 0);
  }

  return EvidencePacketSchema.parse({
    dispute: disputePacket,
    payment: paymentPacket,
    order: orderPacket,
    customer: customerPacket,
    delivery,
    communications: communications.map((item) => ({ channel: item.channel, template: item.template, sent_at: iso(item.sent_at) ?? new Date(0).toISOString() })),
    refund_policy: policy,
    prior_disputes: priorDisputes,
    missing: [...new Set(missing)],
  });
}

export const assembleEvidencePacket = assemble;

function integer(value: unknown): number {
  const parsed = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : Number.NaN;
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : 0;
}

function dateValue(value: Date | string): Date {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? new Date(0) : date;
}

function iso(value: Date | string | null): string | null {
  return value === null ? null : dateValue(value).toISOString();
}

function maskId(value: string): string {
  return value.length <= 4 ? '••••' : `${value.slice(0, 4)}••••`;
}

function cardLast4(notes: Record<string, unknown> | null | undefined): string | null {
  const card = notes?.card;
  const nested = typeof card === 'object' && card !== null && !Array.isArray(card) ? (card as Record<string, unknown>).last4 : undefined;
  const value = notes?.card_last4 ?? notes?.last4 ?? nested;
  return typeof value === 'string' && /^\d{4}$/.test(value) ? value : null;
}

function deliveryFromNotes(notes: Record<string, unknown> | null | undefined): EvidencePacket['delivery'] {
  const value = notes?.delivery;
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const delivery = value as Record<string, unknown>;
  return {
    carrier: textOrNull(delivery.carrier),
    tracking: textOrNull(delivery.tracking),
    delivered_at: dateOrNull(delivery.delivered_at),
    proof_url: textOrNull(delivery.proof_url),
  };
}

function refundPolicy(notes: Record<string, unknown> | null | undefined): EvidencePacket['refund_policy'] {
  const value = notes?.refund_policy;
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return { url: null, summary: 'No refund policy recorded' };
  const policy = value as Record<string, unknown>;
  return {
    url: textOrNull(policy.url),
    summary: typeof policy.summary === 'string' && policy.summary.trim().length > 0 ? policy.summary : 'No refund policy recorded',
  };
}

function textOrNull(value: unknown): string | null { return typeof value === 'string' && value.trim().length > 0 ? value : null; }

function dateOrNull(value: unknown): string | null {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.toISOString();
  if (typeof value === 'string' && !Number.isNaN(new Date(value).getTime())) return new Date(value).toISOString();
  return null;
}
