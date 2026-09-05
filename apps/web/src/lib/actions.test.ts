import { describe, expect, it } from "vitest";
import { formatBound, mergeActionEvent, mergePendingEvent, ruleSummary, timelineEntries } from "./actions";
import type { StreamEvent } from "./sse";
import type { ActionDetail, ActionListRow, ActionRow } from "./types";

const action: ActionRow = {
  id: "a1",
  idempotency_key: "checkout_recovery:payment:pay_1:1",
  module: "checkout_recovery",
  module_version: "v1",
  trigger_event_id: "evt_1",
  diagnosis_id: null,
  entity_type: "payment",
  entity_id: "pay_1",
  customer_id: "cus_1",
  kind: "whatsapp_retry_link",
  summary: "Send a retry link",
  proposal: { explanation: ["step one", "step two"] },
  bounds: [
    { rule: "cooldown", limit: 24, actual: 30, pass: true },
    { rule: "quiet_hours_local", limit: "21-8", actual: 1, pass: false, note: "inside quiet hours" },
  ],
  money_impact_paise: 0,
  expected_recovery_paise: 149900,
  requires_approval: false,
  status: "proposed",
  reason: null,
  decided_by: null,
  decided_at: null,
  executed_at: null,
  result: null,
  created_at: "2026-09-06T10:00:00.000Z",
  updated_at: "2026-09-06T10:00:00.000Z",
};

function envelope(name: StreamEvent["name"], data: unknown): StreamEvent {
  return { seq: 1, name, data, receivedAt: 0 };
}

describe("actions helpers", () => {
  it("prepends a proposal that matches the filters and replaces a known row", () => {
    const first = mergeActionEvent([], envelope("action.proposed", { eventId: "evt_1", action }), { module: "checkout_recovery" });
    expect(first.changed).toBe("a1");
    expect(first.rows[0]).toMatchObject({ id: "a1", diagnosis_degraded: null });
    const executed = mergeActionEvent(first.rows, envelope("action.executed", { actionId: "a1", action: { ...action, status: "executed" }, result: {} }));
    expect(executed.rows[0]?.status).toBe("executed");
    expect(executed.rows).toHaveLength(1);
  });

  it("drops a row that stops matching a status filter and ignores foreign modules", () => {
    const rows: ActionListRow[] = [{ ...action, status: "pending_approval", diagnosis_degraded: false, diagnosis_provider: "openai" }];
    const gone = mergeActionEvent(rows, envelope("action.executed", { actionId: "a1", action: { ...action, status: "executed" }, result: {} }), { status: "pending_approval" });
    expect(gone.rows).toHaveLength(0);
    const other = mergeActionEvent([], envelope("action.proposed", { eventId: "evt_2", action: { ...action, id: "a2", module: "b2b_negotiator" } }), { module: "checkout_recovery" });
    expect(other.rows).toHaveLength(0);
    expect(other.changed).toBeNull();
  });

  it("keeps the pending queue honest", () => {
    const pending = mergePendingEvent([], envelope("action.pending_approval", { eventId: "evt_1", action: { ...action, status: "pending_approval" } }));
    expect(pending.map((row) => row.id)).toEqual(["a1"]);
    expect(mergePendingEvent(pending, envelope("action.executed", { actionId: "a1", action: { ...action, status: "executed" }, result: {} }))).toHaveLength(0);
  });

  it("formats guard values and counts rules", () => {
    expect(formatBound("auto_approve_limit_paise", 200000)).toBe("₹2,000.00");
    expect(formatBound("max_negotiation_rounds", 3)).toBe("3");
    expect(formatBound("opted_out", false)).toBe("no");
    expect(formatBound("window", { start: 21, end: 8 })).toBe('{"start":21,"end":8}');
    expect(ruleSummary(action.bounds)).toEqual({ passed: 1, failed: 1 });
  });

  it("orders the timeline oldest first with every source", () => {
    const detail: ActionDetail = {
      action: { ...action, status: "executed", decided_at: "2026-09-06T10:01:00.000Z", decided_by: "human:a", executed_at: "2026-09-06T10:02:00.000Z" },
      diagnosis: null,
      outbound_messages: [{ id: "m1", action_id: "a1", channel: "whatsapp", recipient_masked: "+91••••3210", locale: "en-IN", template: "retry_link", payload: {}, status: "simulated_sent", suppressed_reason: null, created_at: "2026-09-06T10:02:00.000Z" }],
      ledger_entries: [{ id: 1, account: "recovered_revenue", debit_paise: 0, credit_paise: 149900, currency: "INR", ref_type: "action", ref_id: "a1", memo: null, created_at: "2026-09-06T10:03:00.000Z" }],
      audit: [{ id: 1, actor: "human:a", action: "action.approval_granted", entity_type: "action", entity_id: "a1", before: null, after: null, metadata: { note: "looks right" }, created_at: "2026-09-06T10:01:00.000Z" }],
    };
    const titles = timelineEntries(detail).map((entry) => entry.title);
    expect(titles[0]).toBe("Proposed by checkout recovery");
    expect(titles).toContain("Approved by human:a");
    expect(titles).toContain("Simulated whatsapp message");
    expect(titles).toContain("Ledger recovered revenue");
    expect(titles.at(-1)).toBe("Ledger recovered revenue");
  });
});
