/**
 * Razorpay events that have a downstream projection/worker path.
 * Intent: keep ingress routing deterministic and fail closed for event types that Aegis does not understand.
 * Flow:   parse the envelope -> compare `event` to this allowlist -> enqueue only known, verified deliveries.
 */
export const KNOWN_EVENT_TYPES = [
  'payment.authorized',
  'payment.failed',
  'payment.captured',
  'payment.refunded',
  'order.attempted',
  'order.paid',
  'subscription.pending',
  'subscription.halted',
  'subscription.charged',
  'subscription.activated',
  'subscription.completed',
  'subscription.cancelled',
  'invoice.issued',
  'invoice.expired',
  'invoice.paid',
  'invoice.updated',
  'payment.dispute.created',
  'payment.dispute.updated',
  'payment.dispute.closed',
  'dispute.created',
] as const;

export type KnownEventType = (typeof KNOWN_EVENT_TYPES)[number];
