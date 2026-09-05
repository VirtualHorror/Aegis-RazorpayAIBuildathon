import { idsFor, customerFor, makeScenario } from './support';
import type { ScenarioBuildOptions, SimScenario } from './types';

export function buildPaymentFailed3dsIntl(options: ScenarioBuildOptions = {}): SimScenario {
  const ids = idsFor(options);
  const scenarioOptions = { ...options, ids };
  const orderId = options.orderId ?? ids.orderId();
  const customerId = customerFor(scenarioOptions, ids);
  return makeScenario('payment_failed_3ds_intl', 'payment.failed', 'payment', {
    entity: 'payment', id: ids.paymentId(), amount: 149_900, currency: 'INR', status: 'failed', order_id: orderId,
    customer_id: customerId, method: 'card', card_network: 'Visa', card_type: 'credit', card_country: 'US', international: true,
    error_code: 'BAD_REQUEST_ERROR', error_description: 'Payment authentication failed', error_source: 'issuer',
    error_step: 'payment_authentication', error_reason: 'authentication_failed', email: 'sim-3ds@example.test', contact: '+1******42',
    notes: { locale: 'en-US' },
  }, scenarioOptions);
}

export function buildPaymentFailedCartDropoff(options: ScenarioBuildOptions = {}): SimScenario {
  const ids = idsFor(options);
  const scenarioOptions = { ...options, ids };
  return makeScenario('payment_failed_cart_dropoff', 'payment.failed', 'payment', {
    entity: 'payment', id: ids.paymentId(), amount: 79_900, currency: 'INR', status: 'failed', order_id: ids.orderId(),
    customer_id: customerFor(scenarioOptions, ids), method: 'upi', international: false, error_source: 'customer', error_reason: 'payment_cancelled',
    email: 'sim-cart@example.test', contact: '+91******43', notes: { locale: 'en-IN' },
  }, scenarioOptions);
}

export function buildPaymentFailedInsufficientFunds(options: ScenarioBuildOptions = {}): SimScenario {
  const ids = idsFor(options);
  const scenarioOptions = { ...options, ids };
  return makeScenario('payment_failed_insufficient_funds', 'payment.failed', 'payment', {
    entity: 'payment', id: ids.paymentId(), amount: 249_900, currency: 'INR', status: 'failed', order_id: ids.orderId(),
    customer_id: customerFor(scenarioOptions, ids), method: 'card', card_network: 'Mastercard', card_type: 'debit', card_country: 'IN', international: false,
    error_code: 'BAD_REQUEST_ERROR', error_description: 'The bank declined the payment', error_source: 'issuer', error_reason: 'insufficient_funds',
    email: 'sim-funds@example.test', contact: '+91******44', notes: { locale: 'en-IN' },
  }, scenarioOptions);
}

export function buildPaymentFailedIntlNotEnabled(options: ScenarioBuildOptions = {}): SimScenario {
  const ids = idsFor(options);
  const scenarioOptions = { ...options, ids };
  return makeScenario('payment_failed_intl_not_enabled', 'payment.failed', 'payment', {
    entity: 'payment', id: ids.paymentId(), amount: 199_900, currency: 'INR', status: 'failed', order_id: ids.orderId(),
    customer_id: customerFor(scenarioOptions, ids), method: 'card', card_network: 'Visa', card_type: 'credit', card_country: 'US', international: true,
    error_code: 'BAD_REQUEST_ERROR', error_description: 'International transactions are not enabled', error_source: 'issuer',
    error_reason: 'international_transaction_not_allowed', email: 'sim-intl@example.test', contact: '+1******45', notes: { locale: 'en-US' },
  }, scenarioOptions);
}

/**
 * Build a fresh captured payment on an earlier order when the caller supplies one.
 * Intent: retry attribution must point to a real failure event in the same run, never to a random order.
 * Flow: reuse order/customer context -> allocate a new payment and event id -> expose the source event in metadata.
 */
export function buildPaymentCapturedAfterRetry(options: ScenarioBuildOptions = {}): SimScenario {
  const ids = idsFor(options);
  const scenarioOptions = { ...options, ids };
  // Intent: independently built retries must not reuse the source attempt's natural ids when only its order is supplied.
  // Flow: reserve one source payment/event slot for an external prior failure -> allocate the fresh retry ids below.
  if (!options.ids && options.priorFailureOrderId) {
    ids.paymentId();
    ids.eventId();
  }
  const orderId = options.priorFailureOrderId ?? ids.orderId();
  const customerId = options.customerId ?? options.priorFailureCustomerId ?? customerFor(scenarioOptions, ids);
  const attribution = options.priorFailureOrderId
    ? { orderId, ...(options.priorFailureEventId ? { priorFailureEventId: options.priorFailureEventId } : {}) }
    : undefined;
  return makeScenario('payment_captured_after_retry', 'payment.captured', 'payment', {
    entity: 'payment', id: ids.paymentId(), amount: 149_900, currency: 'INR', status: 'captured', order_id: orderId,
    customer_id: customerId, method: 'card', card_network: 'Visa', card_type: 'credit', card_country: 'US', international: true,
    email: 'sim-retry@example.test', contact: '+1******42', notes: { locale: 'en-US', retry: true },
  }, scenarioOptions, true, attribution);
}
