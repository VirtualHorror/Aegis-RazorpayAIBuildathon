import type { DeliveryResult, Totals } from './types';

/**
 * Render the human-readable simulator evidence.
 * Intent: show per-delivery HTTP facts separately from aggregate categories so throttles cannot disappear into rejected.
 * Flow: align rows -> count categories -> calculate p50/p95 over observed request latency.
 */
export function printResults(results: readonly DeliveryResult[]): void {
  const rows = results.map((result) => ({
    scenario: result.scenario,
    code: result.statusCode,
    status: result.status,
    latency: `${result.latencyMs}ms`,
  }));
  const scenarioWidth = Math.max('scenario'.length, ...rows.map((row) => row.scenario.length));
  console.log('');
  console.log(`${'scenario'.padEnd(scenarioWidth)}  code  status         latency`);
  console.log(`${'-'.repeat(scenarioWidth)}  ----  -------------  -------`);
  for (const row of rows) console.log(`${row.scenario.padEnd(scenarioWidth)}  ${String(row.code).padStart(4)}  ${row.status.padEnd(13)}  ${row.latency.padStart(7)}`);

  const totals = results.reduce<Totals>((sum, result) => {
    sum[result.category] += 1;
    return sum;
  }, { accepted: 0, duplicate: 0, rejected: 0, ignored: 0, rate_limited: 0 });
  const latencies = results.map((result) => result.latencyMs);
  console.log('');
  console.log(`totals accepted=${totals.accepted} duplicate=${totals.duplicate} rejected=${totals.rejected} ignored=${totals.ignored} rate_limited=${totals.rate_limited}`);
  console.log(`latency p50=${percentile(latencies, 0.5)}ms p95=${percentile(latencies, 0.95)}ms`);
}

export function percentile(values: readonly number[], fraction: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const rank = Math.max(1, Math.ceil(sorted.length * fraction));
  return sorted[rank - 1] ?? 0;
}
