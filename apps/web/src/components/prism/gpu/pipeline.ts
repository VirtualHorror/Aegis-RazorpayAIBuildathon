/**
 * The dark pipeline's draws, effects and render targets. Ported from `vercel-labs/vgpu`
 * (`apps/docs/.../prism-background/pipelines/dark/{create-graph,targets,index}.ts`).
 *
 * Intent: every node vgpu.sh's debug graph lists, and nothing else. Construction order is stable so a
 * reader can follow it against `render.ts`, which owns the authoritative pass order.
 *
 * Flow: `createPrismGraph` builds the nodes, `ensurePrismTargets` allocates the three HDR targets plus
 * the bloom pyramid at the surface's size, `compilePrismGraph` warms every pipeline against the target
 * it will actually be drawn into, and `destroyPrismGraph` releases the targets.
 */

import type { Draw, Effect, Target } from "vgpu";
import { draw, effect, target } from "vgpu";

import bloomBlurWgsl from "../shaders/bloom-blur.wgsl";
import bloomCompositeWgsl from "../shaders/bloom-composite.wgsl";
import bloomExtractWgsl from "../shaders/bloom-extract.wgsl";
import copyLinearWgsl from "../shaders/copy-linear.wgsl";
import copyPresentationWgsl from "../shaders/copy-presentation.wgsl";
import dustWgsl from "../shaders/dust.wgsl";
import glassBackWgsl from "../shaders/glass-back.wgsl";
import glassWgsl from "../shaders/glass.wgsl";
import lightWgsl from "../shaders/light.wgsl";
import presentWgsl from "../shaders/present.wgsl";
import { LIGHT_MESH_LAYOUT, type LightMeshLayout } from "../scene/light-mesh";
import { BLOOM_LEVELS, bloomFormat, bloomLevelSize } from "./bloom";
import type { PrismRuntime } from "./runtime";

/** Screen-facing quads lit by the blurred light field. Two thousand reads as air, not as confetti. */
export const DUST_PARTICLE_COUNT = 2200;

export interface BloomLevelTargets {
  readonly horizontal: Target;
  readonly vertical: Target;
}

export interface BloomLevelEffects {
  readonly horizontal: Effect;
  readonly vertical: Effect;
}

export interface PrismGraph {
  readonly lightMeshLayout: LightMeshLayout;
  /** Pass A: the spectral light mesh, drawn in three ranges around the back glass. */
  readonly light: Draw;
  readonly glassBack: Draw;
  /** Pass B: pass A copied forward, then the front interface refracts it. */
  readonly copyBackground: Effect;
  readonly glassFront: Draw;
  readonly bloomExtract: Effect;
  readonly bloomBlur: readonly BloomLevelEffects[];
  readonly bloomComposite: Effect;
  readonly present: Effect;
  readonly copyPresentation: Effect;
  readonly dust: Draw;
  backgroundTarget?: Target;
  sceneTarget?: Target;
  bloomTargets?: readonly BloomLevelTargets[];
  presentationTarget?: Target;
}

export function createPrismGraph(runtime: PrismRuntime): PrismGraph {
  const { gpu, label } = runtime;
  return {
    lightMeshLayout: LIGHT_MESH_LAYOUT,
    light: draw(gpu, {
      shader: lightWgsl,
      geometry: runtime.lightGeometry,
      blend: "additive",
      cull: "none",
      depth: false,
      label: `${label}.light`,
    }),
    // Painter's order stands in for a depth buffer: the back interface is drawn between the exterior
    // light and the internal light, so premultiplied Fresnel blending lets the already-drawn light
    // through as the transmitted component.
    glassBack: draw(gpu, {
      shader: glassBackWgsl,
      geometry: runtime.prism,
      cull: "front",
      depth: false,
      blend: "premultiplied",
      label: `${label}.glass-back`,
    }),
    copyBackground: effect(gpu, copyLinearWgsl, { label: `${label}.pass-b-copy-a` }),
    glassFront: draw(gpu, {
      shader: glassWgsl,
      geometry: runtime.prism,
      cull: "back",
      depth: false,
      label: `${label}.glass-front`,
    }),
    bloomExtract: effect(gpu, bloomExtractWgsl, { label: `${label}.bloom-extract` }),
    bloomBlur: Array.from({ length: BLOOM_LEVELS }, (_, level) => ({
      horizontal: effect(gpu, bloomBlurWgsl, { label: `${label}.bloom-${level}-horizontal` }),
      vertical: effect(gpu, bloomBlurWgsl, { label: `${label}.bloom-${level}-vertical` }),
    })),
    bloomComposite: effect(gpu, bloomCompositeWgsl, { label: `${label}.bloom-composite` }),
    present: effect(gpu, presentWgsl, { label: `${label}.present` }),
    copyPresentation: effect(gpu, copyPresentationWgsl, { label: `${label}.copy-presentation` }),
    dust: draw(gpu, {
      shader: dustWgsl,
      vertices: 6,
      instances: DUST_PARTICLE_COUNT,
      cull: "none",
      depth: false,
      blend: "additive",
      label: `${label}.dust`,
    }),
  };
}

