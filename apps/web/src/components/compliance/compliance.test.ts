import { describe, expect, it } from "vitest";
import { splitOnSpan } from "./EvidenceHighlight";

describe("evidence highlighting", () => {
  it("splits the description around a verbatim span", () => {
    const parts = splitOnSpan("Guaranteed returns of 20% monthly for every investor.", "Guaranteed returns");
    expect(parts).toEqual({ before: "", match: "Guaranteed returns", after: " of 20% monthly for every investor." });
  });

  it("refuses to highlight a span that is not there verbatim", () => {
    expect(splitOnSpan("Organic cotton overshirt.", "guaranteed returns")).toBeNull();
    expect(splitOnSpan("Organic cotton overshirt.", "Organic Cotton")).toBeNull();
    expect(splitOnSpan("Organic cotton overshirt.", null)).toBeNull();
    expect(splitOnSpan("Organic cotton overshirt.", "")).toBeNull();
    // The status endpoint used to answer without the product copy, which crashed this component (B-015).
    expect(splitOnSpan(undefined, "anything")).toBeNull();
    expect(splitOnSpan(null, "anything")).toBeNull();
  });
});
