"use client";

import { useEffect, useRef, useState } from "react";
import { moduleColorVar, moduleLabel } from "@/lib/format";
import { createPrismRenderer, type PrismRenderer } from "./gpu/renderer";
import { SPECTRUM } from "./legend";
import { PrismFallback } from "./PrismFallback";

const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

/**
 * The hero picture: vgpu's mesh-based prism on a WebGPU canvas, the equivalent still underneath, and
 * the module legend over both.
 *
 * Flow: the server renders the still, so a page with no JavaScript — or no `navigator.gpu`, or a
 * device that loses its adapter — shows the real scene rather than an empty rectangle (C-F4). On mount
 * the renderer is built against the already-mounted canvas, and `gpuReady` cross-fades to it only when
 * `ready` resolves. `gpuReady` is never set synchronously in the effect body, which React 19's
 * `set-state-in-effect` rule forbids: staying `false` *is* the fallback, so nothing has to be set to
 * choose it.
 *
 * Strict Mode's double-effect is safe: `dispose()` releases the surface before the second effect
 * claims the same canvas, and vgpu throws `VGPU-SURFACE-DUPLICATE` if that order is ever broken.
 */
export function PrismStage() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [gpuReady, setGpuReady] = useState(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !("gpu" in navigator)) return;
    let cancelled = false;
    const renderer: PrismRenderer = createPrismRenderer({
      canvas,
      reducedMotion: window.matchMedia(REDUCED_MOTION_QUERY).matches,
      onError: (error) => {
        // Nothing to recover: the still is already behind the canvas, which stays transparent.
        console.error("Prism hero fell back to the static scene.", error);
      },
      onLost: (reason) => {
        // A driver reset or a reclaimed device: fade the dead canvas back out and keep the still.
        if (!cancelled) setGpuReady(false);
        console.warn("Prism hero lost its GPU device; showing the static scene.", reason);
      },
    });
    void renderer.ready.then(
      (status) => {
        // "unsupported" is not a failure: the device simply has no adapter and the still stays.
        if (!cancelled && status === "gpu") setGpuReady(true);
      },
      () => {
        // Reported through onError above; the still stays on screen.
      },
    );
    return () => {
      cancelled = true;
      renderer.dispose();
    };
  }, []);

  return (
    <div className="relative isolate w-full overflow-hidden rounded-xl bg-black ring-1 ring-border">
      <div className="relative aspect-[50/21] w-full">
        <PrismFallback />
        <canvas
          ref={canvasRef}
          aria-hidden="true"
          className={`absolute inset-0 block h-full w-full touch-none transition-opacity duration-700 ${
            gpuReady ? "opacity-100" : "opacity-0"
          }`}
        />
      </div>
      <PrismLegend />
    </div>
  );
}

/**
 * The legend, and the reason the hero is not decoration.
 *
 * Intent: seven rows in the order the glass throws them — red bends least and sits at the top of the
 * fan, violet bends hardest and sits at the bottom — so each row lands on its own ray. The rule beside
 * each label is painted in that ray's true spectral colour and brightens toward the prism it came
 * from; the dot is the module's own dashboard colour, the same one its badges and feed rails use.
 * Every label sits in a dark pill, because it has to stay legible where it crosses the brightest part
 * of the fan (C-F6).
 *
 * Flow: from `sm` up the list is absolutely positioned over the left of the canvas, spanning the band
 * the resting fan sweeps through (roughly 30% to 86% of the height), so a row sits on its own ray.
 * Below `sm` the canvas is only about 130px tall and seven rows cannot fit inside it, so the same list
 * falls back into normal flow underneath the picture — two columns where the longest label fits twice
 * over, one column below that (C-F3).
 *
 * The canvas and the still are both `aria-hidden`, so this list is the accessible description of the
 * picture.
 */
function PrismLegend() {
  return (
    <ul
      aria-label="The seven modules the event stream is dispersed into, in spectral order"
      className="pointer-events-none grid grid-cols-1 gap-x-3 gap-y-1 p-3 min-[26rem]:grid-cols-2 sm:absolute sm:inset-x-auto sm:top-[30%] sm:bottom-[14%] sm:left-0 sm:flex sm:w-[56%] sm:max-w-[22rem] sm:flex-col sm:justify-between sm:p-3"
    >
      {SPECTRUM.map(({ module, hue, wavelengthNm }) => (
        <li key={module} className="flex items-center gap-2">
          <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-black/80 px-2 py-0.5 ring-1 ring-white/10">
            <span className="size-1.5 shrink-0 rounded-full" style={{ backgroundColor: moduleColorVar(module) }} aria-hidden />
            <span className="text-[11px] leading-4 font-medium tracking-tight whitespace-nowrap text-white">
              {moduleLabel(module)}
            </span>
            <span className="font-mono text-[10px] leading-4 tabular-nums text-white/45">{wavelengthNm}nm</span>
          </span>
          {/* The ray reaching the label: its own spectral colour, brightening toward the glass. */}
          <span
            className="hidden h-px min-w-0 flex-1 rounded-full sm:block"
            style={{ background: `linear-gradient(to right, transparent, ${hue})` }}
            aria-hidden
          />
        </li>
      ))}
    </ul>
  );
}
