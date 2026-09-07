export interface PrismHeroProps {
  eventsIn: string;
  actionsOut: string;
}

/**
 * The seven action modules as the spectrum the glass throws, ordered red through magenta by how far the prism bends
 * them. `deviation` is degrees below horizontal; the colour is the module's own token from `globals.css`, so the rays
 * are the same seven colours that mark badges, feed rails and the sidebar legend — the picture reads as the legend
 * rather than as decoration (Design.md §1, §2).
 */
const SPECTRUM = [
  { module: "checkout_recovery", deviation: 15 },
  { module: "subscription_salvager", deviation: 19 },
  { module: "b2b_negotiator", deviation: 23 },
  { module: "compliance", deviation: 27 },
  { module: "chargeback_evidence", deviation: 31 },
  { module: "x402", deviation: 35 },
  { module: "nlq", deviation: 39 },
] as const;

/*
 * Scene geometry, in the SVG's own 640×250 user space. An equilateral prism (side 120) sits apex-up left of centre;
 * the beam meets its left face, bends once crossing the glass, and disperses off the right face toward the base — the
 * direction a real prism deviates light. The panel is pinned to the same 64:25 ratio the viewBox has, so the whole
 * scene is always visible: nothing here is ever cropped, at any breakpoint.
 */
const APEX = { x: 190, y: 26.7 };
const BASE_LEFT = { x: 130, y: 130.6 };
const BASE_RIGHT = { x: 250, y: 130.6 };
/** The far face of the extrusion, set back and up: what you see through the near face of a solid block of glass. */
const DEPTH = { x: -15, y: -11 };
/** Where the beam meets the glass (45% down the left face) and where the refracted beam leaves it (62% down the right). */
const ENTRY = { x: 163, y: 73.5 };
const EXIT = { x: 227.2, y: 91.1 };
/** The beam arrives 12° below horizontal from off-frame, crossing the left edge high. */
const SOURCE = { x: -42.4, y: 29.8 };
/** Long enough that the falloff below, not the frame, is what ends every ray. */
const RAY_LENGTH = 380;

const shift = (point: { x: number; y: number }) => ({ x: point.x + DEPTH.x, y: point.y + DEPTH.y });
const polygon = (...points: { x: number; y: number }[]) => points.map((point) => `${point.x},${point.y}`).join(" ");
const rayEnd = (deviation: number) => ({
  x: EXIT.x + RAY_LENGTH * Math.cos((deviation * Math.PI) / 180),
  y: EXIT.y + RAY_LENGTH * Math.sin((deviation * Math.PI) / 180),
});

/**
 * The Overview hero: the product's promise as one picture. One webhook stream enters the glass, seven specialist
 * modules leave it. Drawn entirely in SVG and CSS — no canvas, no WebGPU, nothing to feature-detect — so it renders
 * identically on a GPU-less VM (C-F4). The card forces the dark palette on itself with `.dark`, the way `KitchenSink`
 * forces a theme on a subtree, because coloured light only reads on a dark ground.
 */
