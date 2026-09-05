import { describe, expect, it } from 'vitest';
import { KNOWN_EVENT_TYPES } from '@aegis/shared';
import { ROUTES, routeFor } from './routing';

describe('orchestrator routing', () => {
  it('has one deterministic route for every known simulator event', () => {
    for (const eventType of KNOWN_EVENT_TYPES) {
      expect(ROUTES[eventType]).toBeDefined();
      expect(routeFor(eventType)).toEqual(ROUTES[eventType]);
    }
    expect(Object.keys(ROUTES)).toHaveLength(KNOWN_EVENT_TYPES.length);
  });

  it('diagnoses only the payment and subscription failure routes', () => {
    expect(ROUTES['payment.failed']).toEqual({ entity: 'payment', diagnose: true });
    expect(ROUTES['subscription.pending']).toEqual({ entity: 'subscription', diagnose: true });
    expect(ROUTES['subscription.halted']).toEqual({ entity: 'subscription', diagnose: true });
    expect(ROUTES['payment.captured']?.diagnose).toBe(false);
  });

  it('fails closed for unknown event types', () => {
    expect(routeFor('settlement.processed')).toBeUndefined();
    expect(routeFor('toString')).toBeUndefined();
    expect(routeFor('__proto__')).toBeUndefined();
  });
});
