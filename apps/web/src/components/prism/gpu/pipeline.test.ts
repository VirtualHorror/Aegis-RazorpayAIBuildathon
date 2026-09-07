import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Gpu, Target } from "vgpu";
import { frame, init, target } from "vgpu/mock";

import { LIGHT_MESH_LAYOUT, LIGHT_VERTEX_STRIDE } from "../scene/light-mesh";
import { bindPrismGraph } from "./bind";
import { BLOOM_LEVELS, BLOOM_LEVEL_DIVISORS, bloomKernelWeights, bloomLevelSize, prismOptionalFeatures } from "./bloom";
import type { EnvironmentTexture } from "./environment";
import {
  compilePrismGraph,
  createPrismGraph,
  destroyPrismGraph,
  DUST_PARTICLE_COUNT,
  ensurePrismTargets,
  resizePrismTargets,
  type PrismGraph,
} from "./pipeline";
import { renderPrismGraph } from "./render";
import { SETTLED_REVEAL } from "./reveal";
import {
  createPrismRuntime,
  destroyPrismRuntime,
  LIGHT_MESH_FLOATS,
  resizeRuntime,
  setRuntimeLampAim,
  setRuntimeOrbit,
  type PrismRuntime,
} from "./runtime";
import { glassUniforms, schlickFresnelF0, sceneUniforms } from "./uniforms";

const SIZE: readonly [number, number] = [64, 32];
const OUTPUT_FORMAT: GPUTextureFormat = "rgba8unorm";

/**
 * vgpu's mock adapter runs the whole graph without a GPU: shaders are still resolved, linked and
 * reflected, and every `set()` is still checked against the reflected binding names. So this file is
 * the compile gate for all nineteen WGSL modules and for every uniform block in `uniforms.ts` —
 * `next build` never validates WGSL, and the browser only finds out at runtime (D-087).
 *
 * The environment is stubbed rather than baked: `prepareEnvironmentTexture` submits real render passes
 * to build an eight-level mip chain, which is a real-device concern, not a graph-shape one.
 */
function stubEnvironment(gpu: Gpu, runtime: PrismRuntime): void {
  runtime.environment = {
    texture: gpu.device.createTexture({
      size: [2, 1],
      format: "rgba16float",
      usage: ["texture_binding", "copy_dst"],
    }),
    prepared: true,
  } as EnvironmentTexture;
  runtime.environmentReady = Promise.resolve();
}

