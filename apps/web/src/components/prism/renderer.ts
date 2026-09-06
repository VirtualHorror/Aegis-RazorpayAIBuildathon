/**
 * WebGPU pipeline setup for the prism hero.
 *
 * Flow: init() -> surface(canvas, { dpr: [1, 2] }) -> one fullscreen effect over prism.wgsl -> compile() against the
 *       surface's render signature so the first frame does not create the pipeline -> pointer listeners -> frameLoop
 *       eases the pointer, writes the two uniforms (viewport/clock/dpr, and the pointer) and draws -> dispose().
 *
 * The shader owns the scene: the prism, the ray, the dispersion and the limits the pointer may steer between are all
 * derived inside `prism.wgsl`. This file reports where the pointer is, in 0..1 of the canvas, and nothing more: it
 * never computes an angle, so it cannot put the beam somewhere the physics does not allow. `vgpu` is imported
 * dynamically because it touches `navigator.gpu` at module scope and this file is reached from a server-rendered page.
 */
import type { FrameLoopHandle, Gpu, Surface } from "vgpu";
import prismShader from "./prism.wgsl";

export interface PrismRendererOptions {
  readonly canvas: HTMLCanvasElement;
  /** Called once when this machine cannot give us a WebGPU device. */
  readonly onUnsupported?: () => void;
}

/** Where the beam rests when no pointer is over the canvas: mid-face, and a shallow, wide-fanned angle. */
const POINTER_REST_X = 0.5;
const POINTER_REST_Y = 0.3;
/** Time constant of the easing, in seconds. Small enough to feel attached to the cursor, large enough to glide. */
const POINTER_TAU = 0.12;

export interface PrismRenderer {
  /** Resolves when the pipeline is running, or when it has given up. Rejection is never thrown at the caller. */
  readonly ready: Promise<void>;
  dispose(): void;
}

export function createPrismRenderer(options: PrismRendererOptions): PrismRenderer {
  const { canvas, onUnsupported } = options;
  let disposed = false;
  let gpu: Gpu | undefined;
  let canvasSurface: Surface | undefined;
  let loop: FrameLoopHandle | undefined;
  let observer: ResizeObserver | undefined;
  let width = 1;
  let height = 1;
  let dpr = 1;
  // Where the pointer is (target) and where the beam currently believes it is (eased), both 0..1 across the canvas.
  let targetX = POINTER_REST_X;
  let targetY = POINTER_REST_Y;
  let targetActive = 0;
  let pointerX = POINTER_REST_X;
  let pointerY = POINTER_REST_Y;
  let pointerActive = 0;

  /** CSS size and the clamped device pixel ratio. Both feed the uniform; their product is the backing store. */
  const measure = () => {
    const rect = canvas.getBoundingClientRect();
    width = Math.max(1, rect.width || canvas.clientWidth || 1);
    height = Math.max(1, rect.height || canvas.clientHeight || 1);
    dpr = Math.min(Math.max(globalThis.devicePixelRatio || 1, 1), 2);
  };

  const physicalSize = (): [number, number] => [Math.max(1, Math.round(width * dpr)), Math.max(1, Math.round(height * dpr))];

  // Pointer, mouse and touch all arrive as pointer events; the canvas sets `touch-action: none` so a drag steers the
  // beam instead of scrolling the page.
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
    const { clock, effect, frameLoop, init, surface } = vgpu;

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

    // Anything that fails from here is a bug in this file or in the shader, and it says so rather than passing
    // itself off as an unsupported browser.
    gpu.onError((error) => {
      console.error("[aegis] prism device error:", error);
    });

    // Size the surface explicitly rather than relying on auto-resize: vgpu only turns that on for a canvas that
    // already has a numeric `clientWidth` when the surface is created, and a canvas inside a freshly mounted React
    // subtree may not. Left to the default the swapchain stays 300x150 and the picture is a stretched thumbnail.
    measure();
    canvasSurface = surface(gpu, canvas, { size: physicalSize(), dpr });
    const prism = effect(gpu, prismShader, {
      label: "prism-hero",
      set: {
        params: {
          resolution_time: [width, height, 0, dpr],
          pointer: [pointerX, pointerY, pointerActive, 0],
        },
      },
    });
    // A Surface passed to compile() outside a frame throws VGPU-SURFACE-NOT-IN-FRAME, so compile against its
    // render signature instead.
    await prism.compile({ colors: [canvasSurface.format] });
    if (disposed) return;

    const target = canvasSurface;
    observer = new ResizeObserver(() => {
      measure();
      if (!disposed) target.resize(physicalSize());
    });
    observer.observe(canvas);

    const time = clock(gpu);
    loop = frameLoop(gpu, (frame) => {
      // Frame-rate independent easing: the beam chases the pointer with a fixed time constant, and glides back to
      // rest when it leaves. `dt` is clamped so a backgrounded tab does not snap the beam on its first frame back.
      const dt = Math.min(Math.max(time.deltaTime, 0), 0.1);
      const k = 1 - Math.exp(-dt / POINTER_TAU);
      pointerX += (targetX - pointerX) * k;
      pointerY += (targetY - pointerY) * k;
      pointerActive += (targetActive - pointerActive) * k;
      prism.set({
        params: {
          resolution_time: [width, height, time.time, dpr],
          pointer: [pointerX, pointerY, pointerActive, 0],
        },
      });
      frame.pass(target, prism);
    });
  };

  const ready = start().catch((error: unknown) => {
    if (disposed) return;
    console.error("[aegis] the prism pipeline failed:", error);
    onUnsupported?.();
  });

  return { ready, dispose };
}
