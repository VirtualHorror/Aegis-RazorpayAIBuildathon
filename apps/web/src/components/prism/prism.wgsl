// vgpu.sh hero — light through a glass prism, as a single fullscreen fragment effect.
// Written to a fixed specification: pure black stage, one solid SDF prism with visible depth, one intense white
// volumetric ray, impact bloom, internal travel, exit caustic, continuous chromatic dispersion, lit dust, Lottes
// tonemap, interleaved-gradient dithering, screen-edge fade. No ambient light and no scene elements beyond these.
//
// Flow: uv -> CSS pixels -> build the scene (prism vertices, ray path, refraction) -> derivative-based edge width ->
//       glass edges -> volumetric light field -> dust lit by that field -> tonemap -> sRGB -> edge fade -> dither.
//
// All lengths are in CSS pixels. The scene is derived from the viewport alone, so the picture is resolution
// independent; `effect()` supplies `uv`, and `params` is the only binding.

struct Params {
  // x, y: viewport in CSS pixels. z: seconds since start. w: device pixel ratio.
  resolution_time: vec4f,
}

@group(0) @binding(0) var<uniform> params: Params;

// ---- Physical constants -------------------------------------------------------------------------------------------
/** Refractive index at the red end of the visible band. */
const N_RED: f32 = 1.50;
/**
  * Added to the index at the violet end: blue bends harder, which is what opens the spectrum. Real glass disperses by
  * a few hundredths and throws a fan two or three degrees wide; this is dialled up until the band is wide enough to
  * read as a spectrum. At 0.30 the fan is 16.7 degrees and every wavelength still escapes the far face — past about
  * 0.60 the violet end passes the critical angle and is trapped inside the glass.
  */
const N_SPREAD: f32 = 0.30;
/** Wavelength band, nanometres. */
const LAMBDA_RED: f32 = 700.0;
const LAMBDA_VIOLET: f32 = 400.0;
/** Samples across the spectrum for the rendered fan. High enough that the bands merge into one continuous rainbow. */
const SPECTRUM_STEPS: i32 = 48;
/** Cheaper sample count when the same light field is evaluated to illuminate a dust mote. */
const DUST_SPECTRUM_STEPS: i32 = 8;
/** Dust grid pitch in CSS pixels. */
const DUST_CELL: f32 = 30.0;
/**
 * Beam elevation, radians above horizontal, and where it lands on the entry face (0 = apex, 1 = left vertex).
 * Not a free choice: an equilateral prism deviates light by at least ~37 degrees, so a shallow beam arriving from
 * above meets the far wall past the critical angle and totally internally reflects — nothing exits and there is no
 * spectrum. Sitting near minimum deviation (about 24 degrees of elevation here) puts both internal angles near 28
 * degrees, some 13 degrees clear of the critical angle, which is the headroom the dispersion above spends.
 */
const BEAM_ELEVATION: f32 = 0.41888;
const BEAM_ENTRY_U: f32 = 0.45;

const LUMA = vec3f(0.2126, 0.7152, 0.0722);

// ---- Hashes and noise -------------------------------------------------------------------------------------------
fn hash21(p: vec2f) -> f32 {
  return fract(sin(dot(p, vec2f(127.1, 311.7))) * 43758.5453123);
}

fn hash22(p: vec2f) -> vec2f {
  return vec2f(hash21(p), hash21(p + vec2f(37.31, 11.17)));
}

/** Interleaved gradient noise (Jimenez): a high-frequency, blue-noise-like dither that kills banding. */
fn ign(p: vec2f) -> f32 {
  return fract(52.9829189 * fract(dot(p, vec2f(0.06711056, 0.00583715))));
}

// ---- Geometry -----------------------------------------------------------------------------------------------------
fn cross2(a: vec2f, b: vec2f) -> f32 {
  return a.x * b.y - a.y * b.x;
}

fn sd_segment(p: vec2f, a: vec2f, b: vec2f) -> f32 {
  let pa = p - a;
  let ba = b - a;
  let h = clamp(dot(pa, ba) / max(dot(ba, ba), 1e-6), 0.0, 1.0);
  return length(pa - ba * h);
}

/** Distance from p to the half-line leaving `origin` along the unit vector `direction`. */
fn sd_ray(p: vec2f, origin: vec2f, direction: vec2f) -> f32 {
  let v = p - origin;
  return length(v - direction * max(dot(v, direction), 0.0));
}

