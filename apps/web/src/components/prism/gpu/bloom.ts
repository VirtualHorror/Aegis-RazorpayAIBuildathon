/**
 * Bloom pyramid configuration, ported from `vercel-labs/vgpu`
 * (`apps/docs/.../prism-background/pipelines/dark/passes/bloom/{config,uniforms}.ts`) at the two-level
 * low tier — the "Bloom 1/2" and "Bloom 1/4" nodes vgpu.sh's own debug graph shows.
 *
 * Deviation from upstream: vgpu also ships a bilinear-pair variant of the blur that reconstructs the
 * same discrete kernel with roughly half the texture fetches. Aegis runs the plain kernel: at 6 and 10
 * taps on half- and quarter-resolution targets the saving is not worth a second shader and its
 * CPU-side pairing math (D-087).
 */

/** Number of half-resolution steps used to represent the halo. */
export const BLOOM_LEVELS = 2;
/** Wider kernels are inexpensive on the progressively smaller targets. */
export const BLOOM_KERNEL_TAPS = [6, 10] as const;
export const BLOOM_LEVEL_DIVISORS = [2, 4] as const;
/** Near-to-far scale weights. `bloom-composite.wgsl` blends between them with the radius. */
export const BLOOM_LEVEL_FACTORS = [1, 0.8] as const;
/** The WGSL kernel array is a fixed 24 slots; unused coefficients are zero-padded. */
const KERNEL_CAPACITY = 24;

export type BloomBlurAxis = "horizontal" | "vertical";

/**
 * Symmetric, energy-normalized half-kernel. The shader samples index zero once and every remaining
 * coefficient twice, so the normalization counts them that way too.
 */
export function bloomKernelWeights(tapCount: number, capacity = KERNEL_CAPACITY): readonly number[] {
  const count = Math.min(capacity, Math.max(1, Math.floor(tapCount)));
  const sigma = count / 3;
  const weights = Array.from({ length: capacity }, (_, index) =>
    index < count ? Math.exp((-0.5 * index * index) / (sigma * sigma)) : 0,
  );
  const total = weights[0]! + 2 * weights.slice(1, count).reduce((sum, weight) => sum + weight, 0);
  return weights.map((weight) => weight / total);
}

const KERNEL_WEIGHTS = BLOOM_KERNEL_TAPS.map((count) => bloomKernelWeights(count));

export function bloomBlurUniforms(
  level: number,
  axis: BloomBlurAxis,
  size: readonly [number, number],
): Record<string, unknown> {
  const coefficients = KERNEL_WEIGHTS[level] ?? KERNEL_WEIGHTS.at(-1)!;
  return {
    direction: axis === "horizontal" ? [1, 0] : [0, 1],
    texelSize: [1 / size[0], 1 / size[1]],
    tapCount: BLOOM_KERNEL_TAPS[level] ?? BLOOM_KERNEL_TAPS.at(-1)!,
    coefficients0: coefficients.slice(0, 4),
    coefficients1: coefficients.slice(4, 8),
    coefficients2: coefficients.slice(8, 12),
    coefficients3: coefficients.slice(12, 16),
    coefficients4: coefficients.slice(16, 20),
    coefficients5: coefficients.slice(20, 24),
  };
}

export function bloomLevelSize(
  size: readonly [number, number],
  level: number,
): readonly [number, number] {
  const divisor = BLOOM_LEVEL_DIVISORS[level] ?? BLOOM_LEVEL_DIVISORS.at(-1)!;
  return [Math.max(1, Math.ceil(size[0] / divisor)), Math.max(1, Math.ceil(size[1] / divisor))];
}

const PACKED_BLOOM_FEATURE: GPUFeatureName = "rg11b10ufloat-renderable";

/** Packed HDR halves the bloom chain's bandwidth where the device renders that format. */
export function bloomFormat(features: Pick<GPUSupportedFeatures, "has">): GPUTextureFormat {
  return features.has(PACKED_BLOOM_FEATURE) ? "rg11b10ufloat" : "rgba16float";
}

/** Optional device features worth asking for; absent ones fall back exactly. */
export function prismOptionalFeatures(
  supported: Pick<GPUSupportedFeatures, "has"> | undefined,
): readonly GPUFeatureName[] {
  return supported?.has(PACKED_BLOOM_FEATURE) ? [PACKED_BLOOM_FEATURE] : [];
}
