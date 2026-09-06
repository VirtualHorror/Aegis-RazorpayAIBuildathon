// The last pass: scene plus bloom, tone mapped and written to the canvas.
// Flow: scene + bloom * strength -> Lottes tonemap -> sRGB -> screen-edge fade -> interleaved-gradient dither.
struct Params {
  // x, y: viewport in CSS pixels. z: bloom strength. w: device pixel ratio.
  resolution_bloom: vec4f,
}

@group(0) @binding(0) var<uniform> params: Params;
@group(0) @binding(1) var scene_tex: texture_2d<f32>;
@group(0) @binding(2) var bloom_tex: texture_2d<f32>;
@group(0) @binding(3) var linear_sampler: sampler;

fn tonemap_lottes(x: vec3f) -> vec3f {
  let a = 1.6;
  let d = 0.977;
  let hdrMax = 8.0;
  let midIn = 0.18;
  let midOut = 0.267;
  let b =
    (-pow(midIn, a) + pow(hdrMax, a) * midOut)
    / ((pow(hdrMax, a * d) - pow(midIn, a * d)) * midOut);
  let c =
    (pow(hdrMax, a * d) * pow(midIn, a) - pow(hdrMax, a) * pow(midIn, a * d) * midOut)
    / ((pow(hdrMax, a * d) - pow(midIn, a * d)) * midOut);
  return pow(x, vec3f(a)) / (pow(x, vec3f(a * d)) * b + c);
}

fn ign(p: vec2f) -> f32 {
  return fract(52.9829189 * fract(dot(p, vec2f(0.06711056, 0.00583715))));
}

fn edge_fade(p: vec2f, resolution: vec2f) -> f32 {
  let band = min(resolution.x, resolution.y) * 0.20;
  let d = min(min(p.x, resolution.x - p.x), min(p.y, resolution.y - p.y));
  return smoothstep(0.0, band, d);
}

@fragment
fn fs_main(@location(0) uv: vec2f) -> @location(0) vec4f {
  let resolution = params.resolution_bloom.xy;
  let dpr = max(params.resolution_bloom.w, 0.5);
  let scene = textureSampleLevel(scene_tex, linear_sampler, uv, 0.0).rgb;
  let bloom = textureSampleLevel(bloom_tex, linear_sampler, uv, 0.0).rgb;

  var colour = scene + bloom * params.resolution_bloom.z;
  colour = tonemap_lottes(max(colour, vec3f(0.0)));
  colour = pow(clamp(colour, vec3f(0.0), vec3f(1.0)), vec3f(1.0 / 2.2));
  colour *= edge_fade(uv * resolution, resolution);
  colour += (ign(uv * resolution * dpr) - 0.5) * (1.5 / 255.0);
  return vec4f(clamp(colour, vec3f(0.0), vec3f(1.0)), 1.0);
}
