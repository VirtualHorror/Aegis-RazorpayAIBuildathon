"use client";

import { useCallback, useState, useSyncExternalStore } from "react";
import { MODULE_LABELS } from "@/lib/format";
import { PrismCanvas2D } from "./PrismCanvas2D";
import { PrismWebGPU } from "./PrismWebGPU";
import { FAN_MODULES } from "./prismGeometry";

export interface PrismHeroProps {
  /** Module key → the timestamp (ms) of its last bus event. */
  activity: Readonly<Record<string, number>>;
  /** Modules whose label should read as lit right now (the parent owns the timers). */
  active: ReadonlySet<string>;
  eventsIn: string;
  actionsOut: string;
}

type Mode = "auto" | "2d" | "gpu";
const MODE: Mode = ((): Mode => {
  const value = process.env.NEXT_PUBLIC_PRISM_MODE;
  return value === "2d" || value === "gpu" ? value : "auto";
})();

/**
 * The hero (Design.md §5.1): WebGPU when the browser has it, Canvas 2D otherwise, always the same geometry.
 * `NEXT_PUBLIC_PRISM_MODE=2d|gpu|auto` forces a path for demos and screenshots.
 * Labels are HTML, not canvas, so they are readable and translatable (Design.md §8).
 */
/**
 * Which renderer this browser gets. Read through `useSyncExternalStore` rather than an effect, so the server renders
 * "pending" (no canvas) and the client picks a path during hydration without a cascading setState.
 */
const subscribeNoop = () => () => {};
function detectRenderer(): "gpu" | "2d" {
  if (MODE === "2d") return "2d";
  if (MODE === "gpu") return "gpu";
  const supported = typeof navigator !== "undefined" && "gpu" in navigator;
  // Reduced motion gets the 2D path, which draws exactly one frame (C-F4).
  const reduced = typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  return supported && !reduced ? "gpu" : "2d";
}

export function PrismHero({ activity, active, eventsIn, actionsOut }: PrismHeroProps) {
  const detected = useSyncExternalStore(subscribeNoop, detectRenderer, () => "pending" as const);
  const [unsupported, setUnsupported] = useState(false);
  const fallback = useCallback(() => setUnsupported(true), []);
  const renderer = unsupported ? "2d" : detected;

  return (
    <div className="relative overflow-hidden rounded-2xl border border-border bg-[#070810] text-[#e8eaf2]" style={{ colorScheme: "dark" }}>
      {/* The beam sweeps under this copy, so it sits on its own soft scrim rather than fighting the light. */}
      <div className="px-4 pt-4 sm:absolute sm:left-6 sm:top-5 sm:z-[1] sm:max-w-sm sm:rounded-xl sm:bg-[radial-gradient(120%_120%_at_0%_0%,rgba(7,8,16,0.92),rgba(7,8,16,0))] sm:p-3">
        <p className="text-lg font-semibold tracking-tight sm:text-xl">One stream in. Seven specialists out.</p>
        <p className="mt-1 max-w-sm text-xs text-[#8b93a7] sm:text-sm">Every action is proposed by code, bounded by guardrails and gated by a human when money is at stake.</p>
      </div>

      <div className="relative aspect-[960/280] w-full">
        {renderer === "gpu" ? <PrismWebGPU activity={activity} onUnsupported={fallback} /> : renderer === "2d" ? <PrismCanvas2D activity={activity} /> : null}

        {/* A legend in fan order rather than labels pinned to the rays: the fan sweeps with the pointer, so a fixed
            label would soon point at the wrong colour. Each entry lights up when its module produces an event. */}
        <ul className="pointer-events-none absolute inset-y-0 right-3 hidden flex-col justify-center gap-1 sm:flex" aria-hidden>
          {FAN_MODULES.map((entry) => {
            const lit = active.has(entry.module);
            return (
              <li
                key={entry.module}
                className="flex items-center justify-end gap-2 whitespace-nowrap text-[11px] font-medium transition-[color,text-shadow] duration-200"
                style={{ color: lit ? entry.color : "#8b93a7", textShadow: lit ? `0 0 12px ${entry.color}` : "none" }}
              >
                {MODULE_LABELS[entry.module]}
                <span className="h-2.5 w-2.5 shrink-0 rounded-full transition-[box-shadow] duration-200" style={{ background: entry.color, boxShadow: lit ? `0 0 10px ${entry.color}` : "none" }} />
              </li>
            );
          })}
        </ul>
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

      {/* The picture carries meaning, so it also exists as text (Design.md §8). */}
      <p className="sr-only">
        A single beam of webhook events enters a glass prism and leaves as seven coloured rays, one per module: {FAN_MODULES.map((entry) => MODULE_LABELS[entry.module]).join(", ")}. {eventsIn} events in,{" "}
        {actionsOut} actions out.
      </p>
    </div>
  );
}
