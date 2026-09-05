import type pg from 'pg';
import {
  assertSafePaise,
  SUBSCRIPTION_STATUSES,
  type RazorpayWebhook,
  type SubscriptionStatus,
  isStaleSubscriptionEvent,
} from '@aegis/shared';
import type { EntitySnapshot, ProjectionRow } from '../entity';
import {
  asContext,
  definedOr,
  eventDate,
  loadCustomer,
  nullableDate,
  projectCustomer,
  sameEvent,
  snapshot,
  sourceEventId,
  type ProjectionContext,
} from './shared';

interface SubscriptionRow extends ProjectionRow {
  readonly plan_id: string | null;
  readonly customer_id: string | null;
  readonly status: SubscriptionStatus;
  readonly amount_paise: number;
  readonly currency: string;
  readonly current_start: Date | null;
  readonly current_end: Date | null;
  readonly charge_at: Date | null;
  readonly total_count: number | null;
  readonly paid_count: number;
  readonly remaining_count: number | null;
  readonly salvage_state: string;
  readonly retry_count: number;
  readonly next_retry_at: Date | null;
  readonly last_event_id: string | null;
  readonly last_event_at: Date | null;
  readonly notes: Record<string, unknown>;
  readonly created_at: Date;
  readonly updated_at: Date;
}

function eventStatus(eventType: string): SubscriptionStatus | undefined {
  const suffix = eventType.split('.').at(-1);
  if (suffix === 'charged' || suffix === 'activated') return 'active';
  return suffix && SUBSCRIPTION_STATUSES.includes(suffix as SubscriptionStatus) ? (suffix as SubscriptionStatus) : undefined;
}

function eventEntityDate(value: number | null | undefined, current: Date | null | undefined): Date | null {
  return value === undefined ? current ?? null : nullableDate(value);
}

/**
 * Project a subscription with last-writer-wins event timestamps.
 * Intent: subscription states can oscillate, so rank-based guards would be incorrect; stale event timestamps are rejected.
 * Flow: lock row -> reject duplicate/older event -> upsert customer and subscription -> return the committed snapshot.
 */
export async function projectSubscription(
  tx: pg.PoolClient,
  payload: RazorpayWebhook,
  context?: ProjectionContext | string | null,
): Promise<EntitySnapshot> {
  const entity = payload.payload.subscription?.entity;
  if (!entity) throw new Error(`event ${payload.event} has no subscription entity`);
  const ctx = asContext(context);
  const incomingAt = eventDate(payload, ctx);
  const currentResult = await tx.query<SubscriptionRow>('SELECT * FROM subscriptions WHERE id = $1 FOR UPDATE', [entity.id]);
  const current = currentResult.rows[0];
  if (current && (sameEvent(current, ctx) || isStaleSubscriptionEvent(current.last_event_at, incomingAt))) {
    return snapshot('subscription', current, await loadCustomer(tx, current.customer_id), false);
  }

  const customer = await projectCustomer(tx, entity);
  const customerId = definedOr(entity.customer_id, current?.customer_id, null);
  const status = definedOr(entity.status ?? eventStatus(payload.event), current?.status, 'created');
  const amount = assertSafePaise(definedOr(entity.amount, current?.amount_paise, 0), 'subscription.amount_paise');
  const currency = definedOr(entity.currency, current?.currency, 'INR');
  const sourceId = sourceEventId(ctx, current?.last_event_id);
  const result = await tx.query<SubscriptionRow>(
    `INSERT INTO subscriptions
       (id, plan_id, customer_id, status, amount_paise, currency, current_start, current_end, charge_at,
        total_count, paid_count, remaining_count, salvage_state, retry_count, next_retry_at,
        last_event_id, last_event_at, notes, version)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18::jsonb, 1)
     ON CONFLICT (id) DO UPDATE SET
       plan_id = EXCLUDED.plan_id,
       customer_id = EXCLUDED.customer_id,
       status = EXCLUDED.status,
       amount_paise = EXCLUDED.amount_paise,
       currency = EXCLUDED.currency,
       current_start = EXCLUDED.current_start,
       current_end = EXCLUDED.current_end,
       charge_at = EXCLUDED.charge_at,
       total_count = EXCLUDED.total_count,
       paid_count = EXCLUDED.paid_count,
       remaining_count = EXCLUDED.remaining_count,
       salvage_state = EXCLUDED.salvage_state,
       retry_count = EXCLUDED.retry_count,
       next_retry_at = EXCLUDED.next_retry_at,
       last_event_id = EXCLUDED.last_event_id,
       last_event_at = EXCLUDED.last_event_at,
       notes = EXCLUDED.notes,
       version = subscriptions.version + 1,
       updated_at = now()
     WHERE subscriptions.last_event_id IS DISTINCT FROM EXCLUDED.last_event_id
       AND (subscriptions.last_event_at IS NULL OR EXCLUDED.last_event_at >= subscriptions.last_event_at)
     RETURNING *`,
    [
      entity.id,
      definedOr(entity.plan_id, current?.plan_id, null),
      customerId,
      status,
      amount,
      currency,
      eventEntityDate(entity.current_start, current?.current_start),
      eventEntityDate(entity.current_end, current?.current_end),
      eventEntityDate(entity.charge_at, current?.charge_at),
      definedOr(entity.total_count, current?.total_count, null),
      definedOr(entity.paid_count, current?.paid_count, 0),
      definedOr(entity.remaining_count, current?.remaining_count, null),
      current?.salvage_state ?? 'none',
      current?.retry_count ?? 0,
      current?.next_retry_at ?? null,
      sourceId,
      incomingAt,
      JSON.stringify(definedOr(entity.notes, current?.notes, {})),
    ],
  );
  // Intent: concurrent first sightings cannot both pass an absent-row read; PostgreSQL re-checks timestamp/event guards.
  // Flow: stale conflict is rejected -> lock and return the winner's row as unapplied.
  const row = result.rows[0] ?? (await tx.query<SubscriptionRow>('SELECT * FROM subscriptions WHERE id = $1 FOR UPDATE', [entity.id])).rows[0];
  if (!row) throw new Error(`subscription projection returned no row for ${entity.id}`);
  const applied = result.rows.length === 1;
  return snapshot('subscription', row, customer ?? await loadCustomer(tx, row.customer_id), applied);
}

export const applySubscriptionProjection = projectSubscription;
