/**
 * The hero's intro, ported from `vercel-labs/vgpu`
 * (`apps/docs/.../prism-background/pipelines/shared/presentation/index.ts`).
 *
 * Two independent curves: the whole picture fades up from the card's background over one second, and
 * the beam opens from its centre line over the next second and a half. Under `prefers-reduced-motion`
 * the renderer never calls this — it binds a settled `{ opacity: 1, beamWidth: 1 }` (C-F4).
 */

/** Display-space black: the dark card the canvas sits on. `copy-presentation.wgsl` blends after ACES. */
export const PAGE_BACKGROUND_SRGB = [0, 0, 0] as const;

const OPACITY_REVEAL_SECONDS = 1;
const BEAM_REVEAL_END_SECONDS = 2.5;
const BEAM_REVEAL_START_OPACITY = 0.25;
/** The beam starts opening once the picture is a quarter visible, not before. */
const BEAM_REVEAL_START_SECONDS = OPACITY_REVEAL_SECONDS * (1 - Math.cbrt(1 - BEAM_REVEAL_START_OPACITY));

export interface RevealProgress {
  readonly opacity: number;
  readonly beamWidth: number;
}

export const SETTLED_REVEAL: RevealProgress = { opacity: 1, beamWidth: 1 };

export function heroRevealProgress(elapsedSeconds: number): RevealProgress {
  const opacityLinear = clamp01(elapsedSeconds / OPACITY_REVEAL_SECONDS);
  const beamLinear = clamp01(
    (elapsedSeconds - BEAM_REVEAL_START_SECONDS) / (BEAM_REVEAL_END_SECONDS - BEAM_REVEAL_START_SECONDS),
  );
  return { opacity: 1 - (1 - opacityLinear) ** 3, beamWidth: 1 - (1 - beamLinear) ** 3 };
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}
