import { describe, expect, it } from 'vitest';
import { nextSalvageState, SALVAGE_EVENTS, SALVAGE_STATES } from './state';

describe('subscription salvage state machine', () => {
  it('covers every state/event pair without throwing', () => {
    for (const state of SALVAGE_STATES) for (const event of SALVAGE_EVENTS) {
      expect(() => nextSalvageState(state, event, 0, 3)).not.toThrow();
    }
  });

  it('bounds retries and permits only the documented churn recovery exception', () => {
    expect(nextSalvageState('none', 'failure_observed', 0, 3)).toBe('retry_scheduled');
    expect(nextSalvageState('retrying', 'retry_failed', 2, 3)).toBe('retry_scheduled');
    expect(nextSalvageState('retrying', 'retry_failed', 3, 3)).toBe('churned');
    expect(nextSalvageState('churned', 'payment_succeeded', 3, 3)).toBe('recovered');
    expect(nextSalvageState('recovered', 'payment_succeeded', 3, 3)).toBeNull();
    expect(nextSalvageState('escalated', 'escalate', 0, 3)).toBeNull();
  });
});

