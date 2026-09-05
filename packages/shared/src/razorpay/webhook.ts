import { z } from 'zod';
import {
  DISPUTE_PHASES,
  DISPUTE_STATUSES,
  INVOICE_STATUSES,
  ORDER_STATUSES,
  PAYMENT_STATUSES,
  SUBSCRIPTION_STATUSES,
} from '../domain/enums';

const optionalString = z.string().nullable().optional();
const optionalInteger = z.number().int().nonnegative().nullable().optional();

/** Razorpay's payment entity, retaining provider fields Aegis does not currently project. */
export const RazorpayPaymentEntitySchema = z
  .object({
    entity: z.literal('payment').optional(),
    id: z.string().min(1),
    amount: z.number().int().nonnegative().optional(),
    currency: z.string().min(1).optional(),
    status: z.enum(PAYMENT_STATUSES).optional(),
    order_id: optionalString,
    customer_id: optionalString,
    method: optionalString,
    card_network: optionalString,
    card_type: optionalString,
    card_issuer: optionalString,
    card_country: optionalString,
    international: z.boolean().optional(),
    error_code: optionalString,
    error_description: optionalString,
    error_source: optionalString,
    error_step: optionalString,
    error_reason: optionalString,
    email: optionalString,
    contact: optionalString,
    notes: z.record(z.string(), z.unknown()).optional(),
  })
  .passthrough();

/** Razorpay's order entity, retaining payment totals and merchant metadata. */
export const RazorpayOrderEntitySchema = z
  .object({
    entity: z.literal('order').optional(),
    id: z.string().min(1),
    amount: z.number().int().nonnegative().optional(),
    amount_paid: z.number().int().nonnegative().optional(),
    amount_due: z.number().int().nonnegative().optional(),
    currency: z.string().min(1).optional(),
    status: z.enum(ORDER_STATUSES).optional(),
    receipt: optionalString,
    customer_id: optionalString,
    notes: z.record(z.string(), z.unknown()).optional(),
    items: z.array(z.unknown()).optional(),
  })
  .passthrough();

/** Razorpay's subscription entity, retaining timestamps and counters for the T4 projection. */
export const RazorpaySubscriptionEntitySchema = z
  .object({
    entity: z.literal('subscription').optional(),
    id: z.string().min(1),
    plan_id: optionalString,
    customer_id: optionalString,
    status: z.enum(SUBSCRIPTION_STATUSES).optional(),
    amount: z.number().int().nonnegative().optional(),
    currency: z.string().min(1).optional(),
    current_start: optionalInteger,
    current_end: optionalInteger,
    charge_at: optionalInteger,
    total_count: optionalInteger,
    paid_count: optionalInteger,
    remaining_count: optionalInteger,
    notes: z.record(z.string(), z.unknown()).optional(),
  })
  .passthrough();

/** Razorpay's invoice entity, retaining line items and payment totals for negotiation. */
export const RazorpayInvoiceEntitySchema = z
  .object({
    entity: z.literal('invoice').optional(),
    id: z.string().min(1),
    customer_id: optionalString,
    amount: z.number().int().nonnegative().optional(),
    amount_paid: z.number().int().nonnegative().optional(),
    amount_due: z.number().int().nonnegative().optional(),
    currency: z.string().min(1).optional(),
    status: z.enum(INVOICE_STATUSES).optional(),
    due_by: optionalInteger,
    line_items: z.array(z.unknown()).optional(),
    notes: z.record(z.string(), z.unknown()).optional(),
  })
  .passthrough();

/** Razorpay's dispute entity, retaining reason and response deadline fields. */
export const RazorpayDisputeEntitySchema = z
  .object({
    entity: z.literal('dispute').optional(),
    id: z.string().min(1),
    payment_id: optionalString,
    amount: z.number().int().nonnegative().optional(),
    currency: z.string().min(1).optional(),
    reason_code: optionalString,
    reason_description: optionalString,
    phase: z.enum(DISPUTE_PHASES).optional(),
    status: z.enum(DISPUTE_STATUSES).optional(),
    respond_by: optionalInteger,
  })
  .passthrough();

// Intent: keep schema names convenient for callers while retaining Razorpay-prefixed exports for self-documenting imports.
// Flow: export the same zod instances under both naming conventions so validation behavior cannot diverge.
export const PaymentEntitySchema = RazorpayPaymentEntitySchema;
export const OrderEntitySchema = RazorpayOrderEntitySchema;
export const SubscriptionEntitySchema = RazorpaySubscriptionEntitySchema;
export const InvoiceEntitySchema = RazorpayInvoiceEntitySchema;
export const DisputeEntitySchema = RazorpayDisputeEntitySchema;

// Intent: model Razorpay's `{ entity: ... }` payload wrapper without dropping provider-added wrapper fields.
// Flow: validate the nested entity schema -> preserve unknown wrapper keys via `.passthrough()`.
const EntityEnvelope = <T extends z.ZodType>(entity: T) => z.object({ entity }).passthrough();

/**
 * Razorpay's event envelope. The payload wrappers are optional so unknown provider events can still be recorded and ignored.
 * Intent: validate the fields used by projections while preserving additive provider fields with `.passthrough()`.
 * Flow:   validate envelope -> select the nested entity schema for known event types -> persist the parsed payload unchanged.
 */
export const RazorpayWebhookSchema = z
  .object({
    entity: z.literal('event'),
    account_id: z.string().min(1).nullable().optional(),
    event: z.string().min(1),
    contains: z.array(z.string()).default([]),
    payload: z
      .object({
        payment: EntityEnvelope(RazorpayPaymentEntitySchema).optional(),
        order: EntityEnvelope(RazorpayOrderEntitySchema).optional(),
        subscription: EntityEnvelope(RazorpaySubscriptionEntitySchema).optional(),
        invoice: EntityEnvelope(RazorpayInvoiceEntitySchema).optional(),
        dispute: EntityEnvelope(RazorpayDisputeEntitySchema).optional(),
      })
      .passthrough(),
    created_at: z.union([z.number().int().nonnegative(), z.string().min(1)]).nullable().optional(),
  })
  .passthrough();

export type RazorpayPaymentEntity = z.infer<typeof RazorpayPaymentEntitySchema>;
export type RazorpayOrderEntity = z.infer<typeof RazorpayOrderEntitySchema>;
export type RazorpaySubscriptionEntity = z.infer<typeof RazorpaySubscriptionEntitySchema>;
export type RazorpayInvoiceEntity = z.infer<typeof RazorpayInvoiceEntitySchema>;
export type RazorpayDisputeEntity = z.infer<typeof RazorpayDisputeEntitySchema>;
export type RazorpayWebhook = z.infer<typeof RazorpayWebhookSchema>;
