/**
 * Retained GPU identities and the mutable optical state the pointer drives. Ported from
 * `vercel-labs/vgpu` (`apps/docs/.../prism-background/runtime/{resources,state}.ts`), collapsed to the
 * one quality tier and the one theme Aegis ships.
 *
 * Intent: nothing here is allocated per frame. The light mesh is rebuilt on the CPU whenever the lamp
 * moves — that is the price of the mesh approach, and it is paid once per pointer step rather than once
 * per pixel — and written straight back into the same vertex buffer and the same scratch array.
 */

import type { Buffer, Geometry, GeometryLike, Gpu } from "vgpu";
import { sampler } from "vgpu";

import { cameraView, lightWallExtent, type CameraView } from "../scene/camera";
import {
  CAMERA_DISTANCE,
  CAMERA_FOV_DEGREES,
  PRISM_DEFAULT_ARC,
  PRISM_DISPERSION,
  PRISM_LIGHT_FADE,
  lampAt,
} from "../scene/constants";
import {
  buildLightMesh,
  LIGHT_MESH_LAYOUT,
  LIGHT_VERTEX_FLOATS,
  LIGHT_VERTEX_STRIDE,
  type LightMeshLayout,
  type LightMeshStats,
} from "../scene/light-mesh";
import { prismGeometry } from "../scene/prism-mesh";
import {
  createEnvironmentSampler,
  createEnvironmentTexture,
  destroyEnvironmentTexture,
  prepareEnvironmentTexture,
  type EnvironmentTexture,
} from "./environment";

export interface PrismRuntime {
  readonly gpu: Gpu;
  readonly label: string;
  readonly lightBuffer: Buffer;
  readonly lightVertexScratch: number[];
  readonly lightVertices: Float32Array<ArrayBuffer>;
  readonly lightGeometry: GeometryLike;
  readonly lightMeshLayout: LightMeshLayout;
  readonly prism: Geometry;
  readonly sceneSampler: GPUSampler;
  readonly environmentSampler: GPUSampler;
  environment?: EnvironmentTexture;
  environmentReady?: Promise<void>;
  outputSize: readonly [number, number];
  lightStats: LightMeshStats;
  /** Normalized pointer height, 0 at the top of the canvas: swings the lamp around the prism. */
  lampArc: number;
  /** Normalized pointer width: chooses the point of impact along the entry face. */
  lampTarget: number;
  orbit: readonly [number, number];
  aspect: number;
  view: CameraView;
}

export function createPrismRuntime(gpu: Gpu, output: readonly [number, number], label: string): PrismRuntime {
  const aspect = output[0] / Math.max(1, output[1]);
  const lightVertexScratch: number[] = [];
  const initialMesh = buildLightMesh(
    {
      light: lampAt(PRISM_DEFAULT_ARC, 0.5),
      dispersion: PRISM_DISPERSION,
      edgeFalloff: PRISM_LIGHT_FADE.edgeFalloff,
      wallHalfExtent: lightWallExtent(aspect),
    },
    undefined,
    lightVertexScratch,
  );
  const lightBuffer = gpu.device.createBuffer({
    size: LIGHT_MESH_LAYOUT.vertexCount * LIGHT_VERTEX_STRIDE,
    usage: ["vertex", "copy_dst"],
    label: `${label}.light-vertices`,
  });
  lightBuffer.write(initialMesh.vertices);

  return {
    gpu,
    label,
    outputSize: output,
    lightBuffer,
    lightVertexScratch,
    lightVertices: initialMesh.vertices,
    lightMeshLayout: LIGHT_MESH_LAYOUT,
    // `light.wgsl` reads position at location 0 and intensity at location 3; everything else about a
    // light vertex is reconstructed from `@builtin(vertex_index)` and never uploaded.
    lightGeometry: {
      vertexBuffers: [lightBuffer.gpu],
      vertexBufferLayouts: [
        {
          arrayStride: LIGHT_VERTEX_STRIDE,
          attributes: [
            { shaderLocation: 0, offset: 0, format: "float32x2" },
            { shaderLocation: 3, offset: 8, format: "float32" },
          ],
        },
      ],
      vertexCount: LIGHT_MESH_LAYOUT.vertexCount,
    },
    prism: prismGeometry(gpu, `${label}.prism`),
    sceneSampler: sampler(gpu, {
      minFilter: "linear",
      magFilter: "linear",
      addressModeU: "clamp-to-edge",
      addressModeV: "clamp-to-edge",
    }),
    environmentSampler: createEnvironmentSampler(gpu),
    lightStats: initialMesh.stats,
    lampArc: PRISM_DEFAULT_ARC,
    lampTarget: 0.5,
    orbit: [0, 0],
    aspect,
    view: cameraView(aspect, 0, 0, CAMERA_DISTANCE, CAMERA_FOV_DEGREES),
  };
}

