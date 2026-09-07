/**
 * CPU optics, ported from `vercel-labs/vgpu`
 * (`apps/docs/.../prism-background/scene/optics.ts`).
 *
 * Intent: Snell refraction, Fresnel transmission and total internal reflection are solved here for the
 * two boundaries of every wavelength band, deterministically and on the CPU. `light-mesh.ts` turns
 * those paths into the vertices the GPU rasterizes — which is the whole point of the mesh approach: a
 * ray that has already been solved never has to be marched again per pixel.
 */

import {
  PRISM_MAX_INTERNAL_BOUNCES,
  PRISM_WAVELENGTHS,
  type Triangle,
  type Vec2,
  type Vec3,
} from "./constants";

/** Keeps a ray from immediately re-hitting the surface it just left. */
export const SURFACE_EPSILON = 1e-4;

const add = (a: Vec2, b: Vec2): Vec2 => [a[0] + b[0], a[1] + b[1]];
const sub = (a: Vec2, b: Vec2): Vec2 => [a[0] - b[0], a[1] - b[1]];
const scale = (a: Vec2, k: number): Vec2 => [a[0] * k, a[1] * k];
const dot = (a: Vec2, b: Vec2): number => a[0] * b[0] + a[1] * b[1];
const length = (a: Vec2): number => Math.hypot(a[0], a[1]);
const normalize = (a: Vec2): Vec2 => scale(a, 1 / length(a));
/** z of the 3D cross product of two planar vectors: positive when b is left of a. */
const cross = (a: Vec2, b: Vec2): number => a[0] * b[1] - a[1] * b[0];

export { add, cross, dot, normalize, scale, sub };

/** Cauchy's empirical dispersion law, with the wavelength given in nanometres. */
export function iorAt(wavelengthNm: number, base: number, strength: number): number {
  const micrometres = wavelengthNm * 1e-3;
  return base + strength / (micrometres * micrometres);
}

export interface EdgeHit {
  /** Distance along the ray. */
  readonly t: number;
  /** Unit normal pointing out of the triangle. */
  readonly normal: Vec2;
  /** Triangle edge index: a-b, b-c or c-a. */
  readonly edge: number;
}

/**
 * Nearest crossing of the triangle's boundary strictly beyond `minT`.
 *
 * Works from inside and outside: the caller decides what a hit means by looking at the sign of
 * `dot(direction, normal)`.
 */
export function intersectTriangle(
  triangle: Triangle,
  origin: Vec2,
  direction: Vec2,
  minT: number,
): EdgeHit | undefined {
  const vertices: readonly [Vec2, Vec2, Vec2] = [triangle.a, triangle.b, triangle.c];
  let best: EdgeHit | undefined;
  for (let index = 0; index < 3; index++) {
    const edgeStart = vertices[index]!;
    const edgeEnd = vertices[(index + 1) % 3]!;
    const edge = sub(edgeEnd, edgeStart);
    const denominator = cross(direction, edge);
    if (denominator === 0) continue;
    const offset = sub(edgeStart, origin);
    const t = cross(offset, edge) / denominator;
    const s = cross(offset, direction) / denominator;
    if (t <= minT || s < 0 || s > 1) continue;
    if (best && best.t <= t) continue;
    // Counter-clockwise winding puts the interior left of every edge, so rotating the edge clockwise
    // points out of the triangle.
    best = { t, normal: normalize([edge[1], -edge[0]]), edge: index };
  }
  return best;
}

/**
 * Snell's law in the plane. `normal` faces the side the ray comes from and `eta` is the ratio of
 * indices, incident over transmitted.
 *
 * Returns `undefined` on total internal reflection, which is a real outcome here rather than an
 * error: a ray that enters the prism too straight-on hits the second face past the critical angle and
 * bounces instead of leaving.
 */
export function refract(incident: Vec2, normal: Vec2, eta: number): Vec2 | undefined {
  const cosIncident = -dot(incident, normal);
  const sinTransmittedSquared = eta * eta * (1 - cosIncident * cosIncident);
  if (sinTransmittedSquared > 1) return undefined;
  const cosTransmitted = Math.sqrt(1 - sinTransmittedSquared);
  return add(scale(incident, eta), scale(normal, eta * cosIncident - cosTransmitted));
}

export function reflect(incident: Vec2, normal: Vec2): Vec2 {
  return sub(incident, scale(normal, 2 * dot(incident, normal)));
}

/**
 * Fraction of unpolarized light transmitted by one ideal dielectric boundary.
 *
 * `normal` faces the incident medium. The two polarizations are averaged with the exact Fresnel
 * equations; total internal reflection therefore returns 0.
 */
