import type pg from 'pg';
import type { OutboundMessageDraft } from '../../orchestrator/types';

type QueryDatabase = pg.Pool | pg.PoolClient;

export async function insertOutboundMessage(db: QueryDatabase, actionId: string, draft: OutboundMessageDraft): Promise<string> {
  const result = await db.query<{ id: string }>(
    `INSERT INTO outbound_messages
       (action_id, channel, recipient_masked, locale, template, payload, status, suppressed_reason)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8)
     RETURNING id`,
    [actionId, draft.channel, draft.recipientMasked, draft.locale, draft.template, JSON.stringify(draft.payload), draft.status ?? 'simulated_sent', draft.suppressedReason ?? null],
  );
  const id = result.rows[0]?.id;
  if (!id) throw new Error(`outbound message insert returned no id for action ${actionId}`);
  return id;
}
