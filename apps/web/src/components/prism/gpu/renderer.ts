/**
 * Browser renderer for the prism hero: owns the device, the surface, the frame loop and the pointer.
 * Ported from `vercel-labs/vgpu` (`apps/docs/.../prism-background/renderer.ts`), reduced to the parts
 * a dashboard flourish needs — no debug previews, no performance sampler, no runtime quality
 * switching, one theme.
 *
 * Flow:
 *   createPrismRenderer() -> requestAdapter -> init() -> surface() -> runtime -> graph
 *     -> bake the environment and compile every pipeline (`ready`)
 *     -> frameLoop: ease the pointer, rebuild the mesh only when the lamp moved, render, repeat.
 *
 * A frame is skipped outright unless something changed: the eased lamp or orbit, the intro reveal, or
 * the dust clock. The dust clock is quantised to `DUST_FPS`, so an otherwise idle hero submits 24
 * cheap frames a second instead of 60 full ones — and none at all under `prefers-reduced-motion`,
 * where the picture settles once and stays (C-F4).
 *
 * A machine with no WebGPU adapter is the *expected* case this hero is built to survive, not a
 * failure: `ready` resolves `"unsupported"` and the caller keeps the static scene. Only a device or
 * shader that genuinely broke rejects.
 *
 * A device can also be lost *after* the hero starts — a driver reset, a backgrounded tab, a browser
 * reclaiming GPU memory. `GPUDevice.lost` is therefore watched for the whole session: when it settles
 * the loop stops, everything is released and `onLost` puts the still back, instead of the frame loop
 * throwing once per animation frame against a dead device.
 */

import type { Frame, Gpu, Surface } from "vgpu";
import { clock, frameLoop, init, surface } from "vgpu";

import { CAMERA_ORBIT_LERP, LAMP_AIM_LERP, PRISM_DEFAULT_ARC } from "../scene/constants";
import { bindPrismGraph } from "./bind";
import { prismOptionalFeatures } from "./bloom";
import {
  compilePrismGraph,
  createPrismGraph,
  destroyPrismGraph,
  ensurePrismTargets,
  resizePrismTargets,
  type PrismGraph,
} from "./pipeline";
import { renderPrismGraph } from "./render";
import { heroRevealProgress, SETTLED_REVEAL, type RevealProgress } from "./reveal";
import {
  createPrismRuntime,
  destroyPrismRuntime,
  prepareRuntimeEnvironment,
  resizeRuntime,
  setRuntimeLampAim,
  setRuntimeOrbit,
  type PrismRuntime,
} from "./runtime";

/** Idle refresh rate for the dust field. Anything faster is invisible on particles this small. */
const DUST_FPS = 24;
/** Above 2 the extra pixels are wasted on a card-sized canvas. */
const SURFACE_DPR: readonly [number, number] = [1, 2];

type Pair = readonly [number, number];

/** `"unsupported"` is a clean outcome: the device has no adapter and the still stays on screen. */
export type PrismRenderStatus = "gpu" | "unsupported";

export interface PrismRendererOptions {
  readonly canvas: HTMLCanvasElement;
  /** True freezes the intro and the dust clock: one settled frame, then nothing (C-F4). */
  readonly reducedMotion: boolean;
  /** Called only for genuine failures, never for a missing adapter. */
  readonly onError: (error: unknown) => void;
  /** Called if the device is lost after start-up, so the caller can show the still again. */
  readonly onLost?: (reason: string) => void;
}

export interface PrismRenderer {
  /** Resolves once the first frame can be drawn, or `"unsupported"`; rejects only on real failure. */
  readonly ready: Promise<PrismRenderStatus>;
  dispose(): void;
}

