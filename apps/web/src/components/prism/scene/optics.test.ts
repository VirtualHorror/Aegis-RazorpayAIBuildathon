import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import {
  PRISM_DISPERSION,
  PRISM_TRIANGLE,
  PRISM_WAVELENGTHS,
  lampAt,
  incidenceAt,
  PRISM_BEAM_MOUSE_Y,
  PRISM_INCIDENCE_DEGREES,
  type Vec2,
} from "./constants";
import {
  cross,
  dot,
  fresnelTransmittance,
  intersectTriangle,
  iorAt,
  refract,
  tracePrismDetailed,
  wavelengthToBeamRgb,
} from "./optics";

const SPECTRAL_WGSL = fileURLToPath(new URL("../shaders/spectral.wgsl", import.meta.url));

describe("dispersion", () => {
  it("bends short wavelengths harder than long ones (Cauchy)", () => {
    const red = iorAt(700, PRISM_DISPERSION.base, PRISM_DISPERSION.strength);
    const violet = iorAt(400, PRISM_DISPERSION.base, PRISM_DISPERSION.strength);
    expect(violet).toBeGreaterThan(red);
    // The stylized preset is what opens the fan wide enough to read as a rainbow at this size.
    expect(violet - red).toBeGreaterThan(0.15);
  });
});

describe("refraction and total internal reflection", () => {
  it("returns undefined past the critical angle instead of a bogus direction", () => {
    const normal: Vec2 = [0, 1];
    const eta = 1.6; // glass -> air
    // 80 degrees from the normal, well past the ~38.7 degree critical angle for this ratio.
    const grazing: Vec2 = [Math.sin((80 * Math.PI) / 180), -Math.cos((80 * Math.PI) / 180)];
    expect(refract(grazing, normal, eta)).toBeUndefined();
    // Straight in always transmits.
    expect(refract([0, -1], normal, eta)).toBeDefined();
  });

  it("transmits everything at normal incidence minus the Fresnel reflection", () => {
    const straight = fresnelTransmittance([0, -1], [0, 1], 1, 1.5);
    // (0.5 / 2.5)^2 = 4% reflected at an air-glass boundary.
    expect(straight).toBeCloseTo(0.96, 3);
    expect(fresnelTransmittance([0, -1], [0, 1], 1.5, 1)).toBeCloseTo(0.96, 3);
  });

  it("returns zero transmittance where refraction is impossible", () => {
    const grazing: Vec2 = [Math.sin((80 * Math.PI) / 180), -Math.cos((80 * Math.PI) / 180)];
    expect(fresnelTransmittance(grazing, [0, 1], 1.6, 1)).toBe(0);
  });
});

describe("the prism the hero actually draws", () => {
  const light = lampAt(0.5, 0.5);

  it("aims the resting lamp at the entry face from outside the glass", () => {
    const hit = intersectTriangle(PRISM_TRIANGLE, light.center, light.direction, 1e-4);
    expect(hit).toBeDefined();
    // Edge 2 is c->a, the face the beam is designed to enter.
    expect(hit!.edge).toBe(2);
  });

  it("sends every visible wavelength out of the glass, red bending least", () => {
    // Total deviation: the signed turn from the incoming direction to the outgoing one. Measuring the
    // turn rather than the absolute heading keeps the comparison off atan2's +/-pi seam.
    const deviations = [PRISM_WAVELENGTHS.max, 600, 545, 495, 465, 430, PRISM_WAVELENGTHS.min].map((nm) => {
      const path = tracePrismDetailed(
        PRISM_TRIANGLE,
        light.center,
        light.direction,
        iorAt(nm, PRISM_DISPERSION.base, PRISM_DISPERSION.strength),
      );
      expect(path, `${nm}nm must leave the glass`).toBeDefined();
      // No bounces at the resting incidence: every band clears the exit face directly.
      expect(path!.bounces).toBe(0);
      const turn = Math.atan2(
        cross(light.direction, path!.direction),
        dot(light.direction, path!.direction),
      );
      return Math.abs((turn * 180) / Math.PI);
    });
    // Deviation grows monotonically from red to violet: the fan opens without any band crossing over.
    for (let index = 1; index < deviations.length; index++) {
      expect(deviations[index]!, `band ${index}`).toBeGreaterThan(deviations[index - 1]!);
    }
    // The whole fan is more than ten degrees wide, which is what makes the seven bands separable.
    expect(deviations.at(-1)! - deviations[0]!).toBeGreaterThan(10);
  });

  it("loses no more than a third of the beam to Fresnel over the two boundaries", () => {
    const path = tracePrismDetailed(
      PRISM_TRIANGLE,
      light.center,
      light.direction,
      iorAt(550, PRISM_DISPERSION.base, PRISM_DISPERSION.strength),
    );
    expect(path!.transmission).toBeGreaterThan(0.66);
    expect(path!.transmission).toBeLessThanOrEqual(1);
    expect(path!.entryTransmission).toBeGreaterThanOrEqual(path!.transmission);
  });
});

