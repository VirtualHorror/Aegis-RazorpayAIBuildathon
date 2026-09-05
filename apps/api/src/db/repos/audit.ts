import type pg from 'pg';

type QueryDatabase = pg.Pool | pg.PoolClient;

export interface AuditInput {
  readonly actor: string;
  readonly action: string;
  readonly entityType: string;
  readonly entityId: string;
  readonly before?: unknown;
  readonly after?: unknown;
  readonly metadata?: unknown;
}

export async function insertAuditLog(db: QueryDatabase, input: AuditInput): Promise<void> {
  await db.query(
    `INSERT INTO audit_log (actor, action, entity_type, entity_id, before, after, metadata)
     VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb, $7::jsonb)`,
    [input.actor, input.action, input.entityType, input.entityId, jsonOrNull(input.before), jsonOrNull(input.after), jsonOrNull(input.metadata)],
  );
}

function jsonOrNull(value: unknown): string | null {
  return value === undefined || value === null ? null : JSON.stringify(value);
}
