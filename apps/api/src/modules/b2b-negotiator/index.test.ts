import { describe, expect, it } from 'vitest';
import { StubLlmClient } from '../../llm/stub';
import type { CustomerRow } from '../../db/repos/customers';
import type { EventContext, Logger } from '../../orchestrator/types';
import type { GuardrailConfig } from '../../guardrails/types';
import { B2BNegotiator } from './index';

const logger: Logger = { info: () => undefined, warn: () => undefined, error: () => undefined, debug: () => undefined };
const config: GuardrailConfig = { kill_switch: false, auto_approve_limit_paise: 200000, max_discount_pct: 15, max_negotiation_rounds: 3, max_dunning_retries: 3, dunning_schedule_hours: [24, 72, 168], message_cooldown_hours: 24, quiet_hours_local: { start: 21, end: 8 }, daily_discount_budget_paise: 5000000, attribution_window_hours: 72, x402_max_amount_paise: 100000, x402_daily_cap_per_payer_paise: 500000 };
const customer: CustomerRow = { id: 'cus_invoice_test', name: 'Buyer', email: 'buyer@example.test', contact: '+919876543210', country: 'IN', locale: 'en-IN', opted_out: false, notes: {}, created_at: new Date(0), updated_at: new Date(0) };

function context(eventType: string, state = 'none', round = 0, notes: Record<string, unknown> = {}): EventContext {
  return {
    event: { event_id: 'evt_invoice_test', event_type: eventType, payload: {}, signature_valid: true, rzp_created_at: new Date(0), status: 'processed' },
    payload: { entity: 'event', event: eventType, contains: ['invoice'], payload: { invoice: { entity: { id: 'inv_test', entity: 'invoice', status: eventType.endsWith('expired') ? 'expired' : 'issued', amount: 5_000_000, customer_id: customer.id, notes } } }, created_at: 1 },
    entity: { type: 'invoice', row: { id: 'inv_test', version: 1, status: eventType.endsWith('expired') ? 'expired' : 'issued', amount_paise: 5_000_000, floor_amount_paise: 4_500_000, negotiation_state: state, negotiation_round: round, current_offer_paise: 4_750_000, line_items: [], notes }, customer, applied: true },
    diagnosis: null,
    config,
    now: new Date('2026-01-01T00:00:00Z'),
    logger,
  };
}

describe('B2BNegotiator', () => {
  it('keeps offer math in code and requires approval at ten percent', async () => {
    const module = new B2BNegotiator(new StubLlmClient());
    const proposal = await module.propose(context('invoice.expired'));
    expect(proposal).toMatchObject({ kind: 'discount_offer', moneyImpactPaise: -250000, requiresApproval: false });
    if (!proposal) throw new Error('proposal missing');
    expect(proposal.payload).toMatchObject({ offerPaise: 4_750_000, round: 1 });
    expect(JSON.stringify(proposal.payload)).not.toContain('{{OFFER_AMOUNT}}');
    const second = await module.propose(context('invoice.updated', 'countered', 1, { counter_paise: 4_750_000 }));
    expect(second?.requiresApproval).toBe(true);
  });

  it('turns a below-floor counter into a recorded human escalation', async () => {
    const module = new B2BNegotiator();
    const proposal = await module.propose(context('invoice.updated', 'countered', 1, { counter_paise: 1 }));
    expect(proposal).toMatchObject({ kind: 'ESCALATE_HUMAN', requiresApproval: true });
  });

  it('falls back when the model authors an unbound number', async () => {
    const llm = new StubLlmClient({
      fixtureFor: () => ({ subject: 'Offer 123', body: 'Pay {{OFFER_AMOUNT}} by {{VALID_UNTIL}}.' }),
    });
    const proposal = await new B2BNegotiator(llm).propose(context('invoice.expired'));
    expect(proposal?.payload).toMatchObject({ degraded: true });
    expect((proposal?.payload as Record<string, unknown> | undefined)?.email).toMatchObject({ subject: 'A practical way to settle your invoice' });
  });
});