/** Signed distance to a triangle: negative inside, positive outside. */
fn sd_triangle(p: vec2f, a: vec2f, b: vec2f, c: vec2f) -> f32 {
  let d = min(min(sd_segment(p, a, b), sd_segment(p, b, c)), sd_segment(p, c, a));
  let e0 = b - a;
  let e1 = c - b;
  let e2 = a - c;
  let s0 = cross2(e0, p - a);
  let s1 = cross2(e1, p - b);
  let s2 = cross2(e2, p - c);
  let inside = (s0 <= 0.0 && s1 <= 0.0 && s2 <= 0.0) || (s0 >= 0.0 && s1 >= 0.0 && s2 >= 0.0);
  return select(d, -d, inside);
}

/** The solid the glass occupies: the triangle swept along the extrusion, i.e. front face, back face and sides. */
fn sd_prism(p: vec2f, a: vec2f, b: vec2f, c: vec2f, depth: vec2f) -> f32 {
  var d = 1e9;
  for (var k = 0; k < 5; k = k + 1) {
    d = min(d, sd_triangle(p - depth * (f32(k) / 4.0), a, b, c));
  }
  return d;
}

/** Unit normal of edge a->b pointing away from the interior point `interiorPoint`. */
fn outward_normal(a: vec2f, b: vec2f, interiorPoint: vec2f) -> vec2f {
  let e = normalize(b - a);
  let n = vec2f(e.y, -e.x);
  return select(-n, n, dot(n, a - interiorPoint) > 0.0);
}

/** Ray/segment intersection: distance along `direction`, or -1 for a miss. */
fn ray_segment(origin: vec2f, direction: vec2f, a: vec2f, b: vec2f) -> f32 {
  let e = b - a;
  let denom = cross2(direction, e);
  if (abs(denom) < 1e-6) {
    return -1.0;
  }
  let diff = a - origin;
  let t = cross2(diff, e) / denom;
  let u = cross2(diff, direction) / denom;
  if (t <= 1e-3 || u < 0.0 || u > 1.0) {
    return -1.0;
  }
  return t;
}

/** Gaussian falloff: 1 on the line, ~0 by three sigma. Every light in this shader is painted with it. */
fn glow(distance: f32, sigma: f32) -> f32 {
  let x = distance / max(sigma, 1e-4);
  return exp(-x * x * 0.5);
}

// ---- Spectrum -----------------------------------------------------------------------------------------------------
/** Visible spectrum, wavelength in nanometres to linear RGB (Bruton's approximation), with the ends rolled off. */
fn spectral_rgb(wavelength: f32) -> vec3f {
  var c = vec3f(0.0);
  if (wavelength < 440.0) {
    c = vec3f(-(wavelength - 440.0) / 60.0, 0.0, 1.0);
  } else if (wavelength < 490.0) {
    c = vec3f(0.0, (wavelength - 440.0) / 50.0, 1.0);
  } else if (wavelength < 510.0) {
    c = vec3f(0.0, 1.0, -(wavelength - 510.0) / 20.0);
  } else if (wavelength < 580.0) {
    c = vec3f((wavelength - 510.0) / 70.0, 1.0, 0.0);
  } else if (wavelength < 645.0) {
    c = vec3f(1.0, -(wavelength - 645.0) / 65.0, 0.0);
  } else {
    c = vec3f(1.0, 0.0, 0.0);
  }
  var f = 1.0;
  if (wavelength < 420.0) {
    f = 0.3 + 0.7 * (wavelength - 380.0) / 40.0;
  } else if (wavelength > 700.0) {
    f = 0.3 + 0.7 * (780.0 - wavelength) / 80.0;
  }
  return c * clamp(f, 0.0, 1.0);
}

// ---- Scene --------------------------------------------------------------------------------------------------------
struct Scene {
  apex: vec2f,
  right: vec2f,
  left: vec2f,
  centroid: vec2f,
  depth: vec2f,
  size: f32,
  entryOrigin: vec2f,
  entryDirection: vec2f,
  entryHit: vec2f,
  insideDirection: vec2f,
  exitPoint: vec2f,
  exitNormal: vec2f,
  refracts: f32,
}

/**
 * The whole scene from the viewport: an equilateral prism centre-right, and one ray refracted into it, across it and
 * out of its far face. Snell's law twice, with the exit taken per wavelength in the fan below.
 */
