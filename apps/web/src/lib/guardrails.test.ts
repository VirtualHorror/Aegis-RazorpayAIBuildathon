import { describe, expect, it } from "vitest";
import { formatGuardrail, parseGuardrail } from "./guardrails";

describe("guardrail editing", () => {
  it("converts rupees to integer paise without floating point", () => {
    expect(parseGuardrail("auto_approve_limit_paise", "2000")).toEqual({ ok: true, value: 200_000 });
    expect(parseGuardrail("auto_approve_limit_paise", "1499.99")).toEqual({ ok: true, value: 149_999 });
    expect(parseGuardrail("auto_approve_limit_paise", "0.05")).toEqual({ ok: true, value: 5 });
    expect(parseGuardrail("auto_approve_limit_paise", "1,499")).toMatchObject({ ok: false });
    expect(parseGuardrail("auto_approve_limit_paise", "12.345")).toMatchObject({ ok: false });
    expect(formatGuardrail("auto_approve_limit_paise", 149_999)).toBe("1499.99");
    expect(formatGuardrail("auto_approve_limit_paise", 200_000)).toBe("2000");
  });

  it("bounds percentages, counts and hours the way the API does", () => {
    expect(parseGuardrail("max_discount_pct", "15")).toEqual({ ok: true, value: 15 });
    expect(parseGuardrail("max_discount_pct", "101")).toMatchObject({ ok: false });
    expect(parseGuardrail("max_dunning_retries", "3")).toEqual({ ok: true, value: 3 });
    expect(parseGuardrail("max_dunning_retries", "3.5")).toMatchObject({ ok: false });
    expect(parseGuardrail("attribution_window_hours", "0")).toMatchObject({ ok: false });
    expect(parseGuardrail("attribution_window_hours", "72")).toEqual({ ok: true, value: 72 });
  });

  it("reads schedules and quiet hours in their own notation", () => {
    expect(parseGuardrail("dunning_schedule_hours", "24, 72,168")).toEqual({ ok: true, value: [24, 72, 168] });
    expect(parseGuardrail("dunning_schedule_hours", "")).toMatchObject({ ok: false });
    expect(parseGuardrail("quiet_hours_local", "21-8")).toEqual({ ok: true, value: { start: 21, end: 8 } });
    expect(parseGuardrail("quiet_hours_local", "21 to 8")).toEqual({ ok: true, value: { start: 21, end: 8 } });
    expect(parseGuardrail("quiet_hours_local", "24-8")).toMatchObject({ ok: false });
    expect(formatGuardrail("quiet_hours_local", { start: 21, end: 8 })).toBe("21-8");
    expect(formatGuardrail("dunning_schedule_hours", [24, 72])).toBe("24, 72");
  });

  it("refuses an unknown key and non-boolean switches", () => {
    expect(parseGuardrail("not_a_guardrail", "1")).toMatchObject({ ok: false });
    expect(parseGuardrail("kill_switch", "yes")).toMatchObject({ ok: false });
    expect(parseGuardrail("kill_switch", "true")).toEqual({ ok: true, value: true });
  });
});