describe("prism pipeline", () => {
  let gpu: Gpu;
  let runtime: PrismRuntime;
  let graph: PrismGraph;
  let output: Target;

  beforeEach(async () => {
    gpu = await init();
    runtime = createPrismRuntime(gpu, SIZE, "prism-test");
    stubEnvironment(gpu, runtime);
    graph = createPrismGraph(runtime);
    output = target(gpu, { size: SIZE, format: OUTPUT_FORMAT });
    ensurePrismTargets(graph, runtime, SIZE, OUTPUT_FORMAT);
  });

  afterEach(() => {
    destroyPrismGraph(graph);
    destroyPrismRuntime(runtime);
    gpu.dispose();
  });

  it("compiles every shader in the graph", async () => {
    await expect(Promise.all(compilePrismGraph(graph, OUTPUT_FORMAT))).resolves.toBeDefined();
  });

  it("allocates the targets the two-level bloom tier needs", () => {
    expect(graph.bloomTargets).toHaveLength(BLOOM_LEVELS);
    graph.bloomTargets!.forEach((level, index) => {
      const divisor = BLOOM_LEVEL_DIVISORS[index]!;
      expect(level.horizontal.size).toEqual([SIZE[0] / divisor, SIZE[1] / divisor]);
      expect(level.vertical.size).toEqual(level.horizontal.size);
    });
    expect(graph.backgroundTarget!.size).toEqual([...SIZE]);
    expect(graph.presentationTarget!.format).toBe(OUTPUT_FORMAT);
  });

  it("binds and renders a full frame, then an idle one", async () => {
    await Promise.all(compilePrismGraph(graph, OUTPUT_FORMAT));
    bindPrismGraph(graph, runtime, { time: 0, reveal: SETTLED_REVEAL, updateScene: true });
    expect(() =>
      frame(gpu, (current) => renderPrismGraph(current, graph, output, { updateScene: true })),
    ).not.toThrow();

    // An idle frame skips the whole scene chain and only rebinds the two draws that reach the surface.
    bindPrismGraph(graph, runtime, { time: 1, reveal: SETTLED_REVEAL, updateScene: false });
    expect(() =>
      frame(gpu, (current) => renderPrismGraph(current, graph, output, { updateScene: false })),
    ).not.toThrow();
  });

  it("refuses to bind or render before the targets exist", () => {
    const bare = createPrismGraph(runtime);
    expect(() =>
      bindPrismGraph(bare, runtime, { time: 0, reveal: SETTLED_REVEAL, updateScene: true }),
    ).toThrow(/ensurePrismTargets/);
    expect(() =>
      frame(gpu, (current) => renderPrismGraph(current, bare, output, { updateScene: true })),
    ).toThrow(/ensurePrismTargets/);
  });

  it("refuses to bind before the environment is baked", () => {
    runtime.environment = undefined;
    expect(() =>
      bindPrismGraph(graph, runtime, { time: 0, reveal: SETTLED_REVEAL, updateScene: true }),
    ).toThrow(/prepareRuntimeEnvironment/);
  });

  it("resizes every target together", () => {
    const next: readonly [number, number] = [128, 48];
    resizePrismTargets(graph, next);
    expect(graph.backgroundTarget!.size).toEqual([...next]);
    expect(graph.sceneTarget!.size).toEqual([...next]);
    expect(graph.presentationTarget!.size).toEqual([...next]);
    expect(graph.bloomTargets![1]!.vertical.size).toEqual([...bloomLevelSize(next, 1)]);
  });

  it("releases its targets on destroy", () => {
    destroyPrismGraph(graph);
    expect(graph.backgroundTarget).toBeUndefined();
    expect(graph.sceneTarget).toBeUndefined();
    expect(graph.bloomTargets).toBeUndefined();
    expect(graph.presentationTarget).toBeUndefined();
  });
});

describe("runtime", () => {
  it("reserves exactly the light mesh the layout describes", async () => {
    const gpu = await init();
    const runtime = createPrismRuntime(gpu, SIZE, "prism-runtime-test");
    try {
      expect(runtime.lightVertices).toHaveLength(LIGHT_MESH_FLOATS);
      expect(runtime.lightBuffer.options.size).toBe(LIGHT_MESH_LAYOUT.vertexCount * LIGHT_VERTEX_STRIDE);
      expect(runtime.lightGeometry.vertexCount).toBe(LIGHT_MESH_LAYOUT.vertexCount);
    } finally {
      destroyPrismRuntime(runtime);
      gpu.dispose();
    }
  });

  it("rebuilds the mesh in place when the lamp moves and leaves it alone when it does not", async () => {
    const gpu = await init();
    const runtime = createPrismRuntime(gpu, SIZE, "prism-lamp-test");
    try {
      const buffer = runtime.lightVertices;
      const before = buffer.slice(0, 24);
      setRuntimeLampAim(runtime, 0.9, 0.2);
      expect(runtime.lightVertices).toBe(buffer);
      expect(Array.from(buffer.slice(0, 24))).not.toEqual(Array.from(before));

      const settled = buffer.slice(0, 24);
      setRuntimeLampAim(runtime, 0.9, 0.2);
      expect(Array.from(buffer.slice(0, 24))).toEqual(Array.from(settled));
    } finally {
      destroyPrismRuntime(runtime);
      gpu.dispose();
    }
  });

  it("moves the camera on orbit and re-fits the wall on resize", async () => {
    const gpu = await init();
    const runtime = createPrismRuntime(gpu, SIZE, "prism-camera-test");
    try {
      const resting = runtime.view.position;
      setRuntimeOrbit(runtime, 1, -1);
      expect(runtime.view.position).not.toEqual(resting);
      // The orbit is deliberately tiny: the light sheet is world-space, so a few degrees is enough.
      expect(Math.hypot(...runtime.view.position)).toBeCloseTo(Math.hypot(...resting), 6);

      resizeRuntime(runtime, [128, 32]);
      expect(runtime.aspect).toBe(4);
      expect(runtime.outputSize).toEqual([128, 32]);
    } finally {
      destroyPrismRuntime(runtime);
      gpu.dispose();
    }
  });
});

