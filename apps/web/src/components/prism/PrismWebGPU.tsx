"use client";

import { useEffect, useRef } from "react";
import prismShader from "./prism.wgsl";
import { pulseAt, type PrismRendererProps } from "./PrismCanvas2D";
import { prismUniforms } from "./uniforms";
import { usePrismFrame } from "./usePrismFrame";

/**
 * WebGPU prism through vgpu's `effect()` (Design.md §5.1).
 * Flow: `init()` after mount -> `surface(canvas, { dpr: [1, 2] })` -> one fullscreen effect -> `compile()` so the
 *       first frame does not stall on pipeline creation -> `frameLoop` writes only what changes (time,
 *       pointer-derived geometry, activity pulses) -> `stop()` and `dispose()` on unmount, which React's strict mode
 *       double-invoke makes mandatory.
 * `onUnsupported` is the only fallback trigger and it fires on one thing: this machine could not give us a device
 * (B-026). A device error after that is reported through `gpu.onError` and logged, never silently swapped for the
 * 2D renderer, because a shader bug must be visible rather than disguised as an unsupported browser.
 */
function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function PrismWebGPU({ activity, className = "", onUnsupported }: PrismRendererProps & { onUnsupported: () => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const { state, sceneOf } = usePrismFrame(canvasRef);
  // The vgpu frame loop is created once and reads the freshest values through refs; they are written in an effect so
  // nothing mutates during render.
  const activityRef = useRef(activity);
  const stateRef = useRef(state);
  const sceneOfRef = useRef(sceneOf);
  useEffect(() => {
    activityRef.current = activity;
    stateRef.current = state;
    sceneOfRef.current = sceneOf;
  }, [activity, state, sceneOf]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let disposed = false;
    let stop: (() => void) | undefined;
    let dispose: (() => void) | undefined;
    // Under reduced motion the scene is static, so redundant redraws of an identical frame are skipped.
    let lastStill = "";

    void (async () => {
      const vgpu = await import("vgpu").catch((error: unknown) => {
        console.info("[aegis] the vgpu module did not load, using the Canvas 2D renderer:", message(error));
        return null;
      });
      if (!vgpu || disposed) return;
      const { clock, effect, frameLoop, init, surface } = vgpu;

      // Only one question decides the renderer: can this machine give us a device? Everything after this point is
      // our own code, and a failure there is reported as an error rather than as an unsupported browser (B-026).
      let gpu: Awaited<ReturnType<typeof init>>;
      try {
        gpu = await init();
      } catch (error) {
        if (!disposed) {
          console.info("[aegis] no WebGPU device on this machine, using the Canvas 2D renderer:", message(error));
          onUnsupported();
        }
        return;
      }
      if (disposed) {
        gpu.dispose();
        return;
      }
      dispose = () => gpu.dispose();

      try {
        // A device error is a bug in this shader, not a missing feature: say so instead of hiding it (C-F5).
        gpu.onError((error) => {
          console.error("[aegis] WebGPU prism device error:", error);
        });
        const canvasSurface = surface(gpu, canvas, { dpr: [1, 2] });
        const time = clock(gpu);
        const uniformsFor = (timeSeconds: number, pulses: Record<string, number>) => {
          const current = stateRef.current;
          const width = Math.max(current.width, 1);
          const height = Math.max(current.height, 1);
          return prismUniforms({
            scene: sceneOfRef.current(width, height),
            width,
            height,
            timeSeconds,
            reducedMotion: current.reducedMotion,
            activity: pulses,
            dpr: canvasSurface.dpr,
          });
        };
        const prism = effect(gpu, prismShader, { label: "aegis-prism", set: { params: uniformsFor(0, {}) } });
        // Compile before the loop starts so the first visible frame is not the one that creates the pipeline. The
        // target is the surface's render signature, not the surface itself: a Surface passed here outside a frame
        // throws VGPU-SURFACE-NOT-IN-FRAME, which used to look exactly like "this browser has no WebGPU" (B-027).
        await prism.compile({ colors: [canvasSurface.format] });
        if (disposed) return;

        const loop = frameLoop(gpu, (frame) => {
          const current = stateRef.current;
          // Offscreen and background tabs stop drawing; a still frame under reduced motion is drawn once and then
          // only when a module pulse changes it. Neither condition may decide which *renderer* runs.
          if (!current.visible || document.hidden || current.width === 0) return;
          const now = Date.now();
          const pulses: Record<string, number> = {};
          for (const [module, at] of Object.entries(activityRef.current)) pulses[module] = pulseAt(at, now);
          const signature = current.reducedMotion
            ? `${current.width}x${current.height}:${Object.values(pulses).join(",")}`
            : "";
          if (signature !== "" && signature === lastStill) return;
          lastStill = signature;
          prism.set({ params: uniformsFor(current.reducedMotion ? 1.3 : time.time, pulses) });
          frame.pass(canvasSurface, prism);
        });
        stop = () => loop.stop();
      } catch (error) {
        // The device exists and our own pipeline failed: that is a bug in this component, and it says so. The 2D
        // renderer still takes over, because a broken canvas is worse than a simpler picture.
        if (!disposed) {
          console.error("[aegis] the WebGPU prism failed after the device was created, falling back to Canvas 2D:", error);
          onUnsupported();
        }
      }
    })();

    return () => {
      disposed = true;
      stop?.();
      dispose?.();
    };
  }, [onUnsupported]);

  return <canvas ref={canvasRef} aria-hidden="true" className={`block h-full w-full ${className}`} />;
}
