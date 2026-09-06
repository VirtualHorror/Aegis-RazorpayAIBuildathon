import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { resolveShader } from "@vgpu/wgsl/runtime";

const file = (name: string) => fileURLToPath(new URL(`./${name}`, import.meta.url));
const ENTRIES = ["env.wgsl", "glass.wgsl", "beam.wgsl", "bright.wgsl", "blur.wgsl", "composite.wgsl"] as const;
const RENDERER = readFileSync(file("renderer.ts"), "utf8");

/** Members of the `Params` struct a shader declares, in order. */
function declaredParams(name: string): string[] {
  const body = /struct Params \{([\s\S]*?)\n\}/.exec(readFileSync(file(name), "utf8"))?.[1];
  if (!body) return [];
  return [...body.matchAll(/^\s*([a-z0-9_]+)\s*:/gm)].map((match) => match[1]!);
}

/**
 * The shaders and the renderer are two halves of one contract, and nothing else checks it: `set()` accepts a struct
 * member no shader declares without complaint, and a pass simply renders wrong. vgpu's resolver parses each entry the
 * way its loader does, so this runs anywhere — no GPU, no browser.
 */
describe("prism pipeline", () => {
  it("resolves every pass in the pipeline", { timeout: 60_000 }, async () => {
    for (const entry of ENTRIES) {
      const resolved = await resolveShader({ entry: file(entry) });
      expect(resolved.wgsl, entry).toContain("@fragment");
      expect(resolved.wgsl, entry).toContain("fn fs_main");
    }
  });

  it("draws the beam and the glass from geometry, not from a distance field", async () => {
    for (const entry of ["glass.wgsl", "beam.wgsl"]) {
      const resolved = await resolveShader({ entry: file(entry) });
      // A vertex stage is what makes these meshes: the smoothness comes from interpolation across triangles.
      expect(resolved.wgsl, entry).toContain("@vertex");
      expect(resolved.wgsl, entry).toContain("fn vs_main");
      expect(resolved.wgsl, entry).toContain("vertex_index");
    }
  });

  it("keeps the pointer's steering limits derived from the physics", () => {
    const optics = readFileSync(file("optics.wgsl"), "utf8");
    // The floor of the range comes from the apex angle and the critical angle of the most-refracted wavelength, so a
    // change to the geometry or the dispersion cannot quietly let the beam past total internal reflection.
    expect(optics).toContain("let apexAngle = acos(clamp(-dot(s.entryNormal, exitFaceNormal), -1.0, 1.0));");
    expect(optics).toContain("let criticalViolet = asin(clamp(1.0 / (N_RED + N_SPREAD), -1.0, 1.0));");
    expect(optics).toContain("asin(clamp(meanIndex * sin(apexAngle - criticalViolet), -1.0, 1.0))");
    expect(optics).toMatch(/clamp\(mix\(elevationMin, BEAM_ELEVATION_MAX, aim\.y\), elevationMin, BEAM_ELEVATION_MAX\)/);
    expect(optics).toContain("let aim = clamp(pointer, vec2f(0.0), vec2f(1.0));");
  });

  it("sets exactly the uniform members the shaders declare", () => {
    const declared = new Set(ENTRIES.flatMap((entry) => declaredParams(entry)));
    expect(declared.size).toBeGreaterThan(3);
    const used = [...RENDERER.matchAll(/params:\s*\{([^}]*)\}/g)]
      .flatMap((match) => [...match[1]!.matchAll(/([a-z0-9_]+):/g)].map((inner) => inner[1]!));
    expect(used.length).toBeGreaterThan(0);
    for (const name of used) expect([...declared], `renderer sets ${name}`).toContain(name);
    for (const name of declared) expect(RENDERER, `renderer never sets ${name}`).toContain(`${name}:`);
  });

  it("runs the passes a bloom needs, in order", () => {
    // scene -> bright -> blur across -> blur down -> composite. The composite is the only pass that reaches the canvas.
    const order = ["target: scene", "target: bloomA", "target: bloomB", "target: bloomA", "pass(output, composite)"];
    let cursor = 0;
    for (const step of order) {
      const at = RENDERER.indexOf(step, cursor);
      expect(at, step).toBeGreaterThan(-1);
      cursor = at + step.length;
    }
  });
});
