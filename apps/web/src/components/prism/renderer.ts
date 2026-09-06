/**
 * WebGPU pipeline setup for the prism hero.
 *
 * Flow: init() -> surface(canvas, { dpr: [1, 2] }) -> one fullscreen effect over prism.wgsl -> compile() against the
 *       surface's render signature so the first frame does not create the pipeline -> frameLoop writes the only
 *       uniform there is (viewport, clock, device pixel ratio) and draws -> dispose() tears the whole thing down.
 *
 * The shader owns the scene: the prism, the ray and the dispersion are all derived from the viewport inside
 * `prism.wgsl`, so nothing here computes geometry. `vgpu` is imported dynamically because it touches `navigator.gpu`
 * at module scope and this file is reached from a server-rendered page.
 */
import type { FrameLoopHandle, Gpu, Surface } from "vgpu";
import prismShader from "./prism.wgsl";

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

  /** CSS size and the clamped device pixel ratio. Both feed the uniform; their product is the backing store. */
  const measure = () => {
    const rect = canvas.getBoundingClientRect();
    width = Math.max(1, rect.width || canvas.clientWidth || 1);
    height = Math.max(1, rect.height || canvas.clientHeight || 1);
    dpr = Math.min(Math.max(globalThis.devicePixelRatio || 1, 1), 2);
  };

  const physicalSize = (): [number, number] => [Math.max(1, Math.round(width * dpr)), Math.max(1, Math.round(height * dpr))];

  const dispose = () => {
    if (disposed) return;
    disposed = true;
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
      set: { params: { resolution_time: [width, height, 0, dpr] } },
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
      prism.set({ params: { resolution_time: [width, height, time.time, dpr] } });
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
