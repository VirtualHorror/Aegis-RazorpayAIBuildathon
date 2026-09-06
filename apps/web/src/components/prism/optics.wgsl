// Prism optics, shared by every pass that needs to know where the light goes.
// Pure WGSL module (no bindings of its own, per vgpu's module rule): the entry shaders declare the uniform and pass
// the two values this needs — the viewport and the pointer.
//
// The physics is unchanged from the single-pass version: Snell at the entry face, the far wall found by intersection,
// Snell again per wavelength on the way out, and a steering range derived from the geometry so the pointer can never
// push the beam into total internal reflection.

/** Refractive index at the red end of the visible band. */
export const N_RED: f32 = 1.50;
/** Added at the violet end. 0.30 opens a 16.7 degree fan; past about 0.60 the violet end is trapped in the glass. */
export const N_SPREAD: f32 = 0.30;
export const LAMBDA_RED: f32 = 700.0;
export const LAMBDA_VIOLET: f32 = 400.0;
/** Headroom kept above the total-internal-reflection floor, radians. */
export const BEAM_MARGIN: f32 = 0.06;
/** Steepest the pointer may push the beam: 45.8 degrees of elevation, short of grazing incidence. */
export const BEAM_ELEVATION_MAX: f32 = 0.80;
/** Where the beam may land on the entry face (0 = apex, 1 = left vertex). */
export const BEAM_ENTRY_U_MIN: f32 = 0.30;
export const BEAM_ENTRY_U_MAX: f32 = 0.62;

export struct Scene {
  apex: vec2f,
  right: vec2f,
  left: vec2f,
  centroid: vec2f,
  /** Half the prism's thickness along z, in the same pixel units as the cross-section. */
  halfDepth: f32,
  size: f32,
  entryOrigin: vec2f,
  entryDirection: vec2f,
  entryHit: vec2f,
  insideDirection: vec2f,
  exitPoint: vec2f,
  exitNormal: vec2f,
  entryNormal: vec2f,
  refracts: f32,
}

export fn cross2(a: vec2f, b: vec2f) -> f32 {
  return a.x * b.y - a.y * b.x;
}

/** Unit normal of edge a->b pointing away from `interiorPoint`. */
export fn outward_normal(a: vec2f, b: vec2f, interiorPoint: vec2f) -> vec2f {
  let e = normalize(b - a);
  let n = vec2f(e.y, -e.x);
  return select(-n, n, dot(n, a - interiorPoint) > 0.0);
}

/** Ray/segment intersection: distance along `direction`, or -1 for a miss. */
export fn ray_segment(origin: vec2f, direction: vec2f, a: vec2f, b: vec2f) -> f32 {
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

/** Visible spectrum, nanometres to linear RGB (Bruton's approximation), ends rolled off. */
export fn spectral_rgb(wavelength: f32) -> vec3f {
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

/**
 * The scene for a viewport and a pointer in 0..1 of the canvas.
 * The steering range is derived, never tuned: Snell twice gives r1 + r2 = A, so the shallowest beam whose violet end
 * still escapes satisfies r1 > A - asin(1 / n_violet). That fixes the minimum incidence, and so the minimum
 * elevation, which is clamped with BEAM_MARGIN in hand.
 */
export fn build_scene(resolution: vec2f, pointer: vec2f) -> Scene {
  var s: Scene;
  s.size = min(resolution.y * 0.72, resolution.x * 0.34);
  let radius = s.size * 0.58;
  let centre = vec2f(resolution.x * 0.60, resolution.y * 0.52);
  s.apex = centre + vec2f(0.0, -radius);
  s.right = centre + vec2f(radius * 0.8660254, radius * 0.5);
  s.left = centre + vec2f(-radius * 0.8660254, radius * 0.5);
  s.centroid = (s.apex + s.right + s.left) / 3.0;
  s.halfDepth = s.size * 0.30;

  let aim = clamp(pointer, vec2f(0.0), vec2f(1.0));
  s.entryHit = mix(s.apex, s.left, mix(BEAM_ENTRY_U_MAX, BEAM_ENTRY_U_MIN, aim.x));

  s.entryNormal = outward_normal(s.apex, s.left, s.centroid);
  let meanIndex = N_RED + N_SPREAD * 0.5;

  let exitFaceNormal = outward_normal(s.apex, s.right, s.centroid);
  let apexAngle = acos(clamp(-dot(s.entryNormal, exitFaceNormal), -1.0, 1.0));
  let criticalViolet = asin(clamp(1.0 / (N_RED + N_SPREAD), -1.0, 1.0));
  let incidenceMin = asin(clamp(meanIndex * sin(apexAngle - criticalViolet), -1.0, 1.0));
  let inwardNormalAngle = atan2(-s.entryNormal.y, -s.entryNormal.x);
  let elevationMin = min(incidenceMin - inwardNormalAngle + BEAM_MARGIN, BEAM_ELEVATION_MAX);
  let elevation = clamp(mix(elevationMin, BEAM_ELEVATION_MAX, aim.y), elevationMin, BEAM_ELEVATION_MAX);

  s.entryDirection = vec2f(cos(-elevation), sin(-elevation));
  s.entryOrigin = s.entryHit - s.entryDirection * length(resolution) * 1.2;
  s.insideDirection = refract(s.entryDirection, s.entryNormal, 1.0 / meanIndex);
  s.refracts = select(0.0, 1.0, dot(s.insideDirection, s.insideDirection) > 1e-6);

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
export fn exit_direction(s: Scene, wavelength: f32) -> vec2f {
  let t = clamp((LAMBDA_RED - wavelength) / (LAMBDA_RED - LAMBDA_VIOLET), 0.0, 1.0);
  let index = N_RED + N_SPREAD * t;
  return refract(s.insideDirection, -s.exitNormal, index);
}

/**
 * Oblique ("cabinet") projection: pixel coordinates straight to clip space, with z shearing the point along a fixed
 * screen direction. It keeps the composition identical to the flat version while giving the prism real thickness.
 */
export fn to_clip(world: vec3f, resolution: vec2f, depthShear: vec2f) -> vec4f {
  let p = world.xy + depthShear * world.z;
  return vec4f((p / resolution) * vec2f(2.0, -2.0) + vec2f(-1.0, 1.0), 0.5, 1.0);
}

/** How far a unit of z displaces a point on screen: the direction the solid leans away from the viewer. */
export fn depth_shear() -> vec2f {
  return vec2f(0.55, -0.36);
}
