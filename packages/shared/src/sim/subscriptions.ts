import { idsFor, customerFor, createdAtFor, makeScenario } from './support';
import type { ScenarioBuildOptions, SimScenario } from './types';

function subscriptionEntity(
  ids: ReturnType<typeof idsFor>,
  options: ScenarioBuildOptions,
  status: 'pending' | 'halted' | 'active',
  subscriptionId: string,
  paidCount: number,
): Record<string, unknown> {
  return {
    entity: 'subscription', id: subscriptionId, plan_id: 'plan_pro', customer_id: customerFor(options, ids), status,
    amount: 249_900, currency: 'INR', current_start: createdAtFor(options) - 86_400,
    current_end: createdAtFor(options) + 2_592_000, charge_at: createdAtFor(options) + 3_600,
    total_count: 12, paid_count: paidCount, remaining_count: 12 - paidCount, notes: { locale: 'en-IN' },
  };
}

export function buildSubscriptionPending(options: ScenarioBuildOptions = {}): SimScenario {
  const ids = idsFor(options);
  const scenarioOptions = { ...options, ids };
  return makeScenario('subscription_pending', 'subscription.pending', 'subscription', subscriptionEntity(
    ids, scenarioOptions, 'pending', options.priorSubscriptionId ?? ids.subscriptionId(), 3,
  ), scenarioOptions);
}

export function buildSubscriptionHalted(options: ScenarioBuildOptions = {}): SimScenario {
  const ids = idsFor(options);
  const scenarioOptions = { ...options, ids };
  return makeScenario('subscription_halted', 'subscription.halted', 'subscription', subscriptionEntity(
    ids, scenarioOptions, 'halted', options.priorSubscriptionId ?? ids.subscriptionId(), 3,
  ), scenarioOptions);
}

/** `charged` is an event suffix; its entity carries the valid `active` subscription status. */
export function buildSubscriptionCharged(options: ScenarioBuildOptions = {}): SimScenario {
  const ids = idsFor(options);
  const scenarioOptions = { ...options, ids };
  return makeScenario('subscription_charged', 'subscription.charged', 'subscription', subscriptionEntity(
    ids, scenarioOptions, 'active', options.priorSubscriptionId ?? ids.subscriptionId(), 4,
  ), scenarioOptions);
}
