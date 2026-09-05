import type pg from 'pg';
import { WhatsAppTemplateMessageSchema } from '@aegis/shared';
import { cancelJobsByDedupePrefix } from '../../db/repos/jobs';
import { maskContact } from '../../llm/mask';
import type { ActionModule, ActionProposal, ActionRow, EventContext, ExecutionDeps, ExecutionResult } from '../../orchestrator/types';
import { guardRecovery, guardSubscriptionSalvage, transitionEvent } from './rules';
import { nextSalvageState, type SalvageState } from './state';
import { retryTemplate } from './templates';
import type { JobHandler } from '../../worker/registry';

function integer(value: unknown, fallback = 0): number {
  const parsed = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : Number.NaN;
  return Number.isSafeInteger(parsed) ? parsed : fallback;
}

function currentState(ctx: EventContext): SalvageState {
  return (typeof ctx.entity.row.salvage_state === 'string' ? ctx.entity.row.salvage_state : 'none') as SalvageState;
}

function customerContact(ctx: EventContext): string | null {
  const contact = ctx.entity.customer?.contact;
  return typeof contact === 'string' && contact.trim().length > 0 ? contact : null;
}

export class SubscriptionSalvager implements ActionModule {
  readonly name = 'subscription_salvager';
  readonly version = 'v1';
  readonly handles = ['subscription.pending', 'subscription.halted', 'subscription.charged', 'subscription.activated'] as const;

  canHandle(ctx: EventContext): boolean {
    if (ctx.entity.type !== 'subscription') return false;
    if (ctx.event.event_type === 'subscription.charged' || ctx.event.event_type === 'subscription.activated') {
      return currentState(ctx) !== 'recovered' && currentState(ctx) !== 'escalated';
    }
    if (ctx.event.event_type !== 'subscription.pending' && ctx.event.event_type !== 'subscription.halted') return false;
    // A synthetic retry is allowed only while the retry transaction left the row in `retrying`; re-running an already
    // scheduled step is a no-op and therefore cannot create a second message.
    return currentState(ctx) === 'none' || currentState(ctx) === 'retrying';
  }

  async propose(ctx: EventContext): Promise<ActionProposal | null> {
    if (!this.canHandle(ctx)) return null;
    const row = ctx.entity.row;
    const amountPaise = integer(row.amount_paise);
    const customerId = ctx.entity.customer?.id;
    if (ctx.event.event_type === 'subscription.charged' || ctx.event.event_type === 'subscription.activated') {
      return {
        module: this.name,
        moduleVersion: this.version,
        idempotencyKey: `${this.name}:subscription:${row.id}:recovered`,
        entityType: 'subscription',
        entityId: row.id,
        ...(customerId ? { customerId } : {}),
        kind: 'salvage_recovered',
        summary: `Record recovered subscription revenue of ${amountPaise} paise`,
        moneyImpactPaise: 0,
        expectedRecoveryPaise: amountPaise,
        requiresApproval: false,
        payload: { subscriptionId: row.id, amountPaise },
        explanation: ['A charged or activated subscription recovered a previously failing dunning journey.'],
      };
    }
    const contact = customerContact(ctx);
    if (!contact) return null;
    const step = integer(row.retry_count) + 1;
    const offsetHours = ctx.config.dunning_schedule_hours[step - 1] ?? ctx.config.dunning_schedule_hours.at(-1) ?? 0;
    const runAt = new Date(ctx.now.getTime() + offsetHours * 3_600_000);
    const payload = retryTemplate(contact, ctx.entity.customer?.locale ?? 'en-IN', amountPaise, step);
    return {
      module: this.name,
      moduleVersion: this.version,
      idempotencyKey: `${this.name}:subscription:${row.id}:${step}`,
      entityType: 'subscription',
      entityId: row.id,
      ...(customerId ? { customerId } : {}),
      kind: 'dunning_retry',
      summary: `Schedule subscription retry ${step} for ${amountPaise} paise`,
      moneyImpactPaise: 0,
      expectedRecoveryPaise: amountPaise,
      requiresApproval: false,
      payload,
      explanation: [`Deterministic dunning step ${step} for subscription ${row.id}.`, `Retry is scheduled at ${runAt.toISOString()}.`],
      scheduleFollowUp: { kind: 'dunning_retry', runAt, payload: { subscriptionId: row.id, step }, dedupeKey: `dunning_retry:${row.id}:${step}` },
    };
  }

  guard(proposal: ActionProposal, ctx: EventContext) {
    return proposal.kind === 'salvage_recovered' ? guardRecovery(proposal, ctx) : guardSubscriptionSalvage(proposal, ctx);
  }

