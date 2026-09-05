import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import type { Config } from '../config';
import { withTransaction } from '../db/tx';
import { insertLedgerEntry } from '../db/repos/ledger';
import { insertAuditLog } from '../db/repos/audit';
import { loadGuardrailConfig } from '../db/repos/guardrails';
import type { EventBus } from '../bus/event-bus';
import { verifyPaymentSignature } from './canonical';
import type { X402Payload, X402Rejection, X402RequestContext } from './types';

export class X402Error extends Error { constructor(readonly reason: X402Rejection) { super(reason); this.name = 'X402Error'; } }
export class X402PausedError extends Error { constructor() { super('gateway_paused'); this.name = 'X402PausedError'; } }
export interface Settlement { readonly txId: string; readonly settledAt: string }

export async function verifyAndSettle(
  db: pg.Pool,
  payload: X402Payload,
  requiredPaise: number,
  config: Config,
  bus: EventBus,
  requestContext?: X402RequestContext,
): Promise<Settlement> {
  const outcome = await withTransaction(db, async (tx) => {
    const rowResult = await tx.query<{ id: string; status: string; expires_at: Date; amount_paise: string | number; payer: string | null; resource: string; method: string }>(
      `SELECT id, status, expires_at, amount_paise, payer, resource, method
       FROM x402_payments WHERE nonce = $1 FOR UPDATE`,
      [payload.nonce],
    );
    const row = rowResult.rows[0];
    if (!row) return { reason: 'unknown_nonce' as const };
    if (row.status === 'settled') {
      await insertAuditLog(tx, { actor: 'system:x402', action: 'x402.replay', entityType: 'x402_payment', entityId: row.id, metadata: { reason: 'nonce_already_settled' } });
      return { reason: 'nonce_already_settled' as const };
    }
    if (row.status !== 'challenged') return rejectKnown(tx, row.id, 'invalid_payment_header');
    if (new Date(row.expires_at).getTime() <= Date.now()) {
      await tx.query(`UPDATE x402_payments SET status='expired', reject_reason='nonce_expired' WHERE id=$1`, [row.id]);
      await insertAuditLog(tx, { actor: 'system:x402', action: 'x402.expired', entityType: 'x402_payment', entityId: row.id, metadata: { reason: 'nonce_expired' } });
      return { reason: 'nonce_expired' as const };
    }
    if (requestContext && (row.resource !== requestContext.resource || row.method !== requestContext.method)) {
      return rejectKnown(tx, row.id, 'invalid_payment_header');
    }
    if (!verifyPaymentSignature(payload, config.X402_SIM_SECRET)) return rejectKnown(tx, row.id, 'bad_signature');
    if (payload.payTo !== config.X402_PAY_TO || payload.asset !== 'INR') return rejectKnown(tx, row.id, 'bad_signature');
    const guards = await loadGuardrailConfig(tx);
    if (guards.kill_switch) return { paused: true as const };
    const amount = parsePaise(payload.amount);
    if (amount === null || amount < requiredPaise || amount < safePaise(row.amount_paise)) return rejectKnown(tx, row.id, 'amount_below_required');
    if (amount > guards.x402_max_amount_paise) return rejectKnown(tx, row.id, 'amount_exceeds_policy');
    // Intent: serialize different nonces for one payer while checking the aggregate cap; a row lock on one nonce alone
    // would let concurrent payments both observe the same daily total.
    // Flow: payer advisory lock -> sum committed settlements -> compare -> settle the nonce and write its ledger row.
    await tx.query(`SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`, [`x402:payer:${payload.payer}`]);
    const daily = await tx.query<{ total: string | number }>(
      `SELECT COALESCE(SUM(amount_paise),0)::bigint AS total
       FROM x402_payments WHERE payer=$1 AND status='settled' AND created_at >= date_trunc('day', now())`,
      [payload.payer],
    );
    if (safePaise(daily.rows[0]?.total) + amount > guards.x402_daily_cap_per_payer_paise) return rejectKnown(tx, row.id, 'payer_daily_cap_exceeded');
    const txId = randomUUID();
    const settledAt = new Date().toISOString();
    await tx.query(
      `UPDATE x402_payments SET status='settled', payer=$1, amount_paise=$2, payment_payload=$3::jsonb, settled_at=$4 WHERE id=$5`,
      [payload.payer, amount, JSON.stringify(payload), settledAt, row.id],
    );
    await insertLedgerEntry(tx, { account: 'x402_revenue', creditPaise: amount, debitPaise: 0, refType: 'x402_payment', refId: row.id, memo: 'x402 simulated settlement' });
    await insertAuditLog(tx, { actor: payload.payer, action: 'x402.settled', entityType: 'x402_payment', entityId: row.id, metadata: { txId, amountPaise: amount } });
    return { settlement: { txId, settledAt } };
  });

  if ('settlement' in outcome && outcome.settlement !== undefined) {
    bus.publish('x402.settled', outcome.settlement);
    return outcome.settlement;
  }
  if ('paused' in outcome) {
    bus.publish('x402.rejected', { reason: 'gateway_paused', nonce: payload.nonce });
    throw new X402PausedError();
  }
  const reason = outcome.reason;
  bus.publish('x402.rejected', { reason, nonce: payload.nonce });
  throw new X402Error(reason);
}

function parsePaise(value: string): number | null {
  if (!/^(?:0|[1-9]\d*)$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

function safePaise(value: unknown): number {
  const parsed = typeof value === 'number' ? value : typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : Number.NaN;
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : 0;
}

async function rejectKnown(tx: pg.PoolClient, rowId: string, reason: X402Rejection): Promise<{ reason: X402Rejection }> {
  await tx.query(`UPDATE x402_payments SET status='rejected', reject_reason=$1 WHERE id=$2 AND status='challenged'`, [reason, rowId]);
  await insertAuditLog(tx, { actor: 'system:x402', action: 'x402.rejected', entityType: 'x402_payment', entityId: rowId, metadata: { reason } });
  return { reason };
}
