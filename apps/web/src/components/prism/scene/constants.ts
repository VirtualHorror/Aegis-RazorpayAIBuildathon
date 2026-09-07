/**
 * Scene definition for the prism hero, ported from `vercel-labs/vgpu`
 * (`apps/docs/app/[lang]/(home)/components/prism-background/types.ts`).
 *
 * Intent: one set of numbers read twice. `z = 0` is the wall — a flat plane facing the camera, `x`
 * growing right and `y` growing up, centred on the origin. The CPU solves the spectral ray bundle in
 * that plane (`optics.ts`), turns its finite width into wavelength-connected mesh sheets
 * (`light-mesh.ts`), and `prism-mesh.ts` extrudes the same triangle towards the viewer by
 * `PRISM_DEPTH`. That shared cross-section is what keeps the rainbow registered with the object that
 * made it.
 *
 * Flow: four decisions produce everything else — how big the prism is (`PRISM_SIDE`), how it is
 * tilted (`PRISM_TILT_DEGREES`), how steeply the beam arrives (`PRISM_INCIDENCE_DEGREES`) and how far
 * away the lamp sits (`PRISM_LAMP_DISTANCE`). The vertices only follow from them.
 *
 * Aegis runs vgpu's *low* quality tier — 64 wavelengths x 12 beam slices = 23,040 vertices, two bloom
 * scales — which is the tier vgpu.sh's own debug graph shows. A merchant dashboard hero has no budget
 * for the 128 x 24 tier, and the picture is indistinguishable at this size (D-087).
 */

export type Vec2 = readonly [number, number];
export type Vec3 = readonly [number, number, number];

export interface Triangle {
  readonly a: Vec2;
  readonly b: Vec2;
  readonly c: Vec2;
}

export interface CollimatedLight {
  /** Emitter center, in scene units. */
  readonly center: Vec2;
  /** Unit direction the beam is aimed in. */
  readonly direction: Vec2;
  /** Half the physical width of the collimated beam, perpendicular to its axis. */
  readonly beamHalfWidth: number;
}

/**
 * Cauchy dispersion, `n(l) = base + strength / l^2` with `l` in micrometres. Real crown and flint
 * glasses open a 1.6-7.3 degree fan through this prism, which is honestly what a prism this size does
 * over a throw this short. The stylized preset keeps the geometry and only widens `strength`, opening
 * the fan far enough to read as a rainbow. It is vgpu's own homepage default.
 */
export interface DispersionPreset {
  readonly base: number;
  readonly strength: number;
}

export const PRISM_DISPERSION: DispersionPreset = { base: 1.2, strength: 0.1 };

const radians = (degrees: number): number => (degrees * Math.PI) / 180;

function rotate(point: Vec2, angle: number): Vec2 {
  const cosine = Math.cos(angle);
  const sine = Math.sin(angle);
  return [point[0] * cosine - point[1] * sine, point[0] * sine + point[1] * cosine];
}

/** Side length of the equilateral prism, in scene units. */
export const PRISM_SIDE = 0.57;
/** Upright from the resting front camera, so the solid reads as a triangle. */
export const PRISM_TILT_DEGREES = 0;
/** The prism stands at the middle of the wall so the fan has a whole quadrant to open into. */
export const PRISM_CENTROID: Vec2 = [0, 0];

/**
 * Equilateral prism, apex up, wound counter-clockwise.
 *
 * The winding matters: `optics.ts` takes each edge's outward normal to be `(edge.y, -edge.x)`, which
 * only points out of the triangle for counter-clockwise vertices.
 */
export const PRISM_TRIANGLE: Triangle = (() => {
  const circumradius = PRISM_SIDE / Math.sqrt(3);
  const vertex = (degrees: number): Vec2 => {
    const spun = rotate([circumradius, 0], radians(degrees + PRISM_TILT_DEGREES));
    return [PRISM_CENTROID[0] + spun[0], PRISM_CENTROID[1] + spun[1]];
  };
  return { a: vertex(90), b: vertex(210), c: vertex(330) };
})();

/** Full beam width in scene units, measured perpendicular to its axis. */
export const PRISM_BEAM_WIDTH = 0.025;

