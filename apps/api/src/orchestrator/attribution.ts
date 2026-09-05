import type pg from 'pg';
import { assertSafePaise } from '@aegis/shared';
import { withTransaction } from '../db/tx';
import { insertAuditLog } from '../db/repos/audit';
import { insertRecoveredRevenueForAction } from '../db/repos/ledger';
import type { EventBus } from '../bus/event-bus';
import type { EntitySnapshot } from './entity';

export interface AttributionInput {
  readonly eventType: 'payment.captured' | 'order.paid';
  readonly entity: EntitySnapshot;
  readonly capturedAt: Date;
  readonly attributionWindowHours: number;
}

export interface AttributionResult {
  readonly actionId: string;
  readonly amountPaise: number;
  readonly ledgerId: number;
}

/** Attribute one successful capture to the most recent eligible recovery action exactly once. */
export async function attributeRecovery(
  db: pg.Pool,
  input: AttributionInput,
  bus?: EventBus,
): Promise<AttributionResult | null> {
  if (!Number.isSafeInteger(input.attributionWindowHours) || input.attributionWindowHours < 1 || input.attributionWindowHours > 8_760) {
    throw new RangeError('attribution window must be 1..8760 hours');
  }
  if (!(input.capturedAt instanceof Date) || Number.isNaN(input.capturedAt.getTime())) throw new TypeError('capturedAt must be a valid Date');
  const amountPaise = readPaise(input.entity.row.amount_paise);
  if (amountPaise <= 0) return null;
  const orderId = stringValue(input.entity.row.order_id) ?? (input.entity.type === 'order' ? input.entity.row.id : null);
  const paymentId = input.entity.type === 'payment' ? input.entity.row.id : stringValue(input.entity.row.payment_id);
  const customerId = stringValue(input.entity.row.customer_id) ?? input.entity.customer?.id ?? null;

  const result = await withTransaction(db, async (tx) => {
    // Intent: choose by durable execution time and lock the action before changing its result. The action lock is the
    // first mutable-row lock in this path, so concurrent capture/order events follow actions -> entity (C-C3).
    // Flow: find a recent executed recovery -> lock it -> re-check its identity/window -> insert unique ledger credit ->
    //       merge recovered_paise into the action result and append an audit row.
    const candidateResult = await tx.query<{ id: string; expected_recovery_paise: number | string; executed_at: Date | string }>(
      `SELECT a.id, a.expected_recovery_paise, a.executed_at
       FROM actions a
       WHERE a.status = 'executed'
         AND a.expected_recovery_paise > 0
         AND a.executed_at IS NOT NULL
         AND a.executed_at <= $1
         AND a.executed_at >= $1 - ($2::int * interval '1 hour')
         AND (a.customer_id = $3
              OR (a.entity_type = 'payment' AND a.entity_id = $4)
              OR (a.entity_type = 'order' AND a.entity_id = $5))
         AND NOT EXISTS (
           SELECT 1 FROM ledger_entries l
           WHERE l.account = 'recovered_revenue'
             AND l.ref_type = 'action'
             AND (l.ref_id = a.id::text OR l.ref_id LIKE a.id::text || ':%')
         )
       ORDER BY a.executed_at DESC, a.id DESC
       LIMIT 1`,
      [input.capturedAt, input.attributionWindowHours, customerId, paymentId, orderId],
    );
    const candidate = candidateResult.rows[0];
    if (!candidate) return null;
    const actionResult = await tx.query<{ id: string; status: string; entity_type: string; entity_id: string; customer_id: string | null; expected_recovery_paise: number | string; executed_at: Date | string; result: Record<string, unknown> | null }>(
      `SELECT id, status, entity_type, entity_id, customer_id, expected_recovery_paise, executed_at, result
       FROM actions WHERE id = $1 FOR UPDATE`,
      [candidate.id],
    );
    const action = actionResult.rows[0];
    if (!action || action.entity_type === 'event') return null;
    const executedAt = new Date(action.executed_at);
    if (action.status === 'failed' || Number.isNaN(executedAt.getTime()) || executedAt > input.capturedAt || executedAt < new Date(input.capturedAt.getTime() - input.attributionWindowHours * 3_600_000)) return null;
    const expected = readPaise(action.expected_recovery_paise);
    const credit = assertSafePaise(Math.min(amountPaise, expected), 'attribution.creditPaise');
    const ledgerId = await insertRecoveredRevenueForAction(tx, action.id, credit);
    if (ledgerId === null) return null;
    const previousResult = action.result && typeof action.result === 'object' ? action.result : {};
    const nextResult = { ...previousResult, recovered_paise: credit };
    await tx.query(`UPDATE actions SET result = $2::jsonb, updated_at = now() WHERE id = $1`, [action.id, JSON.stringify(nextResult)]);
    await insertAuditLog(tx, {
      actor: 'orchestrator',
      action: 'action.recovered',
      entityType: action.entity_type,
      entityId: action.entity_id,
      before: { result: previousResult },
      after: { result: nextResult },
      metadata: { event_type: input.eventType, amount_paise: credit, ledger_id: ledgerId },
    });
    return { actionId: action.id, amountPaise: credit, ledgerId } satisfies AttributionResult;
  });
  if (result) bus?.publish('action.recovered', result);
  return result;
}

function readPaise(value: unknown): number {
  const number = typeof value === 'number' ? value : typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : Number.NaN;
  return Number.isSafeInteger(number) && number >= 0 ? number : 0;
}

function stringValue(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}
