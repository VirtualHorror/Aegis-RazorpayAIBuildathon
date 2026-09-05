import { LlmUnavailableError, type LlmClient } from '../../llm/client';
import { maskPii } from '../../llm/mask';
import { StubLlmClient } from '../../llm/stub';
import { draftNegotiationMessagePrompt, NegotiationDraftSchema } from '../../llm/prompts/draft-negotiation-message';
import type { ActionModule, ActionProposal, ActionRow, EventContext, ExecutionDeps, ExecutionResult } from '../../orchestrator/types';
import type { JobHandler } from '../../worker/registry';
import { offerForRound, type OfferClamp } from './pricing';
import { guardNegotiation } from './rules';

function integer(value: unknown, fallback = 0): number {
  const parsed = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : Number.NaN;
  return Number.isSafeInteger(parsed) ? parsed : fallback;
}

function number(value: unknown, fallback = 0): number {
  const parsed = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : fallback;
}

function maskedCustomer(ctx: EventContext): Record<string, unknown> {
  const customer = ctx.entity.customer;
  return { id_masked: customer?.id ? `${customer.id.slice(0, 4)}••••` : null, country: customer?.country ?? null, locale: customer?.locale ?? 'en-IN' };
}

function substitute(template: string, offerPaise: number, validUntil: Date): string {
  return template.replaceAll('{{OFFER_AMOUNT}}', formatInr(offerPaise)).replaceAll('{{VALID_UNTIL}}', validUntil.toISOString());
}

