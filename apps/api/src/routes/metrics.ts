import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import type pg from 'pg';

const WindowSchema = z.object({ window: z.enum(['24h', '7d', 'all']).default('24h') });
export interface MetricsRouteOptions { readonly db: pg.Pool }

/**
 * Return dashboard metrics from independent durable aggregates.
 * Intent: each displayed number reconciles directly to source rows rather than to another derived metric.
 * Flow: parse the time window -> aggregate events/actions/ledger/audit/diagnoses -> normalize PostgreSQL bigint values.
 */
export const metricsRoutes: FastifyPluginAsync<MetricsRouteOptions> = async (app, options) => {
  app.get('/api/v1/metrics/summary', async (request) => {
    const { window } = WindowSchema.parse(request.query ?? {});
    const since = window === '24h' ? new Date(Date.now() - 24 * 3_600_000) : window === '7d' ? new Date(Date.now() - 7 * 86_400_000) : null;
    const time = since ? ' AND created_at >= $1' : '';
    const eventTime = since ? ' AND received_at >= $1' : '';
    const [events, actions, money, humans, llm] = await Promise.all([
      options.db.query<{ received: string; duplicates: string; rejected: string; processed: string; dead_letter: string }>(
        `SELECT count(*) FILTER (WHERE status = 'received') AS received,
                COALESCE(sum(duplicate_count), 0) AS duplicates,
                count(*) FILTER (WHERE status = 'ignored' AND signature_valid = false) AS rejected,
                count(*) FILTER (WHERE status = 'processed') AS processed,
                count(*) FILTER (WHERE status = 'dead_letter') AS dead_letter
         FROM webhook_events WHERE true${eventTime}`, since ? [since] : [],
      ),
      options.db.query<{ proposed: string; blocked: string; pending_approval: string; executed: string; rejected: string }>(
        `SELECT count(*) AS proposed,
                count(*) FILTER (WHERE status = 'blocked') AS blocked,
                count(*) FILTER (WHERE status = 'pending_approval') AS pending_approval,
                count(*) FILTER (WHERE status = 'executed') AS executed,
                count(*) FILTER (WHERE status = 'rejected') AS rejected
         FROM actions WHERE true${time}`, since ? [since] : [],
      ),
      options.db.query<{ recovered: string; discounts: string; x402: string; exposure: string }>(
        `SELECT
           COALESCE(sum(credit_paise) FILTER (WHERE account = 'recovered_revenue'), 0) AS recovered,
           COALESCE(sum(debit_paise) FILTER (WHERE account = 'discount_granted'), 0) AS discounts,
           COALESCE(sum(credit_paise) FILTER (WHERE account = 'x402_revenue'), 0) AS x402,
           COALESCE(sum(credit_paise) FILTER (WHERE account = 'chargeback_exposure'), 0) AS exposure
         FROM ledger_entries WHERE true${time}`, since ? [since] : [],
      ),
      options.db.query<{ reviewed: string; approved: string; rejected: string }>(
        `SELECT count(*) FILTER (WHERE action IN ('action.approval_granted', 'action.rejected', 'evidence.approved', 'evidence.rejected')) AS reviewed,
                count(*) FILTER (WHERE action IN ('action.approval_granted', 'evidence.approved')) AS approved,
                count(*) FILTER (WHERE action IN ('action.rejected', 'evidence.rejected')) AS rejected
         FROM audit_log WHERE true${time}`, since ? [since] : [],
      ),
      options.db.query<{ calls: string; degraded: string; avg_latency: string | null; by_provider: Record<string, number> | null }>(
        `SELECT count(*) AS calls,
                count(*) FILTER (WHERE degraded) AS degraded,
                avg(latency_ms)::float AS avg_latency,
                COALESCE(jsonb_object_agg(provider, provider_count), '{}'::jsonb) AS by_provider
         FROM (SELECT provider, count(*)::int AS provider_count, bool_or(degraded) AS degraded, avg(latency_ms)::float AS latency_ms
               FROM diagnoses WHERE true${time} GROUP BY provider) grouped`, since ? [since] : [],
      ),
    ]);
    const event = events.rows[0] ?? { received: '0', duplicates: '0', rejected: '0', processed: '0', dead_letter: '0' };
    const action = actions.rows[0] ?? { proposed: '0', blocked: '0', pending_approval: '0', executed: '0', rejected: '0' };
    const ledger = money.rows[0] ?? { recovered: '0', discounts: '0', x402: '0', exposure: '0' };
    const human = humans.rows[0] ?? { reviewed: '0', approved: '0', rejected: '0' };
    const model = llm.rows[0] ?? { calls: '0', degraded: '0', avg_latency: null, by_provider: {} };
    const number = (value: string | number | null | undefined): number => Number(value ?? 0);
    const reviewed = number(human.reviewed);
    const calls = number(model.calls);
    return {
      events: { received: number(event.received), duplicates: number(event.duplicates), rejected: number(event.rejected), processed: number(event.processed), dead_letter: number(event.dead_letter) },
      actions: { proposed: number(action.proposed), blocked: number(action.blocked), pending_approval: number(action.pending_approval), executed: number(action.executed), rejected: number(action.rejected) },
      money: { recovered_paise: number(ledger.recovered), discounts_granted_paise: number(ledger.discounts), x402_revenue_paise: number(ledger.x402), chargeback_exposure_paise: number(ledger.exposure) },
      humans: { reviewed, approved: number(human.approved), rejected: number(human.rejected), rejection_rate: reviewed === 0 ? 0 : number(human.rejected) / reviewed },
      llm: { calls, degraded: number(model.degraded), degraded_rate: calls === 0 ? 0 : number(model.degraded) / calls, avg_latency_ms: number(model.avg_latency), by_provider: model.by_provider ?? {} },
      window,
    };
  });
};

export default metricsRoutes;
