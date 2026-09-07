/**
 * Deterministic geometry for the light itself, ported from `vercel-labs/vgpu`
 * (`apps/docs/.../prism-background/scene/light-mesh.ts`).
 *
 * Intent: this file *is* the reason the hero is cheap. The previous Aegis hero integrated the fan over
 * discrete wavelengths per pixel, and past a few hundred pixels those samples separate into visible
 * rays. Geometry does not do that. The mesh integrates two continuous dimensions — wavelength vertices
 * are connected to their neighbours so RGB interpolates without banding, and several additive spectral
 * sheets sample the finite width of the collimated beam, preserving the footprint a single centre ray
 * would collapse. `light.wgsl` lifts their XY coordinates to a shared world-space depth.
 *
 * Flow (the order vertices are written, which the shader's `decodeLightVertex` mirrors exactly):
 *   1. white   — `beamSlices` quads: the incoming beam, from off-frame to the entry face.
 *   2. internal— `samples * beamSlices * LIGHT_INTERNAL_SEGMENTS` quads: each wavelength's strip
 *                inside the glass, one quad per traced segment (entry->exit plus each TIR bounce).
 *   3. outgoing— `(samples - 1) * beamSlices` cells connecting neighbouring wavelengths into the fan.
 * Every draw range in `gpu/render.ts` is a slice of that layout.
 */

import {
  intersectTriangle,
  iorAt,
  tracePrismDetailed,
  wavelengthToBeamRgb,
  add,
  cross,
  dot,
  normalize,
  scale,
  sub,
  type DetailedPrismPath,
} from "./optics";
import {
  PRISM_BEAM_SLICES,
  PRISM_LIGHT_EXPOSURE,
  PRISM_LIGHT_FADE,
  PRISM_MAX_INTERNAL_BOUNCES,
  PRISM_SPECTRAL_SAMPLES,
  PRISM_TRIANGLE,
  PRISM_WAVELENGTHS,
  type CollimatedLight,
  type DispersionPreset,
  type Triangle,
  type Vec2,
} from "./constants";

/** Dynamic position.xy and intensity. Static attributes decode from `vertex_index`. */
export const LIGHT_VERTEX_FLOATS = 3;
export const LIGHT_VERTEX_STRIDE = LIGHT_VERTEX_FLOATS * Float32Array.BYTES_PER_ELEMENT;
const VERTICES_PER_QUAD = 6;
/** Entry-to-exit segment plus one slot for every possible internal bounce. */
export const LIGHT_INTERNAL_SEGMENTS = PRISM_MAX_INTERNAL_BOUNCES + 1;
/** The collimated source is deliberately emissive HDR, not painted white. */
export const INPUT_BEAM_RADIANCE = 6;
const DENSITY_MEASURE_DISTANCE = 1;

const whiteQuadCount = (beamSlices: number) => beamSlices;
const internalQuadCount = (samples: number, beamSlices: number) =>
  samples * beamSlices * LIGHT_INTERNAL_SEGMENTS;

export interface LightMeshLayout {
  readonly samples: number;
  readonly beamSlices: number;
  readonly whiteQuads: number;
  readonly internalQuads: number;
  readonly whiteVertices: number;
  readonly internalFirstVertex: number;
  readonly internalVertices: number;
  readonly outgoingFirstVertex: number;
  readonly outgoingVertices: number;
  readonly vertexCount: number;
}

