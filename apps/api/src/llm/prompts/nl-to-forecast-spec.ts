import { z } from 'zod';
import { FORECAST_METRICS } from '../../nlq/intent';

export const ForecastSpecSchema = z.object({
  metric: z.enum(FORECAST_METRICS),
  window_days: z.number().int().min(1).max(365),
  horizon_days: z.number().int().min(1).max(365),
});
export type ForecastSpecOutput = z.infer<typeof ForecastSpecSchema>;

export const nlToForecastSpecPrompt = {
  version: 'v1',
  system: `Extract a forecast metric and date windows. Allowed metrics: ${FORECAST_METRICS.join(', ')}. Return JSON only. The application computes all forecast numbers itself.`,
  buildUser: (question: string): string => question,
  schema: ForecastSpecSchema,
} as const;

export default nlToForecastSpecPrompt;