describe("pointer sweep", () => {
  it("hinges on the resting incidence at the vertical centre and clamps at both ends", () => {
    expect(incidenceAt(0)).toBeCloseTo(PRISM_BEAM_MOUSE_Y.top, 6);
    expect(incidenceAt(0.5)).toBeCloseTo(PRISM_INCIDENCE_DEGREES, 6);
    expect(incidenceAt(1)).toBeCloseTo(PRISM_BEAM_MOUSE_Y.bottom, 6);
    expect(incidenceAt(-4)).toBeCloseTo(PRISM_BEAM_MOUSE_Y.top, 6);
    expect(incidenceAt(9)).toBeCloseTo(PRISM_BEAM_MOUSE_Y.bottom, 6);
  });

  it("keeps both beam boundaries on the entry face across the whole sweep", () => {
    for (let step = 0; step <= 20; step++) {
      const beam = lampAt(step / 20, step % 2 === 0 ? 0 : 1);
      const perpendicular: Vec2 = [-beam.direction[1], beam.direction[0]];
      for (const side of [-1, 1]) {
        const origin: Vec2 = [
          beam.center[0] + perpendicular[0] * beam.beamHalfWidth * side,
          beam.center[1] + perpendicular[1] * beam.beamHalfWidth * side,
        ];
        const hit = intersectTriangle(PRISM_TRIANGLE, origin, beam.direction, 1e-4);
        expect(hit, `arc ${step / 20} side ${side} must still hit the glass`).toBeDefined();
      }
    }
  });
});

/**
 * The strongest check that this port is faithful: `shaders/spectral.wgsl` is Vercel's own generated
 * Float32 checkpoint of `wavelengthToBeamRgb`, copied verbatim. Regenerating it here from our
 * TypeScript must reproduce it bit for bit — if the CIE curves, the D65 table, the gamut mapping or
 * the exposure ever drift, the shader and the CPU would disagree about what colour a ray is, and the
 * legend swatches in `legend.ts` would be wrong too.
 */
describe("spectral LUT parity with vercel-labs/vgpu", () => {
  const reference = [...readFileSync(SPECTRAL_WGSL, "utf8").matchAll(/vec4f\(([-\d.e]+), ([-\d.e]+), ([-\d.e]+), ([-\d.e]+)\)/g)]
    .map((match) => match.slice(1, 5).map(Number) as [number, number, number, number]);

  it("has the 128 rows the shader indexes", () => {
    expect(reference).toHaveLength(128);
  });

  it("reproduces every row exactly", () => {
    for (const [index, expected] of reference.entries()) {
      // The generator evaluates at the f32-rounded wavelength, which is what the row's alpha stores.
      const wavelength = Math.fround(
        PRISM_WAVELENGTHS.min + (PRISM_WAVELENGTHS.max - PRISM_WAVELENGTHS.min) * (index / (reference.length - 1)),
      );
      expect(wavelength, `row ${index} wavelength`).toBe(expected[3]);
      const rgb = wavelengthToBeamRgb(wavelength).map(Math.fround);
      expect(rgb, `row ${index} rgb`).toEqual(expected.slice(0, 3));
    }
  });
});