export function lightMeshLayout(
  samples = PRISM_SPECTRAL_SAMPLES,
  beamSlices = PRISM_BEAM_SLICES,
): LightMeshLayout {
  const safeSamples = Math.max(2, Math.floor(samples));
  const safeBeamSlices = Math.max(1, Math.floor(beamSlices));
  const whiteQuads = whiteQuadCount(safeBeamSlices);
  const internalQuads = internalQuadCount(safeSamples, safeBeamSlices);
  const whiteVertices = whiteQuads * VERTICES_PER_QUAD;
  const internalVertices = internalQuads * VERTICES_PER_QUAD;
  const outgoingVertices = (safeSamples - 1) * safeBeamSlices * VERTICES_PER_QUAD;
  return Object.freeze({
    samples: safeSamples,
    beamSlices: safeBeamSlices,
    whiteQuads,
    internalQuads,
    whiteVertices,
    internalFirstVertex: whiteVertices,
    internalVertices,
    outgoingFirstVertex: whiteVertices + internalVertices,
    outgoingVertices,
    vertexCount: whiteVertices + internalVertices + outgoingVertices,
  });
}

/** The one layout Aegis builds: 64 wavelengths x 12 beam slices = 23,040 vertices. */
export const LIGHT_MESH_LAYOUT = lightMeshLayout();

export interface LightMeshStats {
  readonly samples: number;
  readonly beamSlices: number;
  readonly validBands: number;
  readonly rejectedTopology: number;
  /** Integrated scalar flux, useful for checking subdivision invariance. */
  readonly totalFlux: number;
}

export interface LightMeshData {
  readonly vertices: Float32Array<ArrayBuffer>;
  readonly vertexCount: number;
  readonly stats: LightMeshStats;
}

export interface LightMeshOptions {
  readonly light: CollimatedLight;
  readonly dispersion: DispersionPreset;
  readonly wallHalfExtent: Vec2;
  readonly triangle?: Triangle;
  readonly samples?: number;
  readonly beamSlices?: number;
  readonly exposure?: number;
  readonly edgeFalloff?: number;
}

interface SpectralNode {
  readonly wavelength: number;
  /** Paths through the centre of each slice, used by the outgoing fan. */
  readonly paths: readonly (DetailedPrismPath | undefined)[];
  /** Paths along every slice boundary, used to give internal light width. */
  readonly boundaryPaths: readonly (DetailedPrismPath | undefined)[];
}

/** Origin at a normalized coordinate across the finite collimated beam. */
export function beamProfileOrigin(light: CollimatedLight, profile: number): Vec2 {
  const perpendicular: Vec2 = [-light.direction[1], light.direction[0]];
  return add(light.center, scale(perpendicular, light.beamHalfWidth * Math.min(1, Math.max(-1, profile))));
}

/** First point where a forward ray reaches the axis-aligned wall rectangle. */
export function rayToWallBoundary(origin: Vec2, direction: Vec2, halfExtent: Vec2): Vec2 {
  let nearest = Number.POSITIVE_INFINITY;
  for (let axis = 0; axis < 2; axis++) {
    const component = direction[axis]!;
    if (Math.abs(component) < 1e-8) continue;
    for (const side of [-halfExtent[axis]!, halfExtent[axis]!] as const) {
      const distance = (side - origin[axis]!) / component;
      if (distance <= 0 || distance >= nearest) continue;
      const other = 1 - axis;
      const otherCoordinate = origin[other]! + direction[other]! * distance;
      if (Math.abs(otherCoordinate) <= halfExtent[other]! + 1e-6) nearest = distance;
    }
  }
  return Number.isFinite(nearest) ? add(origin, scale(direction, nearest)) : origin;
}

/** The portion of a forward ray that lies inside the wall rectangle. */
export function lineThroughWall(
  origin: Vec2,
  direction: Vec2,
  halfExtent: Vec2,
): readonly [Vec2, Vec2] | undefined {
  let near = Number.NEGATIVE_INFINITY;
  let far = Number.POSITIVE_INFINITY;
  for (let axis = 0; axis < 2; axis++) {
    const component = direction[axis]!;
    const coordinate = origin[axis]!;
    const extent = halfExtent[axis]!;
    if (Math.abs(component) < 1e-8) {
      if (Math.abs(coordinate) > extent) return undefined;
      continue;
    }
    const first = (-extent - coordinate) / component;
    const second = (extent - coordinate) / component;
    near = Math.max(near, Math.min(first, second));
    far = Math.min(far, Math.max(first, second));
    if (near > far) return undefined;
  }
  near = Math.max(0, near);
  if (!Number.isFinite(near) || !Number.isFinite(far) || far < near) return undefined;
  return [add(origin, scale(direction, near)), add(origin, scale(direction, far))];
}

