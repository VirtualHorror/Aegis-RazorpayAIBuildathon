import type { PaymentStatus } from './enums';

/**
 * Out-of-order webhook guard for payments.
 * Intent: Razorpay may deliver `payment.captured` before a delayed `payment.authorized` retry; a projection must never
 *         regress. Ranks encode the lifecycle; `failed` is terminal for a given payment id (a retry is a NEW payment id).
 * Flow:   projection loads the row FOR UPDATE → shouldApplyPaymentTransition(current, incoming) → upsert or ignore.
 */
export const PAYMENT_STATUS_RANK: Readonly<Record<PaymentStatus, number>> = {
  created: 0,
  authorized: 1,
  failed: 1,
  captured: 2,
  refunded: 3,
};

export function shouldApplyPaymentTransition(current: PaymentStatus | null, incoming: PaymentStatus): boolean {
  if (current === null) return true; // first sighting of this payment id
  if (current === 'failed') return incoming === 'failed'; // terminal: only idempotent repeats are accepted
  return PAYMENT_STATUS_RANK[incoming] >= PAYMENT_STATUS_RANK[current];
}

/**
 * Staleness guard for entities whose states legitimately oscillate (subscriptions: active ↔ pending, invoices, orders, disputes).
 * Intent: last-writer-wins by the event's own `created_at`, so a delayed old event cannot overwrite newer state.
 *         Equal timestamps are applied (idempotent re-delivery of the same event is a no-op at the row level anyway).
 */
export function isStaleSubscriptionEvent(lastEventAt: Date | null, incomingEventAt: Date): boolean {
  if (lastEventAt === null) return false;
  return incomingEventAt.getTime() < lastEventAt.getTime();
}
