import { describe, expect, it } from 'vitest';
import { classifyIntent } from './intent';

describe('Ask Aegis intent', () => {
  it('routes forecast language deterministically', () => {
    expect(classifyIntent('forecast failed payments for the next 7 days')).toEqual({ kind: 'forecast', metric: 'failed_payments', horizonDays: 7 });
    expect(classifyIntent('how many open disputes do we have')).toEqual({ kind: 'query' });
  });
});

