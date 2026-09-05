import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { withTransaction } from '../db/tx';
import { insertAuditLog } from '../db/repos/audit';
import type pg from 'pg';
import { enqueueComplianceScan } from './worker';

const FlagQuerySchema = z.object({
  status: z.enum(['open', 'acknowledged', 'resolved', 'false_positive', 'needs_review']).optional(),
  risk: z.enum(['none', 'low', 'medium', 'high', 'prohibited']).optional(),
});
const FlagDecisionSchema = z.object({
  status: z.enum(['open', 'acknowledged', 'resolved', 'false_positive', 'needs_review']),
  actor: z.string().min(1),
});

export interface ComplianceRouteOptions {
  readonly db: pg.Pool;
}

/** Compliance scan control-plane routes. */
export const complianceRoutes: FastifyPluginAsync<ComplianceRouteOptions> = async (app, options) => {
  app.post('/api/v1/compliance/scan', async (_request, reply) => {
    const run = await enqueueComplianceScan(options.db);
    return reply.code(202).send({ runId: run, status: 'queued' });
  });

  app.get('/api/v1/compliance/flags', async (request) => {
    const parsed = FlagQuerySchema.parse(request.query ?? {});
    const conditions: string[] = [];
    const values: string[] = [];
    if (parsed.status) { values.push(parsed.status); conditions.push(`status = $${values.length}`); }
    if (parsed.risk) { values.push(parsed.risk); conditions.push(`risk_level = $${values.length}`); }
    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const result = await options.db.query(
      `SELECT id, product_id, scan_run_id, keyword_hits, llm_assessment, risk_level, category, evidence_span,
              recommendation, status, reviewed_by, reviewed_at, created_at
       FROM compliance_flags ${where} ORDER BY created_at DESC`,
      values,
    );
    return result.rows;
  });

  app.post('/api/v1/compliance/flags/:id/status', async (request, reply) => {
    const params = z.object({ id: z.string().uuid() }).parse(request.params);
    const body = FlagDecisionSchema.parse(request.body ?? {});
    const row = await withTransaction(options.db, async (tx) => {
      const before = await tx.query<Record<string, unknown>>('SELECT * FROM compliance_flags WHERE id = $1 FOR UPDATE', [params.id]);
      const existing = before.rows[0];
      if (!existing) return null;
      const updated = await tx.query<Record<string, unknown>>(
        `UPDATE compliance_flags SET status = $2, reviewed_by = $3, reviewed_at = now() WHERE id = $1 RETURNING *`,
        [params.id, body.status, body.actor],
      );
      const after = updated.rows[0];
      await insertAuditLog(tx, { actor: body.actor, action: 'compliance.flag_status', entityType: 'compliance_flag', entityId: params.id, before: existing, after, metadata: { status: body.status } });
      return after;
    });
    if (!row) return reply.code(404).send({ error: 'not_found', details: 'compliance flag not found' });
    return { flag: row };
  });
};

export default complianceRoutes;
