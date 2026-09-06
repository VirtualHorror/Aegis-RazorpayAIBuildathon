"use client";

import { useEffect, useRef } from "react";
import { createPrismRenderer } from "./renderer";

export interface PrismHeroProps {
  eventsIn: string;
  actionsOut: string;
}

/**
 * The hero canvas. Everything drawn inside it is `prism.wgsl`: a solid glass prism, one white ray, and the spectrum
 * it disperses into. The component owns the canvas and its lifetime, nothing else — no scene, no overlay on the
 * picture, and no second renderer.
 */
export function PrismHero({ eventsIn, actionsOut }: PrismHeroProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const renderer = createPrismRenderer({ canvas });
    void renderer.ready;
    return () => renderer.dispose();
  }, []);

  return (
    <div className="relative overflow-hidden rounded-2xl border border-border bg-black text-[#e8eaf2]" style={{ colorScheme: "dark" }}>
      <div className="px-4 pt-4 sm:absolute sm:left-6 sm:top-5 sm:z-[1] sm:max-w-sm sm:rounded-xl sm:bg-[radial-gradient(120%_120%_at_0%_0%,rgba(0,0,0,0.94),rgba(0,0,0,0))] sm:p-3">
        <p className="text-lg font-semibold tracking-tight sm:text-xl">One stream in. Seven specialists out.</p>
        <p className="mt-1 max-w-sm text-xs text-[#8b93a7] sm:text-sm">Every action is proposed by code, bounded by guardrails and gated by a human when money is at stake.</p>
      </div>

      <div className="relative aspect-[960/280] w-full">
        <canvas ref={canvasRef} aria-hidden="true" className="block h-full w-full touch-none" />
      </div>

      <div className="flex gap-4 px-4 pb-3 font-mono text-xs text-[#8b93a7] sm:absolute sm:bottom-4 sm:left-6 sm:p-0">
        <span>
          <span className="text-[#e8eaf2]">{eventsIn}</span> events in
        </span>
        <span aria-hidden>·</span>
        <span>
          <span className="text-[#e8eaf2]">{actionsOut}</span> actions out
        </span>
      </div>

      <p className="sr-only">
        A single beam of light enters a glass prism and leaves as a continuous spectrum. {eventsIn} events in, {actionsOut} actions out.
      </p>
    </div>
  );
}
