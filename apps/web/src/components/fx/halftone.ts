/**
 * Pure math for the HalftoneField (Design.md §5.2).
 * Intent: keep the field function testable and free of canvas code; the component only walks the grid and draws.
 * Flow: rotate the cell centre by 35° -> evaluate a slowly flowing ribbon (base wave + half-amplitude octave) ->
 *       smoothstep it into 0..1 -> map to a dot radius; radii beyond half the pitch merge into solid cells.
 */
const ROTATION = (35 * Math.PI) / 180;
const COS = Math.cos(ROTATION);
const SIN = Math.sin(ROTATION);

/** Field units per pixel: a ribbon spans roughly six cells at the default pitch. */
export const FIELD_SCALE = 6;

export function clamp01(value: number): number {
  return value < 0 ? 0 : value > 1 ? 1 : value;
}

export function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = clamp01((x - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
}

/** Field strength 0..1 at field coordinates (x, y) and time t; `intensity` 0..1 scales the wave amplitude. */
export function fieldValue(x: number, y: number, t: number, intensity: number): number {
  const u = x * COS - y * SIN;
  const v = x * SIN + y * COS;
  const amplitude = 0.5 * clamp01(intensity);
  const base = Math.sin(0.9 * u + 0.6 * Math.sin(1.7 * v + t) + t * 0.4);
  const octave = Math.sin(1.8 * u + 1.2 * Math.sin(3.4 * v + 1.3 * t) + t * 0.8);
  // Both waves sit in [-1, 1]; the octave contributes at half amplitude and the sum is normalised back to [-1, 1].
  const signal = 0.5 + amplitude * ((base + 0.5 * octave) / 1.5);
  return smoothstep(0.35, 0.85, signal);
}

/** Dot radius for a field value: pinpoints in the dark, merging squares where the field is bright. */
export function dotRadius(pitch: number, field: number): number {
  return pitch * (0.06 + 0.5 * clamp01(field));
}

export interface HalftoneCell {
  readonly x: number;
  readonly y: number;
  readonly radius: number;
  readonly merged: boolean;
}

/** Every cell for a width×height area at time t (pixel space). Exported so a test can inspect one frame. */
export function halftoneCells(width: number, height: number, pitch: number, t: number, intensity: number): HalftoneCell[] {
  const cells: HalftoneCell[] = [];
  const scale = 1 / (pitch * FIELD_SCALE);
  const half = pitch / 2;
  for (let y = half; y < height + half; y += pitch) {
    for (let x = half; x < width + half; x += pitch) {
      const radius = dotRadius(pitch, fieldValue(x * scale, y * scale, t, intensity));
      cells.push({ x, y, radius, merged: radius > half });
    }
  }
  return cells;
}