fn build_scene(resolution: vec2f) -> Scene {
  var s: Scene;
  s.size = min(resolution.y * 0.72, resolution.x * 0.34);
  let radius = s.size * 0.58;
  let centre = vec2f(resolution.x * 0.60, resolution.y * 0.52);
  // Equilateral: vertices at -90 deg, 30 deg and 150 deg on the circumcircle.
  s.apex = centre + vec2f(0.0, -radius);
  s.right = centre + vec2f(radius * 0.8660254, radius * 0.5);
  s.left = centre + vec2f(-radius * 0.8660254, radius * 0.5);
  s.centroid = (s.apex + s.right + s.left) / 3.0;
  // Seen slightly from the right and above, so the far face and the struts stand off the near face.
  s.depth = vec2f(s.size * 0.17, -s.size * 0.11);

  s.entryHit = mix(s.apex, s.left, BEAM_ENTRY_U);
  // Fixed elevation, and the origin projected back off-canvas along it, so the shaft always enters from outside.
  s.entryDirection = vec2f(cos(-BEAM_ELEVATION), sin(-BEAM_ELEVATION));
  s.entryOrigin = s.entryHit - s.entryDirection * length(resolution) * 1.2;

  let entryNormal = outward_normal(s.apex, s.left, s.centroid);
  let meanIndex = N_RED + N_SPREAD * 0.5;
  s.insideDirection = refract(s.entryDirection, entryNormal, 1.0 / meanIndex);
  s.refracts = select(0.0, 1.0, dot(s.insideDirection, s.insideDirection) > 1e-6);

  // The far wall is whichever of the two remaining faces the internal ray reaches first.
  let tRight = ray_segment(s.entryHit, s.insideDirection, s.apex, s.right);
  let tBase = ray_segment(s.entryHit, s.insideDirection, s.left, s.right);
  var travel = 1e9;
  var exitA = s.apex;
  var exitB = s.right;
  if (tRight > 0.0) {
    travel = tRight;
  }
  if (tBase > 0.0 && tBase < travel) {
    travel = tBase;
    exitA = s.left;
    exitB = s.right;
  }
  if (travel > 1e8) {
    travel = s.size * 0.5;
  }
  s.exitPoint = s.entryHit + s.insideDirection * travel;
  s.exitNormal = outward_normal(exitA, exitB, s.centroid);
  return s;
}

/** Exit direction of one wavelength, or a zero vector under total internal reflection. */
fn exit_direction(s: Scene, wavelength: f32) -> vec2f {
  let t = clamp((LAMBDA_RED - wavelength) / (LAMBDA_RED - LAMBDA_VIOLET), 0.0, 1.0);
  let index = N_RED + N_SPREAD * t;
  return refract(s.insideDirection, -s.exitNormal, index);
}

// ---- The light field ----------------------------------------------------------------------------------------------
/**
 * Radiance reaching a point in the plane. This is the whole picture, and it is a function of position alone, which is
 * what lets a dust mote be lit by exactly the light that is there and nothing else.
 * `steps` trades spectral smoothness for cost: the frame uses SPECTRUM_STEPS, a dust mote uses far fewer.
 */
fn light_at(q: vec2f, s: Scene, steps: i32) -> vec3f {
  var light = vec3f(0.0);
  let core = max(s.size * 0.0045, 0.7);

  // The incoming shaft: an intense white core inside a soft volumetric halo, stopping at the glass.
  let dEntry = sd_segment(q, s.entryOrigin, s.entryHit);
  light += vec3f(1.0) * glow(dEntry, core) * 3.2;
  light += vec3f(0.92, 0.95, 1.0) * glow(dEntry, s.size * 0.030) * 0.30;
  light += vec3f(0.80, 0.86, 1.0) * glow(dEntry, s.size * 0.115) * 0.055;

  // Impact bloom where the shaft meets the outer wall.
  light += vec3f(1.0, 0.99, 0.96) * glow(length(q - s.entryHit), s.size * 0.045) * 1.30;
  light += vec3f(0.85, 0.90, 1.0) * glow(length(q - s.entryHit), s.size * 0.16) * 0.10;

  // The refracted ray crossing the glass.
  let dInside = sd_segment(q, s.entryHit, s.exitPoint);
  light += vec3f(0.96, 0.98, 1.0) * glow(dInside, core * 1.2) * (1.6 * s.refracts);
  light += vec3f(0.70, 0.80, 1.0) * glow(dInside, s.size * 0.045) * (0.10 * s.refracts);

  // Caustic where it leaves the far wall: a hot point plus a short smear along that face.
  let dExit = length(q - s.exitPoint);
  light += vec3f(1.0, 0.98, 0.94) * glow(dExit, s.size * 0.030) * (1.9 * s.refracts);
  let alongFace = sd_ray(q, s.exitPoint, normalize(vec2f(-s.exitNormal.y, s.exitNormal.x)));
  light += vec3f(0.90, 0.95, 1.0) * glow(alongFace, core * 1.6) * glow(dExit, s.size * 0.14) * (0.9 * s.refracts);

  // The dispersed fan: one half-line per wavelength, summed into a continuous spectrum.
  var spectrum = vec3f(0.0);
  let inverse = 1.0 / f32(steps);
  for (var i = 0; i < steps; i = i + 1) {
    let u = (f32(i) + 0.5) * inverse;
    let wavelength = mix(LAMBDA_RED, LAMBDA_VIOLET, u);
    let direction = exit_direction(s, wavelength);
    if (dot(direction, direction) < 1e-6) {
      continue;
    }
    let d = sd_ray(q, s.exitPoint, normalize(direction));
    let colour = spectral_rgb(wavelength);
    spectrum += colour * (glow(d, core * 1.35) * 2.6 + glow(d, s.size * 0.05) * 0.24);
  }
  // Mean over the samples, so the fan's brightness does not depend on how many wavelengths were traced.
  light += spectrum * inverse * s.refracts;
  return light;
}

