import type pg from 'pg';

/**
 * Execute a callback in one PostgreSQL transaction and always release its client.
 * Intent: projection and queue state changes must commit or roll back together;
 *         callers should not have to repeat transaction boilerplate (or leak a client).
 * Flow: acquire client -> BEGIN -> callback -> COMMIT; on any failure ROLLBACK -> release.
 */
export async function withTransaction<T>(pool: pg.Pool, fn: (tx: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  let began = false;
  try {
    await client.query('BEGIN');
    began = true;
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    if (!began) throw error;
    try {
      await client.query('ROLLBACK');
    } catch (rollbackError) {
      throw new Error(
        `transaction failed and rollback failed: ${error instanceof Error ? error.message : String(error)}; ` +
          `${rollbackError instanceof Error ? rollbackError.message : String(rollbackError)}`,
        { cause: rollbackError },
      );
    }
    throw error;
  } finally {
    client.release();
  }
}
