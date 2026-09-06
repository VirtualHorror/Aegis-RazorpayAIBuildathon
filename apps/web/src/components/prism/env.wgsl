// Environment map for the glass, rendered once into an equirectangular target and sampled by direction.
// vgpu's public API has no cube-texture resource, so the environment is a 2:1 equirect texture: same job, one
// texture instead of six faces, and the lookup is `direction -> uv` in `glass.wgsl`.
// Flow: uv -> spherical direction -> a dark studio: a broad soft key light, a cool rim, a warm bounce, a dim floor.

struct Params {
  // x, y: texture size. z: seconds, so the studio drifts a little and the glass never looks like a decal.
  size_time: vec4f,
}

@group(0) @binding(0) var<uniform> params: Params;

fn soft_light(direction: vec3f, towards: vec3f, tightness: f32) -> f32 {
  return pow(max(dot(direction, normalize(towards)), 0.0), tightness);
}

@fragment
fn fs_main(@location(0) uv: vec2f) -> @location(0) vec4f {
  let time = params.size_time.z;
  // Equirectangular: x wraps the azimuth, y sweeps the pole.
  let azimuth = (uv.x - 0.5) * 6.2831853;
  let polar = uv.y * 3.1415927;
  let direction = vec3f(sin(polar) * cos(azimuth), cos(polar), sin(polar) * sin(azimuth));

  // A near-black room, so the prism reads as glass in the dark rather than as a lit object.
  var colour = vec3f(0.004, 0.005, 0.010) * (1.0 - 0.6 * direction.y);
  // Key: a broad soft source up and to the left, drifting slowly.
  let key = normalize(vec3f(-0.55 + 0.06 * sin(time * 0.11), 0.72, 0.42));
  colour += vec3f(0.95, 0.97, 1.00) * soft_light(direction, key, 70.0) * 1.6;
  colour += vec3f(0.35, 0.42, 0.60) * soft_light(direction, key, 4.0) * 0.07;
  // Rim: a cool source behind and to the right, which is what draws the far edges of the glass.
  let rim = normalize(vec3f(0.78, 0.10, -0.62));
  colour += vec3f(0.35, 0.55, 1.00) * soft_light(direction, rim, 40.0) * 0.55;
  // Bounce: a dim warm floor under the prism.
  colour += vec3f(0.55, 0.38, 0.24) * soft_light(direction, vec3f(0.1, -1.0, 0.2), 6.0) * 0.10;
  return vec4f(colour, 1.0);
}
