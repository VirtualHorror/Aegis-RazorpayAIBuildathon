export interface ForecastSeriesPoint {
  readonly date: string | Date;
  readonly value: number;
}

export interface ForecastPoint {
  readonly date: string;
  readonly value: number;
  readonly lower: number;
  readonly upper: number;
}

export interface ForecastResult {
  readonly points: ForecastPoint[];
  readonly method: 'ols+ma7';
  readonly slopePerDay: number;
  readonly r2: number;
  readonly intercept: number;
  readonly movingAverage7: number;
  readonly residualStddev: number;
}

/**
 * Produce a small, explainable forecast from a daily series.
 * Intent: all numeric predictions stay in TypeScript; the model may describe the result but cannot author values.
 * Flow: fit OLS over x=0..n-1 -> anchor its level to the trailing seven-day mean -> emit a band from OLS residuals.
 */
export function forecast(series: readonly ForecastSeriesPoint[], horizonDays: number): ForecastResult {
  if (!Number.isSafeInteger(horizonDays) || horizonDays < 1 || horizonDays > 365) throw new RangeError('horizonDays must be 1..365');
  if (series.length === 0) throw new RangeError('series must contain at least one point');
  const values = series.map((point) => finiteValue(point.value));
  const n = values.length;
  const meanX = (n - 1) / 2;
  const meanY = values.reduce((sum, value) => sum + value, 0) / n;
  let ssXX = 0;
  let ssXY = 0;
  for (let index = 0; index < n; index += 1) {
    const dx = index - meanX;
    ssXX += dx * dx;
    ssXY += dx * ((values[index] ?? 0) - meanY);
  }
  const slopePerDay = ssXX === 0 ? 0 : ssXY / ssXX;
  const intercept = meanY - slopePerDay * meanX;
  const fitted = values.map((_, index) => intercept + slopePerDay * index);
  const residuals = values.map((value, index) => value - (fitted[index] ?? 0));
  const residualStddev = Math.sqrt(residuals.reduce((sum, residual) => sum + residual * residual, 0) / n);
  const totalVariance = values.reduce((sum, value) => sum + (value - meanY) ** 2, 0);
  const residualVariance = residuals.reduce((sum, residual) => sum + residual * residual, 0);
  const r2 = totalVariance === 0 ? (residualVariance === 0 ? 1 : 0) : Math.max(0, Math.min(1, 1 - residualVariance / totalVariance));
  const movingAverage7 = values.slice(Math.max(0, n - 7)).reduce((sum, value) => sum + value, 0) / Math.min(7, n);
  const levelAdjustment = movingAverage7 - (intercept + slopePerDay * (n - 1));
  const lastPoint = series[n - 1];
  if (!lastPoint) throw new RangeError('series must contain at least one point');
  const lastDate = parseDate(lastPoint.date);
  const points: ForecastPoint[] = [];
  for (let offset = 1; offset <= horizonDays; offset += 1) {
    const trend = intercept + slopePerDay * (n - 1 + offset) + levelAdjustment;
    const date = new Date(lastDate.getTime());
    date.setUTCDate(date.getUTCDate() + offset);
    points.push({ date: date.toISOString().slice(0, 10), value: trend, lower: trend - residualStddev, upper: trend + residualStddev });
  }
  return { points, method: 'ols+ma7', slopePerDay, r2, intercept, movingAverage7, residualStddev };
}

export const forecastSeries = forecast;

function finiteValue(value: number): number {
  if (!Number.isFinite(value)) throw new TypeError('series values must be finite numbers');
  return value;
}

function parseDate(value: string | Date): Date {
  const date = value instanceof Date ? new Date(value.getTime()) : new Date(value);
  if (Number.isNaN(date.getTime())) throw new TypeError(`invalid series date: ${String(value)}`);
  return date;
}
