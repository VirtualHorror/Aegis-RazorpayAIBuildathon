/**
 * Pure helpers for the Overview's live counters.
 * Intent: bus events bump the visible counters immediately for feedback, and a debounced refetch replaces them with
 *         the durable aggregates from `/api/v1/metrics/summary` (C-C6: the stream is not the source of truth).
 */
import type { StreamEvent } from "./sse";
import type { ActionRow, MetricsSummary } from "./types";

export function bumpMetrics(metrics: MetricsSummary, name: StreamEvent["name"]): MetricsSummary {
  switch (name) {
    case "event.received":
      return { ...metrics, events: { ...metrics.events, received: metrics.events.received + 1 } };
    case "event.duplicate":
      return { ...metrics, events: { ...metrics.events, duplicates: metrics.events.duplicates + 1 } };
    case "event.rejected":
      return { ...metrics, events: { ...metrics.events, rejected: metrics.events.rejected + 1 } };
    case "event.processed":
      return {
        ...metrics,
        events: { ...metrics.events, processed: metrics.events.processed + 1, received: Math.max(0, metrics.events.received - 1) },
      };
    case "action.proposed":
      return { ...metrics, actions: { ...metrics.actions, proposed: metrics.actions.proposed + 1 } };
    case "action.pending_approval":
      return { ...metrics, actions: { ...metrics.actions, pending_approval: metrics.actions.pending_approval + 1 } };
    case "action.blocked":
      return { ...metrics, actions: { ...metrics.actions, blocked: metrics.actions.blocked + 1 } };
    case "action.executed":
      return { ...metrics, actions: { ...metrics.actions, executed: metrics.actions.executed + 1 } };
    default:
      return metrics;
  }
}

/** Which KPI group a bus event touches, so only that tile flashes. */
export function flashGroup(name: StreamEvent["name"]): "events" | "actions" | "x402" | null {
  if (name.startsWith("event.")) return "events";
  if (name.startsWith("action.")) return "actions";
  if (name === "x402.settled") return "x402";
  return null;
}

export function actionOf(data: unknown): ActionRow | null {
  if (typeof data !== "object" || data === null || !("action" in data)) return null;
  const action = (data as { action: unknown }).action;
  if (typeof action !== "object" || action === null || !("id" in action) || !("module" in action)) return null;
  return action as ActionRow;
}

/** Insert or replace an action at the top of the recent list, newest first, bounded. */
export function upsertAction(list: readonly ActionRow[], action: ActionRow, max = 8): ActionRow[] {
  const without = list.filter((row) => row.id !== action.id);
  return [action, ...without].slice(0, max);
}

/** Module key for the prism labels: actions carry their module; settlements light the x402 label. */
export function activityModule(event: StreamEvent): string | null {
  if (event.name === "x402.settled") return "x402";
  if (event.name === "compliance.flag") return "compliance";
  return actionOf(event.data)?.module ?? null;
}
