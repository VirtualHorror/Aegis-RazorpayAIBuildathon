"use client";

import { MODULE_LABELS } from "@/lib/format";

export interface PrismPlaceholderProps {
  /** Modules with a bus event in the last 1.2 s (the parent owns the timers); their labels and rays light up. */
  active: ReadonlySet<string>;
  eventsIn: string;
  actionsOut: string;
}

const RAYS: readonly { module: string; color: string; angle: number }[] = [
  { module: "checkout_recovery", color: "var(--mod-checkout_recovery)", angle: -24 },
  { module: "subscription_salvager", color: "var(--mod-subscription_salvager)", angle: -16 },
  { module: "b2b_negotiator", color: "var(--mod-b2b_negotiator)", angle: -8 },
  { module: "chargeback_evidence", color: "var(--mod-chargeback_evidence)", angle: 0 },
  { module: "x402", color: "var(--mod-x402)", angle: 8 },
  { module: "compliance", color: "var(--mod-compliance)", angle: 16 },
  { module: "nlq", color: "var(--mod-nlq)", angle: 24 },
];
const EXIT = { x: 528, y: 150 };
const RAY_LENGTH = 330;
const STARS = Array.from({ length: 70 }, (_, index) => ({
  x: (index * 137.508) % 960,
  y: (index * 97.31 + 13) % 280,
  r: 0.6 + ((index * 7) % 5) * 0.25,
}));

/**
 * Static prism hero (Task 18); the WebGPU/Canvas version replaces it in Task 22 with the same props.
 * Intent: the pitch in one picture — one white beam of events enters, the orchestrator splits it into the module
 *         spectrum. Labels at the fan ends light up when the bus reports activity for that module.
 */
export function PrismPlaceholder({ active, eventsIn, actionsOut }: PrismPlaceholderProps) {
  const isActive = (module: string) => active.has(module);

  return (
    <div className="relative overflow-hidden rounded-2xl border border-border bg-[#070810] text-[#e8eaf2]" style={{ colorScheme: "dark" }}>
      {/* On phones the copy sits above the picture; from `sm` it overlays the empty upper-left of the scene. */}
      <div className="px-4 pt-4 sm:absolute sm:left-6 sm:top-5 sm:z-[1] sm:p-0">
        <p className="text-lg font-semibold tracking-tight sm:text-xl">One stream in. Seven specialists out.</p>
        <p className="mt-1 max-w-sm text-xs text-[#8b93a7] sm:text-sm">Every action is proposed by code, bounded by guardrails and gated by a human when money is at stake.</p>
      </div>
      <svg viewBox="0 0 960 280" className="block h-auto w-full" role="img" aria-label="One event stream enters a prism and leaves as seven coloured module rays">
        <defs>
          <filter id="prism-glow" x="-20%" y="-50%" width="140%" height="200%">
            <feGaussianBlur stdDeviation="3" />
          </filter>
          <radialGradient id="prism-vignette" cx="50%" cy="50%" r="70%">
            <stop offset="0%" stopColor="#141a33" stopOpacity="0.9" />
            <stop offset="100%" stopColor="#070810" stopOpacity="0" />
          </radialGradient>
        </defs>
        <rect width="960" height="280" fill="url(#prism-vignette)" />
        {STARS.map((star, index) => (
          <circle key={index} cx={star.x} cy={star.y} r={star.r} fill="#ffffff" opacity={0.35} />
        ))}
        {/* Beam in */}
        <line x1="24" y1="150" x2="452" y2="150" stroke="#ffffff" strokeWidth="6" opacity="0.35" filter="url(#prism-glow)" />
        <line x1="24" y1="150" x2="452" y2="150" stroke="#ffffff" strokeWidth="1.5" />
        {/* Prism */}
        <path d="M480 44 L570 232 L390 232 Z" fill="rgba(255,255,255,0.04)" stroke="rgba(255,255,255,0.7)" strokeWidth="1.5" />
        <path d="M480 44 L570 232 L390 232 Z" fill="none" stroke="#ffffff" strokeWidth="1" opacity="0.25" filter="url(#prism-glow)" />
        {/* Internal segment */}
        <line x1="452" y1="150" x2={EXIT.x} y2={EXIT.y} stroke="#ffffff" strokeWidth="1.5" opacity="0.8" />
        {/* Fan */}
        {RAYS.map((ray) => {
          const rad = (ray.angle * Math.PI) / 180;
          const x2 = EXIT.x + Math.cos(rad) * RAY_LENGTH;
          const y2 = EXIT.y + Math.sin(rad) * RAY_LENGTH;
          const active = isActive(ray.module);
          return (
            <g key={ray.module}>
              <line x1={EXIT.x} y1={EXIT.y} x2={x2} y2={y2} stroke={ray.color} strokeWidth={active ? 7 : 5} opacity={active ? 0.9 : 0.35} filter="url(#prism-glow)" style={{ transition: "opacity 200ms ease-out" }} />
              <line x1={EXIT.x} y1={EXIT.y} x2={x2} y2={y2} stroke={ray.color} strokeWidth="1.5" opacity={active ? 1 : 0.85} />
            </g>
          );
        })}
        {/* Specular streak continuing past the prism */}
        <line x1={EXIT.x} y1={EXIT.y} x2="940" y2="150" stroke="#ffffff" strokeWidth="1" opacity="0.18" />
      </svg>

      {/* Labels at the fan ends (HTML so they wrap and stay legible). */}
      <div className="pointer-events-none absolute inset-0 hidden sm:block" aria-hidden>
        {RAYS.map((ray) => {
          const rad = (ray.angle * Math.PI) / 180;
          const x = ((EXIT.x + Math.cos(rad) * (RAY_LENGTH + 14)) / 960) * 100;
          const y = ((EXIT.y + Math.sin(rad) * (RAY_LENGTH + 14)) / 280) * 100;
          const active = isActive(ray.module);
          return (
            <span
              key={ray.module}
              className="absolute -translate-y-1/2 whitespace-nowrap text-[11px] font-medium transition-[opacity,color] duration-200"
              style={{ left: `${x}%`, top: `${y}%`, color: active ? ray.color : "#8b93a7", opacity: active ? 1 : 0.85, textShadow: active ? `0 0 10px ${ray.color}` : "none" }}
            >
              {MODULE_LABELS[ray.module]}
            </span>
          );
        })}
      </div>

      <div className="flex justify-between px-4 pb-3 font-mono text-xs text-[#8b93a7] sm:absolute sm:inset-x-6 sm:bottom-4 sm:p-0">
        <span>
          <span className="text-[#e8eaf2]">{eventsIn}</span> events in
        </span>
        <span>
          <span className="text-[#e8eaf2]">{actionsOut}</span> actions out
        </span>
      </div>
    </div>
  );
}
