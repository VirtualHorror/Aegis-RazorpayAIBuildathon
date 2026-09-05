import type { EntityType } from '@aegis/shared';
import type { CustomerRow } from '../db/repos/customers';

/** Common shape of rows returned by the five projection tables. */
export interface ProjectionRow {
  readonly [column: string]: unknown;
  readonly id: string;
  readonly version: number;
}

/** Result passed to the diagnostic and action layers after a projection transaction commits. */
export interface EntitySnapshot {
  readonly type: EntityType;
  readonly row: ProjectionRow;
  readonly customer: CustomerRow | null;
  /** False when the event was a duplicate or failed its precedence guard. */
  readonly applied: boolean;
}
