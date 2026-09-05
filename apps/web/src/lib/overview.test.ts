import { describe, expect, it } from "vitest";
import { activityModule, bumpMetrics, flashGroup, upsertAction } from "./overview";
import type { ActionRow, MetricsSummary } from "./types";

const metrics: MetricsSummary = {
  events: { received: 1, duplicates: 0, rejected: 0, processed: 10, dead_letter: 0 },
  actions: { proposed: 3, blocked: 1, pending_approval: 1, executed: 1, rejected: 0 },
  money: { recovered_paise: 0, discounts_granted_paise: 0, x402_revenue_paise: 0, chargeback_exposure_paise: 0 },
  humans: { reviewed: 0, approved: 0, rejected: 0, rejection_rate: 0 },
  llm: { calls: 0, degraded: 0, degraded_rate: 0, avg_latency_ms: 0, by_provider: {} },
  window: "24h",
};

const action = { id: "a1", module: "checkout_recovery", status: "proposed" } as ActionRow;

describe("overview live helpers", () => {
  it("moves counters the way the bus reports them", () => {
    expect(bumpMetrics(metrics, "event.received").events.received).toBe(2);
    const processed = bumpMetrics(metrics, "event.processed").events;
    expect(processed).toMatchObject({ processed: 11, received: 0 });
    expect(bumpMetrics(metrics, "action.executed").actions.executed).toBe(2);
    expect(bumpMetrics(metrics, "x402.settled")).toEqual(metrics);
  });

  it("maps events to the tile group that should flash", () => {
    expect(flashGroup("event.duplicate")).toBe("events");
    expect(flashGroup("action.blocked")).toBe("actions");
    expect(flashGroup("x402.settled")).toBe("x402");
    expect(flashGroup("system.kill_switch")).toBeNull();
  });

  it("keeps the recent list bounded and de-duplicated", () => {
    const list = upsertAction([action, { ...action, id: "a2" }], { ...action, status: "executed" }, 2);
    expect(list.map((row) => row.id)).toEqual(["a1", "a2"]);
    expect(list[0]?.status).toBe("executed");
  });

  it("finds the module behind an envelope", () => {
    expect(activityModule({ seq: 1, name: "action.proposed", data: { eventId: "e", action }, receivedAt: 0 })).toBe("checkout_recovery");
    expect(activityModule({ seq: 1, name: "x402.settled", data: {}, receivedAt: 0 })).toBe("x402");
    expect(activityModule({ seq: 1, name: "event.received", data: {}, receivedAt: 0 })).toBeNull();
  });
});
