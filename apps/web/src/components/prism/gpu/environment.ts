/**
 * The studio the glass reflects, ported from `vercel-labs/vgpu`
 * (`apps/docs/.../prism-background/environment/texture.ts`).
 *
 * Intent: the blog post calls this a cubemap; vgpu actually bakes it as one 2:1 equirectangular HDR
 * texture, because the lookup is direction -> uv either way and one texture needs one binding.
 * `environment.wgsl` authors three analytic panels, `environment-bake.wgsl` rasterizes them into level
 * zero, and `environment-blur.wgsl` builds the mip chain so a reflection that compresses the map on
 * screen can select a prefiltered level instead of aliasing.
 *
 * Flow: bake once -> copy to level 0 -> for each level, blur horizontally then vertically at half the
 * previous size and copy into that mip. Runtime glass shading then performs exactly one fetch.
 */

import type { Effect, Gpu, Target } from "vgpu";
import type { Texture } from "vgpu/core";
import { effect, frame, sampler, target } from "vgpu";

import environmentBakeWgsl from "../shaders/environment-bake.wgsl";
import environmentBlurWgsl from "../shaders/environment-blur.wgsl";

/** 2:1 HDR layout sized for the hero's small on-screen reflection footprint. */
export const ENVIRONMENT_SIZE = [1024, 512] as const;
export const ENVIRONMENT_LEVELS = 8;
export const ENVIRONMENT_TEXEL_ANGLE = (2 * Math.PI) / ENVIRONMENT_SIZE[0];
const ENVIRONMENT_BLUR_RADIUS = 1.15;

export interface EnvironmentTexture {
  readonly texture: Texture;
  readonly bake: Effect;
  readonly blur: Effect;
  prepared: boolean;
}

export function createEnvironmentSampler(gpu: Gpu): GPUSampler {
  return sampler(gpu, {
    minFilter: "linear",
    magFilter: "linear",
    mipmapFilter: "linear",
    addressModeU: "repeat",
    addressModeV: "clamp-to-edge",
  });
}

export function createEnvironmentTexture(gpu: Gpu, label: string): EnvironmentTexture {
  return {
    texture: gpu.device.createTexture({
      size: [...ENVIRONMENT_SIZE],
      format: "rgba16float",
      mipLevelCount: ENVIRONMENT_LEVELS,
      usage: ["texture_binding", "copy_dst"],
      label: `${label}.texture`,
    }),
    bake: effect(gpu, environmentBakeWgsl, { label: `${label}.bake` }),
    blur: effect(gpu, environmentBlurWgsl, { label: `${label}.blur` }),
    prepared: false,
  };
}

export async function prepareEnvironmentTexture(
  gpu: Gpu,
  environment: EnvironmentTexture,
  samplerState: GPUSampler,
): Promise<void> {
  if (environment.prepared) return;
  let source = target(gpu, {
    size: ENVIRONMENT_SIZE,
    format: "rgba16float",
    label: `${environment.texture.label}.level0`,
  });
  await Promise.all([environment.bake.compile(source), environment.blur.compile(source)]);
  frame(gpu, (currentFrame) => {
    currentFrame.pass({ target: source, clear: [0, 0, 0, 1] }, (pass) => pass.draw(environment.bake));
  });
  copyIntoLevel(gpu, source, environment.texture, 0);

  for (let level = 1; level < ENVIRONMENT_LEVELS; level++) {
    const size: [number, number] = [
      Math.max(1, ENVIRONMENT_SIZE[0] >> level),
      Math.max(1, ENVIRONMENT_SIZE[1] >> level),
    ];
    const horizontal = target(gpu, {
      size,
      format: "rgba16float",
      label: `${environment.texture.label}.blur-h${level}`,
    });
    const vertical = target(gpu, {
      size,
      format: "rgba16float",
      label: `${environment.texture.label}.level${level}`,
    });
    const texel: [number, number] = [1 / size[0], 1 / size[1]];

    // Horizontal first, with the 1 / sin(theta) compensation that keeps a blur near the poles of an
    // equirectangular map angularly uniform; the vertical axis needs none.
    environment.blur.set({
      src: source,
      src_samp: samplerState,
      blur: { texel, direction: [1, 0], radius: ENVIRONMENT_BLUR_RADIUS, equirect_compensation: 1 },
    });
    frame(gpu, (currentFrame) => {
      currentFrame.pass({ target: horizontal }, (pass) => pass.draw(environment.blur));
    });
    environment.blur.set({
      src: horizontal,
      src_samp: samplerState,
      blur: { texel, direction: [0, 1], radius: ENVIRONMENT_BLUR_RADIUS, equirect_compensation: 0 },
    });
    frame(gpu, (currentFrame) => {
      currentFrame.pass({ target: vertical }, (pass) => pass.draw(environment.blur));
    });

    copyIntoLevel(gpu, vertical, environment.texture, level);
    destroyTarget(horizontal);
    destroyTarget(source);
    source = vertical;
  }
  destroyTarget(source);
  environment.prepared = true;
}

function copyIntoLevel(gpu: Gpu, source: Target, environment: Texture, level: number): void {
  const encoder = gpu.gpu.createCommandEncoder({ label: `${environment.label}.copy-level${level}` });
  encoder.copyTextureToTexture(
    { texture: source.color.gpu },
    { texture: environment.gpu, mipLevel: level },
    [source.size[0], source.size[1], 1],
  );
  gpu.gpu.queue.submit([encoder.finish()]);
}

function destroyTarget(colorTarget: Target): void {
  (colorTarget as Target & { destroy?: () => void }).destroy?.();
}

export function destroyEnvironmentTexture(environment: EnvironmentTexture | undefined): void {
  environment?.texture.destroy();
}
