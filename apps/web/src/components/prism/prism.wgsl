// Prism hero, WebGPU path (Design.md §5.1).
// Intent: draw the scene `prismGeometry.ts` computes — dark glass triangle, one white beam in, seven module-coloured
//         rays out — the way the vgpu reference hero does it: a black stage, a very bright thin beam, and everything
//         else earned by falloff, so the picture reads as light rather than as strokes.
// Flow: uv -> CSS pixels -> background (vignette, stars, grain) -> glass body and rim -> beams (entry with dispersion,
//       internal, exit hotspot, seven-ray fan, specular streak) -> Lottes tonemap -> sRGB -> screen-edge fade -> dither.
// Technique credit: the official vgpu example `triangle-led-front` (`npx vgpu examples pull triangle-led-front`).
// Its `color-utils.wgsl` gives the Lottes tonemap and the linear->sRGB pass, `geometry.wgsl` the signed triangle SDF,
// `direct-triangle-raycast.wgsl` the interleaved-gradient noise, and `themes/dark/main-scene-floor.wgsl` both the
// analytic anti-aliased silhouette (SDF gradient taken in uniform control flow) and the vertical edge-fade envelope.
// The scene itself is Aegis's own: the reference draws LED edges lighting a floor, not a refracted spectrum.

struct Params {
  // x, y: viewport in CSS pixels. z: seconds since start. w: 1 when reduced motion freezes the animation.
  resolution_time: vec4f,
  // Entry ray origin (xy) and the point where it meets the left face (zw), CSS pixels, both from prismGeometry.
  entry_beam: vec4f,
  // Exit point on the right face (xy); fan centre angle and total spread in radians (zw).
  exit_fan: vec4f,
  // Triangle apex (xy) and right vertex (zw).
  apex_right: vec4f,
  // Triangle left vertex (xy), device pixel ratio (z), triangle size in pixels (w) — every radius scales with it.
  left_scale: vec4f,
  // Front face to back face (xy). The prism is a solid seen slightly from the side, not an outline.
  depth_extra: vec4f,
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

const LUMA = vec3f(0.2126, 0.7152, 0.0722);
/** Dispersion angle between the red and blue edges of the entry beam, radians. */
const DISPERSION = 0.010;

fn hash21(p: vec2f) -> f32 {
  return fract(sin(dot(p, vec2f(127.1, 311.7))) * 43758.5453123);
}

// Interleaved gradient noise (Jimenez): high-frequency, so it dithers the gradients as grain instead of banding.
fn ign(p: vec2f) -> f32 {
  return fract(52.9829189 * fract(dot(p, vec2f(0.06711056, 0.00583715))));
}

fn sd_segment(p: vec2f, a: vec2f, b: vec2f) -> f32 {
  let pa = p - a;
  let ba = b - a;
  let h = clamp(dot(pa, ba) / max(dot(ba, ba), 1e-6), 0.0, 1.0);
  return length(pa - ba * h);
}

// Signed distance to the triangle: negative inside, positive outside.
fn sd_triangle(p: vec2f, a: vec2f, b: vec2f, c: vec2f) -> f32 {
  let d = min(min(sd_segment(p, a, b), sd_segment(p, b, c)), sd_segment(p, c, a));
  let e0 = b - a;
  let e1 = c - b;
  let e2 = a - c;
  let s0 = e0.x * (p.y - a.y) - e0.y * (p.x - a.x);
  let s1 = e1.x * (p.y - b.y) - e1.y * (p.x - b.x);
  let s2 = e2.x * (p.y - c.y) - e2.y * (p.x - c.x);
  let inside = (s0 <= 0.0 && s1 <= 0.0 && s2 <= 0.0) || (s0 >= 0.0 && s1 >= 0.0 && s2 >= 0.0);
  return select(d, -d, inside);
}

// The solid the glass occupies: the triangle swept along the extrusion, i.e. front face, back face and the three
// side faces in one signed field. Sampling the sweep is exact enough at five steps and stays branch-free.
fn sd_prism(p: vec2f, a: vec2f, b: vec2f, c: vec2f, depth: vec2f) -> f32 {
  var d = 1e9;
  for (var k = 0; k < 5; k = k + 1) {
    let t = f32(k) / 4.0;
    d = min(d, sd_triangle(p - depth * t, a, b, c));
  }
  return d;
}

/** Gaussian falloff: 1 on the line, reaching ~0 at about 3 * sigma. The only brush this shader paints with. */
fn glow(distance: f32, sigma: f32) -> f32 {
  let x = distance / max(sigma, 1e-4);
  return exp(-x * x * 0.5);
}

fn rotate(direction: vec2f, angle: f32) -> vec2f {
  let c = cos(angle);
  let s = sin(angle);
  return vec2f(direction.x * c - direction.y * s, direction.x * s + direction.y * c);
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

// Lottes filmic curve: overlapping additive beams roll off to white instead of clipping to a flat colour.
fn tonemap_lottes(x: vec3f) -> vec3f {
  let a = 1.6;
  let d = 0.977;
  let hdr_max = 8.0;
  let mid_in = 0.18;
  let mid_out = 0.267;
  let b =
    (-pow(mid_in, a) + pow(hdr_max, a) * mid_out)
    / ((pow(hdr_max, a * d) - pow(mid_in, a * d)) * mid_out);
  let c =
    (pow(hdr_max, a * d) * pow(mid_in, a) - pow(hdr_max, a) * pow(mid_in, a * d) * mid_out)
    / ((pow(hdr_max, a * d) - pow(mid_in, a * d)) * mid_out);
  return pow(x, vec3f(a)) / (pow(x, vec3f(a * d)) * b + c);
}

// Vertical-only envelope: the hero sits in a card, so the picture eases to black at the top and bottom edges and
// never on the x axis, where the beam enters and the fan leaves.
fn edge_fade(p: vec2f, height: f32) -> f32 {
  let band = max(height * 0.16, 1.0);
  let d = min(p.y, height - p.y);
  return sqrt(clamp(d / band, 0.0, 1.0));
}

@fragment
fn fs_main(@location(0) uv: vec2f) -> @location(0) vec4f {
  let resolution = params.resolution_time.xy;
  let time = params.resolution_time.z;
  let still = params.resolution_time.w;
  let dpr = max(params.left_scale.z, 0.5);
  let size = max(params.left_scale.w, 1.0);
  let p = uv * resolution;

  let depth = params.depth_extra.xy;
  let apex = params.apex_right.xy;
  let right = params.apex_right.zw;
  let left = params.left_scale.xy;
  let entryFrom = params.entry_beam.xy;
  let hit = params.entry_beam.zw;
  let exitPoint = params.exit_fan.xy;
  let centreAngle = params.exit_fan.z;
  let spread = params.exit_fan.w;

  // The SDF gradient is a derivative, so it must be taken in uniform control flow: one texel of the edge, used both
  // for the anti-aliased silhouette and for the rim light (reference: main-scene-floor.wgsl).
  let triangle = sd_triangle(p, apex, right, left);
  let backTriangle = sd_triangle(p - depth, apex, right, left);
  let solid = sd_prism(p, apex, right, left, depth);
  let aa = max(length(vec2f(dpdx(solid), dpdy(solid))), 1e-4);

  // ---- Stage: black, with a slow lift toward the prism and a sparse starfield -------------------------------------
  var color = vec3f(0.004, 0.005, 0.012);
  let centre = (uv - vec2f(0.5, 0.5)) * vec2f(resolution.x / max(resolution.y, 1.0), 1.0);
  color += vec3f(0.012, 0.016, 0.038) * pow(1.0 - clamp(length(centre) * 0.85, 0.0, 1.0), 2.0);

  let cellSize = 34.0;
  let cell = floor(p / cellSize);
  let star = hash21(cell);
  if (star > 0.955) {
    let jitter = vec2f(hash21(cell + 3.7), hash21(cell + 9.1)) * cellSize;
    let d = length(p - (cell * cellSize + jitter));
    let twinkle = select(0.55 + 0.45 * sin(time * 1.5 + star * 40.0), 1.0, still > 0.5);
    color += vec3f(0.55, 0.62, 0.85) * twinkle * glow(d, 0.9) * 0.55;
  }

  // ---- Glass: a solid dark body, its far edges visible through it, its near edges catching the light -------------
  let insideMask = 1.0 - smoothstep(-aa, aa, solid);
  // The body darkens the stage and shades along the extrusion, so the side faces read as faces rather than as fill.
  let alongDepth = clamp(dot(p - apex, normalize(depth)) / (size * 1.4), 0.0, 1.0);
  let glassBody = mix(vec3f(0.005, 0.007, 0.017), vec3f(0.020, 0.024, 0.048), alongDepth);
  color = mix(color, glassBody, insideMask);
  // Fresnel-ish rim: the closer to a wall from the inside, the more light grazes it.
  color += vec3f(0.30, 0.40, 0.70) * insideMask * pow(1.0 - clamp(-solid / (size * 0.14), 0.0, 1.0), 4.0) * 0.13;
  // Struts: the three edges joining the front face to the back one.
  let strut = min(
    sd_segment(p, apex, apex + depth),
    min(sd_segment(p, right, right + depth), sd_segment(p, left, left + depth)),
  );
  color += vec3f(0.42, 0.50, 0.72) * glow(strut, max(aa * 0.9, size * 0.0022)) * 0.18;
  // Back face, seen through the glass: the same outline, dimmer.
  color += vec3f(0.45, 0.55, 0.80) * glow(abs(backTriangle), max(aa * 0.9, size * 0.0022)) * 0.20;
  // Front face: the bright bevel.
  let edgeDistance = abs(triangle);
  color += vec3f(0.80, 0.87, 1.00) * glow(edgeDistance, max(aa * 0.9, size * 0.0026)) * 0.80;
  color += vec3f(0.30, 0.42, 0.75) * glow(min(edgeDistance, abs(backTriangle)), size * 0.035) * 0.055;

  // ---- Entry beam: one hard white core, dispersed into a warm and a cool edge as it leaves the prism --------------
  let entryLength = max(length(hit - entryFrom), 1.0);
  let backAngle = atan2(entryFrom.y - hit.y, entryFrom.x - hit.x);
  let fromWarm = hit + rotate(vec2f(cos(backAngle), sin(backAngle)), DISPERSION) * entryLength;
  let fromCool = hit + rotate(vec2f(cos(backAngle), sin(backAngle)), -DISPERSION) * entryLength;
  let coreSigma = max(dpr * 0.75, size * 0.0045);
  let dEntry = sd_segment(p, entryFrom, hit);
  let dWarm = sd_segment(p, fromWarm, hit);
  let dCool = sd_segment(p, fromCool, hit);
  color += vec3f(1.0, 1.0, 1.0) * glow(dEntry, coreSigma) * 2.4;
  color += vec3f(1.00, 0.62, 0.30) * glow(dWarm, coreSigma * 2.6) * 0.30;
  color += vec3f(0.32, 0.58, 1.00) * glow(dCool, coreSigma * 2.6) * 0.30;
  color += vec3f(0.85, 0.90, 1.00) * glow(dEntry, size * 0.040) * 0.17;
  color += vec3f(0.55, 0.65, 0.95) * glow(dEntry, size * 0.18) * 0.022;

  // Impact: the wall scatters where the beam lands, which is the brightest place in the reference too.
  color += vec3f(1.0, 0.98, 0.92) * glow(length(p - hit), size * 0.045) * 0.50;

  // ---- Inside the glass: the bent ray, brightening toward the face it leaves by --------------------------------
  let dInside = sd_segment(p, hit, exitPoint);
  let alongInside = clamp(dot(p - hit, exitPoint - hit) / max(dot(exitPoint - hit, exitPoint - hit), 1e-6), 0.0, 1.0);
  color += vec3f(0.92, 0.96, 1.00) * glow(dInside, coreSigma * 1.3) * (0.85 + alongInside * 0.55);
  color += vec3f(0.45, 0.60, 1.00) * glow(dInside, size * 0.055) * 0.07;

  let exitFace = min(sd_segment(p, apex, right), sd_segment(p - depth, apex, right));
  color += vec3f(0.75, 0.85, 1.00) * glow(exitFace, size * 0.012) * glow(length(p - exitPoint), size * 0.16) * 0.85;

  // ---- Fan: a soft wedge of dispersed light, then the seven module rays on top of it ------------------------------
  let toPixel = p - exitPoint;
  let pixelDistance = length(toPixel);
  let rayLength = max(resolution.x, resolution.y) * 1.3;
  if (pixelDistance > 0.5) {
    let angle = atan2(toPixel.y, toPixel.x);
    let offAxis = abs(atan2(sin(angle - centreAngle), cos(angle - centreAngle)));
    let wedge = (1.0 - smoothstep(spread * 0.45, spread * 0.9, offAxis)) * exp(-pixelDistance / (size * 2.0));
    color += vec3f(0.35, 0.45, 0.85) * wedge * 0.085;
  }

  var fanSum = vec3f(0.0);
  for (var i = 0; i < 7; i = i + 1) {
    let t = f32(i) / 6.0 - 0.5;
    let angle = centreAngle + t * spread;
    let to = exitPoint + vec2f(cos(angle), sin(angle)) * rayLength;
    let d = sd_segment(p, exitPoint, to);
    let pulse = activity_at(i);
    // A ray fades with distance from the prism, so the fan opens out of the glass instead of being seven long lines.
    let reach = exp(-max(pixelDistance - size * 0.2, 0.0) / (size * (2.4 + pulse * 1.6)));
    let core = glow(d, coreSigma * (1.05 + pulse * 0.5)) * (0.85 + pulse * 1.30);
    let halo = glow(d, size * 0.032) * (0.075 + pulse * 0.26);
    fanSum += color_at(i) * (core + halo) * reach;
  }
  color += fanSum;
  // The exit point itself: where all seven rays still overlap, the light is white.
  color += vec3f(1.0, 0.97, 0.95) * glow(pixelDistance, size * 0.028) * 0.60;

  // ---- Specular streak carrying past the prism, much dimmer than the fan ------------------------------------------
  let streakTo = vec2f(resolution.x, exitPoint.y + (resolution.x - exitPoint.x) * tan(centreAngle));
  color += vec3f(1.0) * glow(sd_segment(p, exitPoint, streakTo), coreSigma * 1.2) * 0.22;

  // ---- Display: tone map the HDR sum, convert to sRGB, fade at the card edges, dither out the banding -------------
  color = tonemap_lottes(max(color, vec3f(0.0)));
  color = pow(clamp(color, vec3f(0.0), vec3f(1.0)), vec3f(1.0 / 2.2));
  color *= edge_fade(p, resolution.y);
  color += (ign(p * dpr) - 0.5) * (1.5 / 255.0);
  return vec4f(clamp(color, vec3f(0.0), vec3f(1.0)), 1.0);
}
