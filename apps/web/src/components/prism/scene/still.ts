/**
 * A flat still of the resting scene, for devices with no WebGPU (C-F4).
 *
 * Intent: the fallback must be the *same picture*, not a different one. Everything here is projected
 * from the constants and the ray tracer the GPU path uses — the prism's real cross-section, the real
 * lamp at the resting incidence, and each module wavelength's real exit point and heading through the
 * real Cauchy dispersion. The only things it drops are the ones that need a GPU: the environment
 * reflection, the bloom chain and the dust.
 *
 * Flow: trace at `PRISM_DEFAULT_ARC` -> project the light plane, the front cap and the back cap through
 * the resting camera -> hand `PrismFallback.tsx` a set of SVG user-space points. Computed once at
 * module scope, so a page render costs nothing.
 */

import { SPECTRUM } from "../legend";
import {
  CAMERA_DISTANCE,
  CAMERA_FOV_DEGREES,
  PRISM_BACK_Z,
  PRISM_DEFAULT_ARC,
  PRISM_DISPERSION,
  PRISM_FRONT_Z,
  PRISM_LIGHT_PLANE_Z,
  PRISM_TRIANGLE,
  lampAt,
  type Vec2,
} from "./constants";
import { iorAt, tracePrismDetailed } from "./optics";

/** SVG user space. The panel is pinned to this ratio so nothing is ever cropped (C-F3). */
export const STILL_WIDTH = 1000;
export const STILL_HEIGHT = 420;
const ASPECT = STILL_WIDTH / STILL_HEIGHT;

export interface StillPoint {
  readonly x: number;
  readonly y: number;
}

export interface StillRay {
  readonly module: string;
  readonly hue: string;
  readonly end: StillPoint;
}

export interface StillScene {
  /** The cross-section at the light plane, the near cap and the far cap, in SVG user space. */
  readonly lightPlane: readonly StillPoint[];
  readonly front: readonly StillPoint[];
  readonly back: readonly StillPoint[];
  /** Where the beam crosses the frame, where it meets the glass, and where it leaves. */
  readonly source: StillPoint;
  readonly entry: StillPoint;
  readonly exit: StillPoint;
  readonly rays: readonly StillRay[];
}

/**
 * World -> SVG. The resting camera looks straight down -z from `CAMERA_DISTANCE`, so a point at depth
 * `z` is magnified by `d / (d - z)`: the near cap reads larger than the far one, which is the whole of
 * the solid's perspective in a flat drawing.
 */
function project(point: Vec2, z: number): StillPoint {
  const halfHeight = Math.tan((CAMERA_FOV_DEGREES * Math.PI) / 180 / 2) * CAMERA_DISTANCE;
  const magnification = CAMERA_DISTANCE / (CAMERA_DISTANCE - z);
  return {
    x: STILL_WIDTH * (0.5 + (point[0] * magnification) / (2 * halfHeight * ASPECT)),
    y: STILL_HEIGHT * (0.5 - (point[1] * magnification) / (2 * halfHeight)),
  };
}

const CORNERS: readonly Vec2[] = [PRISM_TRIANGLE.a, PRISM_TRIANGLE.b, PRISM_TRIANGLE.c];

/** Far enough that the frame, not the ray, is what ends every line. */
const RAY_LENGTH = 4;

export const STILL_SCENE: StillScene = (() => {
  const light = lampAt(PRISM_DEFAULT_ARC, 0.5);
  // Every wavelength enters at the same point; the red band's path supplies it and the exit.
  const reference = tracePrismDetailed(
    PRISM_TRIANGLE,
    light.center,
    light.direction,
    iorAt(SPECTRUM[0]!.wavelengthNm, PRISM_DISPERSION.base, PRISM_DISPERSION.strength),
  );
  if (!reference) throw new Error("The resting lamp must produce a path through the prism.");
  const entry = reference.points[0]!;
  const exit = reference.origin;

  const rays = SPECTRUM.map(({ module, hue, wavelengthNm }): StillRay => {
    const path = tracePrismDetailed(
      PRISM_TRIANGLE,
      light.center,
      light.direction,
      iorAt(wavelengthNm, PRISM_DISPERSION.base, PRISM_DISPERSION.strength),
    );
    // Every band clears the exit face at the resting incidence; falling back to the reference heading
    // keeps the drawing well-formed rather than throwing if a constant is ever retuned.
    const direction = (path ?? reference).direction;
    const origin = (path ?? reference).origin;
    return {
      module,
      hue,
      end: project(
        [origin[0] + direction[0] * RAY_LENGTH, origin[1] + direction[1] * RAY_LENGTH],
        PRISM_LIGHT_PLANE_Z,
      ),
    };
  });

  return {
    lightPlane: CORNERS.map((corner) => project(corner, PRISM_LIGHT_PLANE_Z)),
    front: CORNERS.map((corner) => project(corner, PRISM_FRONT_Z)),
    back: CORNERS.map((corner) => project(corner, PRISM_BACK_Z)),
    source: project(
      [entry[0] - light.direction[0] * RAY_LENGTH, entry[1] - light.direction[1] * RAY_LENGTH],
      PRISM_LIGHT_PLANE_Z,
    ),
    entry: project(entry, PRISM_LIGHT_PLANE_Z),
    exit: project(exit, PRISM_LIGHT_PLANE_Z),
    rays,
  };
})();

export function polygonPoints(points: readonly StillPoint[]): string {
  return points.map(({ x, y }) => `${x.toFixed(2)},${y.toFixed(2)}`).join(" ");
}
