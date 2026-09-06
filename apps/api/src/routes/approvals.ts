import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import type pg from 'pg';
import type { EventBus } from '../bus/event-bus';
import type { EventOrchestrator } from '../orchestrator/EventOrchestrator';
import { getAction } from '../db/repos/actions';
import { insertAuditLog } from '../db/repos/audit';
import { getEvidencePacket, updateEvidenceReview } from '../db/repos/evidence';
import { SANDBOX_SECRET_LIKE } from '../db/repos/sandbox';
import { withTransaction } from '../db/tx';

const IdParams = z.object({ id: z.string().uuid() });
const DisputeParams = z.object({ disputeId: z.string().min(1).max(200) });
const DecisionSchema = z.object({
  decision: z.enum(['approve', 'reject']),
  note: z.string().min(3).max(2_000),
  actor: z.string().min(1).max(200),
});
const ListQuery = z.object({ status: z.string().min(1).max(80).optional(), module: z.string().min(1).max(120).optional(), limit: z.coerce.number().int().min(1).max(100).default(50), before: z.string().datetime().optional() });
const EventQuery = z.object({ type: z.string().min(1).max(120).optional(), status: z.string().min(1).max(80).optional(), limit: z.coerce.number().int().min(1).max(100).default(50), before: z.string().datetime().optional() });
const EntityQuery = z.object({ limit: z.coerce.number().int().min(1).max(100).default(50), before: z.string().datetime().optional() });
const GuardrailBody = z.object({ value: z.unknown(), actor: z.string().min(1).max(200) });

const GUARDRAIL_VALUES: Record<string, z.ZodType> = {
  kill_switch: z.boolean(),
  auto_approve_limit_paise: z.number().int().nonnegative().safe(),
  max_discount_pct: z.number().finite().min(0).max(100),
  max_negotiation_rounds: z.number().int().nonnegative().safe(),
  max_dunning_retries: z.number().int().nonnegative().safe(),
  dunning_schedule_hours: z.array(z.number().int().nonnegative().safe()),
  message_cooldown_hours: z.number().int().nonnegative().safe(),
  quiet_hours_local: z.object({ start: z.number().int().min(0).max(23), end: z.number().int().min(0).max(23) }),
  daily_discount_budget_paise: z.number().int().nonnegative().safe(),
  attribution_window_hours: z.number().int().min(1).max(8_760),
  x402_max_amount_paise: z.number().int().nonnegative().safe(),
  x402_daily_cap_per_payer_paise: z.number().int().nonnegative().safe(),
};

/**
 * Pagination cursor for `before=`.
 * Intent: node-postgres returns timestamptz as `Date`; `String(date)` yields "Sat Sep 05 2026 …", which the list
 *         routes' own `z.string().datetime()` validator rejects, so the second page could never be fetched (B-012).
 * Flow: last row's timestamp -> ISO 8601 string the same route accepts -> null when the page was not full.
 */
function cursorOf(value: unknown): string | null {
  if (value instanceof Date) return value.toISOString();
  return typeof value === 'string' && value.length > 0 ? value : null;
}

export interface ApprovalRouteOptions { readonly db: pg.Pool; readonly orchestrator: EventOrchestrator; readonly bus?: EventBus }

/**
 * Human control-plane routes for action and evidence review.
 * Intent: the database is the source of truth for every decision; route validation never trusts a client-provided
 * status or action result.
 * Flow: parse request -> lock/transition the pending row -> audit -> reconstruct context -> reuse executeAction.
 */