/**
 * How far outside the frame the lamp sits — and the reason there is a rainbow at all.
 *
 * Dispersion spreads this glass by about 16 degrees, so any angular blur wider than that washes the
 * fan back to white, and a nearby lamp is exactly that blur: rays reaching different parts of the
 * entry face arrive at different angles of incidence. At 6.5 units the beam is collimated to about
 * 1.3 degrees per wavelength and the colours separate.
 */
export const PRISM_LAMP_DISTANCE = 6.5;

/**
 * Angle of incidence on the entry face, in degrees, for the resting view.
 *
 * A 60-degree apex forces the two internal angles to sum to 60, so a beam that enters too straight-on
 * meets the exit face beyond the critical angle, reflects internally and leaves through the base
 * instead — draining that wavelength out of the fan. 60 degrees keeps the whole spectrum on the exit
 * face with a comfortable margin.
 */
export const PRISM_INCIDENCE_DEGREES = 60;

/** Incidence endpoints the pointer's vertical position sweeps between. */
export const PRISM_BEAM_MOUSE_Y = { top: -35, bottom: 75 } as const;

/** The neutral shot sits at the vertical centre of the viewport. */
export const PRISM_DEFAULT_ARC = 0.5;

/** Visible wavelength range the continuous spectral mesh subdivides, in nanometres. */
export const PRISM_WAVELENGTHS = { min: 400, max: 700 } as const;

/** Wavelength vertices connected into the smooth spectral mesh (vgpu's low tier). */
export const PRISM_SPECTRAL_SAMPLES = 64;

/** Additive sheets that integrate the finite width of the collimated beam (vgpu's low tier). */
export const PRISM_BEAM_SLICES = 12;

/** Display exposure for the finite spectral integral the mesh represents. */
export const PRISM_LIGHT_EXPOSURE = 88;

/** Internal reflections a ray may take before the analytic solver gives up. */
export const PRISM_MAX_INTERNAL_BOUNCES = 3;

/**
 * How far the triangle is extruded off the wall, towards the camera. Enough for the side faces to
 * catch the studio environment and read as a block of glass; little enough that the scene still reads
 * as one compact prism.
 */
export const PRISM_DEPTH = 0.3;

/** Gap between the prism's back face and the wall; coplanar geometry would z-fight. */
export const PRISM_WALL_GAP = 0.015;

/** The prism occupies `z` in [`PRISM_BACK_Z`, `PRISM_FRONT_Z`]; the wall is `z = 0`. */
export const PRISM_BACK_Z = PRISM_WALL_GAP;
export const PRISM_FRONT_Z = PRISM_WALL_GAP + PRISM_DEPTH;
/** The emissive light sheet crosses halfway between the two glass interfaces. */
export const PRISM_LIGHT_PLANE_Z = (PRISM_BACK_Z + PRISM_FRONT_Z) * 0.5;

/** Index of refraction and Beer-Lambert absorption per scene unit, in linear RGB. */
export const PRISM_GLASS = {
  ior: 1.645,
  absorption: [1, 1, 0.54] as Vec3,
  reflectionStrength: 2.14,
  environmentExposure: 2.3,
  /** XYZ rotation of the studio environment, in degrees. */
  environmentRotation: [0, 0, 0] as Vec3,
} as const;

/** Visual attenuation of the finite light sheet (vgpu's defaults). */
export const PRISM_LIGHT_FADE = {
  beamOpacity: 1,
  edgeFalloff: 16,
  rainbowFalloffRate: 3.8,
  rainbowFalloffPower: 3.7,
} as const;

/**
 * Bloom look. `bloomRadius` is already normalised to [0, 1]: vgpu maps its public 0.25-3 range onto
 * that blend, and 0.25 — its default — is the near end. `bloomStrength` is the low tier's value,
 * which vgpu substitutes for the high tier's 0.7 whenever it drops a quality step.
 */
export const PRISM_POSTPROCESS = {
  bloomStrength: 0.15,
  bloomThreshold: 0.1,
  bloomRadius: 0,
} as const;

/** Vertical field of view of the camera looking at the wall, in degrees. */
export const CAMERA_FOV_DEGREES = 48;
export const CAMERA_DISTANCE = 1.25;
export const CAMERA_YAW_DEGREES = 0;
export const CAMERA_PITCH_DEGREES = 0;
/** Widest angle the pointer can swing the camera off its resting view, in degrees. */
export const CAMERA_ORBIT_DEGREES = 3.5;
/** Per-frame interpolation towards the pointer's camera angle and lamp position. */
export const CAMERA_ORBIT_LERP = 0.08;
export const LAMP_AIM_LERP = 0.12;

