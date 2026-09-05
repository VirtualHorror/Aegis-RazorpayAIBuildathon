import type pg from 'pg';
import { assertSafePaise } from '@aegis/shared';
import type { LedgerEntryDraft } from '../../orchestrator/types';

type QueryDatabase = pg.Pool | pg.PoolClient;

export async function insertLedgerEntry(db: QueryDatabase, draft: LedgerEntryDraft): Promise<number> {
  const debit = assertSafePaise(draft.debitPaise ?? 0, 'ledger.debitPaise');
  const credit = assertSafePaise(draft.creditPaise ?? 0, 'ledger.creditPaise');
  const result = await db.query<{ id: number }>(
    `INSERT INTO ledger_entries (account, debit_paise, credit_paise, currency, ref_type, ref_id, memo)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
    [draft.account, debit, credit, draft.currency ?? 'INR', draft.refType, draft.refId, draft.memo ?? null],
  );
  const id = result.rows[0]?.id;
  if (id === undefined) throw new Error(`ledger insert returned no id for ${draft.refId}`);
  return Number(id);
}
