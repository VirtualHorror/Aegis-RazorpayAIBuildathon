import { describe, expect, it } from 'vitest';
import { SubscriptionSalvager } from './index';
import type { EventContext, Logger } from '../../orchestrator/types';
import type { CustomerRow } from '../../db/repos/customers';
import type { GuardrailConfig } from '../../guardrails/types';

const logger: Logger = { info: () => undefined, warn: () => undefined, error: () => undefined, debug: () => undefined };
const config: GuardrailConfig = { kill_switch: false, auto_approve_limit_paise: 200000, max_discount_pct: 15, max_negotiation_rounds: 3, max_dunning_retries: 3, dunning_schedule_hours: [24, 72, 168], message_cooldown_hours: 24, quiet_hours_local: { start: 21, end: 8 }, daily_discount_budget_paise: 5000000, attribution_window_hours: 72, x402_max_amount_paise: 100000, x402_daily_cap_per_payer_paise: 500000 };
const customer: CustomerRow = { id: 'cus_sub_test', name: 'Customer', email: 'a@test', contact: '+919876543210', country: 'IN', locale: 'en-IN', opted_out: false, notes: {}, created_at: new Date(0), updated_at: new Date(0) };

function context(eventType: string, state: string, retryCount = 0): EventContext {
  return {
    event: { event_id: 'evt_sub_test', event_type: eventType, payload: {}, signature_valid: true, rzp_created_at: new Date(0), status: 'processed' },
    payload: { entity: 'event', event: eventType, contains: ['subscription'], payload: { subscription: { entity: { id: 'sub_test', entity: 'subscription', status: eventType.endsWith('halted') ? 'halted' : 'pending', amount: 10000, customer_id: customer.id } } }, created_at: 1 },
    entity: { type: 'subscription', row: { id: 'sub_test', version: 1, status: eventType.endsWith('charged') ? 'active' : 'pending', amount_paise: 10000, salvage_state: state, retry_count: retryCount, customer_id: customer.id }, customer, applied: true },
    diagnosis: null,
    config,
    now: new Date('2026-01-01T00:00:00Z'),
    logger,
  };
}

describe('SubscriptionSalvager', () => {
  it('proposes bounded step one and recovery', async () => {
    const module = new SubscriptionSalvager();
    const proposal = await module.propose(context('subscription.pending', 'none'));
    expect(proposal).toMatchObject({ kind: 'dunning_retry', idempotencyKey: 'subscription_salvager:subscription:sub_test:1', expectedRecoveryPaise: 10000 });
    const recovery = await module.propose(context('subscription.charged', 'retry_scheduled', 1));
    expect(recovery).toMatchObject({ kind: 'salvage_recovered', moneyImpactPaise: 0 });
  });

  it('does not re-propose an already scheduled step', async () => {
    const module = new SubscriptionSalvager();
    await expect(module.propose(context('subscription.pending', 'retry_scheduled', 1))).resolves.toBeNull();
  });
});

