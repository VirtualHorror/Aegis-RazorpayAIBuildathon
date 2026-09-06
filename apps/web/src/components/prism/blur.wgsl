// Bloom, pass two: a separable Gaussian. Run once across and once down, twice over if a wider bleed is wanted.
// Nine taps at linear-filtered offsets, which is a 17-tap kernel for the cost of nine.
struct Params {
  // xy: step between taps in uv (texel size times the axis). zw: unused.
  step_axis: vec4f,
}

@group(0) @binding(0) var<uniform> params: Params;
@group(0) @binding(1) var source_tex: texture_2d<f32>;
@group(0) @binding(2) var source_sampler: sampler;

@fragment
fn fs_main(@location(0) uv: vec2f) -> @location(0) vec4f {
  let stepUv = params.step_axis.xy;
  var weights = array<f32, 5>(0.227027, 0.194594, 0.121621, 0.054054, 0.016216);
  var offsets = array<f32, 5>(0.0, 1.384615, 3.230769, 5.176470, 7.117647);
  var sum = textureSampleLevel(source_tex, source_sampler, uv, 0.0).rgb * weights[0];
  for (var i = 1; i < 5; i = i + 1) {
    let o = stepUv * offsets[i];
    sum += textureSampleLevel(source_tex, source_sampler, uv + o, 0.0).rgb * weights[i];
    sum += textureSampleLevel(source_tex, source_sampler, uv - o, 0.0).rgb * weights[i];
  }
  return vec4f(sum, 1.0);
}
