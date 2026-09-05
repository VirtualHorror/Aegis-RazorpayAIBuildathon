import { describe, expect, it } from "vitest";
import { FAN_MODULES, FAN_SPREAD, prismGeometry } from "./prismGeometry";
import { hexToRgba, prismUniforms } from "./uniforms";

describe("prism uniforms", () => {
  it("parses hex colours and falls back to white", () => {
    expect(hexToRgba("#ff4d4d")).toEqual([1, 77 / 255, 77 / 255, 1]);
    expect(hexToRgba("#fff")).toEqual([1, 1, 1, 1]);
    expect(hexToRgba("not-a-colour")).toEqual([1, 1, 1, 1]);
  });

  it("packs the scene, the clock and seven module pulses into the shader layout", () => {
    const scene = prismGeometry({ width: 960, height: 280, pointer: null });
    const uniforms = prismUniforms({
      scene,
      width: 960,
      height: 280,
      timeSeconds: 12.5,
      reducedMotion: true,
      activity: { [FAN_MODULES[0]!.module]: 1, [FAN_MODULES[6]!.module]: 0.5, unknown_module: 1 },
    });
    expect(uniforms.resolution_time).toEqual([960, 280, 12.5, 1]);
    expect(uniforms.entry_exit).toEqual([scene.entry.to.x, scene.entry.to.y, scene.exitPoint.x, scene.exitPoint.y]);
    expect(uniforms.left_fan[3]).toBeCloseTo(FAN_SPREAD, 12);
    expect(uniforms.activity_a[0]).toBe(1);
    expect(uniforms.activity_b[2]).toBe(0.5);
    // The eighth slot is unused padding and must stay zero.
    expect(uniforms.activity_b[3]).toBe(0);
    expect(uniforms.color0).toEqual(hexToRgba(FAN_MODULES[0]!.color));
  });

  it("clamps pulses into 0..1 whatever the caller passes", () => {
    const scene = prismGeometry({ width: 400, height: 200, pointer: null });
    const uniforms = prismUniforms({ scene, width: 400, height: 200, timeSeconds: 0, reducedMotion: false, activity: { [FAN_MODULES[1]!.module]: 4, [FAN_MODULES[2]!.module]: -2 } });
    expect(uniforms.activity_a[1]).toBe(1);
    expect(uniforms.activity_a[2]).toBe(0);
    expect(uniforms.resolution_time[3]).toBe(0);
  });
});
