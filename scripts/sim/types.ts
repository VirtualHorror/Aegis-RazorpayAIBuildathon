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
  readonly seed: SimSeed;
  readonly apiUrl: string;
  readonly chaos: 'llm_down' | undefined;
}

export interface DbInspector {
  readonly pool: pg.Pool;
  close(): Promise<void>;
}
