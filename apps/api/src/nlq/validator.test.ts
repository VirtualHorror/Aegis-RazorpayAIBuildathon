import { describe, expect, it } from 'vitest';
import { validateSql } from './validator';

describe('Ask Aegis SQL validator', () => {
  it.each(['UPDATE payments SET status = \'captured\'', 'DELETE FROM payments', ';SELECT 1', 'SELECT 1;;', 'SELECT 1; SELECT 2', 'SELECT 1 -- comment', 'SELECT pg_sleep(1)', 'SELECT * FROM information_schema.tables'])('rejects %s', (sql) => {
    const result = validateSql(sql);
    expect(result.ok).toBe(false);
  });

  it('accepts joins and select-only CTEs and applies the row cap', () => {
    const joined = validateSql('SELECT p.id, o.amount_paise FROM payments p JOIN orders o ON o.id = p.order_id');
    expect(joined).toEqual({ ok: true, sql: expect.stringContaining('LIMIT 200') });
    const cte = validateSql('WITH recent AS (SELECT id FROM payments) SELECT * FROM recent');
    expect(cte.ok).toBe(true);
  });

  it('allows the application schema but rejects other schema-qualified tables', () => {
    expect(validateSql('SELECT id FROM public.payments').ok).toBe(true);
    expect(validateSql('SELECT id FROM reporting.payments')).toEqual({
      ok: false,
      errors: ['schema-qualified table is not allowed: reporting.payments'],
    });
  });

  it('does not treat semicolons inside literals as statement separators', () => {
    expect(validateSql("SELECT ';' AS marker;").ok).toBe(true);
  });

  it('leaves PII column references to the readonly database grant', () => {
    const result = validateSql('SELECT email FROM customers');
    expect(result.ok).toBe(true);
  });
});
