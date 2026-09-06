// The light itself, as geometry. Every part of the beam is a rasterised quad whose brightness is interpolated across
// the surface, which is what makes it smooth: no per-pixel sampling of a distance field, and no discrete rays.
// Flow: vertex_index -> a quad of the requested part (shaft, the segment inside the glass, one ribbon of the
//       dispersed fan, or an impact billboard) -> oblique projection -> fragment applies a Gaussian across the
//       quad and fades it along its length. Everything is drawn with additive blending.
import { Scene, build_scene, exit_direction, spectral_rgb, to_clip, depth_shear, LAMBDA_RED, LAMBDA_VIOLET } from "./optics.wgsl";

/** Ribbons across the spectrum. They overlap, so the fan is continuous rather than a comb of separate rays. */
const FAN_RIBBONS: u32 = 64u;

struct Params {
  // x, y: viewport in CSS pixels. z: seconds. w: device pixel ratio.
  resolution_time: vec4f,
  // x, y: eased pointer in 0..1 of the canvas. z: 1 while it is over the canvas.
  pointer: vec4f,
  // x: which part this draw is — 0 shaft, 1 the segment inside the glass, 2 the fan, 3 the impact billboards.
  part_info: vec4f,
}

@group(0) @binding(0) var<uniform> params: Params;

struct VertexOut {
  @builtin(position) position: vec4f,
  // Across the quad, -1..1: the Gaussian profile that gives the beam its core and halo.
  @location(0) lateral: f32,
  // Along the quad, 0..1 from the source outward.
  @location(1) along: f32,
  @location(2) colour: vec3f,
  @location(3) kind: f32,
}

/** The six corners of a quad, as (along, lateral) pairs. */
fn quad_corner(index: u32) -> vec2f {
  var corners = array<vec2f, 6>(
    vec2f(0.0, -1.0), vec2f(1.0, -1.0), vec2f(1.0, 1.0),
    vec2f(0.0, -1.0), vec2f(1.0, 1.0), vec2f(0.0, 1.0),
  );
  return corners[index];
}

@vertex
fn vs_main(@builtin(vertex_index) vertexIndex: u32) -> VertexOut {
  let resolution = params.resolution_time.xy;
  let s = build_scene(resolution, params.pointer.xy);
  let shear = depth_shear();
  let part = u32(params.part_info.x + 0.5);
  let corner = quad_corner(vertexIndex % 6u);
  let quadIndex = vertexIndex / 6u;
  let span = max(resolution.x, resolution.y);

  var origin = s.entryOrigin;
  var tip = s.entryHit;
  var halfWidthNear = s.size * 0.075;
  var halfWidthFar = s.size * 0.075;
  var colour = vec3f(1.0, 1.0, 1.0);
  var kind = 0.0;

  if (part == 1u) {
    // Inside the glass: shorter, tighter, and slightly cooler.
    origin = s.entryHit;
    tip = s.exitPoint;
    halfWidthNear = s.size * 0.035;
    halfWidthFar = s.size * 0.035;
    colour = vec3f(0.94, 0.97, 1.0) * s.refracts;
  } else if (part == 2u) {
    // One ribbon of the fan. Ribbons start together at the exit point and separate with distance, so the spectrum
    // is a continuous wash near the glass and resolves into colour further out.
    let t = (f32(quadIndex) + 0.5) / f32(FAN_RIBBONS);
    let wavelength = mix(LAMBDA_RED, LAMBDA_VIOLET, t);
    let direction = exit_direction(s, wavelength);
    let valid = select(0.0, 1.0, dot(direction, direction) > 1e-6) * s.refracts;
    origin = s.exitPoint;
    tip = s.exitPoint + normalize(direction + vec2f(1e-6, 0.0)) * span * 1.5;
    halfWidthNear = s.size * 0.030;
    halfWidthFar = s.size * 0.075;
    // Fade the two ends of the spectrum so the fan has no hard edge.
    let window = smoothstep(0.0, 0.16, t) * smoothstep(0.0, 0.16, 1.0 - t);
    colour = spectral_rgb(wavelength) * (window * valid * 0.85);
    kind = 1.0;
  } else if (part == 3u) {
    // Impact billboards: one where the beam meets the glass, one where it leaves.
    let atExit = quadIndex == 1u;
    let centre = select(s.entryHit, s.exitPoint, atExit);
    let radius = s.size * select(0.22, 0.26, atExit);
    let offset = vec2f(corner.x * 2.0 - 1.0, corner.y) * radius;
    var out: VertexOut;
    out.position = to_clip(vec3f(centre + offset, 0.0), resolution, shear);
    out.lateral = corner.y;
    out.along = corner.x * 2.0 - 1.0;
    out.colour = select(vec3f(1.0, 0.99, 0.96) * 1.25, vec3f(1.0, 0.98, 0.94) * 1.55 * s.refracts, atExit);
    out.kind = 2.0;
    return out;
  }

  let axis = normalize(tip - origin);
  let normal = vec2f(-axis.y, axis.x);
  let halfWidth = mix(halfWidthNear, halfWidthFar, corner.x);
  let world = mix(origin, tip, corner.x) + normal * corner.y * halfWidth;

  var out: VertexOut;
  out.position = to_clip(vec3f(world, 0.0), resolution, shear);
  out.lateral = corner.y;
  out.along = corner.x;
  out.colour = colour;
  out.kind = kind;
  return out;
}

@fragment
fn fs_main(in: VertexOut) -> @location(0) vec4f {
  if (in.kind > 1.5) {
    // Billboard: a radial falloff, bright at the centre, gone by the edge.
    let r = length(vec2f(in.along, in.lateral));
    let glow = exp(-r * r * 7.0) * 0.55 + exp(-r * r * 34.0) * 0.9;
    return vec4f(in.colour * glow, 1.0);
  }

  // A hard bright core inside a soft halo: two Gaussians across the quad, which is why the edge never steps.
  let v = in.lateral;
  let core = exp(-v * v * 190.0);
  let halo = exp(-v * v * 7.0);
  var profile = core * 2.9 + halo * 0.34;
  if (in.kind > 0.5) {
    // Fan ribbons are wider and dimmer: they overlap their neighbours to make one continuous spectrum.
    profile = exp(-v * v * 5.5) * 0.75 + exp(-v * v * 26.0) * 0.55;
    // The spectrum keeps going to the edge of the frame, dimming as it spreads.
    profile *= mix(1.0, 0.22, smoothstep(0.0, 0.75, in.along));
  } else {
    // The shaft brightens as it approaches the glass; the segment inside brightens toward the far wall.
    profile *= mix(0.55, 1.0, in.along);
  }
  return vec4f(in.colour * profile, 1.0);
}
