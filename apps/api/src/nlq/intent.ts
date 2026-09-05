export const FORECAST_METRICS = ['gmv', 'failed_payments', 'recovered_revenue', 'disputes', 'x402_revenue'] as const;
export type ForecastMetric = (typeof FORECAST_METRICS)[number];

export interface QueryIntent {
  readonly kind: 'query';
}

export interface ForecastIntent {
  readonly kind: 'forecast';
  readonly metric?: ForecastMetric;
  readonly horizonDays?: number;
  readonly windowDays?: number;
}

export type AskIntent = QueryIntent | ForecastIntent;

/**
 * Classify an Ask Aegis question without a model call.
 * Intent: routing must remain deterministic and must not let model prose choose whether a query can execute.
 * Flow: inspect forecast verbs/next-day language -> infer an explicit metric when present -> leave query questions alone.
 */
export function classifyIntent(question: string): AskIntent {
  const normalized = question.trim().toLowerCase();
  const forecast = /\bforecast\b|\bpredict\b|\bprojection\b|\bnext\s+\d+\s+days?\b/.test(normalized);
  if (!forecast) return { kind: 'query' };
  const metric = metricFromQuestion(normalized);
  const horizonMatch = normalized.match(/next\s+(\d+)\s+days?/);
  const windowMatch = normalized.match(/(?:last|past|over)\s+(\d+)\s+days?/);
  return {
    kind: 'forecast',
    ...(metric ? { metric } : {}),
    ...(horizonMatch ? { horizonDays: boundedDays(Number(horizonMatch[1]), 7) } : {}),
    ...(windowMatch ? { windowDays: boundedDays(Number(windowMatch[1]), 30) } : {}),
  };
}

export const classify = classifyIntent;

export function metricFromQuestion(question: string): ForecastMetric | undefined {
  const normalized = question.toLowerCase();
  if (/x402|agentic\s+commerce|gateway\s+revenue/.test(normalized)) return 'x402_revenue';
  if (/failed\s+payment|payment\s+failure|declined\s+payment/.test(normalized)) return 'failed_payments';
  if (/recover(?:ed|y)|revenue\s+recover/.test(normalized)) return 'recovered_revenue';
  if (/dispute|chargeback/.test(normalized)) return 'disputes';
  if (/\bgmv\b|gross\s+merchandise|sales|order\s+value/.test(normalized)) return 'gmv';
  return undefined;
}

function boundedDays(value: number, fallback: number): number {
  return Number.isSafeInteger(value) && value >= 1 && value <= 365 ? value : fallback;
}
