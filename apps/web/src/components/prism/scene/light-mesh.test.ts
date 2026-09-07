import { describe, expect, it } from "vitest";

import { lightWallExtent } from "./camera";
import { PRISM_BEAM_SLICES, PRISM_DISPERSION, PRISM_SPECTRAL_SAMPLES, lampAt } from "./constants";
import {
  buildLightMesh,
  INPUT_BEAM_RADIANCE,
  LIGHT_INTERNAL_SEGMENTS,
  LIGHT_MESH_LAYOUT,
  LIGHT_VERTEX_FLOATS,
  lightMeshLayout,
} from "./light-mesh";

const WALL = lightWallExtent(50 / 21);
const options = (arc = 0.5, target = 0.5) => ({
  light: lampAt(arc, target),
  dispersion: PRISM_DISPERSION,
  wallHalfExtent: WALL,
});

describe("mesh layout", () => {
  it("is the 23,040-vertex tier vgpu.sh's debug graph reports", () => {
    // 64 wavelengths x 12 beam slices. The three ranges are what `gpu/render.ts` draws separately.
    expect(LIGHT_MESH_LAYOUT.samples).toBe(64);
    expect(LIGHT_MESH_LAYOUT.beamSlices).toBe(12);
    expect(LIGHT_MESH_LAYOUT.whiteVertices).toBe(12 * 6);
    expect(LIGHT_MESH_LAYOUT.internalVertices).toBe(64 * 12 * LIGHT_INTERNAL_SEGMENTS * 6);
    expect(LIGHT_MESH_LAYOUT.outgoingVertices).toBe(63 * 12 * 6);
    expect(LIGHT_MESH_LAYOUT.vertexCount).toBe(23_040);
  });

  it("packs the three ranges end to end with no gap or overlap", () => {
    const l = LIGHT_MESH_LAYOUT;
    expect(l.internalFirstVertex).toBe(l.whiteVertices);
    expect(l.outgoingFirstVertex).toBe(l.whiteVertices + l.internalVertices);
    expect(l.outgoingFirstVertex + l.outgoingVertices).toBe(l.vertexCount);
  });

  it("clamps degenerate densities rather than emitting a broken buffer", () => {
    expect(lightMeshLayout(0, 0).samples).toBe(2);
    expect(lightMeshLayout(0, 0).beamSlices).toBe(1);
  });
});