/** Dust: fixed motes on a jittered grid, drifting slowly, visible only where the light field reaches them. */
fn dust(p: vec2f, s: Scene, time: f32) -> vec3f {
  var total = vec3f(0.0);
  let base = floor(p / DUST_CELL);
  for (var y = -1; y <= 1; y = y + 1) {
    for (var x = -1; x <= 1; x = x + 1) {
      let cell = base + vec2f(f32(x), f32(y));
      let h = hash22(cell);
      let drift = vec2f(sin(time * 0.13 + h.x * 6.2831), cos(time * 0.11 + h.y * 6.2831)) * DUST_CELL * 0.32;
      let position = (cell + h) * DUST_CELL + drift;
      let radius = mix(0.55, 1.5, hash21(cell + 5.13));
      let sprite = glow(length(p - position), radius);
      if (sprite < 0.002) {
        continue;
      }
      // A mote emits nothing of its own: it scatters whatever radiance is at its position.
      total += light_at(position, s, DUST_SPECTRUM_STEPS) * sprite * 0.16;
    }
  }
  return total;
}

// ---- Display ------------------------------------------------------------------------------------------------------
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

/** Everything dissipates to black before the canvas boundary, on all four sides. */
fn edge_fade(p: vec2f, resolution: vec2f) -> f32 {
  let band = min(resolution.x, resolution.y) * 0.20;
  let d = min(min(p.x, resolution.x - p.x), min(p.y, resolution.y - p.y));
  return smoothstep(0.0, band, d);
}

@fragment
fn fs_main(@location(0) uv: vec2f) -> @location(0) vec4f {
  let resolution = params.resolution_time.xy;
  let time = params.resolution_time.z;
  let dpr = max(params.resolution_time.w, 0.5);
  let p = uv * resolution;
  let s = build_scene(resolution);

  // The SDF gradient is a derivative: taken here, in uniform control flow, before any branch.
  let solid = sd_prism(p, s.apex, s.right, s.left, s.depth);
  let front = sd_triangle(p, s.apex, s.right, s.left);
  let back = sd_triangle(p - s.depth, s.apex, s.right, s.left);
  let aa = max(length(vec2f(dpdx(solid), dpdy(solid))), 1e-4);

  // Pure black stage: nothing is lit that is not lit by the ray.
  var colour = vec3f(0.0);

  // The glass itself, read only through its edges: the far face and the three struts show through the near face.
  let edgeSigma = max(aa * 1.1, s.size * 0.0022);
  let strut = min(
    sd_segment(p, s.apex, s.apex + s.depth),
    min(sd_segment(p, s.right, s.right + s.depth), sd_segment(p, s.left, s.left + s.depth)),
  );
  colour += vec3f(0.36, 0.44, 0.62) * glow(abs(back), edgeSigma) * 0.30;
  colour += vec3f(0.34, 0.42, 0.60) * glow(strut, edgeSigma) * 0.24;
  colour += vec3f(0.72, 0.80, 0.95) * glow(abs(front), edgeSigma) * 0.75;
  // A grazing rim just inside the near face, so the solid reads as glass rather than as a wireframe.
  colour += vec3f(0.30, 0.38, 0.58)
    * (1.0 - smoothstep(-aa, aa, solid))
    * pow(1.0 - clamp(-solid / (s.size * 0.10), 0.0, 1.0), 5.0)
    * 0.16;

  // The light, then the dust it lights.
  colour += light_at(p, s, SPECTRUM_STEPS);
  colour += dust(p, s, time);

  colour = tonemap_lottes(max(colour, vec3f(0.0)));
  colour = pow(clamp(colour, vec3f(0.0), vec3f(1.0)), vec3f(1.0 / 2.2));
  colour *= edge_fade(p, resolution);
  colour += (ign(p * dpr) - 0.5) * (1.5 / 255.0);
  return vec4f(clamp(colour, vec3f(0.0), vec3f(1.0)), 1.0);
}
