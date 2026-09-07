/**
 * Per-frame bindings for the dark pipeline, ported from `vercel-labs/vgpu`
 * (`apps/docs/.../prism-background/pipelines/dark/bind.ts`).
 *
 * Intent: `updateScene` is false on a frame where only the dust moved. Everything up to and including
 * the retained presentation target is then still valid, so the whole scene chain is skipped and only
 * the two draws that reach the surface are rebound — which is what keeps an idle hero close to free.
 */

import {
  CAMERA_DISTANCE,
  PRISM_FRONT_Z,
  PRISM_LIGHT_PLANE_Z,
  PRISM_POSTPROCESS,
  PRISM_TRIANGLE,
} from "../scene/constants";
import { BLOOM_LEVELS, BLOOM_LEVEL_FACTORS, bloomBlurUniforms } from "./bloom";
import { DUST_PARTICLE_COUNT, type PrismGraph } from "./pipeline";
import { PAGE_BACKGROUND_SRGB, type RevealProgress } from "./reveal";
import type { PrismRuntime } from "./runtime";
import { glassUniforms, runtimeWallExtent, sceneUniforms } from "./uniforms";

export interface BindOptions {
  readonly time: number;
  readonly reveal: RevealProgress;
  readonly updateScene: boolean;
}

export function bindPrismGraph(graph: PrismGraph, runtime: PrismRuntime, options: BindOptions): void {
  const { backgroundTarget, sceneTarget, bloomTargets, presentationTarget } = graph;
  if (!backgroundTarget || !sceneTarget || !bloomTargets || !presentationTarget) {
    throw new Error("ensurePrismTargets() must run before bindPrismGraph().");
  }
  const environment = runtime.environment;
  if (!environment) throw new Error("prepareRuntimeEnvironment() must resolve before bindPrismGraph().");

  const presentation = { backgroundColor: PAGE_BACKGROUND_SRGB, revealProgress: options.reveal.opacity };

  if (!options.updateScene) {
    graph.copyPresentation.set({ params: presentation });
    graph.dust.set({ params: dustUniforms(runtime, options) });
    return;
  }

  graph.light.set({ scene: sceneUniforms(runtime, options.reveal.beamWidth, graph.lightMeshLayout) });
  graph.copyBackground.set({ sceneTexture: backgroundTarget });
  graph.glassBack.set({
    params: glassUniforms(runtime),
    studioEnvironment: environment.texture,
    environmentSampler: runtime.environmentSampler,
  });
  graph.glassFront.set({
    params: glassUniforms(runtime),
    // Pass A — exterior light, the back interface and internal light — is what the front face refracts.
    sceneTexture: backgroundTarget,
    sceneSampler: runtime.sceneSampler,
    studioEnvironment: environment.texture,
    environmentSampler: runtime.environmentSampler,
  });
  graph.bloomExtract.set({
    sourceTexture: sceneTarget,
    sourceSampler: runtime.sceneSampler,
    params: { threshold: PRISM_POSTPROCESS.bloomThreshold },
  });
  graph.bloomBlur.forEach((bloom, level) => {
    const targets = bloomTargets[level]!;
    // Level 0 blurs the extract in place; every later level starts from the level above it.
    const horizontalSource = level === 0 ? targets.vertical : bloomTargets[level - 1]!.vertical;
    bloom.horizontal.set({
      sourceTexture: horizontalSource,
      sourceSampler: runtime.sceneSampler,
      params: bloomBlurUniforms(level, "horizontal", targets.horizontal.size),
    });
    bloom.vertical.set({
      sourceTexture: targets.horizontal,
      sourceSampler: runtime.sceneSampler,
      params: bloomBlurUniforms(level, "vertical", targets.vertical.size),
    });
  });
  graph.bloomComposite.set({
    level0Texture: bloomTargets[0]!.vertical,
    level1Texture: bloomTargets[1]!.vertical,
    levelSampler: runtime.sceneSampler,
    params: { radius: PRISM_POSTPROCESS.bloomRadius, factors: BLOOM_LEVEL_FACTORS },
  });
  graph.present.set({
    sceneTexture: sceneTarget,
    bloomTexture: bloomTargets[0]!.horizontal,
    bloomSampler: runtime.sceneSampler,
    params: { bloomStrength: PRISM_POSTPROCESS.bloomStrength },
  });
  graph.copyPresentation.set({ sourceTexture: presentationTarget, params: presentation });
  graph.dust.set({
    params: dustUniforms(runtime, options),
    // Hue and illumination both come from the broadest blurred level. vgpu's high tier downsamples a
    // second, unthresholded light field for the illumination term; its low tier — this one — reuses the
    // last visible bloom level for both, so a mote lights up wherever the fan passes behind it.
    colorTexture: bloomTargets[BLOOM_LEVELS - 1]!.vertical,
    lightTexture: bloomTargets[BLOOM_LEVELS - 1]!.vertical,
    lightSampler: runtime.sceneSampler,
  });
}

export { DUST_PARTICLE_COUNT };

function dustUniforms(runtime: PrismRuntime, options: BindOptions): Record<string, unknown> {
  return {
    viewProjection: runtime.view.viewProjection,
    fieldHalfExtent: runtimeWallExtent(runtime),
    outputSize: runtime.outputSize,
    time: options.time,
    cameraDistance: CAMERA_DISTANCE,
    lightPlaneZ: PRISM_LIGHT_PLANE_Z,
    // The prism's silhouette, projected in the shader: motes inside it are discarded so the glass
    // never looks dusty from the front.
    prismA: PRISM_TRIANGLE.a,
    prismB: PRISM_TRIANGLE.b,
    prismC: PRISM_TRIANGLE.c,
    prismFrontZ: PRISM_FRONT_Z,
    revealProgress: options.reveal.opacity,
  };
}
