/**
 * Names of the committed control-plane facts the API publishes on its process-local bus and streams to the
 * dashboard as Server-Sent Events (`event: <name>\ndata: <json>`).
 * Intent: one definition for the publisher (`apps/api/src/bus`) and the consumer (`apps/web/src/lib/sse.ts`), so a
 *         renamed or added event cannot silently drift between the two packages (D-059).
 * Flow: API modules publish by name -> SSE route frames the name -> the browser registers one listener per name.
 */
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
  'action.recovered',
  'system.kill_switch',
  'message.simulated_sent',
  'x402.settled',
  'x402.rejected',
  'compliance.flag',
  'job.dead_letter',
] as const;

export type BusEventName = (typeof BUS_EVENT_NAMES)[number];

export function isBusEventName(value: string): value is BusEventName {
  return (BUS_EVENT_NAMES as readonly string[]).includes(value);
}
