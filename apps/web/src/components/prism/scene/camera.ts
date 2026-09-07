/**
 * The one camera in the scene, and the wall it decides the size of. Ported from `vercel-labs/vgpu`
 * (`apps/docs/.../prism-background/scene/camera.ts`).
 *
 * Intent: the wall is the picture. A frame that saw past a corner of it would end in a hard edge
 * against an empty room, so rather than pick a wall size and hope, the relationship runs the other
 * way: `wallCoverage` walks the frustum's corners to the wall plane and `wallHalfHeight` returns the
 * size that covers the worst of them over every position the pointer can put the camera in.
 *
 * The pointer only ever moves the view a few degrees off its resting angle. That is deliberate: the
 * ribbons live on a world-space sheet inside the glass, so moving the camera only changes their
 * projection — and a small swing is enough to reveal their separation from the wall.
 */

import { perspectiveCamera, type SceneCamera } from "vgpu/scene";

import {
  CAMERA_DISTANCE,
  CAMERA_FOV_DEGREES,
  CAMERA_ORBIT_DEGREES,
  CAMERA_PITCH_DEGREES,
  CAMERA_YAW_DEGREES,
  type Vec3,
} from "./constants";

/** Slack on the derived wall size, covering the gap between sampled frustum corners. */
const WALL_SAFETY = 1.02;

/** Last answer from `wallHalfHeight`, which costs nine cameras and is read while assembling uniforms. */
let memoizedAspect = 0;
let memoizedDistance = 0;
let memoizedFov = 0;
let memoizedHalfHeight = 0;

export interface CameraView {
  readonly camera: SceneCamera;
  readonly viewProjection: Float32Array;
  readonly position: Vec3;
  /** Orthonormal basis: where the camera looks, and the frame's axes. */
  readonly forward: Vec3;
  readonly right: Vec3;
  readonly up: Vec3;
}

/**
 * The camera for a pointer position, both components in [-1, 1] with 0 at rest. It swings on a sphere
 * around the origin and keeps looking at it, so the prism stays put in the frame and only the parallax
 * against the wall behind it moves.
 */
export function cameraView(
  aspect: number,
  orbitX = 0,
  orbitY = 0,
  distance = CAMERA_DISTANCE,
  fov = CAMERA_FOV_DEGREES,
): CameraView {
  const limit = CAMERA_ORBIT_DEGREES;
  const yaw = radians(CAMERA_YAW_DEGREES + clamp(orbitX, -1, 1) * limit);
  const pitch = radians(CAMERA_PITCH_DEGREES - clamp(orbitY, -1, 1) * limit);
  const cosPitch = Math.cos(pitch);
  const position: Vec3 = [
    Math.sin(yaw) * cosPitch * distance,
    Math.sin(pitch) * distance,
    Math.cos(yaw) * cosPitch * distance,
  ];
  const forward = normalize([-position[0], -position[1], -position[2]]);
  const right = normalize(cross(forward, [0, 1, 0]));
  const camera = perspectiveCamera({
    fov,
    aspect,
    // The whole scene sits between the wall at z = 0 and the glass in front of it, so the depth range
    // only has to bracket a couple of units.
    near: 0.05,
    far: 4 * distance,
    position,
    target: [0, 0, 0],
  });
  return { camera, viewProjection: camera.viewProjection, position, forward, right, up: cross(right, forward) };
}

/**
 * Half-height of the wall, in scene units, for a canvas of this shape. Derived, not chosen: an
 * off-axis camera keystones the wall and a wide canvas widens the frustum, so this returns the worst
 * case over the pointer's whole swing — exactly the size that guarantees the frame never sees past the
 * lit wall. Nothing optical scales with it; the prism, lamp and their distances are fixed in scene
 * units, so a taller wall is the same picture with more room in the corners.
 */