export const approvalRoutes: FastifyPluginAsync<ApprovalRouteOptions> = async (app, options) => {
  app.get('/api/v1/approvals', async () => {
    const [actions, evidence] = await Promise.all([
      options.db.query(`SELECT id, idempotency_key, module, module_version, entity_type, entity_id, customer_id, kind, summary, proposal, bounds, money_impact_paise, expected_recovery_paise, requires_approval, status, reason, decided_by, decided_at, executed_at, result, created_at, updated_at FROM actions WHERE status = 'pending_approval' ORDER BY created_at ASC, id ASC`),
      options.db.query(`SELECT id, dispute_id, packet, narrative, review_status, reviewed_by, reviewed_at, review_note, submitted_at, created_at FROM evidence_packets WHERE review_status = 'requires_human_review' ORDER BY created_at ASC, id ASC`),
    ]);
    return { actions: actions.rows, evidence: evidence.rows };
  });

  app.post('/api/v1/actions/:id/decision', async (request, reply) => {
    const params = IdParams.parse(request.params);
    const body = DecisionSchema.parse(request.body ?? {});
    const decided = await options.orchestrator.decideAction(params.id, body.decision, body.actor, body.note);
    if (!decided) return reply.code(409).send({ error: 'action_not_pending' });
    const action = await getAction(options.db, params.id);
    return { action: action ?? decided };
  });

  app.get('/api/v1/actions', async (request) => {
    const query = ListQuery.parse(request.query ?? {});
    const values: unknown[] = [];
    const predicates: string[] = [];
    if (query.status) { values.push(query.status); predicates.push(`a.status = $${values.length}`); }
    if (query.module) { values.push(query.module); predicates.push(`a.module = $${values.length}`); }
    if (query.before) { values.push(query.before); predicates.push(`a.created_at < $${values.length}`); }
    values.push(query.limit);
    // Intent: the audit table shows whether an action's diagnosis came from the model or the rule-based fallback
    //         without one detail request per row; the join is read-only and additive to the row shape.
    const result = await options.db.query(
      `SELECT a.id, a.idempotency_key, a.module, a.module_version, a.trigger_event_id, a.diagnosis_id, a.entity_type, a.entity_id, a.customer_id, a.kind, a.summary, a.proposal, a.bounds, a.money_impact_paise, a.expected_recovery_paise, a.requires_approval, a.status, a.reason, a.decided_by, a.decided_at, a.executed_at, a.result, a.created_at, a.updated_at,
              d.degraded AS diagnosis_degraded, d.provider AS diagnosis_provider
       FROM actions a LEFT JOIN diagnoses d ON d.id = a.diagnosis_id
       ${predicates.length > 0 ? `WHERE ${predicates.join(' AND ')}` : ''} ORDER BY a.created_at DESC, a.id DESC LIMIT $${values.length}`,
      values,
    );
    return { items: result.rows, next: result.rows.length === query.limit ? cursorOf(result.rows.at(-1)?.created_at) : null };
  });

  app.get('/api/v1/actions/:id', async (request, reply) => {
    const { id } = IdParams.parse(request.params);
    const action = await getAction(options.db, id);
    if (!action) return reply.code(404).send({ error: 'not_found' });
    const [diagnosis, outbound, ledger, audit] = await Promise.all([
      action.diagnosis_id ? options.db.query(`SELECT * FROM diagnoses WHERE id = $1`, [action.diagnosis_id]) : Promise.resolve({ rows: [] as Record<string, unknown>[] }),
      options.db.query(`SELECT * FROM outbound_messages WHERE action_id = $1 ORDER BY created_at ASC, id ASC`, [id]),
      options.db.query(`SELECT * FROM ledger_entries WHERE ref_type = 'action' AND ref_id = $1 ORDER BY created_at ASC, id ASC`, [id]),
      options.db.query(`SELECT * FROM audit_log WHERE entity_type = $1 AND entity_id = $2 ORDER BY created_at ASC, id ASC`, ['action', id]),
    ]);
    return { action, diagnosis: diagnosis.rows[0] ?? null, outbound_messages: outbound.rows, ledger_entries: ledger.rows, audit: audit.rows };
  });

  app.get('/api/v1/events', async (request) => {
    const query = EventQuery.parse(request.query ?? {});
    const values: unknown[] = [];
    const predicates: string[] = [];
    if (query.type) { values.push(query.type); predicates.push(`event_type = $${values.length}`); }
    if (query.status) { values.push(query.status); predicates.push(`status = $${values.length}`); }
    if (query.before) { values.push(query.before); predicates.push(`received_at < $${values.length}`); }
    values.push(query.limit);
    const result = await options.db.query(`SELECT event_id, event_type, status, signature_valid, rzp_created_at, received_at, duplicate_count, processed_at, last_error FROM webhook_events ${predicates.length > 0 ? `WHERE ${predicates.join(' AND ')}` : ''} ORDER BY received_at DESC, event_id DESC LIMIT $${values.length}`, values);
    return { items: result.rows, next: result.rows.length === query.limit ? cursorOf(result.rows.at(-1)?.received_at) : null };
  });

  app.get('/api/v1/events/:eventId', async (request, reply) => {
    const eventId = z.string().min(1).max(255).parse((request.params as { eventId?: string }).eventId);
    const eventResult = await options.db.query(`SELECT * FROM webhook_events WHERE event_id = $1`, [eventId]);
    const event = eventResult.rows[0];
    if (!event) return reply.code(404).send({ error: 'not_found' });
    const [diagnoses, actions] = await Promise.all([
      options.db.query(`SELECT * FROM diagnoses WHERE event_id = $1 ORDER BY created_at ASC, id ASC`, [eventId]),
      options.db.query(`SELECT * FROM actions WHERE trigger_event_id = $1 ORDER BY created_at ASC, id ASC`, [eventId]),
    ]);
    return { ...event, diagnoses: diagnoses.rows, actions: actions.rows };
  });

  app.get('/api/v1/evidence/:disputeId', async (request, reply) => {
    const { disputeId } = DisputeParams.parse(request.params);
    const packet = await getEvidencePacket(options.db, disputeId);
    if (!packet) return reply.code(404).send({ error: 'not_found' });
    return packet;
  });

  app.post('/api/v1/evidence/:disputeId/decision', async (request, reply) => {
    const { disputeId } = DisputeParams.parse(request.params);
    const body = DecisionSchema.parse(request.body ?? {});
    const actionResult = await options.db.query<{ id: string; status: string }>(`SELECT id, status FROM actions WHERE entity_type = 'dispute' AND entity_id = $1 AND kind = 'evidence_packet' ORDER BY created_at DESC, id DESC LIMIT 1`, [disputeId]);
    const action = actionResult.rows[0];
    if (!action) return reply.code(404).send({ error: 'evidence_action_not_found' });
    const reviewed = await withTransaction(options.db, async (tx) => {
      const current = await tx.query(`SELECT * FROM evidence_packets WHERE dispute_id = $1 FOR UPDATE`, [disputeId]);
      if (!current.rows[0] || current.rows[0].review_status !== 'requires_human_review') return null;
      const status = body.decision === 'approve' ? 'approved' : 'rejected';
      const updated = await updateEvidenceReview(tx, disputeId, status, body.actor, body.note);
      if (!updated) return null;
      await insertAuditLog(tx, { actor: body.actor, action: `evidence.${status}`, entityType: 'evidence_packet', entityId: disputeId, before: current.rows[0], after: updated, metadata: { note: body.note } });
      return updated;
    });
    if (!reviewed) return reply.code(409).send({ error: 'evidence_not_pending' });
    const decided = await options.orchestrator.decideAction(action.id, body.decision, body.actor, body.note);
    if (!decided) return reply.code(409).send({ error: 'action_not_pending' });
    return { evidence: reviewed, action: (await getAction(options.db, action.id)) ?? decided };
  });

  for (const [path, table] of [['/api/v1/subscriptions', 'subscriptions'], ['/api/v1/invoices', 'invoices'], ['/api/v1/disputes', 'disputes'] as const]) {
    app.get(path, async (request) => {
      const query = EntityQuery.parse(request.query ?? {});
      const values: unknown[] = [query.limit];
      const predicate = query.before ? 'WHERE created_at < $2' : '';
      if (query.before) values.push(query.before);
      const result = await options.db.query(`SELECT * FROM ${table} ${predicate} ORDER BY created_at DESC, id DESC LIMIT $1`, values);
      return { items: result.rows, next: result.rows.length === query.limit ? cursorOf(result.rows.at(-1)?.created_at) : null };
    });
  }

  app.get('/api/v1/guardrails', async () => {
    // Intent: this route feeds the settings form, and `guardrail_config` also holds the Sandbox / BYOK webhook secrets
    //         (T25). Those are credentials, not bounds: they are filtered out here so no secret is ever rendered in the
    //         dashboard or returned to a browser (C-D3). 0005 hides them from the read-only role at the database level.
    const result = await options.db.query(
      `SELECT key, value, description, updated_by, updated_at FROM guardrail_config WHERE key NOT LIKE $1 ORDER BY key`,
      [SANDBOX_SECRET_LIKE],
    );
    return { items: result.rows };
  });

  /** Audit trail of guardrail edits for the settings page; `audit_log` is append-only, so this is the whole history. */
  app.get('/api/v1/guardrails/history', async (request) => {
    const query = EntityQuery.parse(request.query ?? {});
    const values: unknown[] = [query.limit];
    const predicate = query.before ? 'AND created_at < $2' : '';
    if (query.before) values.push(query.before);
    const result = await options.db.query(
      `SELECT id, actor, action, entity_type, entity_id, before, after, metadata, created_at
       FROM audit_log WHERE entity_type = 'guardrail' ${predicate} ORDER BY created_at DESC, id DESC LIMIT $1`,
      values,
    );
    return { items: result.rows, next: result.rows.length === query.limit ? cursorOf(result.rows.at(-1)?.created_at) : null };
  });

  app.put('/api/v1/guardrails/:key', async (request, reply) => {
    const key = z.string().refine((value) => Object.prototype.hasOwnProperty.call(GUARDRAIL_VALUES, value), 'unknown guardrail').parse((request.params as { key?: string }).key);
    const body = GuardrailBody.parse(request.body ?? {});
    const value = GUARDRAIL_VALUES[key]?.parse(body.value);
    const updated = await withTransaction(options.db, async (tx) => {
      const before = await tx.query(`SELECT * FROM guardrail_config WHERE key = $1 FOR UPDATE`, [key]);
      if (!before.rows[0]) return null;
      const result = await tx.query(`UPDATE guardrail_config SET value = $2::jsonb, updated_by = $3, updated_at = now() WHERE key = $1 RETURNING key, value, description, updated_by, updated_at`, [key, JSON.stringify(value), body.actor]);
      const row = result.rows[0];
      await insertAuditLog(tx, { actor: body.actor, action: 'guardrail.updated', entityType: 'guardrail', entityId: key, before: before.rows[0], after: row, metadata: {} });
      return row;
    });
    if (!updated) return reply.code(404).send({ error: 'guardrail_not_found' });
    if (key === 'kill_switch') options.bus?.publish('system.kill_switch', { enabled: value });
    return { guardrail: updated };
  });
};

export default approvalRoutes;
