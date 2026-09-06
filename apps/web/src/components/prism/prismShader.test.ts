import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { resolveShader } from "@vgpu/wgsl/runtime";

const SHADER = fileURLToPath(new URL("./prism.wgsl", import.meta.url));
const RENDERER = fileURLToPath(new URL("./renderer.ts", import.meta.url));

/**
 * The shader and the pipeline setup are two halves of one contract, and nothing else checks it: `set()` accepts a
 * struct member the shader does not declare without complaint, and the picture is simply wrong. vgpu's resolver parses
 * the shader the way its loader does, so this runs anywhere — no GPU, no browser.
 */
describe("prism shader", () => {
  it("resolves, and declares one fragment entry point behind one uniform", { timeout: 30_000 }, async () => {
    const resolved = await resolveShader({ entry: SHADER });
    expect(resolved.wgsl).toContain("@fragment");
    expect(resolved.wgsl).toContain("fn fs_main");
    expect(resolved.wgsl).toMatch(/@group\(0\)\s*@binding\(0\)\s*var<uniform>\s*params/);
  });

  it("declares exactly the struct members the renderer sets", () => {
    const source = readFileSync(SHADER, "utf8");
    const body = /struct Params \{([\s\S]*?)\n\}/.exec(source)?.[1];
    expect(body).toBeDefined();
    const declared = [...body!.matchAll(/^\s*([a-z0-9_]+)\s*:/gm)].map((match) => match[1]);
    expect(declared).toEqual(["resolution_time"]);
    const set = [...readFileSync(RENDERER, "utf8").matchAll(/params:\s*\{\s*([a-z0-9_]+):/g)].map((match) => match[1]);
    expect(set.length).toBeGreaterThan(0);
    expect([...new Set(set)]).toEqual(declared);
  });

  it("keeps the scene in the shader: no ambient stage, one spectrum, dust lit only by the light field", () => {
    const source = readFileSync(SHADER, "utf8");
    expect(source).toContain("var colour = vec3f(0.0)");
    expect(source).toContain("fn spectral_rgb");
    expect(source).toContain("fn tonemap_lottes");
    expect(source).toContain("fn ign");
    expect(source).toContain("fn edge_fade");
    expect(source).toMatch(/light_at\(position, s, DUST_SPECTRUM_STEPS\)/);
  });
});
