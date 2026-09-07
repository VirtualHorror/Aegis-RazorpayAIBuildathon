import { moduleColorVar } from "@/lib/format";
import { polygonPoints, STILL_HEIGHT, STILL_SCENE, STILL_WIDTH } from "./scene/still";

/**
 * The no-WebGPU picture (C-F4): the same scene as the canvas, drawn flat.
 *
 * Every coordinate comes from `scene/still.ts`, which projects the real prism, the real lamp at the
 * resting incidence and the real refracted heading of each module's wavelength. What it cannot draw is
 * what needs a GPU — the environment reflection, the bloom chain, the dust — so the glass is a flat
 * gradient and the rays are strokes under one elliptical falloff.
 *
 * It renders on the server too, so a page with JavaScript disabled still shows the picture, and the
 * canvas cross-fades over it once the device reports a working adapter.
 */
export function PrismFallback() {
  const { front, back, source, entry, exit, rays } = STILL_SCENE;
  return (
    <svg
      viewBox={`0 0 ${STILL_WIDTH} ${STILL_HEIGHT}`}
      role="presentation"
      aria-hidden="true"
      className="absolute inset-0 block h-full w-full"
      preserveAspectRatio="xMidYMid slice"
    >
      <defs>
        {/* The studio pool the environment map stands in for. */}
        <radialGradient id="prism-still-stage" cx="46%" cy="38%" r="78%">
          <stop offset="0%" stopColor="#141a2c" />
          <stop offset="55%" stopColor="#080b14" />
          <stop offset="100%" stopColor="#03040a" />
        </radialGradient>

        {/*
         * One falloff for the whole fan, squashed into an ellipse: light carries much further across
         * the panel than down it, so the shallow rays and the steep ones both fade to nothing rather
         * than being cut off by the frame.
         */}
        <radialGradient
          id="prism-still-falloff"
          gradientUnits="userSpaceOnUse"
          cx={exit.x}
          cy={exit.y}
          r={STILL_WIDTH * 0.72}
          gradientTransform={`translate(${exit.x} ${exit.y}) scale(1 0.5) translate(${-exit.x} ${-exit.y})`}
        >
          <stop offset="0%" stopColor="#fff" stopOpacity="1" />
          <stop offset="42%" stopColor="#fff" stopOpacity="0.85" />
          <stop offset="76%" stopColor="#fff" stopOpacity="0.3" />
          <stop offset="100%" stopColor="#fff" stopOpacity="0" />
        </radialGradient>
        <mask id="prism-still-fan">
          <rect x="0" y="0" width={STILL_WIDTH} height={STILL_HEIGHT} fill="url(#prism-still-falloff)" />
        </mask>

        <linearGradient id="prism-still-beam" gradientUnits="userSpaceOnUse" x1={source.x} y1={source.y} x2={entry.x} y2={entry.y}>
          <stop offset="0%" stopColor="#fff" stopOpacity="0" />
          <stop offset="45%" stopColor="#fff" stopOpacity="0.55" />
          <stop offset="100%" stopColor="#fff" stopOpacity="1" />
        </linearGradient>

        <linearGradient id="prism-still-glass" gradientUnits="userSpaceOnUse" x1={front[0]!.x} y1={front[0]!.y} x2={front[2]!.x} y2={front[2]!.y}>
          <stop offset="0%" stopColor="#fff" stopOpacity="0.15" />
          <stop offset="100%" stopColor="#fff" stopOpacity="0.03" />
        </linearGradient>

        <radialGradient id="prism-still-bloom">
          <stop offset="0%" stopColor="#fff" stopOpacity="0.9" />
          <stop offset="45%" stopColor="#fff" stopOpacity="0.24" />
          <stop offset="100%" stopColor="#fff" stopOpacity="0" />
        </radialGradient>
      </defs>

      <rect x="0" y="0" width={STILL_WIDTH} height={STILL_HEIGHT} fill="url(#prism-still-stage)" />

      {/* The dispersed fan, screened so the rays pile into white where they still overlap at the exit. */}
      <g mask="url(#prism-still-fan)" style={{ mixBlendMode: "screen" }}>
        {rays.map(({ module, end }) => (
          <g key={module}>
            <line x1={exit.x} y1={exit.y} x2={end.x} y2={end.y} stroke={moduleColorVar(module)} strokeWidth="26" strokeOpacity="0.14" strokeLinecap="round" />
            <line x1={exit.x} y1={exit.y} x2={end.x} y2={end.y} stroke={moduleColorVar(module)} strokeWidth="3.4" strokeOpacity="0.95" strokeLinecap="round" />
          </g>
        ))}
      </g>

      {/* The far cap and the three struts, read through the glass: what makes the triangle a solid. */}
      <g fill="none" stroke="#fff" strokeLinejoin="round" strokeWidth="1.2">
        <polygon points={polygonPoints(back)} strokeOpacity="0.12" />
        {front.map((corner, index) => (
          <line key={corner.x} x1={corner.x} y1={corner.y} x2={back[index]!.x} y2={back[index]!.y} strokeOpacity="0.09" />
        ))}
      </g>

      <polygon points={polygonPoints(front)} fill="url(#prism-still-glass)" stroke="#fff" strokeOpacity="0.34" strokeWidth="1.6" strokeLinejoin="round" />
      {/* The face the beam lands on catches more light than the other two. */}
      <line x1={front[0]!.x} y1={front[0]!.y} x2={front[2]!.x} y2={front[2]!.y} stroke="#fff" strokeOpacity="0.62" strokeWidth="1.6" strokeLinecap="round" />

      {/* The refracted segment inside the glass, then the shaft arriving from off-frame. */}
      <line x1={entry.x} y1={entry.y} x2={exit.x} y2={exit.y} stroke="#fff" strokeOpacity="0.8" strokeWidth="2.4" strokeLinecap="round" />
      <line x1={source.x} y1={source.y} x2={entry.x} y2={entry.y} stroke="url(#prism-still-beam)" strokeWidth="16" strokeOpacity="0.13" strokeLinecap="round" />
      <line x1={source.x} y1={source.y} x2={entry.x} y2={entry.y} stroke="url(#prism-still-beam)" strokeWidth="3" strokeLinecap="round" />
      {/* The one moving thing: packets running down the beam, the event stream reaching the glass. */}
      <line
        x1={source.x}
        y1={source.y}
        x2={entry.x}
        y2={entry.y}
        stroke="url(#prism-still-beam)"
        strokeWidth="5"
        strokeOpacity="0.45"
        strokeLinecap="round"
        strokeDasharray="5 34"
        className="beam-flow"
      />

      <circle cx={entry.x} cy={entry.y} r="18" fill="url(#prism-still-bloom)" />
      <circle cx={exit.x} cy={exit.y} r="26" fill="url(#prism-still-bloom)" />
    </svg>
  );
}
