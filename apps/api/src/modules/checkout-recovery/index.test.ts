import { describe, expect, it } from 'vitest';
import {
  RazorpayWebhookSchema,
  WhatsAppTemplateMessageSchema,
  type RazorpayWebhook,
} from '@aegis/shared';
import type { CustomerRow } from '../../db/repos/customers';
import type { Diagnosis, WebhookEventRow } from '../../diagnosis/diagnostician';
import type { EntitySnapshot } from '../../orchestrator/entity';
import type { GuardrailConfig } from '../../guardrails/types';
import type { EventContext, Logger } from '../../orchestrator/types';
import { CheckoutRecovery } from './index';

const logger: Logger = { info: () => undefined, warn: () => undefined, error: () => undefined, debug: () => undefined };

const config: GuardrailConfig = {
  kill_switch: false,
  auto_approve_limit_paise: 200_000,
  max_discount_pct: 15,
  max_negotiation_rounds: 3,
  max_dunning_retries: 3,
  dunning_schedule_hours: [24, 72, 168],
  message_cooldown_hours: 24,
  quiet_hours_local: { start: 21, end: 8 },
  daily_discount_budget_paise: 5_000_000,
  attribution_window_hours: 72,
  x402_max_amount_paise: 100_000,
  x402_daily_cap_per_payer_paise: 500_000,
};

const customer: CustomerRow = {
  id: 'cus_checkout_test',
  name: 'Test Customer',
  email: 'customer@example.test',
  contact: '+919876543210',
  country: 'IN',
  locale: 'en-IN',
  opted_out: false,
  notes: {},
  created_at: new Date(0),
  updated_at: new Date(0),
};

function payload(strategy: string): RazorpayWebhook {
  return RazorpayWebhookSchema.parse({
    entity: 'event',
    event: 'payment.failed',
    contains: ['payment'],
    payload: {
      payment: {
        entity: {
          entity: 'payment',
          id: 'pay_checkout_test',
          amount: 149_900,
          currency: 'INR',
          status: 'failed',
          customer_id: customer.id,
          contact: customer.contact,
          notes: { locale: customer.locale },
        },
      },
      strategy,
    },
    created_at: 1_757_000_000,
  });
}

const event: WebhookEventRow = {
  event_id: 'evt_checkout_test',
  event_type: 'payment.failed',
  payload: {},
  signature_valid: true,
  rzp_created_at: new Date(1_757_000_000_000),
  status: 'processed',
};

function diagnosis(strategy: Diagnosis['strategy']): Diagnosis {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    rootCause: 'THREE_DS_AUTH_FAILED',
    strategy,
    confidence: 0.9,
    rationale: 'The payment authentication step failed before capture completed.',
    degraded: false,
    crossCheck: { overridden: false, notes: [] },
    provider: 'stub',
    model: 'fixture-v1',
  };
}

function context(strategy: Diagnosis['strategy'], customerOverride: CustomerRow | null = customer): EventContext {
  const parsedPayload = payload(strategy);
  const entity: EntitySnapshot = {
    type: 'payment',
    row: { id: 'pay_checkout_test', version: 1, amount_paise: 149_900, status: 'failed' },
    customer: customerOverride,
    applied: true,
  };
  return {
    event,
    payload: parsedPayload,
    entity,
    diagnosis: diagnosis(strategy),
    config,
    now: new Date('2026-09-05T12:00:00.000Z'),
    logger,
  };
}

describe('CheckoutRecovery', () => {
  it('handles only failed payments with an eligible diagnosis and customer contact', () => {
    const module = new CheckoutRecovery();
    expect(module.canHandle(context('RETRY_LINK_LOCALIZED'))).toBe(true);
    expect(module.canHandle(context('ESCALATE_HUMAN'))).toBe(false);
    expect(module.canHandle(context('RETRY_LINK_LOCALIZED', null))).toBe(false);
  });

  it('proposes a deterministic, schema-valid masked WhatsApp payload', async () => {
    const module = new CheckoutRecovery();
    const proposal = await module.propose(context('RETRY_LINK_LOCALIZED'));
    expect(proposal).not.toBeNull();
    if (proposal === null) throw new Error('expected a proposal');
    expect(proposal).toMatchObject({
      module: 'checkout_recovery',
      moduleVersion: 'v1',
      idempotencyKey: 'checkout_recovery:payment:pay_checkout_test:1',
      kind: 'whatsapp_retry_link',
      moneyImpactPaise: 0,
      expectedRecoveryPaise: 149_900,
      requiresApproval: false,
    });
    const message = WhatsAppTemplateMessageSchema.parse(proposal.payload);
    expect(message.to).toBe('+91••••••3210');
    expect(message.to).not.toContain('987654');
    expect(message.template.components[0]?.parameters[0]?.text).toContain('₹1,499.00');
    expect(message.template.components[1]?.parameters[0]?.text).toMatch(/^https:\/\/rzp\.io\/l\/aegis-[A-Z2-7]{8}$/);
  });

  it('fails the opted-out guard with the required rule name', async () => {
    const module = new CheckoutRecovery();
    const optedOut = { ...customer, opted_out: true };
    const ctx = context('CART_RECOVERY_NUDGE', optedOut);
    const proposal = await module.propose(ctx);
    expect(proposal).not.toBeNull();
    if (proposal === null) throw new Error('expected a proposal');
    const result = module.guard(proposal, ctx);
    expect(result.pass).toBe(false);
    expect(result.rules.find((rule) => rule.rule === 'customer_opted_out')?.pass).toBe(false);
  });
});