export function fresnelTransmittance(
  incident: Vec2,
  normal: Vec2,
  incidentIor: number,
  transmittedIor: number,
): number {
  const cosIncident = Math.min(1, Math.max(0, -dot(incident, normal)));
  const eta = incidentIor / transmittedIor;
  const sinTransmittedSquared = eta * eta * (1 - cosIncident * cosIncident);
  if (sinTransmittedSquared >= 1) return 0;
  const cosTransmitted = Math.sqrt(1 - sinTransmittedSquared);
  const sNumerator = incidentIor * cosIncident - transmittedIor * cosTransmitted;
  const sDenominator = incidentIor * cosIncident + transmittedIor * cosTransmitted;
  const pNumerator = incidentIor * cosTransmitted - transmittedIor * cosIncident;
  const pDenominator = incidentIor * cosTransmitted + transmittedIor * cosIncident;
  const reflectance = 0.5 * ((sNumerator / sDenominator) ** 2 + (pNumerator / pDenominator) ** 2);
  return 1 - reflectance;
}

export interface PrismPath {
  /** Where the ray left the glass. */
  readonly origin: Vec2;
  /** Unit direction it left with. */
  readonly direction: Vec2;
  /** Internal reflections taken before it got out. */
  readonly bounces: number;
}

export interface DetailedPrismPath extends PrismPath {
  /** Entry, reflection points and final exit, in traversal order. */
  readonly points: readonly Vec2[];
  /** Edge index for every point in `points`. */
  readonly edges: readonly number[];
  /** Fresnel transmission accumulated at entry and final exit. */
  readonly transmission: number;
  /** Fresnel transmission at the air-to-glass interface only. */
  readonly entryTransmission: number;
}

/**
 * Refract a ray through the prism and return the ray that comes out the far side.
 *
 * Flow: `origin` is outside the glass and `direction` points into it. The ray refracts on entry,
 * crosses the interior, and refracts again on exit; when the exit face reflects it instead (total
 * internal reflection) it keeps bouncing inside until it escapes or runs out of bounces.
 */
export function tracePrismDetailed(
  triangle: Triangle,
  origin: Vec2,
  direction: Vec2,
  ior: number,
  maxBounces = PRISM_MAX_INTERNAL_BOUNCES,
): DetailedPrismPath | undefined {
  const entry = intersectTriangle(triangle, origin, direction, SURFACE_EPSILON);
  // A ray that first meets the boundary from behind started inside the glass.
  if (!entry || dot(direction, entry.normal) >= 0) return undefined;

  let position = add(origin, scale(direction, entry.t));
  let inside = refract(direction, entry.normal, 1 / ior);
  if (!inside) return undefined;
  const points: Vec2[] = [position];
  const edges: number[] = [entry.edge];
  const entryTransmission = fresnelTransmittance(direction, entry.normal, 1, ior);
  let transmission = entryTransmission;

  for (let bounces = 0; bounces <= maxBounces; bounces++) {
    const exit = intersectTriangle(triangle, position, inside, SURFACE_EPSILON);
    if (!exit) return undefined;
    position = add(position, scale(inside, exit.t));
    points.push(position);
    edges.push(exit.edge);
    const transmitted = refract(inside, scale(exit.normal, -1), ior);
    if (transmitted) {
      transmission *= fresnelTransmittance(inside, scale(exit.normal, -1), ior, 1);
      return {
        origin: position,
        direction: normalize(transmitted),
        bounces,
        points,
        edges,
        transmission,
        entryTransmission,
      };
    }
    inside = reflect(inside, exit.normal);
  }
  return undefined;
}

/**
 * Analytic approximations of the CIE 1931 colour matching functions.
 * Wyman, Sloan and Shirley, JCGT 2013.
 */
function cieX(wavelengthNm: number): number {
  const t1 = (wavelengthNm - 442.0) * (wavelengthNm < 442.0 ? 0.0624 : 0.0374);
  const t2 = (wavelengthNm - 599.8) * (wavelengthNm < 599.8 ? 0.0264 : 0.0323);
  const t3 = (wavelengthNm - 501.1) * (wavelengthNm < 501.1 ? 0.049 : 0.0382);
  return (
    0.362 * Math.exp(-0.5 * t1 * t1) +
    1.056 * Math.exp(-0.5 * t2 * t2) -
    0.065 * Math.exp(-0.5 * t3 * t3)
  );
}

