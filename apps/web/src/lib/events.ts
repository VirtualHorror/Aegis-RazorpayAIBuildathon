/**
 * Pure helpers for the live events feed.
 * Intent: the SSE stream carries notifications, not rows (C-C6). This module turns those notifications into honest
 *         row updates: a row appears only when the ingress committed it, counters move only when the bus says so.
 */
import type { StreamEvent } from "./sse";
import type { WebhookEventListRow } from "./types";

export type EventFamily = "payment" | "order" | "subscription" | "invoice" | "dispute" | "other";

export function eventFamily(type: string): EventFamily {
  if (type.includes("dispute")) return "dispute";
  const head = type.split(".")[0];
  switch (head) {
    case "payment":
    case "order":
    case "subscription":
    case "invoice":
      return head;
    default:
      return "other";
  }
}

/** Module-spectrum colour for the module that handles each family (Design.md §2). */
export const FAMILY_COLOR_VAR: Readonly<Record<EventFamily, string>> = {
  payment: "var(--mod-checkout_recovery)",
  subscription: "var(--mod-subscription_salvager)",
  invoice: "var(--mod-b2b_negotiator)",
  dispute: "var(--mod-chargeback_evidence)",
  order: "var(--accent)",
  other: "var(--fg-muted)",
};

export function eventColorVar(type: string): string {
  return FAMILY_COLOR_VAR[eventFamily(type)];
}

/** Processing latency in milliseconds, or null while the event has not been processed. */
export function latencyMs(row: Pick<WebhookEventListRow, "received_at" | "processed_at">): number | null {
  if (!row.processed_at) return null;
  const delta = new Date(row.processed_at).getTime() - new Date(row.received_at).getTime();
  return Number.isFinite(delta) ? Math.max(0, delta) : null;
}

function text(data: unknown, key: string): string | undefined {
  if (typeof data !== "object" || data === null || !(key in data)) return undefined;
  const value = (data as Record<string, unknown>)[key];
  return typeof value === "string" ? value : undefined;
}

function flag(data: unknown, key: string): boolean | undefined {
  if (typeof data !== "object" || data === null || !(key in data)) return undefined;
  const value = (data as Record<string, unknown>)[key];
  return typeof value === "boolean" ? value : undefined;
}

export function eventIdOf(data: unknown): string | undefined {
  return text(data, "eventId");
}

export interface MergeResult {
  rows: WebhookEventListRow[];
  /** The event id that changed, or null when the notification did not touch the loaded page. */
  changed: string | null;
}

/**
 * Apply one bus envelope to the loaded rows.
 * Flow: `event.received` prepends a new row; `event.duplicate` bumps the counter; `event.rejected` prepends (or marks)
 *       an unverified row; `event.processed` closes the row with the worker's outcome.
 */
export function mergeStreamEvent(rows: readonly WebhookEventListRow[], event: StreamEvent, now: number = Date.now()): MergeResult {
  const eventId = eventIdOf(event.data);
  if (!eventId) return { rows: [...rows], changed: null };
  const index = rows.findIndex((row) => row.event_id === eventId);
  const existing = index >= 0 ? rows[index] : undefined;
  const nowIso = new Date(now).toISOString();
  const eventType = text(event.data, "eventType") ?? existing?.event_type ?? "unknown";

  switch (event.name) {
    case "event.received": {
      if (existing) return { rows: [...rows], changed: null };
      const row: WebhookEventListRow = {
        event_id: eventId,
        event_type: eventType,
        status: "received",
        signature_valid: flag(event.data, "signatureValid") ?? true,
        rzp_created_at: null,
        received_at: nowIso,
        duplicate_count: 0,
        processed_at: null,
        last_error: null,
      };
      return { rows: [row, ...rows], changed: eventId };
    }
    case "event.duplicate": {
      if (!existing) return { rows: [...rows], changed: null };
      const next = [...rows];
      next[index] = { ...existing, duplicate_count: existing.duplicate_count + 1 };
      return { rows: next, changed: eventId };
    }
    case "event.rejected": {
      const reason = text(event.data, "reason") ?? "invalid_signature";
      if (existing) {
        const next = [...rows];
        next[index] = { ...existing, signature_valid: false, status: "ignored", last_error: reason };
        return { rows: next, changed: eventId };
      }
      const row: WebhookEventListRow = {
        event_id: eventId,
        event_type: eventType,
        status: "ignored",
        signature_valid: false,
        rzp_created_at: null,
        received_at: nowIso,
        duplicate_count: 0,
        processed_at: nowIso,
        last_error: reason,
      };
      return { rows: [row, ...rows], changed: eventId };
    }
    case "event.processed": {
      const status = text(event.data, "status") === "ignored" ? "ignored" : "processed";
      const reason = text(event.data, "reason") ?? null;
      if (existing) {
        const next = [...rows];
        next[index] = { ...existing, status, processed_at: nowIso, last_error: reason };
        return { rows: next, changed: eventId };
      }
      // Ingress-level "ignored" (unknown event type) arrives as event.processed with the notification shape.
      if (text(event.data, "eventType") === undefined) return { rows: [...rows], changed: null };
      const row: WebhookEventListRow = {
        event_id: eventId,
        event_type: eventType,
        status,
        signature_valid: flag(event.data, "signatureValid") ?? true,
        rzp_created_at: null,
        received_at: nowIso,
        duplicate_count: 0,
        processed_at: nowIso,
        last_error: reason,
      };
      return { rows: [row, ...rows], changed: eventId };
    }
    default:
      return { rows: [...rows], changed: null };
  }
}

/** Append a fetched page, skipping ids already present (a live row may have arrived meanwhile). */
export function appendPage(rows: readonly WebhookEventListRow[], page: readonly WebhookEventListRow[]): WebhookEventListRow[] {
  const seen = new Set(rows.map((row) => row.event_id));
  return [...rows, ...page.filter((row) => !seen.has(row.event_id))];
}

/** Client-side narrowing by id or type for the compact search box. */
export function matchesSearch(row: WebhookEventListRow, query: string): boolean {
  const needle = query.trim().toLowerCase();
  if (needle.length === 0) return true;
  return row.event_id.toLowerCase().includes(needle) || row.event_type.toLowerCase().includes(needle);
}
