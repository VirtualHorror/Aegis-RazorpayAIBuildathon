import type { ActionProposal, EventContext, GuardResult, GuardRule } from '../../orchestrator/types';
import { isAcceptableCounter } from './pricing';
import { nextNegotiationState, type NegotiationState } from './state';

function numberValue(value: unknown): number | null {
  const number = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : Number.NaN;
  return Number.isFinite(number) ? number : null;
}

export function guardNegotiation(proposal: ActionProposal, ctx: EventContext): GuardResult {
  const row = ctx.entity.row;
  const amount = numberValue(row.amount_paise) ?? -1;
  const floor = numberValue(row.floor_amount_paise) ?? -1;
  const payload = proposal.payload;
  const offer = numberValue(payload.offerPaise);
  const discountPct = numberValue(payload.discountPct);
  const round = numberValue(payload.round);
  const state = (typeof row.negotiation_state === 'string' ? row.negotiation_state : 'none') as NegotiationState;
  const counter = numberValue(payload.counterPaise);
  const transitionEvent = state === 'none' ? 'expired_invoice' : 'offer_sent';
  const transition = proposal.kind === 'ESCALATE_HUMAN'
    ? nextNegotiationState(state, 'rejected', round ?? 0, ctx.config.max_negotiation_rounds)
    : nextNegotiationState(state, transitionEvent, round ?? 0, ctx.config.max_negotiation_rounds);
  const rules: GuardRule[] = [
    { rule: 'invoice_amount_minimum', limit: 5_000_000, actual: amount, pass: amount >= 5_000_000, note: 'Only B2B invoices of at least ₹50,000 enter negotiation.' },
    { rule: 'floor_amount', limit: floor, actual: offer, pass: proposal.kind === 'ESCALATE_HUMAN' || (offer !== null && offer >= floor), note: 'An automated offer never goes below the immutable invoice floor.' },
    { rule: 'max_discount_pct', limit: ctx.config.max_discount_pct, actual: discountPct, pass: proposal.kind === 'ESCALATE_HUMAN' || (discountPct !== null && discountPct <= ctx.config.max_discount_pct + Number.EPSILON), note: 'Discount ceiling is loaded from guardrails.' },
    { rule: 'max_negotiation_rounds', limit: ctx.config.max_negotiation_rounds, actual: round, pass: proposal.kind === 'ESCALATE_HUMAN' || (round !== null && round <= ctx.config.max_negotiation_rounds), note: 'Round count is bounded by the merchant setting.' },
    { rule: 'counter_floor', limit: floor, actual: counter, pass: counter === null || isAcceptableCounter(counter, floor) || proposal.kind === 'ESCALATE_HUMAN', note: 'A below-floor counter is recorded for human override rather than accepted automatically.' },
    { rule: 'negotiation_transition', limit: state, actual: transition, pass: transition !== null, note: 'State transitions are deterministic.' },
  ];
  const failed = rules.find((rule) => !rule.pass);
  return { pass: failed === undefined, rules, ...(failed ? { blockedReason: failed.rule } : {}) };
}
