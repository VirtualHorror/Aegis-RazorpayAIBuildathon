"use client";

import { useEffect, useRef } from "react";
import prismShader from "./prism.wgsl";
import { pulseAt, type PrismRendererProps } from "./PrismCanvas2D";
import { prismUniforms } from "./uniforms";
import { usePrismFrame } from "./usePrismFrame";

/**
 * WebGPU prism through vgpu's `effect()` (Design.md §5.1).
 * Flow: `init()` after mount -> `surface(canvas, { dpr: [1, 2] })` -> one fullscreen effect -> `frameLoop` writes only
 *       what changes (time, pointer-derived geometry, activity pulses) -> `stop()` and `dispose()` on unmount, which
 *       React's strict mode double-invoke makes mandatory.
 * `onUnsupported` lets the parent fall back to Canvas 2D when `init()` fails on this machine.
 */
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

    void (async () => {
      try {
        const { clock, effect, frameLoop, init, surface } = await import("vgpu");
        const gpu = await init();
        if (disposed) {
          gpu.dispose();
          return;
        }
        dispose = () => gpu.dispose();
        const canvasSurface = surface(gpu, canvas, { dpr: [1, 2] });
        const time = clock(gpu);
        const first = stateRef.current;
        const prism = effect(gpu, prismShader, {
          label: "aegis-prism",
          set: {
            params: prismUniforms({
              scene: sceneOfRef.current(Math.max(first.width, 1), Math.max(first.height, 1)),
              width: Math.max(first.width, 1),
              height: Math.max(first.height, 1),
              timeSeconds: 0,
              reducedMotion: first.reducedMotion,
              activity: {},
            }),
          },
        });

        const loop = frameLoop(gpu, (frame) => {
          const current = stateRef.current;
          if (!current.visible || document.hidden || current.width === 0) return;
          const now = Date.now();
          const pulses: Record<string, number> = {};
          for (const [module, at] of Object.entries(activityRef.current)) pulses[module] = pulseAt(at, now);
          prism.set({
            params: prismUniforms({
              scene: sceneOfRef.current(current.width, current.height),
              width: current.width,
              height: current.height,
              timeSeconds: current.reducedMotion ? 1.3 : time.time,
              reducedMotion: current.reducedMotion,
              activity: pulses,
            }),
          });
          frame.pass(canvasSurface, prism);
        });
        stop = () => loop.stop();
      } catch (error) {
        // Intent: a machine without WebGPU (or with a blocked adapter) must fall back, never show a broken canvas.
        if (!disposed) {
          console.info("[aegis] WebGPU prism unavailable, using the Canvas 2D renderer:", error instanceof Error ? error.message : error);
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
