// The prism as a mesh: a triangular prism generated in the vertex stage, shaded as glass against the environment map.
// Flow: vertex_index -> one of eight triangles (two caps, three sides) -> oblique projection -> fragment shades with
//       a Fresnel mix of an environment reflection and a refraction through the body, plus a grazing edge line.
// Draw order does the depth work: the far half is drawn first, then the near half, so the back faces read through
// the front ones the way glass does. No depth buffer, no sorting.
import { Scene, build_scene, to_clip, depth_shear, N_RED } from "./optics.wgsl";

struct Params {
  // x, y: viewport in CSS pixels. z: seconds. w: device pixel ratio.
  resolution_time: vec4f,
  // x, y: eased pointer in 0..1 of the canvas. z: 1 while it is over the canvas.
  pointer: vec4f,
  // x: 0 draws the far half of the solid, 1 the near half.
  half_info: vec4f,
}

@group(0) @binding(0) var<uniform> params: Params;
@group(0) @binding(1) var env_tex: texture_2d<f32>;
@group(0) @binding(2) var env_sampler: sampler;

struct VertexOut {
  @builtin(position) position: vec4f,
  @location(0) normal: vec3f,
  @location(1) world: vec3f,
  @location(2) faceKind: f32,
}

/** Direction to the equirectangular lookup the environment pass wrote. */
fn env_uv(direction: vec3f) -> vec2f {
  let d = normalize(direction);
  return vec2f(atan2(d.z, d.x) / 6.2831853 + 0.5, acos(clamp(d.y, -1.0, 1.0)) / 3.1415927);
}

fn sample_env(direction: vec3f) -> vec3f {
  return textureSampleLevel(env_tex, env_sampler, env_uv(direction), 0.0).rgb;
}

@vertex
fn vs_main(@builtin(vertex_index) vertexIndex: u32) -> VertexOut {
  let resolution = params.resolution_time.xy;
  let s = build_scene(resolution, params.pointer.xy);
  let shear = depth_shear();
  let far = params.half_info.x < 0.5;
  // The cross-section, and the two rings of vertices the solid is built from.
  var corners = array<vec2f, 3>(s.apex, s.right, s.left);

  let triangleIndex = vertexIndex / 3u;
  let corner = vertexIndex % 3u;
  var world = vec3f(0.0);
  var normal = vec3f(0.0, 0.0, 1.0);
  var faceKind = 0.0;

  if (triangleIndex == 0u) {
    // Cap. The far half draws the back cap, the near half the front one.
    let z = select(s.halfDepth, -s.halfDepth, far);
    // Winding is flipped between the two caps so both face the viewer's side of the solid.
    let order = select(corner, 2u - corner, far);
    world = vec3f(corners[order], z);
    normal = vec3f(0.0, 0.0, select(1.0, -1.0, far));
    faceKind = 0.0;
  } else {
    // Sides: three quads, two triangles each, indexed 1..6.
    let side = (triangleIndex - 1u) / 2u;
    let half = (triangleIndex - 1u) % 2u;
    let a = corners[side];
    let b = corners[(side + 1u) % 3u];
    let edgeNormal = normalize(vec2f((b - a).y, -(b - a).x));
    let outward = select(-edgeNormal, edgeNormal, dot(edgeNormal, a - s.centroid) > 0.0);
    // A side belongs to the far half when it points away from the direction the depth shear leans.
    let facesAway = dot(outward, shear) < 0.0;
    if (facesAway != far) {
      // Not this half: collapse the triangle so it rasterises nothing.
      var out: VertexOut;
      out.position = vec4f(0.0, 0.0, 0.0, 1.0);
      out.normal = vec3f(0.0, 0.0, 1.0);
      out.world = vec3f(0.0);
      out.faceKind = 1.0;
      return out;
    }
    var quad = array<vec3f, 4>(
      vec3f(a, -s.halfDepth), vec3f(b, -s.halfDepth), vec3f(b, s.halfDepth), vec3f(a, s.halfDepth),
    );
    var indices = array<u32, 6>(0u, 1u, 2u, 0u, 2u, 3u);
    world = quad[indices[half * 3u + corner]];
    normal = vec3f(outward, 0.0);
    faceKind = 1.0;
  }

  var out: VertexOut;
  out.position = to_clip(world, resolution, shear);
  out.normal = normal;
  out.world = world;
  out.faceKind = faceKind;
  return out;
}

@fragment
fn fs_main(in: VertexOut) -> @location(0) vec4f {
  let normal = normalize(in.normal);
  // The oblique projection is a fixed view: the eye looks down +z, sheared the same way the geometry is.
  let view = normalize(vec3f(-depth_shear() * 0.35, 1.0));
  // Two-sided: we look through this solid, so a face pointing away is still glass seen from behind, not a mirror.
  // Clamping instead of taking the magnitude drove every back face to a full Fresnel and turned the prism to chrome.
  let facing = clamp(abs(dot(normal, view)), 0.0, 1.0);
  // Schlick, with a low base so the body stays dark and only the grazing angles light up.
  let fresnel = 0.04 + 0.96 * pow(1.0 - facing, 5.0);

  let reflection = sample_env(reflect(-view, normal));
  var transmitted = refract(-view, normal, 1.0 / N_RED);
  if (dot(transmitted, transmitted) < 1e-6) {
    transmitted = reflect(-view, normal);
  }
  // What comes through the body: the environment behind, tinted by the glass and dimmed by its thickness.
  // Thick glass swallows most of what passes through it: the body stays near-black so the stage reads through it.
  let inside = sample_env(transmitted) * vec3f(0.62, 0.72, 0.95) * 0.16;

  var colour = mix(inside, reflection, fresnel);
  // The bevel: a thin bright line where the surface turns away hardest.
  colour += vec3f(0.78, 0.87, 1.0) * pow(1.0 - facing, 10.0) * 1.6;

  // Glass is mostly clear: the alpha is the Fresnel term, so the black stage shows through the middle of a face.
  let alpha = clamp(fresnel * 0.5 + 0.015, 0.0, 1.0);
  return vec4f(colour * alpha, alpha);
}
