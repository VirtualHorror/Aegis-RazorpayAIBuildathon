import { RazorpayWebhookSchema } from '@aegis/shared';
import type pg from 'pg';
import { countPriorFailures24h } from '../db/repos/diagnoses';
import { getAction, getActionByIdempotencyKey, insertAction, listApprovedActionsForEvent } from '../db/repos/actions';
import { insertAuditLog } from '../db/repos/audit';
import { loadGuardrailConfig } from '../db/repos/guardrails';
import { withTransaction } from '../db/tx';
import { createDiagnostician, type Diagnostician, type Diagnosis, type WebhookEventRow } from '../diagnosis/diagnostician';
import type { LlmClient } from '../llm/client';
import { createEventBus, type EventBus } from '../bus/event-bus';
import { orchestratorRules } from '../guardrails/rules';
import { applyProjection } from './projections';
import { routeFor, type EventRoute } from './routing';
import { executeAction } from './execute';
import type { ActionModule, ActionProposal, ActionRow, ActionStatus, EventContext, GuardRule, Logger } from './types';

const NOOP_LOGGER: Logger = Object.freeze({ info: () => undefined, warn: () => undefined, error: () => undefined, debug: () => undefined });

export interface EventOrchestratorOptions {
  readonly db: pg.Pool;
  readonly llm: LlmClient;
  readonly modules?: readonly ActionModule[];
  readonly bus?: EventBus;
  readonly logger?: Logger;
  readonly now?: Date | (() => Date);
  readonly diagnostician?: Pick<Diagnostician, 'diagnose'>;
}

export interface OrchestrationResult {
  readonly eventId: string;
  readonly status: 'processed' | 'ignored';
  readonly route?: EventRoute;
  readonly entity?: Awaited<ReturnType<typeof applyProjection>>;
  readonly diagnosis?: Diagnosis | null;
  readonly actions: readonly ActionRow[];
}

interface PersistedEvent extends WebhookEventRow {
  readonly event_id: string;
  readonly event_type: string;
  readonly payload: unknown;
  readonly signature_valid: boolean;
  readonly rzp_created_at: Date | null;
  readonly status: string;
}

/**
 * Route durable events through projection, diagnosis, bounded modules, and the action audit trail.
 * Intent: every branch is selected by the persisted event and deterministic rules; model calls happen only after the
 * projection transaction commits (C-A2/C-A6).
 * Flow: lock event and mark processing -> route/project in a short transaction -> diagnose outside locks -> propose and
 * guard -> persist one idempotent action -> execute approved work -> mark event processed and publish bus facts.
 */
export class EventOrchestrator {
  readonly db: pg.Pool;
  readonly llm: LlmClient;
  readonly modules: readonly ActionModule[];
  readonly bus: EventBus;
  readonly logger: Logger;
  private readonly clock: () => Date;
  private readonly diagnostician: Pick<Diagnostician, 'diagnose'>;

  constructor(options: EventOrchestratorOptions);
  constructor(db: pg.Pool, llm: LlmClient, modules?: readonly ActionModule[], bus?: EventBus, logger?: Logger);
  constructor(
    optionsOrDb: EventOrchestratorOptions | pg.Pool,
    llm?: LlmClient,
    modules: readonly ActionModule[] = [],
    bus?: EventBus,
    logger: Logger = NOOP_LOGGER,
  ) {
    if (isOptions(optionsOrDb)) {
      this.db = optionsOrDb.db;
      this.llm = optionsOrDb.llm;
      this.modules = optionsOrDb.modules ?? [];
      this.bus = optionsOrDb.bus ?? createEventBus();
      this.logger = optionsOrDb.logger ?? NOOP_LOGGER;
      const suppliedClock = optionsOrDb.now;
      this.clock = typeof suppliedClock === 'function' ? suppliedClock : () => suppliedClock ?? new Date();
      this.diagnostician = optionsOrDb.diagnostician ?? createDiagnostician({
        db: optionsOrDb.db,
        llm: optionsOrDb.llm,
        getPriorFailures24h: async (input) => countPriorFailuresForInput(optionsOrDb.db, input),
      });
      return;
    }
    if (!llm) throw new TypeError('EventOrchestrator requires an LlmClient');
    this.db = optionsOrDb;
    this.llm = llm;
    this.modules = modules;
    this.bus = bus ?? createEventBus();
    this.logger = logger;
    this.clock = () => new Date();
    this.diagnostician = createDiagnostician({
      db: optionsOrDb,
      llm,
      getPriorFailures24h: async (input) => countPriorFailuresForInput(optionsOrDb, input),
    });
  }

