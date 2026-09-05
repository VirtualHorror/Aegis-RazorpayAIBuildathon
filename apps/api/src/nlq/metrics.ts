import type pg from 'pg';
import type { ForecastMetric } from './intent';

export interface DailyMetricPoint {
  readonly date: string;
  readonly value: number;
}

/** Build one deterministic metric query; the day count is parameterized and bounded by the caller. */
export function metricQuery(metric: ForecastMetric, windowDays: number): { sql: string; params: [number] } {
  if (!Number.isSafeInteger(windowDays) || windowDays < 1 || windowDays > 365) throw new RangeError('windowDays must be 1..365');
  const aggregate = {
    gmv: `COALESCE(SUM(o.amount_paise) FILTER (WHERE o.status = 'paid'), 0)`,
    failed_payments: `COUNT(*) FILTER (WHERE p.status = 'failed')`,
    recovered_revenue: `COALESCE(SUM(l.credit_paise) FILTER (WHERE l.account = 'recovered_revenue'), 0)`,
    disputes: `COALESCE(SUM(d.amount_paise), 0)`,
    x402_revenue: `COALESCE(SUM(l.credit_paise) FILTER (WHERE l.account = 'x402_revenue'), 0)`,
  }[metric];
  const source = {
    gmv: `orders o`,
    failed_payments: `payments p`,
    recovered_revenue: `ledger_entries l`,
    disputes: `disputes d`,
    x402_revenue: `ledger_entries l`,
  }[metric];
  const dayColumn = metric === 'gmv' ? 'o.created_at' : metric === 'failed_payments' ? 'p.created_at' : metric === 'disputes' ? 'd.created_at' : 'l.created_at';
  return {
    sql: `WITH days AS (SELECT generate_series(current_date - ($1::int - 1), current_date, interval '1 day')::date AS day), totals AS (SELECT ${dayColumn}::date AS day, ${aggregate}::numeric AS value FROM ${source} WHERE ${dayColumn} >= current_date - ($1::int - 1) AND ${dayColumn} < current_date + interval '1 day' GROUP BY ${dayColumn}::date) SELECT days.day::text AS date, COALESCE(totals.value, 0)::numeric AS value FROM days LEFT JOIN totals ON totals.day = days.day ORDER BY days.day`,
    params: [windowDays],
  };
}

export const buildMetricQuery = metricQuery;

export async function loadMetricSeries(db: pg.Pool, metric: ForecastMetric, windowDays: number): Promise<DailyMetricPoint[]> {
  const query = metricQuery(metric, windowDays);
  const result = await db.query<{ date: string | Date; value: number | string }>(query.sql, query.params);
  return result.rows.map((row) => ({ date: row.date instanceof Date ? row.date.toISOString().slice(0, 10) : String(row.date), value: Number(row.value) }));
}

