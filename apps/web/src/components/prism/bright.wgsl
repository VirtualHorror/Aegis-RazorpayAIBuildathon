// Bloom, pass one: keep what is brighter than the threshold and write it at half resolution.
// Flow: four bilinear taps of the scene (a box downsample) -> soft knee above the threshold -> half-res target.
struct Params {
  // xy: texel size of the source. z: threshold. w: knee width.
  texel_threshold: vec4f,
}

@group(0) @binding(0) var<uniform> params: Params;
@group(0) @binding(1) var source_tex: texture_2d<f32>;
@group(0) @binding(2) var source_sampler: sampler;

@fragment
fn fs_main(@location(0) uv: vec2f) -> @location(0) vec4f {
  let texel = params.texel_threshold.xy;
  var sum = vec3f(0.0);
  sum += textureSampleLevel(source_tex, source_sampler, uv + vec2f(-0.5, -0.5) * texel, 0.0).rgb;
  sum += textureSampleLevel(source_tex, source_sampler, uv + vec2f(0.5, -0.5) * texel, 0.0).rgb;
  sum += textureSampleLevel(source_tex, source_sampler, uv + vec2f(-0.5, 0.5) * texel, 0.0).rgb;
  sum += textureSampleLevel(source_tex, source_sampler, uv + vec2f(0.5, 0.5) * texel, 0.0).rgb;
  let colour = sum * 0.25;

  let threshold = params.texel_threshold.z;
  let knee = max(params.texel_threshold.w, 1e-4);
  let brightness = max(colour.r, max(colour.g, colour.b));
  // Soft knee: nothing pops into the bloom, it eases in.
  let contribution = clamp((brightness - threshold + knee) / (2.0 * knee), 0.0, 1.0);
  let weight = contribution * contribution * max(brightness - threshold, 0.0) / max(brightness, 1e-4);
  return vec4f(colour * weight, 1.0);
}
