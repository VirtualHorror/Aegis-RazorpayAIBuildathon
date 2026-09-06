import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { resolveShader } from "@vgpu/wgsl/runtime";
import { prismGeometry } from "./prismGeometry";
import { prismUniforms } from "./uniforms";

const ENTRY = fileURLToPath(new URL("./prism.wgsl", import.meta.url));

/**
 * The WGSL and `uniforms.ts` are two halves of one contract, and nothing else checks it: `set()` accepts a struct
 * member the shader does not declare without complaint, and the picture is simply wrong (B-026). vgpu's resolver
 * parses the shader the same way the loader does, so this runs anywhere — no GPU, no browser.
 */
describe("prism shader", () => {
  it("resolves and declares the single params uniform the renderer sets", async () => {
    const resolved = await resolveShader({ entry: ENTRY });
    expect(resolved.wgsl).toContain("@fragment");
    expect(resolved.wgsl).toContain("fn fs_main");
    expect(resolved.wgsl).toMatch(/@group\(0\)\s*@binding\(0\)\s*var<uniform>\s*params/);
  });

  it("declares exactly the struct members prismUniforms packs, in the same order", () => {
    const source = readFileSync(ENTRY, "utf8");
    const body = /struct Params \{([\s\S]*?)\n\}/.exec(source)?.[1];
    expect(body).toBeDefined();
    const declared = [...body!.matchAll(/^\s*([a-z0-9_]+)\s*:\s*vec4f\s*,/gm)].map((match) => match[1]);
    const scene = prismGeometry({ width: 900, height: 300, pointer: null });
    const packed = Object.keys(prismUniforms({ scene, width: 900, height: 300, timeSeconds: 0, reducedMotion: false, activity: {} }));
    expect(declared).toEqual(packed);
  });
});
