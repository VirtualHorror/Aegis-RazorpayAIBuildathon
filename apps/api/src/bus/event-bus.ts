export const BUS_EVENT_NAMES = [
  'event.received',
  'event.duplicate',
  'event.rejected',
  'event.processed',
  'diagnosis.created',
  'action.proposed',
  'action.blocked',
  'action.pending_approval',
  'action.executed',
  'action.failed',
  'action.rejected',
  'message.simulated_sent',
  'x402.settled',
  'x402.rejected',
  'compliance.flag',
  'job.dead_letter',
] as const;

export type BusEvent = (typeof BUS_EVENT_NAMES)[number];

export interface BusEnvelope {
  readonly name: BusEvent;
  readonly data: unknown;
}

export type EventBusSubscriber = (event: BusEnvelope) => void;

/**
 * Small process-local event bus used for live dashboard updates.
 * Intent: publish committed control-plane facts without pretending the bus is durable storage.
 * Flow: publish to a snapshot of subscribers -> isolate subscriber errors -> unsubscribe by returned closure.
 */
export class EventBus {
  private readonly subscribers = new Set<EventBusSubscriber>();
  private readonly onSubscriberError: (error: unknown) => void;

  constructor(onSubscriberError: (error: unknown) => void = reportSubscriberError) {
    this.onSubscriberError = onSubscriberError;
  }

  publish(name: BusEvent, data: unknown): void {
    const event: BusEnvelope = Object.freeze({ name, data });
    for (const subscriber of [...this.subscribers]) {
      try {
        subscriber(event);
      } catch (error) {
        // Intent: one disconnected or malformed stream must not break other live consumers or the worker; surface the
        // callback failure without allowing it to abort publication to the remaining subscribers.
        this.onSubscriberError(error);
      }
    }
  }

  subscribe(fn: EventBusSubscriber): () => void {
    this.subscribers.add(fn);
    return () => {
      this.subscribers.delete(fn);
    };
  }
}

export function createEventBus(): EventBus {
  return new EventBus();
}

function reportSubscriberError(error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  process.emitWarning(message, { code: 'AEGIS_EVENT_BUS_SUBSCRIBER' });
}
