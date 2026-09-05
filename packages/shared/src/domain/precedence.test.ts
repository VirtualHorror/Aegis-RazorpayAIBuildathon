import { describe, expect, it } from 'vitest';
import { isStaleSubscriptionEvent, shouldApplyPaymentTransition } from './precedence';

describe('shouldApplyPaymentTransition', () => {
  it('applies anything on first sighting', () => {
    expect(shouldApplyPaymentTransition(null, 'captured')).toBe(true);
    expect(shouldApplyPaymentTransition(null, 'failed')).toBe(true);
  });
  it('moves forward and tolerates idempotent repeats', () => {
    expect(shouldApplyPaymentTransition('created', 'authorized')).toBe(true);
    expect(shouldApplyPaymentTransition('authorized', 'captured')).toBe(true);
    expect(shouldApplyPaymentTransition('captured', 'refunded')).toBe(true);
    expect(shouldApplyPaymentTransition('captured', 'captured')).toBe(true);
  });
  it('never regresses', () => {
    expect(shouldApplyPaymentTransition('captured', 'authorized')).toBe(false);
    expect(shouldApplyPaymentTransition('refunded', 'captured')).toBe(false);
    expect(shouldApplyPaymentTransition('authorized', 'created')).toBe(false);
  });
  it('treats failed as terminal for the same payment id', () => {
    expect(shouldApplyPaymentTransition('failed', 'captured')).toBe(false);
    expect(shouldApplyPaymentTransition('failed', 'authorized')).toBe(false);
    expect(shouldApplyPaymentTransition('failed', 'failed')).toBe(true);
    expect(shouldApplyPaymentTransition('created', 'failed')).toBe(true);
  });
});

describe('isStaleSubscriptionEvent', () => {
  const t1 = new Date('2026-09-05T10:00:00Z');
  const t2 = new Date('2026-09-05T10:05:00Z');
  it('is never stale without history', () => {
    expect(isStaleSubscriptionEvent(null, t1)).toBe(false);
  });
  it('flags older events as stale and accepts equal or newer', () => {
    expect(isStaleSubscriptionEvent(t2, t1)).toBe(true);
    expect(isStaleSubscriptionEvent(t1, t2)).toBe(false);
    expect(isStaleSubscriptionEvent(t1, t1)).toBe(false);
  });
});