  async handle(eventId: string, workerId = 'unknown'): Promise<OrchestrationResult> {
    const event = await this.loadAndMarkProcessing(eventId);
    if (event.status === 'processed') return { eventId, status: 'processed', actions: [] };
    if (event.status === 'ignored' && event.signature_valid) return { eventId, status: 'ignored', actions: [] };
    if (!event.signature_valid) {
      this.bus.publish('event.rejected', { eventId, reason: 'invalid_signature' });
      return { eventId, status: 'ignored', actions: [] };
    }

    const route = routeFor(event.event_type);
    if (!route) {
      await this.markIgnored(event, workerId, 'unknown_event');
      return { eventId, status: 'ignored', actions: [] };
    }

    const payload = RazorpayWebhookSchema.parse(event.payload);
    const entity = await withTransaction(this.db, (tx) => applyProjection(tx, payload, {
      eventId: event.event_id,
      eventAt: event.rzp_created_at ?? null,
    }));

    const now = this.clock();
    let diagnosis: Diagnosis | null = null;
    if (route.diagnose) {
      const diagnosisInput = { event, payload, entity };
      const priorFailures24h = entity.applied
        ? await countPriorFailuresForInput(this.db, diagnosisInput, now)
        : undefined;
      diagnosis = await this.diagnostician.diagnose({
        event,
        payload,
        entity,
        ...(priorFailures24h === undefined ? {} : { priorFailures24h }),
      });
      if (diagnosis.provider !== 'skipped') this.bus.publish('diagnosis.created', { eventId, diagnosis });
    }

    // Intent: a stale or duplicate projection did not win reconciliation, so it must not create a fresh customer
    // action even when its deterministic skipped diagnosis happens to map to an eligible strategy.
    // Flow: preserve the diagnostic result for observability -> resume only already-approved crash leftovers -> mark
    // the durable event processed. No new proposal or guard evaluation is allowed for an unapplied projection.
    if (!entity.applied) {
      const recovered = await this.resumeApprovedActions(event, payload, entity, diagnosis, now);
      await this.markProcessed(event, workerId, recovered);
      return { eventId, status: 'processed', route, entity, diagnosis, actions: recovered };
    }

    const config = await loadGuardrailConfig(this.db);
    const ctx: EventContext = { event, payload, entity, diagnosis, config, now, logger: this.logger };
    const actions: ActionRow[] = [];
    for (const module of this.modules) {
      if (!module.handles.includes(event.event_type) || !module.canHandle(ctx)) continue;
      const proposal = await module.propose(ctx);
      if (proposal === null) {
        this.logger.info({ event_id: eventId, module: module.name }, 'action module proposed no action');
        continue;
      }
      const moduleGuard = module.guard(proposal, ctx);
      const globalRules = await orchestratorRules(this.db, proposal, ctx);
      const bounds = [...moduleGuard.rules, ...globalRules];
      const guardPass = moduleGuard.pass && globalRules.every((rule) => rule.pass);
      const failedRule = bounds.find((rule) => !rule.pass);
      const status = !guardPass
        ? 'blocked'
        : proposal.requiresApproval || -proposal.moneyImpactPaise > config.auto_approve_limit_paise
          ? 'pending_approval'
          : 'approved';
      const globalFailure = globalRules.find((rule) => !rule.pass);
      const reason = !guardPass ? globalFailure?.rule ?? moduleGuard.blockedReason ?? failedRule?.rule ?? 'guard_failed' : null;
      const action = await this.persistProposal(proposal, event.event_id, diagnosis, bounds, status, reason);
      if (!action) {
        this.logger.info({ event_id: eventId, idempotency_key: proposal.idempotencyKey }, 'duplicate action proposal skipped');
        const existing = await getActionByIdempotencyKey(this.db, proposal.idempotencyKey);
        if (existing?.status === 'approved') {
          await executeAction({ db: this.db, action: existing, module, ctx, bus: this.bus, llm: this.llm, logger: this.logger, now });
          const resumed = await getAction(this.db, existing.id);
          if (resumed) actions.push(resumed);
        }
        continue;
      }
      actions.push(action);
      this.bus.publish('action.proposed', { eventId, action });
      if (status === 'blocked') {
        this.bus.publish('action.blocked', { eventId, action, reason });
      } else if (status === 'pending_approval') {
        this.bus.publish('action.pending_approval', { eventId, action });
      } else {
        await executeAction({ db: this.db, action, module, ctx, bus: this.bus, llm: this.llm, logger: this.logger, now });
        const executed = await getAction(this.db, action.id);
        if (executed) actions[actions.length - 1] = executed;
      }
    }

    await this.markProcessed(event, workerId, actions);
    return { eventId, status: 'processed', route, entity, diagnosis, actions };
  }

  private async loadAndMarkProcessing(eventId: string): Promise<PersistedEvent> {
    return withTransaction(this.db, async (tx) => {
      const result = await tx.query<PersistedEvent>(
        `SELECT event_id, event_type, payload, signature_valid, rzp_created_at, status
         FROM webhook_events WHERE event_id = $1 FOR UPDATE`,
        [eventId],
      );
      const event = result.rows[0];
      if (!event) throw new Error(`webhook event ${eventId} not found`);
      if (event.status === 'processed' || event.status === 'ignored') return event;
      await tx.query(
        `UPDATE webhook_events SET status = CASE WHEN signature_valid THEN 'processing' ELSE 'ignored' END,
         processed_at = CASE WHEN signature_valid THEN NULL ELSE processed_at END, last_error = NULL WHERE event_id = $1`,
        [eventId],
      );
      return { ...event, status: event.signature_valid ? 'processing' : 'ignored' };
    });
  }

