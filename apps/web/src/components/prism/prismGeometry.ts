/**
 * Pure geometry for the prism hero (Design.md §5.1).
 * Intent: both renderers (WebGPU and Canvas 2D) draw the same scene, so the maths lives here and is unit-tested;
 *         neither renderer decides where anything is.
 * Flow: place an equilateral-ish triangle in the viewport -> aim the entry beam at its left face from the pointer ->
 *       bend it once on entry (Snell, n≈1.5) -> exit on the right face -> fan seven wavelengths across 18°.
 */

export interface Point {
  readonly x: number;
  readonly y: number;
}

export interface Segment {
  readonly from: Point;
  readonly to: Point;
}

export interface FanRay {
  /** Radians, measured from the +x axis, y down. */
  readonly angle: number;
  /** Module key whose spectrum colour this ray carries (Design.md §2). */
  readonly module: string;
  readonly color: string;
  readonly from: Point;
  readonly to: Point;
}

export interface PrismScene {
  readonly triangle: readonly [Point, Point, Point];
  readonly entry: Segment;
  readonly internal: Segment;
  readonly exit: Segment;
  readonly specular: Segment;
  readonly fanRays: readonly FanRay[];
  /** Where the fan starts, i.e. the exit point on the right face. */
  readonly exitPoint: Point;
}

export interface PrismInput {
  readonly width: number;
  readonly height: number;
  /** Pointer in viewport pixels, or null when it has left: the beam eases back to the resting angle. */
  readonly pointer?: Point | null;
}

/** Module order across the fan, red to violet, matching the spectrum in Design.md §2. */
export const FAN_MODULES: readonly { module: string; color: string }[] = [
  { module: "checkout_recovery", color: "#ff4d4d" },
  { module: "subscription_salvager", color: "#ffb020" },
  { module: "b2b_negotiator", color: "#3ddc84" },
  { module: "chargeback_evidence", color: "#3b82f6" },
  { module: "x402", color: "#a855f7" },
  { module: "compliance", color: "#22d3ee" },
  { module: "nlq", color: "#f472b6" },
];

/** Total angular spread of the fan, in radians (18° per Design.md §5.1). */
export const FAN_SPREAD = (18 * Math.PI) / 180;
/** Refractive index of the glass. */
export const INDEX = 1.5;
/** Entry angle when the pointer is away, in radians below horizontal. */
export const REST_ANGLE = (10 * Math.PI) / 180;
/** How far the entry angle may swing with the pointer. */
export const MAX_ANGLE = (26 * Math.PI) / 180;

export function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}

/**
 * Entry angle in radians for a pointer position: above the beam line tilts it down, below tilts it up, bounded by
 * ±MAX_ANGLE. A null pointer returns the resting angle so the scene is never dependent on input.
 */
export function entryAngle(input: PrismInput): number {
  const { height, pointer } = input;
  if (!pointer || height <= 0) return REST_ANGLE;
  const centred = (pointer.y - height / 2) / (height / 2);
  return clamp(REST_ANGLE + centred * MAX_ANGLE, -MAX_ANGLE, MAX_ANGLE);
}

/** Snell's law for the entry face, returning the refracted angle inside the glass. */
export function refract(angle: number, index: number = INDEX): number {
  const sine = clamp(Math.sin(angle) / index, -1, 1);
  return Math.asin(sine);
}

function lerp(from: Point, to: Point, t: number): Point {
  return { x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t };
}

/**
 * Build the whole scene for a viewport.
 * The triangle is centred horizontally at 52 % width; the beam enters its left face at 45 % height and exits the right
 * face, where the fan opens. Everything scales with `height`, so the shape is identical at any size.
 */
export function prismGeometry(input: PrismInput): PrismScene {
  const { width, height } = input;
  const size = Math.min(height * 0.7, width * 0.32);
  const cx = width * 0.52;
  const cy = height * 0.54;
  const apex: Point = { x: cx, y: cy - size * 0.62 };
  const left: Point = { x: cx - size * 0.55, y: cy + size * 0.5 };
  const right: Point = { x: cx + size * 0.55, y: cy + size * 0.5 };

  const angle = entryAngle(input);
  const hitLeft = lerp(apex, left, 0.55);
  const entryFrom: Point = { x: 0, y: hitLeft.y - Math.tan(angle) * hitLeft.x };
  const entry: Segment = { from: entryFrom, to: hitLeft };

  // The refracted ray travels to the right face; the exit height follows the bend, so a steeper pointer angle lifts it.
  const inside = refract(angle);
  const hitRight = lerp(apex, right, 0.62);
  const exitPoint: Point = { x: hitRight.x, y: clamp(hitLeft.y + Math.tan(inside) * (hitRight.x - hitLeft.x), apex.y + size * 0.1, right.y - size * 0.05) };
  const internal: Segment = { from: hitLeft, to: exitPoint };

  const rayLength = Math.max(width - exitPoint.x, height) * 1.05;
  const centreAngle = angle * 0.55;
  const fanRays = FAN_MODULES.map((entryModule, index) => {
    const offset = FAN_MODULES.length === 1 ? 0 : (index / (FAN_MODULES.length - 1) - 0.5) * FAN_SPREAD;
    const rayAngle = centreAngle + offset;
    return {
      module: entryModule.module,
      color: entryModule.color,
      angle: rayAngle,
      from: exitPoint,
      to: { x: exitPoint.x + Math.cos(rayAngle) * rayLength, y: exitPoint.y + Math.sin(rayAngle) * rayLength },
    };
  });

  const exit: Segment = { from: exitPoint, to: fanRays[Math.floor(FAN_MODULES.length / 2)]?.to ?? exitPoint };
  const specular: Segment = { from: exitPoint, to: { x: width, y: exitPoint.y + Math.tan(centreAngle) * (width - exitPoint.x) } };

  return { triangle: [apex, right, left], entry, internal, exit, specular, fanRays, exitPoint };
}
