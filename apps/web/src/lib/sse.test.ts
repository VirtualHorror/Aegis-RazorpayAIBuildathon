import { describe, expect, it } from "vitest";
import { backoffDelayMs, filterEvents, parseEventData, pushBounded, type StreamEvent } from "./sse";

describe("sse helpers", () => {
  it("backs off exponentially from 1 s and caps at 10 s", () => {
    expect([1, 2, 3, 4, 5, 6, 40].map(backoffDelayMs)).toEqual([1_000, 2_000, 4_000, 8_000, 10_000, 10_000, 10_000]);
    expect(backoffDelayMs(0)).toBe(1_000);
    expect(backoffDelayMs(Number.NaN)).toBe(1_000);
  });

  it("keeps the newest 200 events, newest first", () => {
    let list: number[] = [];
    for (let index = 1; index <= 250; index += 1) list = pushBounded(list, index);
    expect(list).toHaveLength(200);
    expect(list[0]).toBe(250);
    expect(list.at(-1)).toBe(51);
  });

  it("never drops a malformed payload", () => {
    expect(parseEventData('{"eventId":"evt_1"}')).toEqual({ eventId: "evt_1" });
    const malformed = parseEventData("{oops");
    expect(malformed).toMatchObject({ raw: "{oops" });
    expect(typeof (malformed as { parseError: string }).parseError).toBe("string");
  });

  it("filters by event name and returns everything for an empty filter", () => {
    const events: StreamEvent[] = [
      { seq: 2, name: "action.executed", data: {}, receivedAt: 2 },
      { seq: 1, name: "event.received", data: {}, receivedAt: 1 },
    ];
    expect(filterEvents(events, ["event.received"]).map((event) => event.seq)).toEqual([1]);
    expect(filterEvents(events).map((event) => event.seq)).toEqual([2, 1]);
    expect(filterEvents(events, [])).toHaveLength(2);
  });
});