function cieY(wavelengthNm: number): number {
  const t1 = (wavelengthNm - 568.8) * (wavelengthNm < 568.8 ? 0.0213 : 0.0247);
  const t2 = (wavelengthNm - 530.9) * (wavelengthNm < 530.9 ? 0.0613 : 0.0322);
  return 0.821 * Math.exp(-0.5 * t1 * t1) + 0.286 * Math.exp(-0.5 * t2 * t2);
}

function cieZ(wavelengthNm: number): number {
  const t1 = (wavelengthNm - 437.0) * (wavelengthNm < 437.0 ? 0.0845 : 0.0278);
  const t2 = (wavelengthNm - 459.0) * (wavelengthNm < 459.0 ? 0.0385 : 0.0725);
  return 1.217 * Math.exp(-0.5 * t1 * t1) + 0.681 * Math.exp(-0.5 * t2 * t2);
}

/**
 * CIE standard illuminant D65 at 10 nm intervals from 400 through 700 nm.
 * Source: CIE.DS.hjfjmt59.
 */
const D65_SPECTRAL_POWER = [
  82.7549, 91.486, 93.4318, 86.6823, 104.865, 117.008, 117.812, 114.861, 115.923, 108.811, 109.354,
  107.802, 104.79, 107.689, 104.405, 104.046, 100, 96.3342, 95.788, 88.6856, 90.0062, 89.5991,
  87.6987, 83.2886, 83.6992, 80.0268, 80.2146, 82.2778, 78.2842, 69.7213, 71.6091,
] as const;

/** Peak of D65(lambda) * CIE y-bar(lambda) over the rendered 400-700 nm range. */
const D65_PHOTOPIC_PEAK = 1.0347;
/** One photographic shoulder shared by every wavelength. */
const SPECTRAL_EXPOSURE = 4.5;
/** Global adaptation that makes the complete gamut-mapped D65 spectrum white. */
const SPECTRAL_WHITE_BALANCE: Vec3 = [1.1868, 1, 2.2495];

function d65SpectralPower(wavelengthNm: number): number {
  const coordinate = Math.min(
    D65_SPECTRAL_POWER.length - 1,
    Math.max(0, (wavelengthNm - PRISM_WAVELENGTHS.min) / 10),
  );
  const lower = Math.min(D65_SPECTRAL_POWER.length - 2, Math.floor(coordinate));
  const fraction = coordinate - lower;
  return (D65_SPECTRAL_POWER[lower]! * (1 - fraction) + D65_SPECTRAL_POWER[lower + 1]! * fraction) / 100;
}

/**
 * Positive linear-sRGB radiance for one wavelength under daylight D65.
 *
 * Intent: the CIE response determines both hue and relative brightness. Monochromatic colours lie
 * outside sRGB, so shifting every triplet toward the neutral axis is the smallest positive gamut
 * mapping that preserves its ordering. That happens *before* one shared exposure, so integrating
 * these values across 400-700 nm reconstructs D65 white instead of giving every wavelength the same
 * peak energy.
 *
 * Fresnel transmission is deliberately absent: the ray tracer has already folded the actual
 * entry/exit losses into each mesh vertex intensity.
 */
export function wavelengthToBeamRgb(wavelengthNm: number): Vec3 {
  const wavelength = Math.min(PRISM_WAVELENGTHS.max, Math.max(PRISM_WAVELENGTHS.min, wavelengthNm));
  const x = cieX(wavelength);
  const y = cieY(wavelength);
  const z = cieZ(wavelength);
  const linearRgb: Vec3 = [
    3.2406 * x - 1.5372 * y - 0.4986 * z,
    -0.9689 * x + 1.8758 * y + 0.0415 * z,
    0.0557 * x - 0.204 * y + 1.057 * z,
  ];
  const neutralOffset = Math.min(0, ...linearRgb);
  const positiveRgb: Vec3 = [
    linearRgb[0] - neutralOffset,
    linearRgb[1] - neutralOffset,
    linearRgb[2] - neutralOffset,
  ];
  const huePeak = Math.max(...positiveRgb, Number.EPSILON);
  const relativePhotopicPower = (d65SpectralPower(wavelength) * y) / D65_PHOTOPIC_PEAK;
  const displayPower =
    (1 - Math.exp(-SPECTRAL_EXPOSURE * relativePhotopicPower)) / (1 - Math.exp(-SPECTRAL_EXPOSURE));
  return [
    (positiveRgb[0] / huePeak) * displayPower * SPECTRAL_WHITE_BALANCE[0],
    (positiveRgb[1] / huePeak) * displayPower * SPECTRAL_WHITE_BALANCE[1],
    (positiveRgb[2] / huePeak) * displayPower * SPECTRAL_WHITE_BALANCE[2],
  ];
}
