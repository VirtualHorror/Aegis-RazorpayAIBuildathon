// Bakes the authored analytic studio into the equirectangular HDR texture layout used by vgpu's
// environment-map and transmission examples. Vercel's version also bakes an orientation-debug map
// behind a uniform; Aegis ships no debug graph, so that branch and its `params` block are gone
// (D-087).

import { direction_from_equirect } from "./environment-map-common.wgsl";
import { sampleStudioEnvironment } from "./environment.wgsl";

@fragment
fn fs_main(@location(0) uv: vec2f) -> @location(0) vec4f {
  return vec4f(sampleStudioEnvironment(direction_from_equirect(uv)), 1.0);
}
