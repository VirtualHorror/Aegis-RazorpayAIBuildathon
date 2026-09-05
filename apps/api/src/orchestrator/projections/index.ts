import type pg from 'pg';
import { RazorpayWebhookSchema, type RazorpayWebhook } from '@aegis/shared';
import type { EntitySnapshot } from '../entity';
import { projectDispute } from './disputes';
import { projectInvoice } from './invoices';
import { projectOrder } from './orders';
import { projectPayment } from './payments';
import { projectSubscription } from './subscriptions';
import type { ProjectionContext } from './shared';

export type { ProjectionContext } from './shared';
export { projectDispute, applyDisputeProjection } from './disputes';
export { projectInvoice, applyInvoiceProjection } from './invoices';
export { projectOrder, applyOrderProjection } from './orders';
export { projectPayment, applyPaymentProjection } from './payments';
export { projectSubscription, applySubscriptionProjection } from './subscriptions';

/**
 * Route a validated Razorpay envelope to exactly one deterministic projection.
 * Intent: event names, not model output, select the entity table and therefore the SQL path.
 * Flow: parse the provider envelope -> choose dispute before payment for dispute events -> project under the caller's tx.
 */
export async function applyProjection(
  tx: pg.PoolClient,
  payload: RazorpayWebhook,
  context?: ProjectionContext | string | null,
): Promise<EntitySnapshot> {
  const parsed = RazorpayWebhookSchema.parse(payload);
  if (parsed.event.startsWith('payment.dispute.') || parsed.event.startsWith('dispute.')) {
    return projectDispute(tx, parsed, context);
  }
  if (parsed.event.startsWith('payment.')) return projectPayment(tx, parsed, context);
  if (parsed.event.startsWith('order.')) return projectOrder(tx, parsed, context);
  if (parsed.event.startsWith('subscription.')) return projectSubscription(tx, parsed, context);
  if (parsed.event.startsWith('invoice.')) return projectInvoice(tx, parsed, context);
  throw new Error(`no projection for event type ${parsed.event}`);
}
