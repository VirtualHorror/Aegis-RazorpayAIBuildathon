/**
 * Turn a `PrismScene` and the module activity map into the uniform values `prism.wgsl` expects.
 * Intent: keep the packing pure and testable; the renderer only writes what this returns (Design.md §5.1).
 */
import { FAN_MODULES, FAN_SPREAD, type PrismScene } from "./prismGeometry";

export interface PrismUniforms {
  resolution_time: [number, number, number, number];
  entry_exit: [number, number, number, number];
  apex_right: [number, number, number, number];
  left_fan: [number, number, number, number];
  activity_a: [number, number, number, number];
  activity_b: [number, number, number, number];
  color0: [number, number, number, number];
  color1: [number, number, number, number];
  color2: [number, number, number, number];
  color3: [number, number, number, number];
  color4: [number, number, number, number];
  color5: [number, number, number, number];
  color6: [number, number, number, number];
}

/** `#rrggbb` → linear-ish 0..1 RGBA. */
export function hexToRgba(hex: string): [number, number, number, number] {
  const value = hex.replace("#", "");
  const full = value.length === 3 ? value.split("").map((char) => char + char).join("") : value;
  const number = Number.parseInt(full, 16);
  if (!Number.isFinite(number) || full.length !== 6) return [1, 1, 1, 1];
  return [((number >> 16) & 255) / 255, ((number >> 8) & 255) / 255, (number & 255) / 255, 1];
}

export interface PrismUniformInput {
  scene: PrismScene;
  width: number;
  height: number;
  timeSeconds: number;
  reducedMotion: boolean;
  /** Module key → 0..1 pulse. */
  activity: Readonly<Record<string, number>>;
}

export function prismUniforms(input: PrismUniformInput): PrismUniforms {
  const { scene, width, height, timeSeconds, reducedMotion, activity } = input;
  const centreAngle = scene.fanRays.length > 0 ? (scene.fanRays[0]!.angle + scene.fanRays.at(-1)!.angle) / 2 : 0;
  const pulses = FAN_MODULES.map((entry) => Math.max(0, Math.min(1, activity[entry.module] ?? 0)));
  const colors = FAN_MODULES.map((entry) => hexToRgba(entry.color));
  return {
    resolution_time: [width, height, timeSeconds, reducedMotion ? 1 : 0],
    entry_exit: [scene.entry.to.x, scene.entry.to.y, scene.exitPoint.x, scene.exitPoint.y],
    apex_right: [scene.triangle[0].x, scene.triangle[0].y, scene.triangle[1].x, scene.triangle[1].y],
    left_fan: [scene.triangle[2].x, scene.triangle[2].y, centreAngle, FAN_SPREAD],
    activity_a: [pulses[0] ?? 0, pulses[1] ?? 0, pulses[2] ?? 0, pulses[3] ?? 0],
    activity_b: [pulses[4] ?? 0, pulses[5] ?? 0, pulses[6] ?? 0, 0],
    color0: colors[0] ?? [1, 1, 1, 1],
    color1: colors[1] ?? [1, 1, 1, 1],
    color2: colors[2] ?? [1, 1, 1, 1],
    color3: colors[3] ?? [1, 1, 1, 1],
    color4: colors[4] ?? [1, 1, 1, 1],
    color5: colors[5] ?? [1, 1, 1, 1],
    color6: colors[6] ?? [1, 1, 1, 1],
  };
}