/** Exact overlap test between the forward finite beam strip and the triangle. */
export function beamIntersectsTriangle(triangle: Triangle, light: CollimatedLight): boolean {
  const perpendicular: Vec2 = [-light.direction[1], light.direction[0]];
  let polygon: Vec2[] = [triangle.a, triangle.b, triangle.c].map((point) => {
    const offset = sub(point, light.center);
    return [
      offset[0] * light.direction[0] + offset[1] * light.direction[1],
      offset[0] * perpendicular[0] + offset[1] * perpendicular[1],
    ];
  });
  const clip = (inside: (point: Vec2) => number): void => {
    const input = polygon;
    polygon = [];
    for (let index = 0; index < input.length; index++) {
      const start = input[index]!;
      const end = input[(index + 1) % input.length]!;
      const startDistance = inside(start);
      const endDistance = inside(end);
      const startInside = startDistance >= 0;
      const endInside = endDistance >= 0;
      if (startInside) polygon.push(start);
      if (startInside === endInside) continue;
      const amount = startDistance / (startDistance - endDistance);
      polygon.push([
        start[0] + (end[0] - start[0]) * amount,
        start[1] + (end[1] - start[1]) * amount,
      ]);
    }
  };
  clip((point) => point[0]);
  if (polygon.length === 0) return false;
  clip((point) => point[1] + light.beamHalfWidth);
  if (polygon.length === 0) return false;
  clip((point) => light.beamHalfWidth - point[1]);
  return polygon.length > 0;
}

/**
 * Two rays belong to the same continuous sheet only if they took the same route: entered the same
 * face and bounced off the same faces in the same order. Connecting rays with different topology
 * would stretch a triangle across the discontinuity where one of them started reflecting internally.
 */
function matchingTopology(a: DetailedPrismPath, b: DetailedPrismPath): boolean {
  return a.edges.length === b.edges.length && a.edges.every((edge, index) => edge === b.edges[index]);
}

function traceProfilePath(
  triangle: Triangle,
  light: CollimatedLight,
  dispersion: DispersionPreset,
  wavelength: number,
  profile: number,
): DetailedPrismPath | undefined {
  return tracePrismDetailed(
    triangle,
    beamProfileOrigin(light, profile),
    light.direction,
    iorAt(wavelength, dispersion.base, dispersion.strength),
  );
}

function pushVertex(output: number[], point: Vec2, intensity: number): void {
  output.push(point[0], point[1], intensity);
}

function pushQuad(
  output: number[],
  lowerStart: Vec2,
  upperStart: Vec2,
  lowerEnd: Vec2,
  upperEnd: Vec2,
  startIntensity: number,
  endIntensity = startIntensity,
): void {
  pushVertex(output, lowerStart, startIntensity);
  pushVertex(output, upperStart, startIntensity);
  pushVertex(output, upperEnd, endIntensity);
  pushVertex(output, lowerStart, startIntensity);
  pushVertex(output, upperEnd, endIntensity);
  pushVertex(output, lowerEnd, endIntensity);
}

/** A cell whose two rails carry neighbouring wavelengths and intensities. */
function pushSpectralCell(
  output: number[],
  lowStart: Vec2,
  highStart: Vec2,
  lowEnd: Vec2,
  highEnd: Vec2,
  lowIntensity: number,
  highIntensity: number,
): void {
  pushVertex(output, lowStart, lowIntensity);
  pushVertex(output, highStart, highIntensity);
  pushVertex(output, highEnd, highIntensity);
  pushVertex(output, lowStart, lowIntensity);
  pushVertex(output, highEnd, highIntensity);
  pushVertex(output, lowEnd, lowIntensity);
}

