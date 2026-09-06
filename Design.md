# Design — the Aegis dashboard

> Visual and interaction spec for `apps/web`. Codex reads this before any frontend task (T17–T22).
> References (watched/inspected by the Architect on 2026-09-05, files in `~/Downloads/ReferenceAttachements`):
> 1. `Recording 2026-09-05 074601.mp4` — vgpu.sh hero: glass prism, pointer-driven light beam, rainbow dispersion.
> 2. `Recording 2026-09-05 074749.mp4` — Warp-style halftone dot grid that brightens into solid flowing shapes.
> 3. `Screenshot 2026-09-05 075505.png` — Slack AI composer: dark rounded input with a soft multi-colour gradient glow bleeding out behind it.

## 1. Direction: "mission control for money"

Aegis is a control plane, so the UI should feel like an instrument panel, not a marketing site: dense but calm, monospace where data is data, one accent colour, real-time feedback, and generous dark surfaces where light effects can live. The single visual metaphor is the **prism**: one stream of events comes in, the orchestrator splits it into coloured, specialised actions. Module colours are the spectrum.

## 2. Tokens (Tailwind 4 `@theme` in `globals.css`)

| Token | Light | Dark | Use |
|---|---|---|---|
| `--bg` | `#F6F7FB` | `#070810` | page background |
| `--surface` | `#FFFFFF` | `#0E1019` | cards, panels |
| `--surface-2` | `#EEF0F6` | `#161927` | table headers, code, inset |
| `--border` | `#DDE1EA` | `#232739` | 1px hairlines |
| `--fg` | `#0B1020` | `#E8EAF2` | primary text |
| `--fg-muted` | `#5B6478` | `#8B93A7` | secondary text |
| `--accent` | `#2B6CF6` (Razorpay-adjacent blue) | `#5B8DFF` | links, primary buttons, focus rings |
| `--ok` | `#0F9D58` | `#31C48D` | executed / recovered |
| `--warn` | `#D97706` | `#F5A524` | pending approval |
| `--danger` | `#DC2626` | `#F87171` | blocked / failed / prohibited |
| Module spectrum | `checkout_recovery` #FF4D4D · `subscription_salvager` #FFB020 · `b2b_negotiator` #3DDC84 · `chargeback_evidence` #3B82F6 · `x402` #A855F7 · `compliance` #22D3EE · `nlq` #F472B6 | same | badges, feed rails, prism fan |

Typography: `Geist Sans` for UI (`next/font`), `Geist Mono` for ids, amounts, JSON, SQL. Sizes: 13px body in tables, 14px elsewhere, 28–40px display for KPI numbers (tabular-nums). Spacing scale 4px; cards `rounded-2xl`, 1px border, no drop shadows in light mode; dark mode uses subtle inner highlight (`inset 0 1px 0 rgba(255,255,255,.04)`).

## 3. Layout

- **App shell**: left sidebar 240px (collapses to icons < 1024px, to a bottom bar < 640px) with nav: Overview, Events, Actions, Approvals, Ask Aegis, Compliance, x402 Lab, Settings. Top bar: environment pill (`LOCAL · SIM`), LLM provider pill (`openai · gpt-5.6` / `stub · degraded`), kill-switch indicator, theme toggle, "Run demo" button.
- **Footer** on every route (in `app/layout.tsx`, not per page): `Made with 💖 by Nabhanyu for Razorpay AI Buildathon` — small, muted, centred, always visible at the bottom of the scroll container.
- **Content** max-width 1400px, 24px gutters, 16px on mobile.

## 4. Pages

