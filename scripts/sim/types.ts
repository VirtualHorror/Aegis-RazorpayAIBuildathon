import type pg from 'pg';
import type { SimScenario, SimSeed } from '../../packages/shared/src/index';

export type DeliveryCategory = 'accepted' | 'duplicate' | 'rejected' | 'ignored' | 'rate_limited';

export interface PreparedScenario {
  readonly scenario: SimScenario;
  readonly raw: Buffer;
  readonly headers: Record<string, string>;
  readonly unverifiedKey: string;
}

export interface DeliveryResult {
  readonly scenario: string;
  readonly statusCode: number;
  readonly status: string;
  readonly category: DeliveryCategory;
  readonly eventId: string;
  readonly latencyMs: number;
  /** False for a `--dupes` replay. Only an original is expected to reach its scenario's terminal category. */
  readonly original: boolean;
}

export interface Totals {
  accepted: number;
  duplicate: number;
  rejected: number;
  ignored: number;
  rate_limited: number;
}

export interface CliOptions {
  readonly scenario: string;
  readonly dupes: number;
  readonly burst: number | undefined;
  readonly contend: boolean;
  readonly seed: SimSeed;
  readonly apiUrl: string;
  readonly chaos: 'llm_down' | undefined;
  /** Epoch seconds stamped on every fixture in the run; defaults to now so time-relative server rules see live input. */
  readonly createdAt: number;
  /** Pin the order id one scenario names, so a retry capture can be attributed to the failure it recovered. */
  readonly orderId: string | undefined;
  /** Pin the customer id one scenario names; `attributeRecovery` matches an executed action on it. */
  readonly customerId: string | undefined;
}

export interface DbInspector {
  readonly pool: pg.Pool;
  close(): Promise<void>;
}