export function wallHalfHeight(
  aspect: number,
  distance = CAMERA_DISTANCE,
  fov = CAMERA_FOV_DEGREES,
): number {
  if (aspect === memoizedAspect && distance === memoizedDistance && fov === memoizedFov) {
    return memoizedHalfHeight;
  }
  let worst = 0;
  for (const orbitX of [-1, 0, 1]) {
    for (const orbitY of [-1, 0, 1]) {
      worst = Math.max(worst, wallCoverage(aspect, orbitX, orbitY, distance, fov));
    }
  }
  memoizedAspect = aspect;
  memoizedDistance = distance;
  memoizedFov = fov;
  memoizedHalfHeight = worst * WALL_SAFETY;
  return memoizedHalfHeight;
}

/**
 * How much of a unit-height wall the frame needs, as a fraction of it. Measured by walking the four
 * corner rays of the frustum to the wall plane, which is the only place a shortfall could appear.
 */
export function wallCoverage(
  aspect: number,
  orbitX = 0,
  orbitY = 0,
  distance = CAMERA_DISTANCE,
  fov = CAMERA_FOV_DEGREES,
): number {
  const view = cameraView(aspect, orbitX, orbitY, distance, fov);
  const tanHalfFov = Math.tan(radians(fov) / 2);
  let worst = 0;
  for (const horizontal of [-1, 1]) {
    for (const vertical of [-1, 1]) {
      const direction = [0, 1, 2].map(
        (axis) =>
          view.forward[axis]! +
          view.right[axis]! * horizontal * tanHalfFov * aspect +
          view.up[axis]! * vertical * tanHalfFov,
      ) as unknown as Vec3;
      // The camera is on the +z side of the wall and looking towards it, so every corner ray crosses
      // z = 0 at a positive distance.
      if (direction[2] >= 0) return Infinity;
      const t = -view.position[2] / direction[2];
      worst = Math.max(
        worst,
        Math.abs(view.position[0] + direction[0] * t) / aspect,
        Math.abs(view.position[1] + direction[1] * t),
      );
    }
  }
  return worst;
}

/** Half-extents of the wall rectangle in scene units, for a canvas of this shape. */
export function wallExtent(
  aspect: number,
  distance = CAMERA_DISTANCE,
  fov = CAMERA_FOV_DEGREES,
): readonly [number, number] {
  const halfHeight = wallHalfHeight(aspect, distance, fov);
  return [halfHeight * aspect, halfHeight];
}

/**
 * Overscanned wall extent used only when building the light mesh. Keeps the rainbow's dark tail
 * outside narrow portrait canvases: the mesh is clipped by the real render target anyway, so
 * overscanning only changes where normalized outgoing travel reaches one.
 */
export function lightWallExtent(
  aspect: number,
  distance = CAMERA_DISTANCE,
  fov = CAMERA_FOV_DEGREES,
): readonly [number, number] {
  const extent = wallExtent(aspect, distance, fov);
  const overscan = Math.min(2.5, Math.max(1, 1 / Math.max(aspect, 1e-3)));
  return [extent[0] * overscan, extent[1] * overscan];
}

/** Column-major XYZ rotation, used for the studio environment's orientation. */
export function rotationMatrix(degrees: Vec3): Float32Array {
  const [x, y, z] = degrees.map(radians) as [number, number, number];
  const [sx, cx] = [Math.sin(x), Math.cos(x)];
  const [sy, cy] = [Math.sin(y), Math.cos(y)];
  const [sz, cz] = [Math.sin(z), Math.cos(z)];
  return new Float32Array([
    cy * cz, cy * sz, -sy, 0,
    sx * sy * cz - cx * sz, sx * sy * sz + cx * cz, sx * cy, 0,
    cx * sy * cz + sx * sz, cx * sy * sz - sx * cz, cx * cy, 0,
    0, 0, 0, 1,
  ]);
}

function radians(degrees: number): number {
  return (degrees * Math.PI) / 180;
}

function clamp(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, value));
}

function cross(a: Vec3, b: Vec3): Vec3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

function normalize(value: Vec3): Vec3 {
  const length = Math.hypot(value[0], value[1], value[2]) || 1;
  return [value[0] / length, value[1] / length, value[2] / length];
}
