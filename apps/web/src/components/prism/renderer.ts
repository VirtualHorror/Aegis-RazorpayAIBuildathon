/**
 * WebGPU pipeline for the prism hero: a multi-pass, mesh-based renderer.
 *
 * Flow (one frame):
 *   1. scene pass, an HDR offscreen target — the beam as geometry (shaft, the segment inside the glass, 64
 *      overlapping ribbons of the dispersed fan, two impact billboards) drawn additively, and the prism as a
 *      triangular-prism mesh drawn in two halves so its far faces read through its near ones. The glass shades
 *      against an environment map instead of a light rig, which is what gives it internal reflections that move.
 *   2. bright pass — the scene above a soft-kneed threshold, at half resolution.
 *   3. two blur passes — a separable Gaussian across and then down.
 *   4. composite — scene + bloom, tone mapped, dithered and faded at the canvas edge, onto the surface.
 *
 * The optics stay in WGSL (`optics.wgsl`, shared by the beam and the glass), so the steering range the pointer is
 * clamped into is still derived from the geometry rather than computed here. This file reports where the pointer is
 * and owns the targets; it never computes an angle.
 */
import type { Draw, FrameLoopHandle, Gpu, Surface, Target } from "vgpu";
import envShader from "./env.wgsl";
import glassShader from "./glass.wgsl";
import beamShader from "./beam.wgsl";
import brightShader from "./bright.wgsl";
import blurShader from "./blur.wgsl";
import compositeShader from "./composite.wgsl";

export interface PrismRendererOptions {
  readonly canvas: HTMLCanvasElement;
  /** Called once when this machine cannot give us a WebGPU device. */
  readonly onUnsupported?: () => void;
}

export interface PrismRenderer {
  /** Resolves when the pipeline is running, or when it has given up. Rejection is never thrown at the caller. */
  readonly ready: Promise<void>;
  dispose(): void;
}

/** Where the beam rests when no pointer is over the canvas: mid-face, and a shallow, wide-fanned angle. */
const POINTER_REST_X = 0.5;
const POINTER_REST_Y = 0.3;
/** Time constant of the pointer easing, in seconds. */
const POINTER_TAU = 0.12;
/** Ribbons across the spectrum; must match FAN_RIBBONS in beam.wgsl. */
const FAN_RIBBONS = 64;
/** HDR everywhere before the composite, so the bright pass has something above 1.0 to find. */
const HDR_FORMAT = "rgba16float" as const;
/** The environment map is small: it is blurry reflections, not a backdrop anyone reads. */
const ENV_SIZE: readonly [number, number] = [512, 256];
const BLOOM_THRESHOLD = 0.75;
const BLOOM_KNEE = 0.45;
const BLOOM_STRENGTH = 0.85;

