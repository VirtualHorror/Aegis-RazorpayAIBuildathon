// Prism hero, WebGPU path (Design.md §5.1).
// Intent: draw the same scene prismGeometry.ts computes — starfield, glass triangle, entry beam, refracted segment and
//         a seven-band fan — as signed-distance fields with additive colour, so the beam glows instead of being a line.
// Flow: uv -> pixel space -> starfield -> triangle outline with a fresnel-ish edge -> beam capsules -> fan bands, each
//       brightened by its module's activity pulse -> tone map.

struct Params {
  // x, y: viewport pixels. z: seconds since start. w: 1 when reduced motion is on (freeze all animation).
  resolution_time: vec4f,
  // Entry hit point (xy) and exit point (zw), in pixels — computed on the CPU so both renderers agree.
  entry_exit: vec4f,
  // Triangle vertices: apex (xy), right (zw).
  apex_right: vec4f,
  // Triangle left vertex (xy) and the fan's centre angle plus its spread, in radians (zw).
  left_fan: vec4f,
  // Per-module activity pulses 0..1, seven used of eight (Design.md §5.1).
  activity_a: vec4f,
  activity_b: vec4f,
  // Module spectrum colours, one per fan band.
  color0: vec4f,
  color1: vec4f,
  color2: vec4f,
  color3: vec4f,
  color4: vec4f,
  color5: vec4f,
  color6: vec4f,
}

@group(0) @binding(0) var<uniform> params: Params;

fn hash21(p: vec2f) -> f32 {
  var q = fract(p * vec2f(123.34, 456.21));
  q = q + dot(q, q + 45.32);
  return fract(q.x * q.y);
}

// Distance from p to the segment ab, in the same units as p.
fn seg_distance(p: vec2f, a: vec2f, b: vec2f) -> f32 {
  let pa = p - a;
  let ba = b - a;
  let h = clamp(dot(pa, ba) / max(dot(ba, ba), 1e-6), 0.0, 1.0);
  return length(pa - ba * h);
}

// Signed distance to a triangle outline (positive outside, negative inside is not needed: only the edge glows).
fn tri_edge_distance(p: vec2f, a: vec2f, b: vec2f, c: vec2f) -> f32 {
  return min(min(seg_distance(p, a, b), seg_distance(p, b, c)), seg_distance(p, c, a));
}

fn activity_at(index: i32) -> f32 {
  if (index < 4) {
    let a = params.activity_a;
    if (index == 0) { return a.x; }
    if (index == 1) { return a.y; }
    if (index == 2) { return a.z; }
    return a.w;
  }
  let b = params.activity_b;
  if (index == 4) { return b.x; }
  if (index == 5) { return b.y; }
  return b.z;
}

fn color_at(index: i32) -> vec3f {
  if (index == 0) { return params.color0.rgb; }
  if (index == 1) { return params.color1.rgb; }
  if (index == 2) { return params.color2.rgb; }
  if (index == 3) { return params.color3.rgb; }
  if (index == 4) { return params.color4.rgb; }
  if (index == 5) { return params.color5.rgb; }
  return params.color6.rgb;
}

@fragment
fn fs_main(@location(0) uv: vec2f) -> @location(0) vec4f {
  let resolution = params.resolution_time.xy;
  let time = params.resolution_time.z;
  let still = params.resolution_time.w;
  let p = uv * resolution;

  // Background: near-black with a soft central lift, plus a sparse starfield that twinkles unless motion is reduced.
  var color = vec3f(0.027, 0.031, 0.063);
  let centre = (uv - vec2f(0.5, 0.5)) * vec2f(resolution.x / max(resolution.y, 1.0), 1.0);
  color += vec3f(0.05, 0.06, 0.12) * (1.0 - clamp(length(centre) * 1.15, 0.0, 1.0));

  let cell = floor(p / 26.0);
  let star = hash21(cell);
  if (star > 0.93) {
    let jitter = vec2f(hash21(cell + 3.7), hash21(cell + 9.1)) * 26.0;
    let d = length(p - (cell * 26.0 + jitter));
    let twinkle = select(0.65 + 0.35 * sin(time * 1.7 + star * 30.0), 1.0, still > 0.5);
    color += vec3f(0.55, 0.6, 0.75) * twinkle * exp(-d * 1.6) * 0.8;
  }

  let apex = params.apex_right.xy;
  let right = params.apex_right.zw;
  let left = params.left_fan.xy;
  let hit = params.entry_exit.xy;
  let exitPoint = params.entry_exit.zw;

  // Glass: a faint fill and a bright edge that brightens where the beam enters and leaves.
  let edge = tri_edge_distance(p, apex, right, left);
  color += vec3f(0.85, 0.9, 1.0) * exp(-edge * 0.5) * 0.55;
  color += vec3f(0.35, 0.45, 0.7) * exp(-edge * 0.06) * 0.08;

  // Entry beam: white, from the left border to the hit point, with a soft halo.
  let entryFrom = vec2f(0.0, hit.y - (hit.x) * tan(params.left_fan.z * 1.8));
  let entryD = seg_distance(p, entryFrom, hit);
  color += vec3f(1.0) * exp(-entryD * 0.9) * 0.9;
  color += vec3f(0.7, 0.8, 1.0) * exp(-entryD * 0.09) * 0.16;

  // Internal segment: the bent ray inside the glass.
  let insideD = seg_distance(p, hit, exitPoint);
  color += vec3f(0.9, 0.95, 1.0) * exp(-insideD * 1.1) * 0.7;

  // Fan: seven bands, additive, each lifted by its module's activity pulse.
  let centreAngle = params.left_fan.z;
  let spread = params.left_fan.w;
  let rayLength = max(resolution.x, resolution.y) * 1.2;
  for (var i = 0; i < 7; i = i + 1) {
    let t = f32(i) / 6.0 - 0.5;
    let angle = centreAngle + t * spread;
    let to = exitPoint + vec2f(cos(angle), sin(angle)) * rayLength;
    let d = seg_distance(p, exitPoint, to);
    let pulse = activity_at(i);
    let core = exp(-d * (1.5 - pulse * 0.6)) * (0.55 + pulse * 0.9);
    let halo = exp(-d * 0.11) * (0.10 + pulse * 0.22);
    color += color_at(i) * (core + halo);
  }

  // Specular streak carrying past the prism, much dimmer than the fan.
  let streak = seg_distance(p, exitPoint, vec2f(resolution.x, exitPoint.y + (resolution.x - exitPoint.x) * tan(centreAngle)));
  color += vec3f(1.0) * exp(-streak * 2.2) * 0.16;

  // Tone map so overlapping additive beams saturate to white instead of clipping to magenta.
  color = color / (color + vec3f(1.0));
  color = pow(color, vec3f(1.0 / 2.2));
  return vec4f(color, 1.0);
}