/** A degenerate quad with the negative-intensity sentinel `light.wgsl` reads as "skip the LUT". */
function pushEmptyQuad(output: number[]): void {
  pushQuad(output, [0, 0], [0, 0], [0, 0], [0, 0], -1);
}

function profileCoordinates(slices: number): readonly number[] {
  return Array.from({ length: slices }, (_, index) => -1 + (2 * (index + 0.5)) / slices);
}

/** Gaussian scattering profile with a zero-energy rim at the beam boundary. */
function normalizedProfileWeights(profiles: readonly number[], edgeFalloff: number): readonly number[] {
  const weights = profiles.map((profile) => {
    const edge = Math.min(1, Math.max(0, (Math.abs(profile) - 0.55) / 0.45));
    const smooth = edge * edge * (3 - 2 * edge);
    return Math.exp(-edgeFalloff * profile * profile) * (1 - smooth);
  });
  const sum = weights.reduce((total, weight) => total + weight, 0) || 1;
  return weights.map((weight) => weight / sum);
}

function canConnect(
  a: SpectralNode | undefined,
  b: SpectralNode | undefined,
  profileIndex: number,
): boolean {
  const aPath = a?.paths[profileIndex];
  const bPath = b?.paths[profileIndex];
  return Boolean(aPath && bPath && matchingTopology(aPath, bPath));
}

function densityReference(path: DetailedPrismPath): Vec2 {
  return add(path.origin, scale(path.direction, DENSITY_MEASURE_DISTANCE));
}

/**
 * Spectral energy density at one wavelength vertex.
 *
 * Intent: keep total energy stable when the mesh is subdivided more finely. The finite difference
 * estimates how much screen-space width a normalized wavelength interval occupies; dividing flux by
 * that Jacobian is what makes 64 samples and 128 samples integrate to the same picture.
 */
function spectralDensity(
  nodes: readonly (SpectralNode | undefined)[],
  nodeIndex: number,
  profileIndex: number,
  exposure: number,
  inputWidth: number,
  profileWeight: number,
): number {
  const node = nodes[nodeIndex];
  const path = node?.paths[profileIndex];
  if (!path) return 0;

  let left = nodeIndex - 1;
  while (left >= 0 && !nodes[left]?.paths[profileIndex]) left--;
  let right = nodeIndex + 1;
  while (right < nodes.length && !nodes[right]?.paths[profileIndex]) right++;
  if (left < 0) left = nodeIndex;
  if (right >= nodes.length) right = nodeIndex;
  if (left === right) return 0;

  const leftPath = nodes[left]!.paths[profileIndex]!;
  const rightPath = nodes[right]!.paths[profileIndex]!;
  if (!matchingTopology(leftPath, rightPath)) return 0;
  const direction = normalize(add(leftPath.direction, rightPath.direction));
  const spectralWidth = Math.abs(
    cross(sub(densityReference(rightPath), densityReference(leftPath)), direction),
  );
  const normalizedSpan = (right - left) / (nodes.length - 1);
  const jacobian = spectralWidth / normalizedSpan;
  return (exposure * inputWidth * profileWeight * path.transmission) / Math.max(jacobian, 1e-4);
}

/**
 * Build the white input beam and the wavelength-connected spectral sheets.
 *
 * `target` and `scratch` are supplied by the runtime so a pointer move re-writes the same buffers
 * instead of allocating 270 KB of vertices per frame.
 */
