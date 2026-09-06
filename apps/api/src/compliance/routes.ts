import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { withTransaction } from '../db/tx';
import { insertAuditLog } from '../db/repos/audit';
import type pg from 'pg';
import { llmKeyFromHeaders, type ByokLlmResolver } from '../llm/byok';
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
  /** Sandbox / BYOK (T25): a manual scan runs on the caller's key when the worker shares this process. */
  readonly byok?: ByokLlmResolver;
}

/** Compliance scan control-plane routes. */
export const complianceRoutes: FastifyPluginAsync<ComplianceRouteOptions> = async (app, options) => {
  app.post('/api/v1/compliance/scan', async (request, reply) => {
    // Intent: the scan is durable work, and a durable row must never hold a credential (C-D3). The key stays in the
    //         in-process registry; the job carries only its fingerprint and the worker resolves it (or falls back).
    const callerKey = options.byok ? llmKeyFromHeaders(request.headers) : null;
    const llmKeyFingerprint = callerKey && options.byok ? options.byok.remember(callerKey) : undefined;
    const run = await enqueueComplianceScan(options.db, { llmKeyFingerprint });
    return reply.code(202).send({ runId: run, status: 'queued' });
  });

  app.get('/api/v1/compliance/flags', async (request) => {
    const parsed = FlagQuerySchema.parse(request.query ?? {});
    const conditions: string[] = [];
    const values: string[] = [];
    if (parsed.status) { values.push(parsed.status); conditions.push(`status = $${values.length}`); }
    if (parsed.risk) { values.push(parsed.risk); conditions.push(`risk_level = $${values.length}`); }
    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    // Intent: a flag is a claim about a product's own words, so the route returns those words with it (B-015). The
    //         join adds no PII: `products` holds merchant catalog copy only.
    const result = await options.db.query(
      `SELECT f.id, f.product_id, f.scan_run_id, f.keyword_hits, f.llm_assessment, f.risk_level, f.category, f.evidence_span,
              f.recommendation, f.status, f.reviewed_by, f.reviewed_at, f.created_at,
              p.name AS product_name, p.description AS product_description, p.category AS product_category
       FROM compliance_flags f JOIN products p ON p.id = f.product_id
       ${where.replace(/\bstatus\b/, 'f.status').replace(/\brisk_level\b/, 'f.risk_level')} ORDER BY f.created_at DESC`,
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
      // Intent: the response must carry the same shape the list returns, product copy included, because the dashboard
      //         replaces the row it is showing with this one (B-015).
      const updated = await tx.query<Record<string, unknown>>(
        `WITH updated AS (
           UPDATE compliance_flags SET status = $2, reviewed_by = $3, reviewed_at = now() WHERE id = $1 RETURNING *
         )
         SELECT u.*, p.name AS product_name, p.description AS product_description, p.category AS product_category
         FROM updated u JOIN products p ON p.id = u.product_id`,
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
