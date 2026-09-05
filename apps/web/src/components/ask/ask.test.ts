import { describe, expect, it } from "vitest";
import { chartScale } from "./ForecastChart";
import { tokenizeSql } from "./SqlBlock";

describe("ask rendering helpers", () => {
  it("colours keywords, functions, strings and numbers without losing a character", () => {
    const sql = "SELECT count(*) AS n FROM actions WHERE status = 'executed' AND created_at > now() - interval '7 days' -- recent\nLIMIT 200";
    const tokens = tokenizeSql(sql);
    expect(tokens.map((token) => token.text).join("")).toBe(sql);
    expect(tokens.filter((token) => token.kind === "kw").map((token) => token.text.toLowerCase())).toContain("select");
    expect(tokens.filter((token) => token.kind === "fn").map((token) => token.text.toLowerCase())).toContain("count");
    expect(tokens.filter((token) => token.kind === "str").map((token) => token.text)).toContain("'executed'");
    expect(tokens.some((token) => token.kind === "cmt" && token.text.includes("recent"))).toBe(true);
    expect(tokens.some((token) => token.kind === "num" && token.text === "200")).toBe(true);
  });

  it("does not treat a quoted keyword as a keyword", () => {
    const tokens = tokenizeSql("SELECT 'from' AS word");
    expect(tokens.find((token) => token.text === "'from'")?.kind).toBe("str");
  });

  it("maps a series onto the plot area with a flat series handled", () => {
    const scale = chartScale(11, 0, 100);
    expect(scale.x(0)).toBeLessThan(scale.x(10));
    expect(scale.y(100)).toBeLessThan(scale.y(0));
    const flat = chartScale(1, 5, 5);
    expect(Number.isFinite(flat.x(0))).toBe(true);
    expect(Number.isFinite(flat.y(5))).toBe(true);
  });
});
