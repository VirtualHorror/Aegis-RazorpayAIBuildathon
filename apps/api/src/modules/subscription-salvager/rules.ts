import type { ActionProposal, EventContext, GuardResult, GuardRule } from '../../orchestrator/types';
import { nextSalvageState, type SalvageEvent, type SalvageState } from './state';

function numberValue(value: unknown): number | null {
  const parsed = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : Number.NaN;
  return Number.isSafeInteger(parsed) ? parsed : null;
}

export function transitionEvent(ctx: EventContext): SalvageEvent {
  const current = String(ctx.entity.row.salvage_state ?? 'none') as SalvageState;
  if (ctx.event.event_type === 'subscription.charged' || ctx.event.event_type === 'subscription.activated') return 'payment_succeeded';
  if (current === 'retrying') return 'retry_failed';
  return 'failure_observed';
}

/** Evaluate the module-local dunning bounds; every bound is retained in the action audit row. */
export function guardSubscriptionSalvage(proposal: ActionProposal, ctx: EventContext): GuardResult {
  const row = ctx.entity.row;
  const retryCount = numberValue(row.retry_count) ?? -1;
  const maxRetries = ctx.config.max_dunning_retries;
  const status = typeof row.status === 'string' ? row.status : null;
  const customer = ctx.entity.customer;
  const current = (typeof row.salvage_state === 'string' ? row.salvage_state : 'none') as SalvageState;
  const event = transitionEvent(ctx);
  const next = nextSalvageState(current, event, retryCount, maxRetries);
  const rules: GuardRule[] = [
    { rule: 'max_dunning_retries', limit: maxRetries, actual: retryCount, pass: retryCount >= 0 && retryCount < maxRetries, note: 'Retry count must remain below the merchant bound.' },
    { rule: 'subscription_status', limit: ['pending', 'halted'], actual: status, pass: status === 'pending' || status === 'halted', note: 'Dunning only addresses pending or halted subscriptions.' },
    { rule: 'customer_opted_out', limit: false, actual: customer?.opted_out ?? null, pass: customer?.opted_out === false, note: 'Customer messaging is disabled after opt-out.' },
    { rule: 'salvage_transition', limit: `${current} + ${event}`, actual: next, pass: next !== null, note: 'Transition table is exhaustive and pure.' },
  ];
  const failed = rules.find((rule) => !rule.pass);
  return { pass: failed === undefined, rules, ...(failed ? { blockedReason: failed.rule } : {}) };
}

export function guardRecovery(proposal: ActionProposal, ctx: EventContext): GuardResult {
  const current = (typeof ctx.entity.row.salvage_state === 'string' ? ctx.entity.row.salvage_state : 'none') as SalvageState;
  const retryCount = numberValue(ctx.entity.row.retry_count) ?? 0;
  const next = nextSalvageState(current, 'payment_succeeded', retryCount, ctx.config.max_dunning_retries);
  const rules: GuardRule[] = [
    { rule: 'subscription_status', limit: ['active'], actual: ctx.entity.row.status ?? null, pass: ctx.entity.row.status === 'active', note: 'A charged/activated event projects active before recovery.' },
    { rule: 'salvage_non_terminal', limit: ['none', 'retry_scheduled', 'retrying', 'offer_sent', 'churned'], actual: current, pass: next === 'recovered', note: 'Only a non-recovered subscription can be credited once.' },
  ];
  const failed = rules.find((rule) => !rule.pass);
  return { pass: failed === undefined, rules, ...(failed ? { blockedReason: failed.rule } : {}) };
}

