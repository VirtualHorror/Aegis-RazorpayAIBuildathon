import type { KnownEventType } from '@aegis/shared';
import type { EntityType } from './types';

export interface EventRoute {
  readonly entity: EntityType;
  readonly diagnose: boolean;
}

/**
 * Closed event-to-entity routing table.
 * Intent: provider event names select the SQL projection and diagnosis capability; no model output can select a branch.
 * Flow: exact event lookup -> project the declared entity -> diagnose only the two failure families with a prompt contract.
 */
export const ROUTES: Readonly<Record<KnownEventType, EventRoute>> = {
  'payment.authorized': { entity: 'payment', diagnose: false },
  'payment.failed': { entity: 'payment', diagnose: true },
  'payment.captured': { entity: 'payment', diagnose: false },
  'payment.refunded': { entity: 'payment', diagnose: false },
  'order.attempted': { entity: 'order', diagnose: false },
  'order.paid': { entity: 'order', diagnose: false },
  'subscription.pending': { entity: 'subscription', diagnose: true },
  'subscription.halted': { entity: 'subscription', diagnose: true },
  'subscription.charged': { entity: 'subscription', diagnose: false },
  'subscription.activated': { entity: 'subscription', diagnose: false },
  'subscription.completed': { entity: 'subscription', diagnose: false },
  'subscription.cancelled': { entity: 'subscription', diagnose: false },
  'invoice.issued': { entity: 'invoice', diagnose: false },
  'invoice.expired': { entity: 'invoice', diagnose: false },
  'invoice.paid': { entity: 'invoice', diagnose: false },
  'invoice.updated': { entity: 'invoice', diagnose: false },
  'payment.dispute.created': { entity: 'dispute', diagnose: false },
  'payment.dispute.updated': { entity: 'dispute', diagnose: false },
  'payment.dispute.closed': { entity: 'dispute', diagnose: false },
  'dispute.created': { entity: 'dispute', diagnose: false },
};

export function routeFor(eventType: string): EventRoute | undefined {
  // Intent: event names are untrusted provider input; inherited object properties must never become routes.
  // Flow: require an own key in the closed table -> return its deterministic route -> otherwise fail closed as unknown.
  return Object.prototype.hasOwnProperty.call(ROUTES, eventType)
    ? (ROUTES as Readonly<Record<string, EventRoute>>)[eventType]
    : undefined;
}