describe("uniform blocks", () => {
  it("hands the light shader the layout it decodes vertex_index against", async () => {
    const gpu = await init();
    const runtime = createPrismRuntime(gpu, SIZE, "prism-uniform-test");
    try {
      const scene = sceneUniforms(runtime, 1, LIGHT_MESH_LAYOUT);
      expect(scene.lightWhiteQuads).toBe(LIGHT_MESH_LAYOUT.whiteQuads);
      expect(scene.lightInternalQuads).toBe(LIGHT_MESH_LAYOUT.internalQuads);
      expect(scene.lightSpectralSamples).toBe(LIGHT_MESH_LAYOUT.samples);
      expect(scene.lightBeamSlices).toBe(LIGHT_MESH_LAYOUT.beamSlices);
      expect(scene.beamWidthReveal).toBe(1);

      const glass = glassUniforms(runtime);
      // Three side planes from the cross-section plus the two caps the extrusion added.
      expect(glass.prismPlanes).toHaveLength(5);
      expect(glass.environmentRotation).toHaveLength(16);
    } finally {
      destroyPrismRuntime(runtime);
      gpu.dispose();
    }
  });

  it("clamps the reveal aperture into [0, 1]", async () => {
    const gpu = await init();
    const runtime = createPrismRuntime(gpu, SIZE, "prism-reveal-test");
    try {
      expect(sceneUniforms(runtime, -3, LIGHT_MESH_LAYOUT).beamWidthReveal).toBe(0);
      expect(sceneUniforms(runtime, 4, LIGHT_MESH_LAYOUT).beamWidthReveal).toBe(1);
    } finally {
      destroyPrismRuntime(runtime);
      gpu.dispose();
    }
  });

  it("derives Schlick's F0 the way the shader's f32 math would", () => {
    // ((1.645 - 1) / (1.645 + 1))^2
    expect(schlickFresnelF0(1.645)).toBeCloseTo(0.0595, 4);
    expect(schlickFresnelF0(1)).toBe(0);
  });
});

describe("bloom configuration", () => {
  it("normalizes each kernel for a shader that doubles every tap but the centre", () => {
    for (const taps of [6, 10]) {
      const weights = bloomKernelWeights(taps);
      expect(weights).toHaveLength(24);
      const total = weights[0]! + 2 * weights.slice(1, taps).reduce((sum, w) => sum + w, 0);
      expect(total).toBeCloseTo(1, 10);
      // Everything past the kernel is zero-padded, so the fixed WGSL loop can read all 24 slots.
      expect(weights.slice(taps).every((w) => w === 0)).toBe(true);
    }
  });

  it("rounds level sizes up so a small canvas never allocates a zero-sized target", () => {
    expect(bloomLevelSize([1, 1], 0)).toEqual([1, 1]);
    expect(bloomLevelSize([1, 1], 1)).toEqual([1, 1]);
    expect(bloomLevelSize([100, 50], 1)).toEqual([25, 13]);
  });

  it("asks for packed HDR only where the device renders it", () => {
    expect(prismOptionalFeatures(undefined)).toEqual([]);
    expect(prismOptionalFeatures({ has: () => false })).toEqual([]);
    expect(prismOptionalFeatures({ has: () => true })).toEqual(["rg11b10ufloat-renderable"]);
  });
});

describe("dust", () => {
  it("draws the same instance count the graph reserves", () => {
    expect(DUST_PARTICLE_COUNT).toBe(2200);
  });
});
