import pg from 'pg';

/**
 * PostgreSQL int8 values are amounts in this application and must arrive as safe JS integers.
 * Intent: install one process-wide parser so production code and tests share the same bigint contract.
 * Flow: import this side-effect module before creating pools -> node-postgres converts int8 -> validate range -> number.
 */
pg.types.setTypeParser(20, (value: string): number => {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) {
    throw new RangeError(`int8 value ${value} exceeds Number.MAX_SAFE_INTEGER`);
  }
  return parsed;
});