/** Bakes the studio environment once; every later call awaits the same promise. */
export function prepareRuntimeEnvironment(runtime: PrismRuntime): Promise<void> {
  if (runtime.environmentReady) return runtime.environmentReady;
  runtime.environment ??= createEnvironmentTexture(runtime.gpu, `${runtime.label}.environment-studio`);
  runtime.environmentReady = prepareEnvironmentTexture(
    runtime.gpu,
    runtime.environment,
    runtime.environmentSampler,
  );
  return runtime.environmentReady;
}

export function setRuntimeLampAim(runtime: PrismRuntime, arcPosition: number, targetPosition: number): void {
  const nextArc = Math.min(1, Math.max(0, arcPosition));
  const nextTarget = Math.min(1, Math.max(0, targetPosition));
  if (nextArc === runtime.lampArc && nextTarget === runtime.lampTarget) return;
  runtime.lampArc = nextArc;
  runtime.lampTarget = nextTarget;
  refreshLightMesh(runtime);
}

export function setRuntimeOrbit(runtime: PrismRuntime, x: number, y: number): void {
  runtime.orbit = [Math.min(1, Math.max(-1, x)), Math.min(1, Math.max(-1, y))];
  refreshCamera(runtime);
}

export function resizeRuntime(runtime: PrismRuntime, output: readonly [number, number]): void {
  if (runtime.outputSize[0] === output[0] && runtime.outputSize[1] === output[1]) return;
  runtime.outputSize = output;
  runtime.aspect = output[0] / Math.max(1, output[1]);
  refreshCamera(runtime);
  refreshLightMesh(runtime);
}

export function destroyPrismRuntime(runtime: PrismRuntime): void {
  destroyEnvironmentTexture(runtime.environment);
  runtime.environment = undefined;
  runtime.environmentReady = undefined;
  runtime.lightBuffer.destroy();
  runtime.prism.destroy();
}

function refreshCamera(runtime: PrismRuntime): void {
  runtime.view = cameraView(
    runtime.aspect,
    runtime.orbit[0],
    runtime.orbit[1],
    CAMERA_DISTANCE,
    CAMERA_FOV_DEGREES,
  );
}

function refreshLightMesh(runtime: PrismRuntime): void {
  const mesh = buildLightMesh(
    {
      light: lampAt(runtime.lampArc, runtime.lampTarget),
      dispersion: PRISM_DISPERSION,
      edgeFalloff: PRISM_LIGHT_FADE.edgeFalloff,
      wallHalfExtent: lightWallExtent(runtime.aspect),
    },
    runtime.lightVertices,
    runtime.lightVertexScratch,
  );
  runtime.lightBuffer.write(runtime.lightVertices);
  runtime.lightStats = mesh.stats;
}

/** Floats in one light-mesh upload, exposed so tests can assert the buffer size matches the layout. */
export const LIGHT_MESH_FLOATS = LIGHT_MESH_LAYOUT.vertexCount * LIGHT_VERTEX_FLOATS;
