// Uniform layout and optical helpers shared by the two glass interfaces.
//
// Ported verbatim from vercel-labs/vgpu apart from the orientation-debug environment: Aegis ships
// no debug graph, so `environmentDebug` and the second texture binding it selected are gone and
// `glassEnvironment` reads the one studio map (D-087).

import { env_lod, sample_env } from "./environment-map-common.wgsl";
import { rotateEnvironmentDirection } from "./environment.wgsl";

export struct Glass {
  viewProjection: mat4x4f,
  environmentRotation: mat4x4f,
  cameraPosition: vec3f,
  /** Beer-Lambert absorption per scene unit, in linear RGB. */
  absorption: vec3f,
  /** The cross-section, wound counter-clockwise, as `scene/constants.ts` derives it. */
  prismA: vec2f,
  prismB: vec2f,
  prismC: vec2f,
  environmentSize: vec2f,
  frontZ: f32,
  backZ: f32,
  ior: f32,
  reflectionStrength: f32,
  environmentExposure: f32,
  environmentTexelAngle: f32,
  /** Schlick reflectance at normal incidence, derived from `ior` on the CPU. */
  fresnelF0: f32,
  /** AB, BC, CA, front and back as `(normal, offset)`. */
  prismPlanes: array<vec4f, 5>,
}

export fn glassEnvironment(
  direction: vec3f,
  params: Glass,
  studioEnvironment: texture_2d<f32>,
  environmentSampler: sampler,
  lod: f32,
) -> vec3f {
  let rotatedDirection = rotateEnvironmentDirection(
    direction,
    params.environmentRotation,
  );
  let maxLod = f32(textureNumLevels(studioEnvironment) - 1u);
  return sample_env(
    studioEnvironment,
    environmentSampler,
    rotatedDirection,
    clamp(lod, 0.0, maxLod),
    params.environmentSize,
  ) * params.environmentExposure;
}

export fn glassEnvironmentLod(direction: vec3f, params: Glass) -> f32 {
  return env_lod(
    0.0,
    dpdx(direction),
    dpdy(direction),
    params.environmentTexelAngle,
  );
}

export fn dielectricFresnel(f0: f32, facing: f32) -> f32 {
  let oneMinusFacing = 1.0 - clamp(facing, 0.0, 1.0);
  let squared = oneMinusFacing * oneMinusFacing;
  let fifth = squared * squared * oneMinusFacing;
  return f0 + (1.0 - f0) * fifth;
}
