import { describe, expect, it } from "vitest";
import { appendPage, eventFamily, latencyMs, matchesSearch, mergeStreamEvent } from "./events";
import type { StreamEvent } from "./sse";
import type { WebhookEventListRow } from "./types";

const base: WebhookEventListRow = {
  event_id: "evt_1",
  event_type: "payment.failed",
  status: "received",
  signature_valid: true,
  rzp_created_at: null,
  received_at: "2026-09-06T10:00:00.000Z",
  duplicate_count: 0,
  processed_at: null,
  last_error: null,
};

const at = Date.parse("2026-09-06T10:00:05.000Z");

function envelope(name: StreamEvent["name"], data: unknown): StreamEvent {
  return { seq: 1, name, data, receivedAt: at };
}

describe("events feed helpers", () => {
  it("classifies event families for the module colour rail", () => {
    expect(eventFamily("payment.failed")).toBe("payment");
    expect(eventFamily("payment.dispute.created")).toBe("dispute");
    expect(eventFamily("subscription.halted")).toBe("subscription");
    expect(eventFamily("settlement.processed")).toBe("other");
  });

  it("prepends a received event once and ignores a repeat", () => {
    const first = mergeStreamEvent([], envelope("event.received", { eventId: "evt_1", eventType: "payment.failed", status: "accepted", signatureValid: true }), at);
    expect(first.changed).toBe("evt_1");
    expect(first.rows[0]).toMatchObject({ event_id: "evt_1", status: "received", received_at: "2026-09-06T10:00:05.000Z" });
    const again = mergeStreamEvent(first.rows, envelope("event.received", { eventId: "evt_1", eventType: "payment.failed", status: "accepted", signatureValid: true }), at);
    expect(again.changed).toBeNull();
    expect(again.rows).toHaveLength(1);
  });

  it("counts duplicates only for rows on the page", () => {
    expect(mergeStreamEvent([base], envelope("event.duplicate", { eventId: "evt_1", status: "duplicate" }), at).rows[0]?.duplicate_count).toBe(1);
    expect(mergeStreamEvent([base], envelope("event.duplicate", { eventId: "evt_other", status: "duplicate" }), at).changed).toBeNull();
  });

  it("closes a row when the worker reports the outcome", () => {
    const processed = mergeStreamEvent([base], envelope("event.processed", { eventId: "evt_1", status: "processed", actionCount: 1 }), at);
    expect(processed.rows[0]).toMatchObject({ status: "processed", processed_at: "2026-09-06T10:00:05.000Z", last_error: null });
    expect(latencyMs(processed.rows[0]!)).toBe(5_000);
    const ignored = mergeStreamEvent([base], envelope("event.processed", { eventId: "evt_1", status: "ignored", reason: "unknown_event" }), at);
    expect(ignored.rows[0]).toMatchObject({ status: "ignored", last_error: "unknown_event" });
  });

  it("shows a rejected delivery with a bad signature", () => {
    const rejected = mergeStreamEvent([], envelope("event.rejected", { eventId: "unverified:abc", eventType: "payment.failed", status: "rejected", signatureValid: false }), at);
    expect(rejected.rows[0]).toMatchObject({ event_id: "unverified:abc", signature_valid: false, status: "ignored" });
  });

  it("appends pages without duplicating live rows and searches by id or type", () => {
    const rows = appendPage([base], [base, { ...base, event_id: "evt_2", event_type: "order.paid" }]);
    expect(rows.map((row) => row.event_id)).toEqual(["evt_1", "evt_2"]);
    expect(matchesSearch(rows[1]!, "ORDER")).toBe(true);
    expect(matchesSearch(rows[1]!, "evt_9")).toBe(false);
    expect(matchesSearch(rows[1]!, "  ")).toBe(true);
  });
});
