import { idsFor, customerFor, createdAtFor, makeScenario } from './support';
import type { ScenarioBuildOptions, SimScenario } from './types';

/** The dispute deliberately references a payment unseen by the worker. */
export function buildDisputeCreated(options: ScenarioBuildOptions = {}): SimScenario {
  const ids = idsFor(options);
  const scenarioOptions = { ...options, ids };
  return makeScenario('dispute_created', 'payment.dispute.created', 'dispute', {
    entity: 'dispute', id: ids.disputeId(), payment_id: ids.paymentId(), amount: 899_900, currency: 'INR',
    reason_code: 'goods_not_received', reason_description: 'Customer reports that the goods were not received',
    phase: 'retrieval', status: 'open', respond_by: createdAtFor(options) + 604_800,
  }, scenarioOptions);
}

export function buildOrderPaid(options: ScenarioBuildOptions = {}): SimScenario {
  const ids = idsFor(options);
  const scenarioOptions = { ...options, ids };
  return makeScenario('order_paid', 'order.paid', 'order', {
    entity: 'order', id: ids.orderId(), amount: 99_900, amount_paid: 99_900, amount_due: 0, currency: 'INR', status: 'paid',
    receipt: 'sim-order-paid', customer_id: customerFor(scenarioOptions, ids), items: [{ name: 'Aegis demo item', amount: 99_900, quantity: 1 }],
    notes: { locale: 'en-IN' },
  }, scenarioOptions);
}

export function buildUnknownEvent(options: ScenarioBuildOptions = {}): SimScenario {
  const ids = idsFor(options);
  const scenarioOptions = { ...options, ids };
  return makeScenario('unknown_event', 'settlement.processed', 'settlement', {
    entity: 'settlement', id: ids.eventId(), status: 'processed',
  }, scenarioOptions);
}

export function buildBadSignature(options: ScenarioBuildOptions = {}): SimScenario {
  const ids = idsFor(options);
  const scenarioOptions = { ...options, ids };
  return makeScenario('bad_signature', 'payment.failed', 'payment', {
    entity: 'payment', id: ids.paymentId(), amount: 1_000, currency: 'INR', status: 'failed', order_id: ids.orderId(),
    customer_id: customerFor(scenarioOptions, ids), method: 'upi', international: false, error_reason: 'payment_cancelled', error_source: 'customer',
  }, scenarioOptions, false);
}
