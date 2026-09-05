import type pg from 'pg';
import { LlmUnavailableError, type LlmClient } from '../../llm/client';
import { maskPii } from '../../llm/mask';
import { draftEvidenceNarrativePrompt, EvidenceNarrativeSchema } from '../../llm/prompts/draft-evidence-narrative';
import { getEvidencePacket, insertEvidencePacket, markEvidenceSubmitted } from '../../db/repos/evidence';
import { StubLlmClient } from '../../llm/stub';
import type { ActionModule, ActionProposal, ActionRow, EventContext, ExecutionDeps, ExecutionResult } from '../../orchestrator/types';
import { assemble } from './assemble';
import type { EvidencePacket } from './packet-schema';

function integer(value: unknown): number {
  const parsed = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : Number.NaN;
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : 0;
}

function maskedNarrative(packet: EvidencePacket): string {
  const present = ['dispute', 'payment', 'order', 'customer', 'delivery', 'communications', 'refund_policy']
    .filter((section) => !packet.missing.includes(section));
  const missing = packet.missing.length > 0 ? ` Missing sections: ${packet.missing.join(', ')}.` : '';
  return `Dispute ${packet.dispute.id} has ${present.join(', ')} evidence available for human review.${missing}`;
}

export interface ChargebackEvidenceOptions { readonly db?: pg.Pool; readonly llm?: LlmClient }

export class ChargebackEvidence implements ActionModule {
  readonly name = 'chargeback_evidence';
  readonly version = 'v1';
  readonly handles = ['payment.dispute.created', 'payment.dispute.updated', 'dispute.created'] as const;
  private readonly db?: pg.Pool;
  private readonly llm: LlmClient;

  constructor(options: ChargebackEvidenceOptions | LlmClient = {}) {
    this.db = isLlm(options) ? undefined : options.db;
    this.llm = isLlm(options) ? options : options.llm ?? new StubLlmClient();
  }

  canHandle(ctx: EventContext): boolean {
    return ctx.entity.type === 'dispute' && ctx.event.event_type !== 'payment.dispute.closed' && ['open', 'under_review'].includes(String(ctx.entity.row.status ?? 'open'));
  }

  async propose(ctx: EventContext): Promise<ActionProposal | null> {
    if (!this.canHandle(ctx)) return null;
    if (!this.db) throw new Error('chargeback evidence module requires a database');
    const packet = await assemble(this.db, ctx.entity.row.id);
    let narrative = maskedNarrative(packet);
    let confidenceNote = packet.missing.length === 0 ? 'All requested source sections were present.' : `Unavailable sections: ${packet.missing.join(', ')}.`;
    let degraded = false;
    try {
      const response = await this.llm.completeJson({
        ...draftEvidenceNarrativePrompt,
        purpose: 'draft_evidence_narrative',
        user: draftEvidenceNarrativePrompt.buildUser(maskPii(packet)),
      });
      const draft = EvidenceNarrativeSchema.parse(response.data);
      narrative = draft.narrative;
      confidenceNote = draft.confidence_note;
    } catch (error) {
      if (!(error instanceof LlmUnavailableError)) throw error;
      degraded = true;
    }
    return {
      module: this.name,
      moduleVersion: this.version,
      idempotencyKey: `${this.name}:dispute:${ctx.entity.row.id}:1`,
      entityType: 'dispute',
      entityId: ctx.entity.row.id,
      ...(ctx.entity.customer?.id ? { customerId: ctx.entity.customer.id } : {}),
      kind: 'evidence_packet',
      summary: `Prepare chargeback evidence for dispute ${ctx.entity.row.id}`,
      moneyImpactPaise: 0,
      expectedRecoveryPaise: integer(ctx.entity.row.amount_paise),
      requiresApproval: true,
      payload: { packet, narrative, confidenceNote, degraded },
      explanation: ['Evidence is assembled deterministically from the dispute graph.', 'Submission always requires explicit human approval.'],
    };
  }

  guard(proposal: ActionProposal, ctx: EventContext) {
    const pass = proposal.requiresApproval && ctx.config.kill_switch === false;
    return {
      pass,
      rules: [
        { rule: 'requires_human_review', limit: true, actual: proposal.requiresApproval, pass: proposal.requiresApproval, note: 'Dispute evidence is never auto-submitted.' },
        { rule: 'kill_switch', limit: false, actual: ctx.config.kill_switch, pass: ctx.config.kill_switch === false, note: 'The merchant kill switch blocks new actions.' },
      ],
      ...(pass ? {} : { blockedReason: proposal.requiresApproval ? 'kill_switch' : 'requires_human_review' }),
    };
  }

  async execute(action: ActionRow, ctx: EventContext, deps: ExecutionDeps): Promise<ExecutionResult> {
    const packetRow = await getEvidencePacket(deps.db, action.entity_id);
    if (!packetRow || packetRow.review_status !== 'approved') throw new Error('evidence_requires_approval');
    const submitted = await markEvidenceSubmitted(deps.db, action.entity_id);
    if (!submitted) throw new Error('evidence_requires_approval');
    return {
      status: 'executed',
      result: { reviewStatus: 'submitted', simulated: true, note: 'Real submission would call Razorpay dispute API.' },
      entityUpdates: [{ table: 'disputes', id: action.entity_id, set: { status: 'under_review' }, expect: { status: String(ctx.entity.row.status ?? 'open') } }],
      ledger: [{ account: 'chargeback_exposure', creditPaise: integer(ctx.entity.row.amount_paise), refType: 'action', refId: action.id, memo: 'chargeback exposure covered by reviewed evidence' }],
    };
  }

  async onProposed(action: ActionRow, _ctx: EventContext, db: pg.Pool): Promise<void> {
    const payload = action.proposal.payload;
    if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) throw new TypeError('evidence action payload must be an object');
    const value = payload as Record<string, unknown>;
    const packet = value.packet as EvidencePacket;
    const narrative = typeof value.narrative === 'string' ? value.narrative : maskedNarrative(packet);
    await insertEvidencePacket(db, { disputeId: action.entity_id, packet, narrative });
  }
}

function isLlm(value: ChargebackEvidenceOptions | LlmClient): value is LlmClient { return typeof (value as LlmClient).completeJson === 'function'; }

export const chargebackEvidence = new ChargebackEvidence();
export const ChargebackEvidenceModule = ChargebackEvidence;
export default chargebackEvidence;