/** Point along the entry edge, ordered left-to-right as it appears on screen. */
export function prismEntryPoint(position: number): Vec2 {
  const clamped = Math.min(1, Math.max(0, position));
  return [
    PRISM_TRIANGLE.a[0] + (PRISM_TRIANGLE.c[0] - PRISM_TRIANGLE.a[0]) * clamped,
    PRISM_TRIANGLE.a[1] + (PRISM_TRIANGLE.c[1] - PRISM_TRIANGLE.a[1]) * clamped,
  ];
}

/** A finite collimated beam emitted from one point and aimed at another. */
export function collimatedLightBetween(center: Vec2, target: Vec2, beamWidth = PRISM_BEAM_WIDTH): CollimatedLight {
  const offset: Vec2 = [target[0] - center[0], target[1] - center[1]];
  const distance = Math.hypot(offset[0], offset[1]);
  if (!Number.isFinite(distance) || distance <= 1e-8) {
    throw new Error("A collimated light needs distinct finite center and target points.");
  }
  return {
    center,
    direction: [offset[0] / distance, offset[1] / distance],
    beamHalfWidth: beamWidth * 0.5,
  };
}

/**
 * The lamp for a given angle of incidence on the entry face.
 *
 * Intent: the prism never moves. The lamp swings around it on a fixed radius, always aimed at a point
 * along the entry face, so the pointer changes the incidence and the point of impact independently.
 *
 * Flow: take the entry face A->C, turn its outward normal inward (a beam along it strikes the face
 * head on, at zero incidence), rotate by -incidence so the white beam arrives from the right and its
 * dispersed output heads left, then back the lamp off along that direction by `PRISM_LAMP_DISTANCE`.
 * The entry margin keeps both finite beam boundaries on the face even at the extremes of the sweep,
 * where their footprint along it grows by 1 / cos(incidence).
 */
export function lampForIncidence(
  incidenceDegrees: number,
  beamWidth = PRISM_BEAM_WIDTH,
  entryPosition = 0.5,
): CollimatedLight {
  const face: Vec2 = [PRISM_TRIANGLE.a[0] - PRISM_TRIANGLE.c[0], PRISM_TRIANGLE.a[1] - PRISM_TRIANGLE.c[1]];
  const faceLength = Math.hypot(face[0], face[1]);
  const inward: Vec2 = [-face[1] / faceLength, face[0] / faceLength];
  const direction = rotate(inward, radians(-incidenceDegrees));
  const entryMargin = Math.min(
    0.45,
    beamWidth / (2 * faceLength * Math.max(0.05, Math.abs(Math.cos(radians(incidenceDegrees))))) + 1e-4,
  );
  const entryPoint = prismEntryPoint(Math.min(1 - entryMargin, Math.max(entryMargin, entryPosition)));
  return collimatedLightBetween(
    [entryPoint[0] - direction[0] * PRISM_LAMP_DISTANCE, entryPoint[1] - direction[1] * PRISM_LAMP_DISTANCE],
    entryPoint,
    beamWidth,
  );
}

/**
 * Incidence for a normalized pointer height, hinged on the resting angle at the viewport's centre so
 * the two halves of the sweep can have different spans.
 */
export function incidenceAt(position: number): number {
  const clamped = Math.min(1, Math.max(0, position));
  if (clamped <= 0.5) {
    return PRISM_BEAM_MOUSE_Y.top + (PRISM_INCIDENCE_DEGREES - PRISM_BEAM_MOUSE_Y.top) * clamped * 2;
  }
  return (
    PRISM_INCIDENCE_DEGREES + (PRISM_BEAM_MOUSE_Y.bottom - PRISM_INCIDENCE_DEGREES) * (clamped - 0.5) * 2
  );
}

/** The lamp for a normalized pointer position: height swings the source, width chooses the impact. */
export function lampAt(arcPosition = PRISM_DEFAULT_ARC, targetPosition = 0.5): CollimatedLight {
  return lampForIncidence(incidenceAt(arcPosition), PRISM_BEAM_WIDTH, targetPosition);
}
