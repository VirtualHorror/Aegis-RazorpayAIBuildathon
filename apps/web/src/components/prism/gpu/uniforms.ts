/**
 * The two uniform blocks the hero's draws read, ported from `vercel-labs/vgpu`
 * (`apps/docs/.../prism-background/runtime/uniforms.ts`).
 *
 * `Scene` (scene.wgsl) is shared by the light draws; `Glass` (glass-common.wgsl) by both glass
 * interfaces. Field names and order match those WGSL structs exactly — vgpu packs by name, so a
 * rename here is a silent binding change.
 */

import { rotationMatrix, wallExtent } from "../scene/camera";
import { CAMERA_DISTANCE, CAMERA_FOV_DEGREES, lampAt, PRISM_BACK_Z, PRISM_FRONT_Z, PRISM_GLASS, PRISM_LIGHT_FADE, PRISM_LIGHT_PLANE_Z, PRISM_TRIANGLE } from "../scene/constants";
import { LIGHT_INTERNAL_SEGMENTS, type LightMeshLayout } from "../scene/light-mesh";
import { prismPlanes } from "../scene/prism-mesh";
import { ENVIRONMENT_SIZE, ENVIRONMENT_TEXEL_ANGLE } from "./environment";
import type { PrismRuntime } from "./runtime";

const ENVIRONMENT_ROTATION = rotationMatrix(PRISM_GLASS.environmentRotation);
const PRISM_PLANES = prismPlanes();

/** Schlick's normal-incidence reflectance, rounded the way the shader's f32 math would. */
export function schlickFresnelF0(ior: number): number {
  const shaderIor = Math.fround(ior);
  const ratio = Math.fround(Math.fround(shaderIor - 1) / Math.fround(shaderIor + 1));
  return Math.fround(ratio * ratio);
}

export function runtimeWallExtent(runtime: PrismRuntime): readonly [number, number] {
  return wallExtent(runtime.aspect, CAMERA_DISTANCE, CAMERA_FOV_DEGREES);
}

/**
 * `beamWidthReveal` opens the beam from its centre line during the intro; `layout` is the mesh
 * topology the shader decodes `@builtin(vertex_index)` against.
 */
export function sceneUniforms(
  runtime: PrismRuntime,
  beamWidthReveal: number,
  layout: LightMeshLayout,
): Record<string, unknown> {
  const light = lampAt(runtime.lampArc, runtime.lampTarget);
  return {
    viewProjection: runtime.view.viewProjection,
    wallHalfExtent: runtimeWallExtent(runtime),
    inputBeamDirection: light.direction,
    // The dark hero stands on black; the wall is the card behind the glass, not a lit surface.
    wallColor: [0, 0, 0],
    causticOnly: 0,
    lightPlaneZ: PRISM_LIGHT_PLANE_Z,
    lightWhiteQuads: layout.whiteQuads,
    lightBeamSlices: layout.beamSlices,
    lightSpectralSamples: layout.samples,
    lightInternalQuads: layout.internalQuads,
    lightInternalSegments: LIGHT_INTERNAL_SEGMENTS,
    lightOpacity: PRISM_LIGHT_FADE.beamOpacity,
    lightEdgeFalloff: PRISM_LIGHT_FADE.edgeFalloff,
    rainbowFalloffRate: PRISM_LIGHT_FADE.rainbowFalloffRate,
    rainbowFalloffPower: PRISM_LIGHT_FADE.rainbowFalloffPower,
    beamWidthReveal: Math.min(1, Math.max(0, beamWidthReveal)),
  };
}

export function glassUniforms(runtime: PrismRuntime): Record<string, unknown> {
  return {
    viewProjection: runtime.view.viewProjection,
    environmentRotation: ENVIRONMENT_ROTATION,
    cameraPosition: runtime.view.position,
    absorption: PRISM_GLASS.absorption,
    prismA: PRISM_TRIANGLE.a,
    prismB: PRISM_TRIANGLE.b,
    prismC: PRISM_TRIANGLE.c,
    environmentSize: ENVIRONMENT_SIZE,
    frontZ: PRISM_FRONT_Z,
    backZ: PRISM_BACK_Z,
    ior: PRISM_GLASS.ior,
    reflectionStrength: PRISM_GLASS.reflectionStrength,
    environmentExposure: PRISM_GLASS.environmentExposure,
    environmentTexelAngle: ENVIRONMENT_TEXEL_ANGLE,
    fresnelF0: schlickFresnelF0(PRISM_GLASS.ior),
    prismPlanes: PRISM_PLANES,
  };
}