export function createPrismRenderer(options: PrismRendererOptions): PrismRenderer {
  const { canvas, reducedMotion } = options;
  let disposed = false;
  let gpu: Gpu | undefined;
  let canvasSurface: Surface | undefined;
  let runtime: PrismRuntime | undefined;
  let graph: PrismGraph | undefined;
  let gpuClock: ReturnType<typeof clock> | undefined;
  let loop: ReturnType<typeof frameLoop> | undefined;
  let resizeObserver: ResizeObserver | undefined;
  let resizeFrame = 0;
  let pendingSize: Pair | undefined;
  /** Forces one full scene render after start-up and after every resize. */
  let pendingPresent = true;
  let lastDustTime = -1;
  let lastReveal: RevealProgress = { opacity: -1, beamWidth: -1 };

  // Pointer easing, straight from vgpu's `runtime/interaction.ts`. Height swings the lamp around the
  // prism; width chooses where along the entry face it lands. Hovering tilts only the camera.
  let aimTarget: Pair = [PRISM_DEFAULT_ARC, 0.5];
  let aimCurrent: Pair = aimTarget;
  let orbitTarget: Pair = [0, 0];
  let orbitCurrent: Pair = orbitTarget;

  const onPointerMove = (event: PointerEvent) => {
    if (event.isPrimary === false) return;
    const rect = canvas.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;
    const x = clamp((event.clientX - rect.left) / rect.width, 0, 1);
    const y = clamp((event.clientY - rect.top) / rect.height, 0, 1);
    aimTarget = [y, x];
    orbitTarget = [x * 2 - 1, y * 2 - 1];
  };
  const onPointerLeave = () => {
    aimTarget = [PRISM_DEFAULT_ARC, 0.5];
    orbitTarget = [0, 0];
  };

  /**
   * The one teardown path. Idempotent, and safe to call from `dispose()` or from `initialize()` when
   * it finds itself cancelled at an await — which is what keeps a fast unmount (React Strict Mode
   * mounts, unmounts and remounts) from leaking a device the effect no longer has a handle on.
   */
  const release = () => {
    if (resizeFrame) cancelAnimationFrame(resizeFrame);
    resizeFrame = 0;
    resizeObserver?.disconnect();
    resizeObserver = undefined;
    canvas.removeEventListener("pointermove", onPointerMove);
    canvas.removeEventListener("pointerleave", onPointerLeave);
    loop?.stop();
    loop = undefined;
    if (graph) destroyPrismGraph(graph);
    graph = undefined;
    if (runtime) destroyPrismRuntime(runtime);
    runtime = undefined;
    canvasSurface?.dispose();
    canvasSurface = undefined;
    gpu?.dispose();
    gpu = undefined;
  };

  const applyResize = () => {
    resizeFrame = 0;
    const size = pendingSize;
    if (disposed || !size || !canvasSurface || !runtime || !graph) return;
    canvasSurface.resize([Math.max(1, Math.round(size[0])), Math.max(1, Math.round(size[1]))]);
    resizeRuntime(runtime, canvasSurface.size);
    resizePrismTargets(graph, canvasSurface.size);
    pendingPresent = true;
  };

  const tick = (currentFrame: Frame) => {
    if (disposed || !runtime || !graph || !canvasSurface) return;
    const aim = reducedMotion ? undefined : easedPair(aimCurrent, aimTarget, LAMP_AIM_LERP);
    const orbit = reducedMotion ? undefined : easedPair(orbitCurrent, orbitTarget, CAMERA_ORBIT_LERP);
    if (aim) aimCurrent = aim;
    if (orbit) orbitCurrent = orbit;

    const elapsed = gpuClock?.time ?? 0;
    const reveal = reducedMotion ? SETTLED_REVEAL : heroRevealProgress(elapsed);
    const revealChanged =
      reveal.opacity !== lastReveal.opacity || reveal.beamWidth !== lastReveal.beamWidth;
    const dustTime = reducedMotion ? 0 : Math.floor(elapsed * DUST_FPS) / DUST_FPS;
    const dustMoved = dustTime !== lastDustTime;
    const updateScene = Boolean(aim) || Boolean(orbit) || pendingPresent || revealChanged;
    if (!updateScene && !dustMoved) return;

    if (aim) setRuntimeLampAim(runtime, aim[0], aim[1]);
    if (orbit) setRuntimeOrbit(runtime, orbit[0], orbit[1]);
    bindPrismGraph(graph, runtime, { time: dustTime, reveal, updateScene });
    renderPrismGraph(currentFrame, graph, canvasSurface, { updateScene });
    pendingPresent = false;
    lastDustTime = dustTime;
    lastReveal = reveal;
  };

  const initialize = async (): Promise<PrismRenderStatus> => {
    // Probe before building anything. A VM with no adapter is the case the still scene exists for, so
    // it must not surface as an error (C-F4).
    const adapter = await Promise.resolve()
      .then(() => navigator.gpu?.requestAdapter())
      .catch(() => undefined);
    if (disposed) return "unsupported";
    if (!adapter) return "unsupported";

    const requiredFeatures = prismOptionalFeatures(adapter.features);
    // The probe can go stale between here and device creation, so a feature-less retry is the
    // documented fallback rather than an error.
    gpu = await init(requiredFeatures.length > 0 ? { requiredFeatures } : undefined).catch((error) => {
      if (requiredFeatures.length === 0) throw error;
      return init();
    });
    if (disposed) {
      release();
      return "unsupported";
    }

    canvasSurface = surface(gpu, canvas, { autoResize: false, dpr: SURFACE_DPR });
    runtime = createPrismRuntime(gpu, canvasSurface.size, "aegis-prism");
    graph = createPrismGraph(runtime);
    ensurePrismTargets(graph, runtime, canvasSurface.size, canvasSurface.format);
    await Promise.all([prepareRuntimeEnvironment(runtime), ...compilePrismGraph(graph, canvasSurface.format)]);
    if (disposed) {
      release();
      return "unsupported";
    }

    gpuClock = clock(gpu);
    canvas.addEventListener("pointermove", onPointerMove, { passive: true });
    canvas.addEventListener("pointerleave", onPointerLeave, { passive: true });
    if (typeof ResizeObserver !== "undefined") {
      resizeObserver = new ResizeObserver((entries) => {
        const entry = entries[0];
        if (!entry) return;
        const box = entry.devicePixelContentBoxSize?.[0];
        pendingSize = box
          ? [box.inlineSize, box.blockSize]
          : [entry.contentRect.width * devicePixelRatio, entry.contentRect.height * devicePixelRatio];
        if (!resizeFrame) resizeFrame = requestAnimationFrame(applyResize);
      });
      resizeObserver.observe(canvas);
    }
    loop = frameLoop(gpu, tick);

    // Stop at the first sign of a lost device rather than throwing once per animation frame. The
    // promise never rejects and settles on an ordinary `gpu.dispose()` too, so the guard on `disposed`
    // is what separates "we tore this down" from "the browser took it away".
    void gpu.device.gpu.lost.then((info) => {
      if (disposed) return;
      disposed = true;
      release();
      options.onLost?.(info.message || info.reason);
    });
    return "gpu";
  };

  const ready = initialize().catch((error: unknown) => {
    release();
    options.onError(error);
    throw error;
  });
  // The caller reports failures through `onError`; this keeps a rejected `ready` from surfacing as an
  // unhandled rejection when nobody awaits it (C-E3).
  void ready.catch(() => undefined);

  return {
    ready,
    dispose() {
      if (disposed) return;
      disposed = true;
      release();
    },
  };
}

/** Returns the eased value only when it actually moved, so a settled frame can be skipped. */
function easedPair(current: Pair, target: Pair, amount: number): Pair | undefined {
  const dx = target[0] - current[0];
  const dy = target[1] - current[1];
  if (Math.abs(dx) < 1e-4 && Math.abs(dy) < 1e-4) {
    return current[0] === target[0] && current[1] === target[1] ? undefined : target;
  }
  return [current[0] + dx * amount, current[1] + dy * amount];
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
