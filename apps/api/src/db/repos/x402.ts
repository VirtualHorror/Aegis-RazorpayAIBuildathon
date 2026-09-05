import type pg from 'pg';
import { randomUUID } from 'node:crypto';

type Database = pg.Pool | pg.PoolClient;
export async function createChallenge(db: Database, input: { resource: string; method: string; amountPaise: number; expiresAt: Date; requestId?: string }): Promise<{ nonce: string; expiresAt: Date }> {
  const nonce = randomUUID();
  await db.query(`INSERT INTO x402_payments (nonce, resource, method, amount_paise, status, expires_at, request_id) VALUES ($1,$2,$3,$4,'challenged',$5,$6)`, [nonce, input.resource, input.method, input.amountPaise, input.expiresAt, input.requestId ?? null]);
  return { nonce, expiresAt: input.expiresAt };
}
export async function listPayments(db: Database): Promise<unknown[]> {
  const result = await db.query(`SELECT id, nonce, resource, method, payer, amount_paise, asset, network, status, reject_reason, expires_at, created_at, settled_at FROM x402_payments ORDER BY created_at DESC LIMIT 100`);
  return result.rows;
}
