import type pg from 'pg';
import type { EvidencePacket } from '../../modules/chargeback-evidence/packet-schema';

type QueryDatabase = pg.Pool | pg.PoolClient;

export interface EvidencePacketRow {
  readonly id: string;
  readonly dispute_id: string;
  readonly packet: EvidencePacket;
  readonly narrative: string | null;
  readonly review_status: 'requires_human_review' | 'approved' | 'rejected' | 'submitted';
  readonly reviewed_by: string | null;
  readonly reviewed_at: Date | null;
  readonly review_note: string | null;
  readonly submitted_at: Date | null;
  readonly created_at: Date;
}

const COLUMNS = `id, dispute_id, packet, narrative, review_status, reviewed_by, reviewed_at, review_note, submitted_at, created_at`;

export async function insertEvidencePacket(db: QueryDatabase, input: { disputeId: string; packet: EvidencePacket; narrative: string }): Promise<EvidencePacketRow> {
  const result = await db.query<EvidencePacketRow>(
    `INSERT INTO evidence_packets (dispute_id, packet, narrative, review_status)
     VALUES ($1, $2::jsonb, $3, 'requires_human_review')
     ON CONFLICT (dispute_id) DO UPDATE SET packet = EXCLUDED.packet, narrative = EXCLUDED.narrative
     RETURNING ${COLUMNS}`,
    [input.disputeId, JSON.stringify(input.packet), input.narrative],
  );
  const row = result.rows[0];
  if (!row) throw new Error(`evidence packet insert returned no row for ${input.disputeId}`);
  return row;
}

export async function getEvidencePacket(db: QueryDatabase, disputeId: string): Promise<EvidencePacketRow | null> {
  const result = await db.query<EvidencePacketRow>(`SELECT ${COLUMNS} FROM evidence_packets WHERE dispute_id = $1`, [disputeId]);
  return result.rows[0] ?? null;
}

export async function updateEvidenceReview(db: QueryDatabase, disputeId: string, status: 'approved' | 'rejected', actor: string, note: string | null): Promise<EvidencePacketRow | null> {
  const result = await db.query<EvidencePacketRow>(
    `UPDATE evidence_packets SET review_status = $2, reviewed_by = $3, reviewed_at = now(), review_note = $4
     WHERE dispute_id = $1 AND review_status = 'requires_human_review' RETURNING ${COLUMNS}`,
    [disputeId, status, actor, note],
  );
  return result.rows[0] ?? null;
}

export async function markEvidenceSubmitted(db: QueryDatabase, disputeId: string): Promise<boolean> {
  const result = await db.query(
    `UPDATE evidence_packets SET review_status = 'submitted', submitted_at = now()
     WHERE dispute_id = $1 AND review_status = 'approved'`,
    [disputeId],
  );
  return (result.rowCount ?? 0) === 1;
}

export const insertEvidence = insertEvidencePacket;
export const getEvidence = getEvidencePacket;
