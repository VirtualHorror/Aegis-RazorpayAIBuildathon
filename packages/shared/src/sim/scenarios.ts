import { createIdFactory, type SimIdFactory, type SimSeed } from './ids';
import { buildPaymentCapturedAfterRetry, buildPaymentFailed3dsIntl, buildPaymentFailedCartDropoff, buildPaymentFailedInsufficientFunds, buildPaymentFailedIntlNotEnabled } from './payments';
import { buildSubscriptionCharged, buildSubscriptionHalted, buildSubscriptionPending } from './subscriptions';
import { buildInvoiceExpiredB2b, buildInvoicePaid } from './invoices';
import { buildBadSignature, buildDisputeCreated, buildOrderPaid, buildUnknownEvent } from './edges';
import { at, buildWebhook, entityString } from './support';
import type { BuildWebhookInput, ScenarioBuildOptions, SimScenario, SimScenarioName } from './types';

export {
  SIM_SCENARIO_NAMES,
  DEFAULT_SIM_ACCOUNT_ID,
  DEFAULT_SIM_CREATED_AT,
} from './types';
export { SIM_SCENARIO_NAMES as SCENARIO_NAMES } from './types';
export type {
  BuildWebhookInput,
  ScenarioBuildOptions,
  SimScenario,
  SimScenarioAttribution,
  SimScenarioName,
  SimScenarioNameOrAll,
} from './types';
export { buildWebhook };
export {
  buildPaymentFailed3dsIntl,
  buildPaymentFailedCartDropoff,
  buildPaymentFailedInsufficientFunds,
  buildPaymentFailedIntlNotEnabled,
  buildPaymentCapturedAfterRetry,
} from './payments';
export { buildSubscriptionPending, buildSubscriptionHalted, buildSubscriptionCharged } from './subscriptions';
export { buildInvoiceExpiredB2b, buildInvoicePaid } from './invoices';
export { buildDisputeCreated, buildOrderPaid, buildUnknownEvent, buildBadSignature } from './edges';

export const SIM_SCENARIO_BUILDERS: Readonly<Record<SimScenarioName, (options?: ScenarioBuildOptions) => SimScenario>> = {
  payment_failed_3ds_intl: buildPaymentFailed3dsIntl,
  payment_failed_cart_dropoff: buildPaymentFailedCartDropoff,
  payment_failed_insufficient_funds: buildPaymentFailedInsufficientFunds,
  payment_failed_intl_not_enabled: buildPaymentFailedIntlNotEnabled,
  payment_captured_after_retry: buildPaymentCapturedAfterRetry,
  subscription_pending: buildSubscriptionPending,
  subscription_halted: buildSubscriptionHalted,
  subscription_charged: buildSubscriptionCharged,
  invoice_expired_b2b: buildInvoiceExpiredB2b,
  invoice_paid: buildInvoicePaid,
  dispute_created: buildDisputeCreated,
  order_paid: buildOrderPaid,
  unknown_event: buildUnknownEvent,
  bad_signature: buildBadSignature,
};

export const SCENARIO_BUILDERS = SIM_SCENARIO_BUILDERS;

export function buildScenario(name: SimScenarioName, options: ScenarioBuildOptions = {}): SimScenario {
  return SIM_SCENARIO_BUILDERS[name](options);
}

function atOffset(options: ScenarioBuildOptions, offset: number): ScenarioBuildOptions {
  return at(options, offset);
}

/**
 * Build the complete demo sequence from one shared id source.
 * Intent: related lifecycle events share entity ids, while each delivery gets a fresh event id.
 * Flow: failure -> retry attribution -> subscription lifecycle -> invoice lifecycle -> dispute/order -> ignored/forged edges.
 */
export function buildAllScenarios(options: ScenarioBuildOptions = {}): readonly SimScenario[] {
  const ids: SimIdFactory = options.ids ?? createIdFactory(options.seed);
  const shared: ScenarioBuildOptions = { ...options, ids };

  const failed = buildPaymentFailed3dsIntl(atOffset(shared, 0));
  const capture = buildPaymentCapturedAfterRetry({
    ...atOffset(shared, 1),
    priorFailureOrderId: entityString(failed, 'payment', 'order_id'),
    priorFailureEventId: failed.eventId,
    priorFailureCustomerId: entityString(failed, 'payment', 'customer_id'),
  });
  const cartDropoff = buildPaymentFailedCartDropoff(atOffset(shared, 2));
  const insufficientFunds = buildPaymentFailedInsufficientFunds(atOffset(shared, 3));
  const internationalDisabled = buildPaymentFailedIntlNotEnabled(atOffset(shared, 4));

  const pending = buildSubscriptionPending(atOffset(shared, 5));
  const subscriptionId = entityString(pending, 'subscription', 'id');
  const subscriptionCustomerId = entityString(pending, 'subscription', 'customer_id');
  const halted = buildSubscriptionHalted({
    ...atOffset(shared, 6), priorSubscriptionId: subscriptionId, customerId: subscriptionCustomerId,
  });
  const charged = buildSubscriptionCharged({
    ...atOffset(shared, 7), priorSubscriptionId: subscriptionId, customerId: subscriptionCustomerId,
  });

  const expired = buildInvoiceExpiredB2b(atOffset(shared, 8));
  const invoiceId = entityString(expired, 'invoice', 'id');
  const invoiceCustomerId = entityString(expired, 'invoice', 'customer_id');
  const paid = buildInvoicePaid({
    ...atOffset(shared, 9), priorInvoiceId: invoiceId, customerId: invoiceCustomerId,
  });

  return [
    failed,
    capture,
    cartDropoff,
    insufficientFunds,
    internationalDisabled,
    pending,
    halted,
    charged,
    expired,
    paid,
    buildDisputeCreated(atOffset(shared, 10)),
    buildOrderPaid(atOffset(shared, 11)),
    buildUnknownEvent(atOffset(shared, 12)),
    buildBadSignature(atOffset(shared, 13)),
  ];
}

export const buildScenarios = buildAllScenarios;

// Keep these type aliases available to consumers that build a run descriptor before invoking a builder.
export type { BuildWebhookInput as WebhookBuilderInput };
export type { SimSeed };