  private async persistProposal(
    proposal: ActionProposal,
    triggerEventId: string,
    diagnosis: Diagnosis | null,
    bounds: readonly GuardRule[],
    status: ActionStatus,
    reason: string | null,
  ): Promise<ActionRow | null> {
    const diagnosisId = diagnosis?.provider === 'skipped' ? null : diagnosis?.id ?? null;
    return withTransaction(this.db, async (tx) => {
      const action = await insertAction(tx, { proposal, triggerEventId, diagnosisId, bounds, status, reason });
      if (!action) return null;
      await insertAuditLog(tx, {
        actor: 'orchestrator',
        action: status === 'approved' ? 'action.approved' : `action.${status}`,
        entityType: action.entity_type,
        entityId: action.entity_id,
        after: action,
        metadata: { trigger_event_id: triggerEventId, idempotency_key: action.idempotency_key },
      });
      return action;
    });
  }

  private async resumeApprovedActions(
    event: PersistedEvent,
    payload: ReturnType<typeof RazorpayWebhookSchema.parse>,
    entity: Awaited<ReturnType<typeof applyProjection>>,
    diagnosis: Diagnosis | null,
    now: Date,
  ): Promise<ActionRow[]> {
    const approved = await listApprovedActionsForEvent(this.db, event.event_id);
    if (approved.length === 0) return [];
    const config = await loadGuardrailConfig(this.db);
    const ctx: EventContext = { event, payload, entity, diagnosis, config, now, logger: this.logger };
    const recovered: ActionRow[] = [];
    for (const action of approved) {
      const module = this.modules.find((candidate) => candidate.name === action.module);
      if (!module) throw new Error(`cannot recover approved action ${action.id}: module ${action.module} is unavailable`);
      await executeAction({ db: this.db, action, module, ctx, bus: this.bus, llm: this.llm, logger: this.logger, now });
      const executed = await getAction(this.db, action.id);
      if (executed) recovered.push(executed);
    }
    return recovered;
  }

  private async markIgnored(event: PersistedEvent, workerId: string, reason: string): Promise<void> {
    await withTransaction(this.db, async (tx) => {
      await tx.query(`UPDATE webhook_events SET status = 'ignored', processed_at = now(), last_error = $2 WHERE event_id = $1`, [event.event_id, reason]);
      await insertAuditLog(tx, { actor: `worker:${workerId}`, action: 'event.ignored', entityType: 'event', entityId: event.event_id, metadata: { reason } });
    });
    this.bus.publish('event.processed', { eventId: event.event_id, status: 'ignored', reason });
  }

  private async markProcessed(event: PersistedEvent, workerId: string, actions: readonly ActionRow[]): Promise<void> {
    await withTransaction(this.db, async (tx) => {
      await tx.query(`UPDATE webhook_events SET status = 'processed', processed_at = now(), last_error = NULL WHERE event_id = $1 AND signature_valid`, [event.event_id]);
      await insertAuditLog(tx, {
        actor: `worker:${workerId}`,
        action: 'event.processed',
        entityType: 'event',
        entityId: event.event_id,
        metadata: { action_ids: actions.map((action) => action.id) },
      });
    });
    this.bus.publish('event.processed', { eventId: event.event_id, status: 'processed', actionCount: actions.length });
  }
}

function isOptions(value: EventOrchestratorOptions | pg.Pool): value is EventOrchestratorOptions {
  return typeof value === 'object' && value !== null && 'db' in value && 'llm' in value;
}

async function countPriorFailuresForInput(
  db: pg.Pool,
  input: Parameters<Diagnostician['diagnose']>[0],
  now?: Date,
): Promise<number> {
  const customerId = input.entity.customer?.id ?? stringValue((input.entity.row as Record<string, unknown>).customer_id);
  const excludePaymentId = input.entity.type === 'payment' ? input.entity.row.id : undefined;
  return countPriorFailures24h(db, customerId, now ?? eventTimestamp(input.event.rzp_created_at, input.payload.created_at), excludePaymentId);
}

function eventTimestamp(eventAt: Date | null, payloadAt: unknown): Date {
  if (eventAt instanceof Date && !Number.isNaN(eventAt.getTime())) return eventAt;
  if (typeof payloadAt === 'number' && Number.isFinite(payloadAt)) return new Date(payloadAt < 100_000_000_000 ? payloadAt * 1_000 : payloadAt);
  if (typeof payloadAt === 'string' && payloadAt.trim().length > 0) {
    const numeric = Number(payloadAt);
    if (Number.isFinite(numeric)) return eventTimestamp(null, numeric);
    const parsed = new Date(payloadAt);
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }
  return new Date();
}

function stringValue(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

export default EventOrchestrator;