function formatInr(paise: number): string {
  return `₹${(paise / 100).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function containsUnboundNumber(value: string): boolean {
  const stripped = value.replaceAll('{{OFFER_AMOUNT}}', '').replaceAll('{{VALID_UNTIL}}', '');
  return /\d/.test(stripped);
}

function counterFromRow(ctx: EventContext): number | null {
  const notes = ctx.entity.row.notes;
  if (typeof notes !== 'object' || notes === null || Array.isArray(notes)) return null;
  const raw = (notes as Record<string, unknown>).counter_paise;
  return typeof raw === 'number' && Number.isSafeInteger(raw) ? raw : typeof raw === 'string' && /^\d+$/.test(raw) ? Number(raw) : null;
}

export interface B2BNegotiatorOptions { readonly llm?: LlmClient }

export class B2BNegotiator implements ActionModule {
  readonly name = 'b2b_negotiator';
  readonly version = 'v1';
  readonly handles = ['invoice.expired', 'invoice.updated', 'invoice.paid'] as const;
  private readonly llm: LlmClient;

  constructor(options: B2BNegotiatorOptions | LlmClient = {}) {
    this.llm = isLlm(options) ? options : options.llm ?? new StubLlmClient();
  }

  canHandle(ctx: EventContext): boolean {
    if (ctx.entity.type !== 'invoice') return false;
    const amount = number(ctx.entity.row.amount_paise, 0);
    const state = String(ctx.entity.row.negotiation_state ?? 'none');
    if (ctx.event.event_type === 'invoice.paid') return state === 'offer_sent' && integer(ctx.entity.row.current_offer_paise) > 0;
    if (amount < 5_000_000 || !['none', 'countered'].includes(state)) return false;
    if (ctx.event.event_type === 'invoice.updated') return counterFromRow(ctx) !== null;
    return ctx.event.event_type === 'invoice.expired';
  }

  async propose(ctx: EventContext): Promise<ActionProposal | null> {
    if (!this.canHandle(ctx)) return null;
    const row = ctx.entity.row;
    const amount = integer(row.amount_paise);
    const floor = integer(row.floor_amount_paise);
    const customerId = ctx.entity.customer?.id;
    if (ctx.event.event_type === 'invoice.paid') {
      const paid = number(row.amount_paid_paise ?? row.amount_paid ?? row.amount_paise, amount);
      const currentOffer = integer(row.current_offer_paise);
      if (paid < currentOffer) return null;
      return {
        module: this.name, moduleVersion: this.version, idempotencyKey: `${this.name}:invoice:${row.id}:accepted`, entityType: 'invoice', entityId: row.id,
        ...(customerId ? { customerId } : {}), kind: 'negotiation_accepted', summary: `Accept invoice ${row.id} payment at ${paid} paise`, moneyImpactPaise: -(Math.max(0, amount - paid)), expectedRecoveryPaise: paid, requiresApproval: false,
        payload: { amountPaise: amount, paidPaise: paid, currentOfferPaise: currentOffer }, explanation: ['Invoice payment meets the latest bounded offer.'],
      };
    }
    const counter = ctx.event.event_type === 'invoice.updated' ? counterFromRow(ctx) : null;
    if (counter !== null && !Number.isSafeInteger(counter)) return null;
    if (counter !== null && counter < floor) {
      return {
        module: this.name, moduleVersion: this.version, idempotencyKey: `${this.name}:invoice:${row.id}:counter-${counter}`, entityType: 'invoice', entityId: row.id,
        ...(customerId ? { customerId } : {}), kind: 'ESCALATE_HUMAN', summary: `Counter-offer for invoice ${row.id} is below the merchant floor`, moneyImpactPaise: 0, expectedRecoveryPaise: amount, requiresApproval: true,
        payload: { counterPaise: counter, floorPaise: floor, override: 'floor' }, explanation: [`Counter ${counter} paise is below floor ${floor} paise.`, 'A human may override the floor; the override is recorded in the action audit.'],
      };
    }
    const round = (integer(row.negotiation_round) + 1) as 1 | 2 | 3;
    const pricing = offerForRound(amount, floor, Math.min(round, 3) as 1 | 2 | 3, ctx.config.max_discount_pct);
    if (round > 3 || round > ctx.config.max_negotiation_rounds) {
      return {
        module: this.name, moduleVersion: this.version, idempotencyKey: `${this.name}:invoice:${row.id}:escalated-${round}`, entityType: 'invoice', entityId: row.id,
        ...(customerId ? { customerId } : {}), kind: 'ESCALATE_HUMAN', summary: `Escalate invoice ${row.id} after maximum negotiation rounds`, moneyImpactPaise: 0, expectedRecoveryPaise: amount, requiresApproval: true,
        payload: { round, maxRounds: ctx.config.max_negotiation_rounds }, explanation: ['Negotiation rounds are exhausted; no further automated discount is permitted.'],
      };
    }
    const validUntil = new Date(ctx.now.getTime() + 72 * 3_600_000);
    let subject = 'A practical way to settle your invoice';
    let body = 'We can offer {{OFFER_AMOUNT}} if payment is completed by {{VALID_UNTIL}}.';
    let degraded = false;
    try {
      const response = await this.llm.completeJson({ ...draftNegotiationMessagePrompt, purpose: 'draft_negotiation_message', user: draftNegotiationMessagePrompt.buildUser({ customer: maskedCustomer(ctx), lineItems: maskPii(row.line_items ?? []), round }) });
      const draft = NegotiationDraftSchema.parse(response.data);
      if (containsUnboundNumber(draft.subject) || containsUnboundNumber(draft.body)) throw new LlmUnavailableError('model_authored_number');
      subject = draft.subject;
      body = draft.body;
    } catch (error) {
      if (!(error instanceof LlmUnavailableError)) throw error;
      degraded = true;
    }
    const renderedBody = substitute(body, pricing.offerPaise, validUntil);
    const whatsapp = { messaging_product: 'whatsapp', to: ctx.entity.customer?.contact ? mask(ctx.entity.customer.contact) : '', type: 'text', text: { body: renderedBody } };
    const email = { subject, body: renderedBody, to: ctx.entity.customer?.email ? maskEmail(ctx.entity.customer.email) : undefined };
    return {
      module: this.name, moduleVersion: this.version, idempotencyKey: `${this.name}:invoice:${row.id}:${round}`, entityType: 'invoice', entityId: row.id,
      ...(customerId ? { customerId } : {}), kind: 'discount_offer', summary: `Offer ${formatInr(pricing.offerPaise)} to settle invoice ${row.id}`, moneyImpactPaise: -(amount - pricing.offerPaise), expectedRecoveryPaise: pricing.offerPaise, requiresApproval: pricing.discountPct >= 10,
      payload: { whatsapp, email, offerPaise: pricing.offerPaise, discountPct: pricing.discountPct, clampedBy: pricing.clampedBy satisfies OfferClamp, round, validUntil: validUntil.toISOString(), degraded },
      explanation: [`Round ${round} discount computed in integer paise.`, `Offer is ${pricing.clampedBy === 'none' ? 'within' : `clamped by ${pricing.clampedBy}`} the configured bounds.`],
      scheduleFollowUp: { kind: 'negotiation_expiry', runAt: validUntil, payload: { invoiceId: row.id, round }, dedupeKey: `negotiation_expiry:${row.id}:${round}` },
    };
  }

  guard(proposal: ActionProposal, ctx: EventContext) { return guardNegotiation(proposal, ctx); }

  async execute(action: ActionRow, ctx: EventContext, _deps: ExecutionDeps): Promise<ExecutionResult> {
    const row = ctx.entity.row;
    if (action.kind === 'negotiation_accepted') {
      const actionPayload = record(action.proposal.payload);
      const paid = integer(actionPayload.paidPaise);
      const amount = integer(actionPayload.amountPaise);
      return { status: 'executed', result: { negotiationState: 'accepted', recoveredPaise: paid }, entityUpdates: [{ table: 'invoices', id: action.entity_id, set: { negotiation_state: 'accepted' }, expect: { negotiation_state: String(row.negotiation_state ?? 'offer_sent'), negotiation_round: integer(row.negotiation_round) } }], ledger: [{ account: 'discount_granted', debitPaise: Math.max(0, amount - paid), refType: 'action', refId: action.id, memo: 'bounded invoice negotiation discount' }, { account: 'recovered_revenue', creditPaise: paid, refType: 'action', refId: `${action.id}:recovered`, memo: 'invoice payment accepted' }] };
    }
    if (action.kind === 'ESCALATE_HUMAN') {
      const actionPayload = record(action.proposal.payload);
      const rejected = actionPayload.override === 'floor';
      return { status: 'executed', result: { negotiationState: rejected ? 'rejected' : 'escalated', humanOverrideRequired: true }, entityUpdates: [{ table: 'invoices', id: action.entity_id, set: { negotiation_state: rejected ? 'rejected' : 'escalated' }, expect: { negotiation_state: String(row.negotiation_state ?? 'countered'), negotiation_round: integer(row.negotiation_round) } }] };
    }
    const payload = record(action.proposal.payload);
    const whatsapp = payload.whatsapp as Record<string, unknown>;
    const offerPaise = integer(payload.offerPaise);
    const round = integer(payload.round);
    return { status: 'executed', result: { negotiationState: 'offer_sent', offerPaise, round }, outbound: { channel: 'whatsapp', recipientMasked: typeof whatsapp.to === 'string' ? whatsapp.to : '', locale: ctx.entity.customer?.locale ?? 'en-IN', template: 'b2b_negotiation_text', payload: whatsapp, status: 'simulated_sent' }, entityUpdates: [{ table: 'invoices', id: action.entity_id, set: { negotiation_state: 'offer_sent', negotiation_round: round, current_offer_paise: offerPaise }, expect: { negotiation_state: String(row.negotiation_state ?? 'none'), negotiation_round: integer(row.negotiation_round) } }] };
  }
}

function isLlm(value: B2BNegotiatorOptions | LlmClient): value is LlmClient { return typeof (value as LlmClient).completeJson === 'function'; }
function record(value: unknown): Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : {}; }
function mask(value: string): string { const trimmed = value.trim(); return trimmed.length > 4 ? `${trimmed.slice(0, 3)}••••${trimmed.slice(-2)}` : '••••'; }
function maskEmail(value: string): string { const at = value.indexOf('@'); return at > 0 ? `${value[0] ?? ''}••••${value.slice(at)}` : '••••'; }

export const b2bNegotiator = new B2BNegotiator();
export const B2BNegotiatorModule = B2BNegotiator;
export default b2bNegotiator;

/** Expire an offer only when the row still contains the scheduled round. */
export const negotiationExpiryHandler: JobHandler = async (job, ctx) => {
  const invoiceId = job.payload.invoiceId;
  const round = integer(job.payload.round);
  if (typeof invoiceId !== 'string' || invoiceId.length === 0 || round < 1) throw new Error('negotiation_expiry payload must contain invoiceId and positive round');
  await ctx.db.query(
    `UPDATE invoices SET negotiation_state = 'expired', updated_at = now()
     WHERE id = $1 AND negotiation_state = 'offer_sent' AND negotiation_round = $2`,
    [invoiceId, round],
  );
};
