/**
 * The mapping the hero exists to make: seven bands of one spectrum, seven Aegis modules.
 *
 * Intent: "One stream in. Seven specialists out." only lands if a viewer can name the colours. Each
 * band pins a module to a wavelength inside the 400-700 nm range `light-mesh.ts` disperses, ordered by
 * how far the glass bends it — red deviates least and leaves the exit face first, violet bends hardest
 * and leaves last. That order is physical, not editorial: it is the order the rays come out in, top to
 * bottom, so a legend row printed in this sequence sits on its own ray. Do not re-sort it.
 *
 * `hue` is the true sRGB of that wavelength, generated once with `scene/optics.ts`
 * `wavelengthToBeamRgb` — the same CIE + D65 chain that produced `shaders/spectral.wgsl` — and
 * normalized to its peak channel, so it is exactly the colour the canvas paints that ray. The label
 * and the swatch come from `MODULE_LABELS` / `moduleColorVar`, so the legend cannot drift away from
 * the badges and feed rails that use the same seven tokens.
 */
export interface SpectrumBand {
  readonly module: string;
  /** Nanometres. Lower bends further; this list runs long to short, so red is first. */
  readonly wavelengthNm: number;
  /** sRGB of `wavelengthNm`, hue-normalized: what the ray on the canvas actually looks like. */
  readonly hue: string;
}

export const SPECTRUM: readonly SpectrumBand[] = [
  { module: "checkout_recovery", wavelengthNm: 660, hue: "#ff0061" },
  { module: "subscription_salvager", wavelengthNm: 600, hue: "#ff5000" },
  { module: "b2b_negotiator", wavelengthNm: 545, hue: "#00ff86" },
  { module: "compliance", wavelengthNm: 495, hue: "#00c1ff" },
  { module: "chargeback_evidence", wavelengthNm: 465, hue: "#0022ff" },
  { module: "x402", wavelengthNm: 430, hue: "#6000ff" },
  { module: "nlq", wavelengthNm: 410, hue: "#7600ff" },
];