export function PrismHero({ eventsIn, actionsOut }: PrismHeroProps) {
  return (
    <div className="dark card overflow-hidden text-fg">
      <div className="grid items-center gap-6 p-5 sm:p-7 md:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)] md:gap-8">
        <div>
          <h2 className="text-xl font-semibold tracking-tight text-balance sm:text-2xl">One stream in. Seven specialists out.</h2>
          <p className="mt-2 max-w-[46ch] text-sm text-fg-muted">
            Every action is proposed by code, bounded by guardrails and gated by a human when money is at stake.
          </p>

          <dl className="mt-6 flex items-stretch gap-5">
            <div className="flex flex-col-reverse">
              <dt className="mt-0.5 text-xs text-fg-muted">events in</dt>
              <dd className="font-mono text-2xl font-medium tabular-nums">{eventsIn}</dd>
            </div>
            <div className="w-px bg-border" aria-hidden />
            <div className="flex flex-col-reverse">
              <dt className="mt-0.5 text-xs text-fg-muted">actions out</dt>
              <dd className="font-mono text-2xl font-medium tabular-nums">{actionsOut}</dd>
            </div>
          </dl>
        </div>

        {/* Decorative: the headline and the readouts above carry the whole message in text. */}
        <svg viewBox="0 0 640 250" role="presentation" aria-hidden="true" className="isolate block aspect-[64/25] w-full rounded-xl ring-1 ring-border">
          <defs>
            {/* The stage: a tight studio pool around the glass falling off to near-black at the frame. */}
            <radialGradient id="prism-stage" cx="38%" cy="42%" r="76%">
              <stop offset="0%" stopColor="#141a2c" />
              <stop offset="55%" stopColor="#090c17" />
              <stop offset="100%" stopColor="#04050b" />
            </radialGradient>

            {/*
             * One falloff for the whole fan, squashed vertically into an ellipse: light carries much further across
             * the panel than down it, so every ray — the shallow ones running the full width and the steep ones
             * dropping to the bottom — fades to nothing just inside the frame instead of being cut off by it.
             */}
            <radialGradient
              id="prism-falloff"
              gradientUnits="userSpaceOnUse"
              cx={EXIT.x}
              cy={EXIT.y}
              r="410"
              gradientTransform={`translate(${EXIT.x} ${EXIT.y}) scale(1 0.42) translate(${-EXIT.x} ${-EXIT.y})`}
            >
              <stop offset="0%" stopColor="#fff" stopOpacity="1" />
              <stop offset="40%" stopColor="#fff" stopOpacity="0.9" />
              <stop offset="78%" stopColor="#fff" stopOpacity="0.35" />
              <stop offset="100%" stopColor="#fff" stopOpacity="0" />
            </radialGradient>
            <mask id="prism-fan-mask">
              <rect x="0" y="0" width="640" height="250" fill="url(#prism-falloff)" />
            </mask>

            {/* The entry beam builds toward the glass instead of starting hard at the frame edge. */}
            <linearGradient id="prism-beam" gradientUnits="userSpaceOnUse" x1={SOURCE.x} y1={SOURCE.y} x2={ENTRY.x} y2={ENTRY.y}>
              <stop offset="0%" stopColor="#fff" stopOpacity="0" />
              <stop offset="35%" stopColor="#fff" stopOpacity="0.5" />
              <stop offset="100%" stopColor="#fff" stopOpacity="1" />
            </linearGradient>

            <linearGradient id="prism-glass" gradientUnits="userSpaceOnUse" x1={APEX.x} y1={APEX.y} x2={BASE_RIGHT.x} y2={BASE_RIGHT.y}>
              <stop offset="0%" stopColor="#fff" stopOpacity="0.13" />
              <stop offset="100%" stopColor="#fff" stopOpacity="0.03" />
            </linearGradient>

            <radialGradient id="prism-bloom">
              <stop offset="0%" stopColor="#fff" stopOpacity="0.85" />
              <stop offset="45%" stopColor="#fff" stopOpacity="0.22" />
              <stop offset="100%" stopColor="#fff" stopOpacity="0" />
            </radialGradient>
          </defs>

          <rect x="0" y="0" width="640" height="250" fill="url(#prism-stage)" />

          {/* The dispersed fan, additive so the rays pile into white where they still overlap at the exit point. */}
          <g mask="url(#prism-fan-mask)" style={{ mixBlendMode: "screen" }}>
            {SPECTRUM.map(({ module, deviation }) => {
              const end = rayEnd(deviation);
              const colour = `var(--mod-${module})`;
              return (
                <g key={module}>
                  <line x1={EXIT.x} y1={EXIT.y} x2={end.x} y2={end.y} stroke={colour} strokeWidth="17" strokeOpacity="0.16" strokeLinecap="round" />
                  <line x1={EXIT.x} y1={EXIT.y} x2={end.x} y2={end.y} stroke={colour} strokeWidth="2.6" strokeOpacity="0.95" strokeLinecap="round" />
                </g>
              );
            })}
          </g>

          {/* The far face and the three struts, read through the glass: what makes the triangle a solid block. */}
          <g fill="none" stroke="#fff" strokeLinejoin="round" strokeWidth="1">
            <polygon points={polygon(shift(APEX), shift(BASE_LEFT), shift(BASE_RIGHT))} strokeOpacity="0.12" />
            {[APEX, BASE_LEFT, BASE_RIGHT].map((corner) => (
              <line key={`${corner.x}-${corner.y}`} x1={corner.x} y1={corner.y} x2={shift(corner).x} y2={shift(corner).y} strokeOpacity="0.09" />
            ))}
          </g>

          <polygon points={polygon(APEX, BASE_LEFT, BASE_RIGHT)} fill="url(#prism-glass)" stroke="#fff" strokeOpacity="0.34" strokeWidth="1.2" strokeLinejoin="round" />
          {/* The face the beam lands on catches more light than the other two. */}
          <line x1={APEX.x} y1={APEX.y} x2={BASE_LEFT.x} y2={BASE_LEFT.y} stroke="#fff" strokeOpacity="0.62" strokeWidth="1.2" strokeLinecap="round" />

          {/* The beam: refracted segment inside the glass, then the shaft arriving from off-frame. */}
          <line x1={ENTRY.x} y1={ENTRY.y} x2={EXIT.x} y2={EXIT.y} stroke="#fff" strokeOpacity="0.8" strokeWidth="1.8" strokeLinecap="round" />
          <line x1={SOURCE.x} y1={SOURCE.y} x2={ENTRY.x} y2={ENTRY.y} stroke="url(#prism-beam)" strokeWidth="11" strokeOpacity="0.14" strokeLinecap="round" />
          <line x1={SOURCE.x} y1={SOURCE.y} x2={ENTRY.x} y2={ENTRY.y} stroke="url(#prism-beam)" strokeWidth="2.2" strokeLinecap="round" />
          {/* The one moving thing on the page: packets running down the beam, the event stream reaching the glass. */}
          <line
            x1={SOURCE.x}
            y1={SOURCE.y}
            x2={ENTRY.x}
            y2={ENTRY.y}
            stroke="url(#prism-beam)"
            strokeWidth="4"
            strokeOpacity="0.42"
            strokeLinecap="round"
            strokeDasharray="4 26"
            className="beam-flow"
          />

          <circle cx={ENTRY.x} cy={ENTRY.y} r="13" fill="url(#prism-bloom)" />
          <circle cx={EXIT.x} cy={EXIT.y} r="19" fill="url(#prism-bloom)" />
        </svg>
      </div>
    </div>
  );
}