export function createPrismRenderer(options: PrismRendererOptions): PrismRenderer {
  const { canvas, onUnsupported } = options;
  let disposed = false;
  let gpu: Gpu | undefined;
  let canvasSurface: Surface | undefined;
  let loop: FrameLoopHandle | undefined;
  let observer: ResizeObserver | undefined;
  const targets: Target[] = [];
  let width = 1;
  let height = 1;
  let dpr = 1;
  let targetX = POINTER_REST_X;
  let targetY = POINTER_REST_Y;
  let targetActive = 0;
  let pointerX = POINTER_REST_X;
  let pointerY = POINTER_REST_Y;
  let pointerActive = 0;

  const measure = () => {
    const rect = canvas.getBoundingClientRect();
    width = Math.max(1, rect.width || canvas.clientWidth || 1);
    height = Math.max(1, rect.height || canvas.clientHeight || 1);
    dpr = Math.min(Math.max(globalThis.devicePixelRatio || 1, 1), 2);
  };
  const physicalSize = (): [number, number] => [Math.max(1, Math.round(width * dpr)), Math.max(1, Math.round(height * dpr))];
  const halfSize = (): [number, number] => {
    const [w, h] = physicalSize();
    return [Math.max(1, Math.round(w / 2)), Math.max(1, Math.round(h / 2))];
  };

  const onPointerMove = (event: PointerEvent) => {
    const rect = canvas.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;
    targetX = (event.clientX - rect.left) / rect.width;
    targetY = (event.clientY - rect.top) / rect.height;
    targetActive = 1;
  };
  const onPointerAway = () => {
    targetX = POINTER_REST_X;
    targetY = POINTER_REST_Y;
    targetActive = 0;
  };
  canvas.addEventListener("pointermove", onPointerMove, { passive: true });
  canvas.addEventListener("pointerdown", onPointerMove, { passive: true });
  canvas.addEventListener("pointerleave", onPointerAway);
  canvas.addEventListener("pointercancel", onPointerAway);

  const dispose = () => {
    if (disposed) return;
    disposed = true;
    canvas.removeEventListener("pointermove", onPointerMove);
    canvas.removeEventListener("pointerdown", onPointerMove);
    canvas.removeEventListener("pointerleave", onPointerAway);
    canvas.removeEventListener("pointercancel", onPointerAway);
    loop?.stop();
    loop = undefined;
    observer?.disconnect();
    observer = undefined;
    canvasSurface?.dispose();
    canvasSurface = undefined;
    gpu?.dispose();
    gpu = undefined;
  };

  const start = async (): Promise<void> => {
    const vgpu = await import("vgpu");
    if (disposed) return;
    const { clock, draw, effect, frame, frameLoop, init, sampler, surface, target } = vgpu;

    // The only question that may send this component away is whether the machine has a device.
    try {
      gpu = await init();
    } catch (error) {
      if (!disposed) {
        console.info("[aegis] no WebGPU device on this machine:", error instanceof Error ? error.message : error);
        onUnsupported?.();
      }
      return;
    }
    if (disposed) {
      gpu.dispose();
      gpu = undefined;
      return;
    }
    const device = gpu;

    // A device error is a bug in these shaders, not a missing feature: say so rather than falling back quietly.
    device.onError((error) => {
      console.error("[aegis] prism device error:", error);
    });

    // vgpu enables auto-resize only for a canvas that already reports a numeric clientWidth, which a freshly
    // mounted React subtree may not, so the surface is sized here and resized from the observer below.
    measure();
    canvasSurface = surface(device, canvas, { size: physicalSize(), dpr });
    const output = canvasSurface;
    const linear = sampler(device, {
      magFilter: "linear",
      minFilter: "linear",
      addressModeU: "repeat",
      addressModeV: "clamp-to-edge",
    });

    const scene = target(device, { size: physicalSize(), format: HDR_FORMAT, label: "prism-scene" });
    const bloomA = target(device, { size: halfSize(), format: HDR_FORMAT, label: "prism-bloom-a" });
    const bloomB = target(device, { size: halfSize(), format: HDR_FORMAT, label: "prism-bloom-b" });
    const environment = target(device, { size: [...ENV_SIZE] as [number, number], format: HDR_FORMAT, label: "prism-env" });
    targets.push(scene, bloomA, bloomB, environment);

    // The environment is a fixed studio: rendered once, then only ever read. What moves in the glass is the geometry.
    const environmentPass = effect(device, envShader, {
      label: "prism-env",
      set: { params: { size_time: [ENV_SIZE[0], ENV_SIZE[1], 0, 0] } },
    });

    const glassUniforms = () => ({
      resolution_time: [width, height, 0, dpr],
      pointer: [pointerX, pointerY, pointerActive, 0],
      half_info: [0, 0, 0, 0],
    });
    const glassHalf = (half: 0 | 1, label: string): Draw =>
      draw(device, {
        shader: glassShader,
        label,
        vertices: 24,
        blend: "premultiplied",
        set: { params: { ...glassUniforms(), half_info: [half, 0, 0, 0] }, env_tex: environment, env_sampler: linear },
      });
    const glassFar = glassHalf(0, "prism-glass-far");
    const glassNear = glassHalf(1, "prism-glass-near");

    const beamPart = (part: number, vertices: number, label: string): Draw =>
      draw(device, {
        shader: beamShader,
        label,
        vertices,
        blend: "additive",
        set: {
          params: {
            resolution_time: [width, height, 0, dpr],
            pointer: [pointerX, pointerY, pointerActive, 0],
            part_info: [part, 0, 0, 0],
          },
        },
      });
    const shaft = beamPart(0, 6, "prism-beam-shaft");
    const inside = beamPart(1, 6, "prism-beam-inside");
    const fan = beamPart(2, FAN_RIBBONS * 6, "prism-beam-fan");
    const impacts = beamPart(3, 12, "prism-beam-impacts");

    const bright = effect(device, brightShader, {
      label: "prism-bright",
      set: {
        params: { texel_threshold: [1 / physicalSize()[0], 1 / physicalSize()[1], BLOOM_THRESHOLD, BLOOM_KNEE] },
        source_tex: scene,
        source_sampler: linear,
      },
    });
    const blurAcross = effect(device, blurShader, {
      label: "prism-blur-x",
      set: { params: { step_axis: [1 / halfSize()[0], 0, 0, 0] }, source_tex: bloomA, source_sampler: linear },
    });
    const blurDown = effect(device, blurShader, {
      label: "prism-blur-y",
      set: { params: { step_axis: [0, 1 / halfSize()[1], 0, 0] }, source_tex: bloomB, source_sampler: linear },
    });
    const composite = effect(device, compositeShader, {
      label: "prism-composite",
      set: {
        params: { resolution_bloom: [width, height, BLOOM_STRENGTH, dpr] },
        scene_tex: scene,
        bloom_tex: bloomA,
        linear_sampler: linear,
      },
    });

    // Pre-warm every pipeline so the first visible frame is not the one that creates them.
    await Promise.all([
      environmentPass.compile({ colors: [HDR_FORMAT] }),
      glassFar.compile({ colors: [HDR_FORMAT] }),
      glassNear.compile({ colors: [HDR_FORMAT] }),
      shaft.compile({ colors: [HDR_FORMAT] }),
      inside.compile({ colors: [HDR_FORMAT] }),
      fan.compile({ colors: [HDR_FORMAT] }),
      impacts.compile({ colors: [HDR_FORMAT] }),
      bright.compile({ colors: [HDR_FORMAT] }),
      blurAcross.compile({ colors: [HDR_FORMAT] }),
      blurDown.compile({ colors: [HDR_FORMAT] }),
      composite.compile({ colors: [output.format] }),
    ]);
    if (disposed) return;

    // The studio is painted once.
    frame(device, (first) => {
      first.pass({ target: environment, clear: [0, 0, 0, 1] }, (pass) => pass.draw(environmentPass));
    });

    const resizeTargets = () => {
      const size = physicalSize();
      const half = halfSize();
      output.resize(size);
      scene.resize(size);
      bloomA.resize(half);
      bloomB.resize(half);
      bright.set({ params: { texel_threshold: [1 / size[0], 1 / size[1], BLOOM_THRESHOLD, BLOOM_KNEE] } });
      blurAcross.set({ params: { step_axis: [1 / half[0], 0, 0, 0] } });
      blurDown.set({ params: { step_axis: [0, 1 / half[1], 0, 0] } });
    };
    observer = new ResizeObserver(() => {
      measure();
      if (!disposed) resizeTargets();
    });
    observer.observe(canvas);

    const time = clock(device);
    loop = frameLoop(device, (currentFrame) => {
      // Frame-rate independent easing: the beam chases the pointer with a fixed time constant and glides back to
      // rest when it leaves. `dt` is clamped so a backgrounded tab does not snap the beam on its first frame back.
      const dt = Math.min(Math.max(time.deltaTime, 0), 0.1);
      const k = 1 - Math.exp(-dt / POINTER_TAU);
      pointerX += (targetX - pointerX) * k;
      pointerY += (targetY - pointerY) * k;
      pointerActive += (targetActive - pointerActive) * k;

      const resolution = [width, height, time.time, dpr];
      const pointer = [pointerX, pointerY, pointerActive, 0];
      shaft.set({ params: { resolution_time: resolution, pointer, part_info: [0, 0, 0, 0] } });
      inside.set({ params: { resolution_time: resolution, pointer, part_info: [1, 0, 0, 0] } });
      fan.set({ params: { resolution_time: resolution, pointer, part_info: [2, 0, 0, 0] } });
      impacts.set({ params: { resolution_time: resolution, pointer, part_info: [3, 0, 0, 0] } });
      glassFar.set({ params: { resolution_time: resolution, pointer, half_info: [0, 0, 0, 0] } });
      glassNear.set({ params: { resolution_time: resolution, pointer, half_info: [1, 0, 0, 0] } });
      composite.set({ params: { resolution_bloom: [width, height, BLOOM_STRENGTH, dpr] } });

      // Painter's order stands in for a depth buffer: what is outside the glass, then the far half of the solid,
      // then the light inside it, then the near half, then the two impacts on top.
      currentFrame.pass({ target: scene, clear: [0, 0, 0, 1] }, (pass) => {
        pass.draw(shaft);
        pass.draw(fan);
        pass.draw(glassFar);
        pass.draw(inside);
        pass.draw(glassNear);
        pass.draw(impacts);
      });
      currentFrame.pass({ target: bloomA, clear: [0, 0, 0, 1] }, (pass) => pass.draw(bright));
      currentFrame.pass({ target: bloomB, clear: [0, 0, 0, 1] }, (pass) => pass.draw(blurAcross));
      currentFrame.pass({ target: bloomA, clear: [0, 0, 0, 1] }, (pass) => pass.draw(blurDown));
      currentFrame.pass(output, composite);
    });
  };

  const ready = start().catch((error: unknown) => {
    if (disposed) return;
    console.error("[aegis] the prism pipeline failed:", error);
    onUnsupported?.();
  });

  return { ready, dispose };
}