export function ensurePrismTargets(
  graph: PrismGraph,
  runtime: PrismRuntime,
  size: readonly [number, number],
  outputFormat: GPUTextureFormat,
): void {
  const { gpu, label } = runtime;
  graph.backgroundTarget ??= target(gpu, {
    size,
    format: "rgba16float",
    label: `${label}.pass-a-back-and-light`,
  });
  graph.sceneTarget ??= target(gpu, {
    size,
    format: "rgba16float",
    // 4x MSAA is the front glass's only geometric antialiasing; compatibility-mode devices resolve
    // differently and vgpu skips it there.
    msaa: !gpu.device.isCompatibilityMode ? true : undefined,
    label: `${label}.pass-b-front-glass`,
  });
  graph.bloomTargets ??= Array.from({ length: BLOOM_LEVELS }, (_, level) => {
    const format = bloomFormat(gpu.device.features);
    const levelSize = bloomLevelSize(size, level);
    return Object.freeze({
      horizontal: target(gpu, { size: levelSize, format, label: `${label}.bloom-${level}-horizontal` }),
      vertical: target(gpu, { size: levelSize, format, label: `${label}.bloom-${level}-vertical` }),
    });
  });
  graph.presentationTarget ??= target(gpu, {
    size,
    format: outputFormat,
    label: `${label}.retained-presentation`,
  });
  resizePrismTargets(graph, size);
}

export function resizePrismTargets(graph: PrismGraph, size: readonly [number, number]): void {
  resizeTarget(graph.backgroundTarget, size);
  resizeTarget(graph.sceneTarget, size);
  resizeTarget(graph.presentationTarget, size);
  graph.bloomTargets?.forEach((level, index) => {
    const next = bloomLevelSize(size, index);
    resizeTarget(level.horizontal, next);
    resizeTarget(level.vertical, next);
  });
}

/** Warms every pipeline against the target signature it will be drawn into. */
export function compilePrismGraph(
  graph: PrismGraph,
  outputFormat: GPUTextureFormat,
): Promise<unknown>[] {
  const background = graph.backgroundTarget!;
  const scene = graph.sceneTarget!;
  const bloom = graph.bloomTargets!;
  const presentation = graph.presentationTarget!;
  const outputSignature = { colors: [outputFormat] } as const;
  return [
    graph.light.compile(background),
    graph.glassBack.compile(background),
    graph.copyBackground.compile(scene),
    graph.glassFront.compile(scene),
    graph.bloomExtract.compile(bloom[0]!.vertical),
    ...graph.bloomBlur.flatMap((level, index) => [
      level.horizontal.compile(bloom[index]!.horizontal),
      level.vertical.compile(bloom[index]!.vertical),
    ]),
    graph.bloomComposite.compile(bloom[0]!.horizontal),
    graph.present.compile(presentation),
    graph.copyPresentation.compile(outputSignature),
    graph.dust.compile(outputSignature),
  ];
}

export function destroyPrismGraph(graph: PrismGraph): void {
  destroyTarget(graph.backgroundTarget);
  graph.backgroundTarget = undefined;
  destroyTarget(graph.sceneTarget);
  graph.sceneTarget = undefined;
  graph.bloomTargets?.forEach((level) => {
    destroyTarget(level.horizontal);
    destroyTarget(level.vertical);
  });
  graph.bloomTargets = undefined;
  destroyTarget(graph.presentationTarget);
  graph.presentationTarget = undefined;
}

function resizeTarget(value: Target | undefined, size: readonly [number, number]): void {
  if (!value || (value.size[0] === size[0] && value.size[1] === size[1])) return;
  value.resize(size);
}

function destroyTarget(value: Target | undefined): void {
  (value as (Target & { destroy?: () => void }) | undefined)?.destroy?.();
}
