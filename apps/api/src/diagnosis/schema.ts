// Intent: keep the diagnosis contract in the prompt registry so every provider and fixture validates one schema.
// Flow: re-export the registry enums/schema -> derive local type aliases for the pure diagnosis modules.
export {
  ROOT_CAUSES,
  STRATEGIES,
  DiagnoseOutputSchema,
  DiagnoseOutputSchema as DiagnosisSchema,
} from '../llm/prompts/index';
export type { DiagnoseOutput } from '../llm/prompts/index';

import type { ROOT_CAUSES, STRATEGIES } from '../llm/prompts/index';

export type RootCause = (typeof ROOT_CAUSES)[number];
export type Strategy = (typeof STRATEGIES)[number];

export interface Hints {
  entity: 'payment' | 'subscription';
  is_international: boolean;
  method: string | null;
  error_step: string | null;
  error_reason: string | null;
  error_source: string | null;
  amount_band: 'micro' | 'small' | 'medium' | 'large';
  customer_locale: string;
  prior_failures_24h: number;
}
