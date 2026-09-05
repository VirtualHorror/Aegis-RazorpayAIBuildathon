/**
 * Domain enums as `as const` tuples so they can be reused by zod (`z.enum(PAYMENT_STATUSES)`),
 * by SQL CHECK constraints (see db/migrations) and by the dashboard, from one definition.
 */
export const PAYMENT_STATUSES = ['created', 'authorized', 'captured', 'refunded', 'failed'] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

export const ORDER_STATUSES = ['created', 'attempted', 'paid', 'abandoned'] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

export const SUBSCRIPTION_STATUSES = ['created', 'authenticated', 'active', 'pending', 'halted', 'cancelled', 'completed', 'expired'] as const;
export type SubscriptionStatus = (typeof SUBSCRIPTION_STATUSES)[number];

export const INVOICE_STATUSES = ['issued', 'partially_paid', 'paid', 'expired', 'cancelled'] as const;
export type InvoiceStatus = (typeof INVOICE_STATUSES)[number];

export const DISPUTE_PHASES = ['fraud', 'retrieval', 'chargeback', 'pre_arbitration', 'arbitration'] as const;
export type DisputePhase = (typeof DISPUTE_PHASES)[number];

export const DISPUTE_STATUSES = ['open', 'under_review', 'won', 'lost', 'closed'] as const;
export type DisputeStatus = (typeof DISPUTE_STATUSES)[number];

export const WEBHOOK_EVENT_STATUSES = ['received', 'processing', 'processed', 'failed', 'dead_letter', 'ignored'] as const;
export type WebhookEventStatus = (typeof WEBHOOK_EVENT_STATUSES)[number];

export const JOB_STATUSES = ['queued', 'running', 'succeeded', 'failed', 'dead_letter', 'cancelled'] as const;
export type JobStatus = (typeof JOB_STATUSES)[number];

export const ACTION_STATUSES = ['proposed', 'blocked', 'pending_approval', 'approved', 'rejected', 'executed', 'failed', 'expired', 'compensated'] as const;
export type ActionStatus = (typeof ACTION_STATUSES)[number];

export const SALVAGE_STATES = ['none', 'retry_scheduled', 'retrying', 'offer_sent', 'recovered', 'churned', 'escalated'] as const;
export type SalvageState = (typeof SALVAGE_STATES)[number];

export const NEGOTIATION_STATES = ['none', 'offer_sent', 'countered', 'accepted', 'rejected', 'expired', 'escalated'] as const;
export type NegotiationState = (typeof NEGOTIATION_STATES)[number];

export const REVIEW_STATUSES = ['requires_human_review', 'approved', 'rejected', 'submitted'] as const;
export type ReviewStatus = (typeof REVIEW_STATUSES)[number];

export const RISK_LEVELS = ['none', 'low', 'medium', 'high', 'prohibited'] as const;
export type RiskLevel = (typeof RISK_LEVELS)[number];

export const X402_STATUSES = ['challenged', 'verified', 'settled', 'rejected', 'expired'] as const;
export type X402Status = (typeof X402_STATUSES)[number];

export const ENTITY_TYPES = ['payment', 'order', 'subscription', 'invoice', 'dispute'] as const;
export type EntityType = (typeof ENTITY_TYPES)[number];

export const MODULE_NAMES = ['checkout_recovery', 'subscription_salvager', 'b2b_negotiator', 'chargeback_evidence'] as const;
export type ModuleName = (typeof MODULE_NAMES)[number];