| Route | Purpose | Key components |
|---|---|---|
| `/` Overview | the pitch in one screen | `PrismHero` (flourish 1) with live counters flowing through it; KPI tiles: events (dupes rejected), actions (executed / pending / blocked), money recovered (₹), discounts granted, x402 revenue, LLM health (calls, degraded %); recent actions list |
| `/events` | live ingress feed | SSE-driven table: time, event id, type, signature ✓/✗, dup count, status, latency; row expands to raw JSON; filters by type/status; `HalftoneField` (flourish 2) as the empty-state / "listening" backdrop |
| `/actions` | audit trail | table + drawer: proposal, `bounds` rendered as a checklist (✓/✗ with limit vs actual), explanation steps, the exact outbound payload (JSON, copy button), diagnosis card (root cause, confidence bar, strategy, degraded badge), timeline |
| `/approvals` | humans decide | queue of `pending_approval` actions and `requires_human_review` evidence packets; side-by-side: what the AI proposes vs the deterministic facts; Approve / Reject with a required note; result toast |
| `/ask` | Ask Aegis | `GlowInput` (flourish 3) for the question; answer card shows: generated SQL (syntax-highlighted, always visible), validation verdict, result table, NL summary, and for forecast questions a line chart (history + forecast band); history of past questions |
| `/compliance` | catalog risk | flags grouped by risk level; each shows description with the evidence span highlighted, keyword hits vs LLM assessment (agreement badge), actions: acknowledge / false positive; "Run scan" button |
| `/x402` | Agentic commerce lab | three-step interactive demo: 1) request without payment → 402 JSON shown; 2) pay → 200 + `X-PAYMENT-RESPONSE`; 3) replay same nonce → rejected; table of settlements; caps shown |
| `/settings` | guardrails | form over `guardrail_config` with descriptions; kill switch as a big deliberate toggle with confirmation; change history from `audit_log` |

## 5. Flourishes (exact specs)

### 5.1 `PrismHero` — the vgpu.sh hero, replicated (reference 1)

**Superseded on 2026-09-07 by the project owner (D-083).** The earlier design in this section adapted the reference
into Aegis's own metaphor: seven module-coloured rays, a legend that lit per module, a Canvas 2D twin. That was
overruled. The hero is now a strict replica of the vgpu.sh landing shader and carries no product data at all.

The specification, in full:

| | |
|---|---|
| Stage | true black (`#000000`); no ambient term, no vignette, no starfield |
| Geometry | one solid equilateral glass prism, centre-right, as a signed distance field: the triangle swept along an extrusion so the far face and the three struts read through the transparent near face |
| Edges | derivative-based anti-aliasing (`length(vec2f(dpdx, dpdy))` of the SDF, taken in uniform control flow) |
| Light | a single intense white volumetric ray entering from the side; an impact bloom where it meets the outer wall; the refracted ray crossing the glass; a caustic where it leaves the far wall |
| Dispersion | on exit the ray becomes a wide continuous spectrum, red through violet, integrated over 48 wavelengths rather than drawn as discrete bands |
| Dust | tiny drifting motes that emit nothing and are visible only where the light field reaches them |
| Display | Lottes tonemap, linear→sRGB, interleaved-gradient dither, a screen-edge fade on all four sides |

Physics, because it dictates the composition: an equilateral prism deviates light by at least about 37°, so a shallow
beam arriving from above meets the far wall past the critical angle, totally internally reflects, and produces no
spectrum at all. The beam therefore rises at 24° (near minimum deviation), which leaves both internal angles near 28°
— about 13° clear of the critical angle. That headroom is what the dispersion constant spends: `N_SPREAD = 0.30`
opens a 16.7° fan with every wavelength still escaping, where real glass would give two or three degrees.

Implementation:
- `components/prism/prism.wgsl` — the whole scene. One uniform (`resolution_time`: viewport, clock, device pixel ratio); everything else is derived from the viewport inside the shader.
- `components/prism/renderer.ts` — the pipeline: `init()` → `surface()` sized explicitly → `effect()` → `compile()` against the surface's render signature → `frameLoop`. Structured after the official example's own `renderer.ts`.
- `components/prism/PrismHero.tsx` — owns the canvas and its lifetime, nothing else.
- `components/prism/prismShader.test.ts` — the shader resolves, declares one binding, and its struct members match what the renderer sets.

There is no second renderer: a browser without WebGPU shows the card with a black canvas (D-083).

### 5.2 `HalftoneField` — vanishing/appearing pattern (reference 2)
What the reference does: a regular grid of tiny white dots on black (~14 px pitch). An invisible smooth field (a slowly flowing ribbon/aurora shape) moves across; where the field is bright the dots grow until they merge into solid white, where it is dark they shrink to pinpoints. The result is a shape that appears to be "printed" onto the dot matrix and dissolves as it passes.

