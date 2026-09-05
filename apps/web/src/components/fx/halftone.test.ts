import { describe, expect, it } from "vitest";
import { dotRadius, fieldValue, halftoneCells, smoothstep } from "./halftone";

describe("halftone field", () => {
  it("smoothstep is clamped and monotonic", () => {
    expect(smoothstep(0.35, 0.85, 0)).toBe(0);
    expect(smoothstep(0.35, 0.85, 1)).toBe(1);
    expect(smoothstep(0.35, 0.85, 0.6)).toBeGreaterThan(smoothstep(0.35, 0.85, 0.5));
  });

  it("stays pinpoints at zero intensity and merges somewhere at full intensity", () => {
    const quiet = halftoneCells(280, 140, 14, 1.3, 0);
    expect(quiet.every((cell) => !cell.merged)).toBe(true);
    expect(new Set(quiet.map((cell) => cell.radius.toFixed(4))).size).toBe(1);
    const loud = halftoneCells(560, 280, 14, 1.3, 1);
    expect(loud.some((cell) => cell.merged)).toBe(true);
    expect(loud.some((cell) => !cell.merged)).toBe(true);
  });

  it("keeps the field and radius inside their bounds for many samples", () => {
    for (let index = 0; index < 500; index += 1) {
      const value = fieldValue((index * 0.37) % 9, (index * 0.53) % 7, index * 0.11, (index % 11) / 10);
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThanOrEqual(1);
      const radius = dotRadius(14, value);
      expect(radius).toBeGreaterThanOrEqual(14 * 0.06);
      expect(radius).toBeLessThanOrEqual(14 * 0.56);
    }
  });

  it("covers the whole area with one cell per pitch square", () => {
    expect(halftoneCells(140, 70, 14, 0, 0.5)).toHaveLength(10 * 5);
  });
});