  async execute(action: ActionRow, ctx: EventContext, deps: ExecutionDeps): Promise<ExecutionResult> {
    if (action.kind === 'salvage_recovered') {
      const amount = integer(ctx.entity.row.amount_paise);
      await cancelJobsByDedupePrefix(deps.db, `dunning_retry:${action.entity_id}:`);
      return {
        status: 'executed',
        result: { salvageState: 'recovered', recoveredPaise: amount },
        entityUpdates: [{ table: 'subscriptions', id: action.entity_id, set: { salvage_state: 'recovered', next_retry_at: null }, expect: { salvage_state: currentState(ctx), retry_count: integer(ctx.entity.row.retry_count) } }],
        ledger: [{ account: 'recovered_revenue', creditPaise: amount, refType: 'action', refId: action.id, memo: `subscription ${action.entity_id} recovered` }],
      };
    }
    const proposal = action.proposal;
    const followUp = typeof proposal.scheduleFollowUp === 'object' && proposal.scheduleFollowUp !== null ? proposal.scheduleFollowUp as Record<string, unknown> : null;
    const rawRunAt = followUp?.runAt;
    const nextRetryAt = rawRunAt instanceof Date ? rawRunAt.toISOString() : typeof rawRunAt === 'string' ? rawRunAt : null;
    const step = integer((proposal.payload as Record<string, unknown>).template ? integer(ctx.entity.row.retry_count) + 1 : integer(ctx.entity.row.retry_count) + 1);
    const next = nextSalvageState(currentState(ctx), transitionEvent(ctx), integer(ctx.entity.row.retry_count), ctx.config.max_dunning_retries);
    if (next === null) return { status: 'failed', result: {}, error: 'invalid_salvage_transition' };
    const outboundPayload = WhatsAppTemplateMessageSchema.parse(proposal.payload);
    return {
      status: 'executed',
      result: { salvageState: next, retryCount: step },
      outbound: { channel: 'whatsapp', recipientMasked: maskContact(outboundPayload.to), locale: ctx.entity.customer?.locale ?? 'en-IN', template: outboundPayload.template.name, payload: outboundPayload, status: 'simulated_sent' },
      entityUpdates: [{ table: 'subscriptions', id: action.entity_id, set: { salvage_state: next, retry_count: step, next_retry_at: nextRetryAt }, expect: { salvage_state: currentState(ctx), retry_count: integer(ctx.entity.row.retry_count) } }],
    };
  }
}

export const subscriptionSalvager = new SubscriptionSalvager();
export const SubscriptionSalvagerModule = SubscriptionSalvager;
export default subscriptionSalvager;

/** Deterministic retry worker helper used by the production registry and focused tests. */
export async function runDunningRetry(
  db: pg.Pool,
  subscriptionId: string,
  step: number,
  orchestrator?: { handleSynthetic(input: { kind: 'dunning_step'; subscriptionId: string }): Promise<unknown> },
): Promise<'recovered' | 'failed' | 'churned' | 'ignored'> {
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const result = await client.query<{ salvage_state: SalvageState; retry_count: number; max_retries?: number; amount_paise: number; notes: Record<string, unknown> }>(
      'SELECT salvage_state, retry_count, amount_paise, notes FROM subscriptions WHERE id = $1 FOR UPDATE', [subscriptionId],
    );
    const row = result.rows[0];
    if (!row || row.salvage_state !== 'retry_scheduled' || row.retry_count !== step) { await client.query('COMMIT'); return 'ignored'; }
    await client.query(`UPDATE subscriptions SET salvage_state = 'retrying', updated_at = now() WHERE id = $1`, [subscriptionId]);
    const notes = row.notes ?? {};
    const outcomes = typeof notes.sim_retry_outcomes === 'object' && notes.sim_retry_outcomes !== null ? notes.sim_retry_outcomes as Record<string, unknown> : {};
    const outcome = outcomes[String(step)] === 'succeeded' || outcomes[String(step)] === 'success' ? 'succeeded' : 'failed';
    if (outcome === 'succeeded') {
      await client.query(`UPDATE subscriptions SET salvage_state = 'recovered', next_retry_at = NULL, updated_at = now() WHERE id = $1 AND salvage_state = 'retrying'`, [subscriptionId]);
      await client.query(`UPDATE jobs SET status = 'cancelled', updated_at = now() WHERE status = 'queued' AND dedupe_key LIKE $1`, [`dunning_retry:${subscriptionId}:%`]);
      await client.query(
        `INSERT INTO ledger_entries (account, credit_paise, ref_type, ref_id, memo) VALUES ('recovered_revenue', $2, 'subscription', $1, 'subscription retry recovered')`,
        [subscriptionId, row.amount_paise],
      );
      await client.query('COMMIT');
      return 'recovered';
    }
    const maxRetries = await maxDunningRetries(db);
    if (row.retry_count >= maxRetries) {
      await client.query(`UPDATE subscriptions SET salvage_state = 'churned', next_retry_at = NULL, updated_at = now() WHERE id = $1 AND salvage_state = 'retrying'`, [subscriptionId]);
      await client.query('COMMIT');
      return 'churned';
    }
    await client.query('COMMIT');
    if (orchestrator) await orchestrator.handleSynthetic({ kind: 'dunning_step', subscriptionId });
    return 'failed';
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch { /* preserve original error */ }
    throw error;
  } finally { client.release(); }
}

export const dunningRetryHandler: JobHandler = async (job, ctx) => {
  const subscriptionId = job.payload.subscriptionId;
  const step = integer(job.payload.step);
  if (typeof subscriptionId !== 'string' || subscriptionId.length === 0 || step < 1) throw new Error('dunning_retry payload must contain subscriptionId and positive step');
  const handleSynthetic = ctx.orchestrator?.handleSynthetic;
  await runDunningRetry(
    ctx.db,
    subscriptionId,
    step,
    handleSynthetic && ctx.orchestrator
      ? { handleSynthetic: handleSynthetic.bind(ctx.orchestrator) }
      : undefined,
  );
};

async function maxDunningRetries(db: pg.Pool): Promise<number> {
  const result = await db.query<{ value: unknown }>(`SELECT value FROM guardrail_config WHERE key = 'max_dunning_retries'`);
  const value = result.rows[0]?.value;
  return integer(value, 3);
}
