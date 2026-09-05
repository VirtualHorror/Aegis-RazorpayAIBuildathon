import { describe, expect, it } from 'vitest';
import { nextNegotiationState } from './state';

describe('negotiation state machine', () => {
  it('stops after max rounds and keeps terminal states terminal', () => {
    expect(nextNegotiationState('none', 'expired_invoice', 1, 3)).toBe('offer_sent');
    expect(nextNegotiationState('offer_sent', 'counter_received', 1, 3)).toBe('countered');
    expect(nextNegotiationState('countered', 'offer_sent', 2, 3)).toBe('offer_sent');
    expect(nextNegotiationState('offer_sent', 'max_rounds', 3, 3)).toBe('escalated');
    expect(nextNegotiationState('accepted', 'timeout', 1, 3)).toBeNull();
  });

  it('covers every event accepted by each non-terminal state', () => {
    expect(nextNegotiationState('none', 'counter_received', 0, 3)).toBeNull();
    expect(nextNegotiationState('offer_sent', 'accepted', 1, 3)).toBe('accepted');
    expect(nextNegotiationState('offer_sent', 'rejected', 1, 3)).toBe('rejected');
    expect(nextNegotiationState('offer_sent', 'offer_sent', 1, 3)).toBe('offer_sent');
    expect(nextNegotiationState('countered', 'accepted', 2, 3)).toBe('accepted');
    expect(nextNegotiationState('expired', 'offer_sent', 2, 3)).toBe('offer_sent');
    expect(nextNegotiationState('expired', 'expired_invoice', 2, 3)).toBe('offer_sent');
    for (const state of ['accepted', 'rejected', 'escalated'] as const) {
      expect(nextNegotiationState(state, 'max_rounds', 3, 3)).toBeNull();
      expect(nextNegotiationState(state, 'rejected', 3, 3)).toBeNull();
    }
  });
});