Implementation (Canvas 2D, `components/fx/HalftoneField.tsx`):
- Props: `pitch=14`, `color` (theme fg), `intensity` (0..1, drives the field amplitude — the events page raises it when new events arrive), `speed`, `className`.
- Field: `f(x,y,t) = smoothstep(0.35, 0.85, 0.5 + 0.5·sin(0.9·u + 0.6·sin(1.7·v + t) + t·0.4))` with `u,v` rotated 35°, plus a second octave at half amplitude. Dot radius `r = pitch · (0.06 + 0.5·f)`. When `r > pitch/2` draw a square cell to merge.
- Render at DPR ≤ 1.5, `requestAnimationFrame` throttled to 30 fps, stops when `prefers-reduced-motion` (draws one frame) or when offscreen (`IntersectionObserver`).
- Used: `/events` backdrop, empty states, the "worker listening" panel, sidebar bottom when collapsed.

### 5.3 `GlowInput` — gradient glow text box (reference 3)
What the reference does: a dark rounded input (radius ~14 px, 1 px hairline border, 56 px tall composer) on a dark surface; behind it a **soft multi-colour halo** — mint/teal top-left, violet/magenta bottom, amber/orange right — blurred ~28 px, ~40 % opacity, extending ~24 px beyond the box like light leaking from behind a panel. Inside: placeholder text, a `Tab` hint chip, left icon buttons, right mic/send.

Implementation (`components/ui/GlowInput.tsx`):
- Wrapper `relative`; pseudo-layer `absolute -inset-1 rounded-[18px] blur-2xl opacity-40 bg-[conic-gradient(from_var(--a),#34D399,#22D3EE,#818CF8,#E879F9,#FBBF24,#34D399)]`; `--a` animates 0→360° over 14 s (`@property --a`), speeds up ×3 while focused, opacity 0.55 on focus, 0.25 idle. Light theme: opacity halves, colours desaturated 20 %.
- Input surface: `bg-surface border border-border rounded-[14px]`, 16px text, `Tab` chip shows an example question when empty (Tab fills it), Enter submits, Shift+Enter newline, loading state replaces the send icon with a spinner and the glow pulses.
- Also used as the compact search on `/events` and `/actions`.

## 6. Motion
- Page transitions: none (instant). Micro-interactions 150–200 ms ease-out. Live feed rows slide in 240 ms and flash the module colour rail once.
- `prefers-reduced-motion`: disable all continuous animation (prism static, halftone static, glow static).

## 7. Theme toggle
`ThemeToggle` in the top bar: three-state (System / Light / Dark) segmented control, icon-only on mobile; persisted by `next-themes`; `<html suppressHydrationWarning class="…">`; `color-scheme` meta updated so native controls match.

## 8. Accessibility & responsiveness checklist (verified by the Architect with Chrome)
- Contrast ≥ 4.5:1 for text in both themes (tokens above are chosen for this).
- All interactive elements reachable with Tab, visible `focus-visible` ring (`--accent`, 2px offset).
- Tables scroll horizontally inside their container; no page-level horizontal scroll at 360px.
- `aria-live="polite"` on the live feed container; toasts use `role="status"`.
- Images/canvases have `aria-hidden` and a text alternative where they carry meaning (KPI numbers are text, not canvas).

## 9. Status (kept by the implementer)

