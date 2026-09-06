import { describe, expect, it } from "vitest";
import { FAN_MODULES, FAN_SPREAD, MAX_ANGLE, REST_ANGLE, entryAngle, prismGeometry, refract } from "./prismGeometry";

const viewport = { width: 960, height: 280 };

describe("prism geometry", () => {
  it("rests at the resting angle when the pointer is away", () => {
    expect(entryAngle({ ...viewport, pointer: null })).toBe(REST_ANGLE);
    expect(entryAngle({ ...viewport })).toBe(REST_ANGLE);
    expect(entryAngle({ ...viewport, pointer: { x: 100, y: viewport.height / 2 } })).toBeCloseTo(REST_ANGLE, 10);
  });

  it("follows the pointer and stays inside its bounds", () => {
    const high = entryAngle({ ...viewport, pointer: { x: 100, y: 0 } });
    const low = entryAngle({ ...viewport, pointer: { x: 100, y: viewport.height } });
    expect(high).toBeLessThan(REST_ANGLE);
    expect(low).toBeGreaterThan(REST_ANGLE);
    for (const y of [-500, 0, 140, 280, 900]) {
      const angle = entryAngle({ ...viewport, pointer: { x: 0, y } });
      expect(Math.abs(angle)).toBeLessThanOrEqual(MAX_ANGLE + 1e-9);
    }
  });

  it("bends the beam towards the normal on entry", () => {
    expect(refract(0)).toBe(0);
    const angle = 0.4;
    expect(Math.abs(refract(angle))).toBeLessThan(Math.abs(angle));
    expect(refract(-angle)).toBeCloseTo(-refract(angle), 12);
    expect(Number.isFinite(refract(Math.PI / 2))).toBe(true);
  });

  it("spans exactly 18 degrees across seven module rays", () => {
    const scene = prismGeometry({ ...viewport, pointer: null });
    expect(scene.fanRays).toHaveLength(FAN_MODULES.length);
    expect(scene.fanRays.map((ray) => ray.module)).toEqual(FAN_MODULES.map((entry) => entry.module));
    const first = scene.fanRays[0]!.angle;
    const last = scene.fanRays.at(-1)!.angle;
    expect(last - first).toBeCloseTo(FAN_SPREAD, 10);
    // Rays are ordered and each one leaves the same exit point.
    for (let index = 1; index < scene.fanRays.length; index += 1) {
      expect(scene.fanRays[index]!.angle).toBeGreaterThan(scene.fanRays[index - 1]!.angle);
      expect(scene.fanRays[index]!.from).toEqual(scene.exitPoint);
    }
  });

  it("keeps the beam and the prism inside the viewport at any size", () => {
    for (const size of [{ width: 360, height: 200 }, { width: 960, height: 280 }, { width: 1920, height: 420 }]) {
      const scene = prismGeometry({ ...size, pointer: { x: size.width / 3, y: 0 } });
      const [apex, right, left] = scene.triangle;
      expect(apex.y).toBeGreaterThan(0);
      expect(left.x).toBeGreaterThan(0);
      expect(right.x).toBeLessThan(size.width);
      expect(scene.entry.from.x).toBe(0);
      expect(scene.exitPoint.y).toBeGreaterThan(apex.y);
      expect(scene.exitPoint.y).toBeLessThan(right.y);
      // The fan must actually leave the frame, otherwise the labels sit on top of the prism.
      expect(Math.max(...scene.fanRays.map((ray) => ray.to.x))).toBeGreaterThan(size.width * 0.9);
    }
  });

  it("moves the exit point when the pointer moves", () => {
    const up = prismGeometry({ ...viewport, pointer: { x: 100, y: 0 } });
    const down = prismGeometry({ ...viewport, pointer: { x: 100, y: viewport.height } });
    expect(up.exitPoint.y).not.toBeCloseTo(down.exitPoint.y, 3);
    expect(up.fanRays[0]!.angle).toBeLessThan(down.fanRays[0]!.angle);
  });

  it("gives the prism a body: a size every renderer scales with and an extrusion to the back face", () => {
    const small = prismGeometry({ width: 480, height: 160, pointer: null });
    const large = prismGeometry({ width: 1440, height: 480, pointer: null });
    expect(small.size).toBeGreaterThan(0);
    expect(large.size).toBeCloseTo(small.size * 3, 6);
    // The extrusion is a fixed fraction of the size, so the prism keeps its proportions at any canvas size.
    expect(small.depth.x / small.size).toBeCloseTo(large.depth.x / large.size, 12);
    expect(small.depth.y).toBeLessThan(0);
    expect(Math.hypot(small.depth.x, small.depth.y)).toBeLessThan(small.size);
  });
});