export function buildLightMesh(
  options: LightMeshOptions,
  target?: Float32Array<ArrayBuffer>,
  scratch?: number[],
): LightMeshData {
  const triangle = options.triangle ?? PRISM_TRIANGLE;
  const samples = Math.max(2, Math.floor(options.samples ?? PRISM_SPECTRAL_SAMPLES));
  const beamSlices = Math.max(1, Math.floor(options.beamSlices ?? PRISM_BEAM_SLICES));
  const exposure = options.exposure ?? PRISM_LIGHT_EXPOSURE;
  const edgeFalloff = Math.max(0, options.edgeFalloff ?? PRISM_LIGHT_FADE.edgeFalloff);
  const layout = lightMeshLayout(samples, beamSlices);
  const expectedFloats = layout.vertexCount * LIGHT_VERTEX_FLOATS;
  if (target && target.length !== expectedFloats) {
    throw new RangeError(`Light mesh target has ${target.length} floats; expected ${expectedFloats}.`);
  }
  const output = scratch ?? [];
  output.length = 0;
  const inputWidth = options.light.beamHalfWidth * 2;
  const profiles = profileCoordinates(beamSlices);
  const profileWeights = normalizedProfileWeights(profiles, edgeFalloff);

  // Step 1 — the white input. It is sliced across its finite width too, which lets neighbouring parts
  // of a grazing beam enter different faces (or miss the prism entirely) without invalidating the rest.
  const boundaryProfiles = Array.from({ length: beamSlices + 1 }, (_, index) => -1 + (2 * index) / beamSlices);
  const whiteBoundaries = boundaryProfiles.map((profile) => {
    const origin = beamProfileOrigin(options.light, profile);
    const hit = intersectTriangle(triangle, origin, options.light.direction, 1e-4);
    const entry =
      hit && dot(options.light.direction, hit.normal) < 0
        ? add(origin, scale(options.light.direction, hit.t))
        : undefined;
    return {
      profile,
      origin,
      entry,
      wall: lineThroughWall(origin, options.light.direction, options.wallHalfExtent),
    };
  });
  const backwards: Vec2 = [-options.light.direction[0], -options.light.direction[1]];
  for (let slice = 0; slice < beamSlices; slice++) {
    const lower = whiteBoundaries[slice]!;
    const upper = whiteBoundaries[slice + 1]!;
    if (lower.entry && upper.entry) {
      pushQuad(
        output,
        rayToWallBoundary(lower.entry, backwards, options.wallHalfExtent),
        rayToWallBoundary(upper.entry, backwards, options.wallHalfExtent),
        lower.entry,
        upper.entry,
        0,
        INPUT_BEAM_RADIANCE,
      );
    } else {
      const centerProfile = (lower.profile + upper.profile) * 0.5;
      const cellLight: CollimatedLight = {
        center: beamProfileOrigin(options.light, centerProfile),
        direction: options.light.direction,
        beamHalfWidth: options.light.beamHalfWidth * (upper.profile - lower.profile) * 0.5,
      };
      if (!beamIntersectsTriangle(triangle, cellLight) && lower.wall && upper.wall) {
        pushQuad(output, lower.wall[0], upper.wall[0], lower.wall[1], upper.wall[1], INPUT_BEAM_RADIANCE);
      } else {
        pushEmptyQuad(output);
      }
    }
  }

  // Trace every wavelength once, along both the slice centres (used by the outgoing fan) and the slice
  // boundaries (used to give the internal strips width).
  const nodes: (SpectralNode | undefined)[] = [];
  for (let index = 0; index < samples; index++) {
    const wavelength =
      PRISM_WAVELENGTHS.min + (PRISM_WAVELENGTHS.max - PRISM_WAVELENGTHS.min) * (index / (samples - 1));
    const paths = profiles.map((profile) =>
      traceProfilePath(triangle, options.light, options.dispersion, wavelength, profile),
    );
    const boundaryPaths = boundaryProfiles.map((profile) =>
      traceProfilePath(triangle, options.light, options.dispersion, wavelength, profile),
    );
    if (paths.every((path) => !path) && boundaryPaths.every((path) => !path)) {
      nodes.push(undefined);
      continue;
    }
    nodes.push({ wavelength, paths, boundaryPaths });
  }

  const densities = nodes.map((node, nodeIndex) =>
    profiles.map((_, profileIndex) =>
      node
        ? spectralDensity(nodes, nodeIndex, profileIndex, exposure, inputWidth, profileWeights[profileIndex]!)
        : 0,
    ),
  );

  // Step 2 — the internal strips. Each wavelength strip spans the finite width of a beam slice, so all
  // strips overlap at the entry face instead of collapsing to independent points. Normalize their
  // additive RGB sum back to the white source level, or the glass would glow brighter than the beam.
  const internalRgbSum = nodes.reduce<[number, number, number]>(
    (sum, node) => {
      if (!node) return sum;
      const rgb = wavelengthToBeamRgb(node.wavelength);
      return [sum[0] + rgb[0], sum[1] + rgb[1], sum[2] + rgb[2]];
    },
    [0, 0, 0],
  );
  const internalIntensityScale =
    INPUT_BEAM_RADIANCE / Math.max(internalRgbSum[0], internalRgbSum[1], internalRgbSum[2], 1);

  for (const node of nodes) {
    if (!node) {
      for (let quad = 0; quad < beamSlices * LIGHT_INTERNAL_SEGMENTS; quad++) pushEmptyQuad(output);
      continue;
    }
    for (let slice = 0; slice < beamSlices; slice++) {
      const lower = node.boundaryPaths[slice];
      const upper = node.boundaryPaths[slice + 1];
      const connected = Boolean(lower && upper && matchingTopology(lower, upper));
      const intensity = connected
        ? internalIntensityScale * (lower!.entryTransmission + upper!.entryTransmission) * 0.5
        : 0;
      for (let segment = 0; segment < LIGHT_INTERNAL_SEGMENTS; segment++) {
        const lowerStart = lower?.points[segment];
        const lowerEnd = lower?.points[segment + 1];
        const upperStart = upper?.points[segment];
        const upperEnd = upper?.points[segment + 1];
        if (connected && lowerStart && lowerEnd && upperStart && upperEnd) {
          pushQuad(output, lowerStart, upperStart, lowerEnd, upperEnd, intensity);
        } else {
          pushEmptyQuad(output);
        }
      }
    }
  }

  // Step 3 — the outgoing fan: one cell per (wavelength interval, beam slice), running from the exit
  // face to the wall boundary. Neighbouring wavelengths share an edge, so the spectrum is continuous.
  let totalFlux = 0;
  for (let interval = 0; interval < samples - 1; interval++) {
    const low = nodes[interval];
    const high = nodes[interval + 1];
    for (let profileIndex = 0; profileIndex < beamSlices; profileIndex++) {
      if (!canConnect(low, high, profileIndex)) {
        pushEmptyQuad(output);
        continue;
      }
      const lowPath = low!.paths[profileIndex]!;
      const highPath = high!.paths[profileIndex]!;
      totalFlux +=
        (exposure *
          inputWidth *
          profileWeights[profileIndex]! *
          (lowPath.transmission + highPath.transmission) *
          0.5) /
        (samples - 1);
      pushSpectralCell(
        output,
        lowPath.origin,
        highPath.origin,
        rayToWallBoundary(lowPath.origin, lowPath.direction, options.wallHalfExtent),
        rayToWallBoundary(highPath.origin, highPath.direction, options.wallHalfExtent),
        densities[interval]![profileIndex]!,
        densities[interval + 1]![profileIndex]!,
      );
    }
  }

  const vertexCount = output.length / LIGHT_VERTEX_FLOATS;
  if (output.length !== expectedFloats || vertexCount !== layout.vertexCount) {
    throw new Error(`Light mesh wrote ${vertexCount} vertices; expected ${layout.vertexCount}.`);
  }
  const vertices = target ?? new Float32Array(expectedFloats);
  vertices.set(output);
  const validBands = nodes.filter(Boolean).length;
  return {
    vertices,
    vertexCount,
    stats: {
      samples,
      beamSlices,
      validBands,
      rejectedTopology: samples - validBands,
      totalFlux,
    },
  };
}