describe("buildLightMesh", () => {
  it("fills exactly the buffer the layout reserves", () => {
    const mesh = buildLightMesh(options());
    expect(mesh.vertexCount).toBe(LIGHT_MESH_LAYOUT.vertexCount);
    expect(mesh.vertices).toHaveLength(LIGHT_MESH_LAYOUT.vertexCount * LIGHT_VERTEX_FLOATS);
    expect(mesh.stats.samples).toBe(PRISM_SPECTRAL_SAMPLES);
    expect(mesh.stats.beamSlices).toBe(PRISM_BEAM_SLICES);
  });

  it("rejects a target sized for a different density", () => {
    expect(() => buildLightMesh(options(), new Float32Array(8))).toThrow(RangeError);
  });

  it("reuses the caller's buffers instead of allocating per frame", () => {
    const target = new Float32Array(LIGHT_MESH_LAYOUT.vertexCount * LIGHT_VERTEX_FLOATS);
    const scratch: number[] = [];
    const first = buildLightMesh(options(0.2), target, scratch);
    expect(first.vertices).toBe(target);
    const before = target.slice(0, 32);
    const second = buildLightMesh(options(0.8), target, scratch);
    expect(second.vertices).toBe(target);
    // A different lamp position must actually rewrite the buffer, not leave the old mesh in place.
    expect(Array.from(target.slice(0, 32))).not.toEqual(Array.from(before));
  });

  /**
   * The mesh reserves `LIGHT_INTERNAL_SEGMENTS` (4) slots per band and slice — entry-to-exit plus one
   * per possible internal bounce — and fills only the ones a ray actually took. Counting them is
   * therefore a direct read of the optics: at the resting incidence nothing reflects internally, so
   * exactly one slot in four is real and the other three carry the negative sentinel `light.wgsl`
   * reads as "skip the LUT".
   */
  const intensityCensus = (vertices: Float32Array, from: number, to: number) => {
    const census = { sentinel: 0, zero: 0, lit: 0 };
    for (let vertex = from; vertex < to; vertex++) {
      const intensity = vertices[vertex * LIGHT_VERTEX_FLOATS + 2]!;
      if (intensity < 0) census.sentinel++;
      else if (intensity === 0) census.zero++;
      else census.lit++;
    }
    return census;
  };

  it("takes no internal bounce at the resting incidence", () => {
    const l = LIGHT_MESH_LAYOUT;
    const { vertices } = buildLightMesh(options());

    // The shaft ramps from nothing at the frame edge to full radiance at the glass: half of each quad.
    expect(intensityCensus(vertices, 0, l.whiteVertices)).toEqual({ sentinel: 0, zero: 36, lit: 36 });

    // 64 bands x 12 slices x 1 real segment x 6 vertices lit; the other three slots are sentinels.
    const internal = intensityCensus(vertices, l.internalFirstVertex, l.outgoingFirstVertex);
    expect(internal).toEqual({ sentinel: 64 * 12 * 3 * 6, zero: 0, lit: 64 * 12 * 6 });

    // Every neighbouring pair of wavelengths connects, so the fan has no hole in it.
    expect(intensityCensus(vertices, l.outgoingFirstVertex, l.vertexCount)).toEqual({
      sentinel: 0,
      zero: 0,
      lit: l.outgoingVertices,
    });
  });

  it("reflects internally at the shallow end of the sweep and drops the discontinuous cells", () => {
    const l = LIGHT_MESH_LAYOUT;
    // The pointer at the top of the canvas swings the lamp to a -35 degree incidence, past the
    // critical angle for the shorter wavelengths.
    const { vertices } = buildLightMesh(options(0));
    const internal = intensityCensus(vertices, l.internalFirstVertex, l.outgoingFirstVertex);
    expect(internal.lit).toBeGreaterThan(64 * 12 * 6);

    // Where a band starts bouncing, its path no longer matches its neighbour's, and `matchingTopology`
    // refuses to stretch a cell across that discontinuity rather than drawing a ray that never existed.
    const outgoing = intensityCensus(vertices, l.outgoingFirstVertex, l.vertexCount);
    expect(outgoing.sentinel).toBeGreaterThan(0);
    expect(outgoing.lit).toBeGreaterThan(l.outgoingVertices * 0.9);
  });

  it("emits the white input beam at the source radiance", () => {
    const mesh = buildLightMesh(options());
    const white = Array.from(
      mesh.vertices.slice(0, LIGHT_MESH_LAYOUT.whiteVertices * LIGHT_VERTEX_FLOATS),
    ).filter((_, index) => index % LIGHT_VERTEX_FLOATS === 2);
    expect(Math.max(...white)).toBeCloseTo(INPUT_BEAM_RADIANCE, 5);
    // The shaft ramps from zero at the frame edge to full radiance at the glass.
    expect(Math.min(...white)).toBe(0);
  });

  it("keeps integrated flux stable when the spectrum is subdivided more finely", () => {
    // This is what the Jacobian in `spectralDensity` buys: doubling the wavelength count must not
    // double the light. Without it the hero would get brighter every time the tier changed.
    const coarse = buildLightMesh({ ...options(), samples: 48 });
    const fine = buildLightMesh({ ...options(), samples: 96 });
    expect(fine.stats.totalFlux).toBeGreaterThan(0);
    expect(fine.stats.totalFlux / coarse.stats.totalFlux).toBeGreaterThan(0.9);
    expect(fine.stats.totalFlux / coarse.stats.totalFlux).toBeLessThan(1.1);
  });

  it("survives every lamp position the pointer can reach", () => {
    for (let step = 0; step <= 12; step++) {
      const mesh = buildLightMesh(options(step / 12, (step % 4) / 3));
      expect(mesh.vertexCount).toBe(LIGHT_MESH_LAYOUT.vertexCount);
      expect(mesh.vertices.every(Number.isFinite), `arc ${step / 12} produced NaN`).toBe(true);
      // Some bands total-internal-reflect at the extremes of the sweep; the fan must not empty out.
      expect(mesh.stats.validBands, `arc ${step / 12}`).toBeGreaterThan(0);
    }
  });
});
