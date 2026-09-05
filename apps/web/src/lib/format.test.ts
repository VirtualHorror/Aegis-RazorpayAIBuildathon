import { describe, expect, it } from "vitest";
import { formatInr, formatMs, formatPaise, humanize, maskId, moduleLabel, relativeTime } from "./format";

describe("format", () => {
  it("formats paise as Indian-grouped rupees without floating point", () => {
    expect(formatInr(42_000_000)).toBe("₹4,20,000.00");
    expect(formatPaise("149900")).toBe("₹1,499.00");
    expect(formatPaise(null)).toBe("—");
    expect(formatPaise(1.5)).toBe("—");
  });

  it("describes elapsed time in coarse human buckets", () => {
    const now = Date.parse("2026-09-06T10:00:00Z");
    expect(relativeTime("2026-09-06T09:59:55Z", now)).toBe("just now");
    expect(relativeTime("2026-09-06T09:59:10Z", now)).toBe("50s ago");
    expect(relativeTime("2026-09-06T09:30:00Z", now)).toBe("30m ago");
    expect(relativeTime("2026-09-06T04:00:00Z", now)).toBe("6h ago");
    expect(relativeTime("2026-09-05T04:00:00Z", now)).toBe("yesterday");
    expect(relativeTime("2026-09-01T04:00:00Z", now)).toBe("5d ago");
    expect(relativeTime(null, now)).toBe("—");
    expect(relativeTime("not a date", now)).toBe("—");
  });

  it("masks ids to prefix + last four", () => {
    expect(maskId("pay_ABCDEFGHIJKLMN")).toBe("pay_…KLMN");
    expect(maskId("evt_1")).toBe("evt_1");
    expect(maskId("5f1e8a2c-9c0b-4d5e-8f7a-1234567890ab")).toBe("…90ab");
    expect(maskId(null)).toBe("—");
  });

  it("humanizes snake_case and labels modules", () => {
    expect(humanize("pending_approval")).toBe("Pending approval");
    expect(moduleLabel("checkout_recovery")).toBe("Checkout recovery");
    expect(moduleLabel("unknown_module")).toBe("Unknown module");
    expect(formatMs(12.4)).toBe("12 ms");
    expect(formatMs(2_400)).toBe("2.4 s");
  });
});
