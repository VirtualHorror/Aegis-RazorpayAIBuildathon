import type { ActionProposal, EventContext, GuardResult, GuardRule } from '../../orchestrator/types';

export const CHECKOUT_RECOVERY_STRATEGIES = [
  'RETRY_LINK_LOCALIZED',
  'RETRY_ALTERNATE_METHOD',
  'CART_RECOVERY_NUDGE',
] as const;

export type CheckoutRecoveryStrategy = (typeof CHECKOUT_RECOVERY_STRATEGIES)[number];

function isCheckoutRecoveryStrategy(value: string | undefined): value is CheckoutRecoveryStrategy {
  return value !== undefined && (CHECKOUT_RECOVERY_STRATEGIES as readonly string[]).includes(value);
}

function paymentAmount(ctx: EventContext): number | null {
  const value = ctx.entity.row.amount_paise;
  if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) return value;
  if (typeof value === 'string' && value.trim().length > 0) {
    const parsed = Number(value);
    return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
  }
  return null;
}

/**
 * Evaluate the module-local bounds without I/O.
 * Intent: opted-out customers and malformed/zero-value payments must never produce a customer message (C-B1/C-A5).
 * Flow: inspect the immutable event snapshot -> record every local rule -> require every rule to pass.
 */
export function guardCheckoutRecovery(proposal: ActionProposal, ctx: EventContext): GuardResult {
  const customer = ctx.entity.customer;
  const amount = paymentAmount(ctx);
  const strategy = ctx.diagnosis?.strategy;
  const rules: GuardRule[] = [
    {
      rule: 'customer_opted_out',
      limit: false,
      actual: customer?.opted_out ?? null,
      pass: customer !== null && customer !== undefined && customer.opted_out === false,
      note: 'Customer messaging is allowed only when opted_out is false.',
    },
    {
      rule: 'payment_amount_positive',
      limit: '> 0 paise',
      actual: amount,
      pass: amount !== null && amount > 0,
      note: 'Recovery links are created only for a positive payment amount.',
    },
    {
      rule: 'strategy_allowed',
      limit: CHECKOUT_RECOVERY_STRATEGIES,
      actual: strategy ?? null,
      pass: isCheckoutRecoveryStrategy(strategy),
      note: 'Only the three checkout recovery diagnosis strategies map to a WhatsApp template.',
    },
    {
      rule: 'payment_entity',
      limit: 'payment',
      actual: proposal.entityType,
      pass: proposal.entityType === 'payment',
      note: 'Checkout recovery actions are scoped to payment projections.',
    },
  ];
  const failed = rules.find((rule) => !rule.pass);
  return {
    pass: failed === undefined,
    rules,
    ...(failed === undefined ? {} : { blockedReason: failed.rule }),
  };
}

/** Extract the payment amount for proposal construction and tests without exposing row internals. */
export function paymentAmountPaise(ctx: EventContext): number {
  return paymentAmount(ctx) ?? 0;
}