- **T17 (2026-09-06, Claude).** Tokens implemented as in §2, plus: `--mod-<module_name>` spectrum variables (`--mod-checkout_recovery` … `--mod-nlq`, exposed to Tailwind as `mod-checkout`, `mod-salvage`, `mod-negotiate`, `mod-evidence`, `mod-x402`, `mod-compliance`, `mod-nlq`), `--card-highlight` (the dark-mode inner highlight, `none` in light), and `--glow-opacity` / `--glow-focus-opacity` / `--glow-saturate` (light theme halves the halo opacity and desaturates it 20 % as §5.3 specifies). A `.light` class mirrors `:root` so a subtree can be forced light inside a dark page (`/kitchen-sink`). Components consume tokens only, never `dark:` utilities. Module colour is used as *information*: 3px left rails (`.rail`, `--rail`), badge tints, the sidebar spectrum strip, the prism fan. Typography: Geist Sans body 14px, tables 13px, KPI figures in Geist Mono at `clamp(18px, 11cqi, 28px)` (tabular). Chosen where §2 left it open: sentence case everywhere (no tracked all-caps labels), no drop shadows in either theme, active nav marked by a 3px accent rail, numbers never appear inside prose copy. `LOCAL · SIM` keeps the brief's own wording. Breakpoints: sidebar 240px ≥ 1024, 64px icon rail ≥ 640, fixed bottom bar with 44px targets below 640.
- **T18 (2026-09-06, Claude).** `HalftoneField` implemented per §5.2 (`components/fx/halftone.ts` is the pure field, tested; the component throttles to 30 fps, caps DPR at 1.5, stops under reduced motion, pauses offscreen/hidden). Used on `/events` as the "Listening for webhooks" panel (intensity 0.3 idle → 1.0 on a delivery, decaying over 1.5 s), behind the events empty state, and at the bottom of the collapsed icon rail. Overview hero is `PrismPlaceholder` (static SVG: starfield, wireframe prism, white beam, seven-ray fan, HTML labels that light for 1.2 s per module event; copy stacks above the picture below `sm`); T22 swaps it for the WebGPU/Canvas version with the same props. Live rows use `.row-enter` (240 ms slide + one rail flash in the entity-family colour: payment → checkout red, subscription → salvage amber, invoice → negotiate green, dispute → evidence blue, order → accent).
- **T19–T21 (2026-09-06, Claude).** Action and approval surfaces follow §4: module colour appears only as a 3px rail and a badge, never as a fill behind text; guard rules render as a checklist with limit against actual; the outbound payload carries a low-contrast SIMULATED watermark over the JSON (C-B7). Settings uses a purpose-built confirm dialog, never `window.confirm` (§4). Money is typed in rupees and stored in paise; every field shows the stored raw value beneath it so the UI never hides what the API holds.
- **T22 (2026-09-06, Claude).** `PrismHero` per §5.1: `prismGeometry.ts` is the single source of the scene for both renderers (Snell bend at index 1.5, 18° fan, resting angle 10° when the pointer leaves), `prism.wgsl` draws it as SDF capsules with additive colour through `vgpu`'s `effect()`, and `PrismCanvas2D` draws the identical scene with `lineTo`, `shadowBlur` and `globalCompositeOperation: "lighter"`. `PrismHero` picks the path with `useSyncExternalStore` (no setState-in-effect), falls back on an `init()` failure, honours `NEXT_PUBLIC_PRISM_MODE`, caps DPR at 2, and pauses offscreen or when the tab is hidden. Deviation from §5.1: the fan-end labels became a right-hand legend with colour swatches, because the fan sweeps with the pointer and a label pinned to a ray ends up naming the wrong colour; the legend still lights per module on a live event. A new `--on-accent` token keeps text on accent fills above 4.5:1 in both themes (B-018).
- **T25 (2026-09-06, Claude).** `SandboxPill` joins the top bar between the LLM pill and the kill switch: icon-only below `md` (the 360px bar has ~10px to spare, B-025), `Live · acc_…` in accent from `md`, state always in the accessible name. `SandboxModal` follows `ConfirmDialog`: `role="dialog"`, focus moves to the first radio and back on close, Escape and backdrop close, body scroll locked, portalled to `document.body` because the header's `backdrop-blur` is a containing block for `fixed`. Sheet-style (bottom-anchored, full width) below `sm`, centred card above; inputs match the settings form; secrets are `type="password"` with one "show while typing" checkbox; errors use `aria-invalid` + `aria-describedby` and the first invalid field takes focus.
- **Prism hero replica (2026-09-07, Claude, on the project owner's instruction).** §5.1 above is the specification and the code follows it exactly; D-083 records what was removed to get there. The earlier pass below is kept for the record.
- **Prism hero pass (2026-09-06, Claude).** The WebGPU path was running and looked nothing like the reference: a milky blue field, a flat wireframe triangle and thin flat rays. `prism.wgsl` was rewritten against the official vgpu example `triangle-led-front` (`npx vgpu examples pull triangle-led-front`) — Lottes tonemap and linear→sRGB from its `color-utils.wgsl`, the signed triangle SDF from `geometry.wgsl`, interleaved-gradient dithering from `direct-triangle-raycast.wgsl`, and both the derivative-based anti-aliased silhouette and the vertical edge fade from `themes/dark/main-scene-floor.wgsl`. The scene stays Aegis's own (§5.1: one beam in, seven module rays out); the reference's own scene is LED edges lighting a floor and was not copied (D-082). What changed visually: a near-black stage, a **solid** glass prism (the triangle swept along a new `depth` vector, so the far face and the three struts are visible through the glass), a bright thin beam with warm/cool dispersion fringes that separate away from the glass, an impact bloom, a caustic where the bent ray leaves the far wall, and a fan that opens out of the exit point instead of seven equal lines. `PrismCanvas2D` draws the same solid on the same stage. The legend gained a right-hand scrim because the brighter fan ran under it (B-018 again).
