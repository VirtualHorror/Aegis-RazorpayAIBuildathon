/**
 * The authoritative pass order, ported from `vercel-labs/vgpu`
 * (`apps/docs/.../prism-background/pipelines/dark/render.ts`).
 *
 * Flow — this is the graph vgpu.sh's debug mode draws, top to bottom:
 *
 *   Pass A  "back and light", into `backgroundTarget` (HDR)
 *     1. Exterior light  — the white beam quads and the outgoing spectral fan, additive.
 *     2. Back glass      — `glass-back.wgsl`, front-culled, premultiplied Fresnel over that light.
 *     3. Internal light  — each wavelength's strip *inside* the glass, additive, so it reads as
 *                          light in the solid rather than in front of it.
 *   Pass B  "front glass", into `sceneTarget` (HDR, 4x MSAA)
 *     4. Copy pass A forward, then `glass.wgsl` refracts that resolved image through the near face.
 *   Bloom
 *     5. Extract highlights, then two half-resolution levels, each horizontal then vertical.
 *     6. Composite the two levels into one half-resolution halo.
 *   Presentation
 *     7. `present.wgsl` adds the halo to the untouched HDR scene, ACES-maps it and encodes sRGB into
 *        the retained `presentationTarget`.
 *     8. The surface gets an exact copy of that, plus the instanced dust quads on top.
 *
 * Steps 1-7 are skipped entirely when `updateScene` is false: the retained presentation target still
 * holds the settled picture, so an idle frame is one copy and one instanced draw.
 */

import type { Frame, Target } from "vgpu";

import { DUST_PARTICLE_COUNT, type PrismGraph } from "./pipeline";

export interface RenderOptions {
  readonly updateScene: boolean;
}

export function renderPrismGraph(
  current: Frame,
  graph: PrismGraph,
  output: Target,
  options: RenderOptions,
): void {
  const { backgroundTarget, sceneTarget, bloomTargets, presentationTarget } = graph;
  if (!backgroundTarget || !sceneTarget || !bloomTargets || !presentationTarget) {
    throw new Error("ensurePrismTargets() must run before renderPrismGraph().");
  }
  const light = graph.lightMeshLayout;

  if (options.updateScene) {
    current.pass({ target: backgroundTarget, clear: [0, 0, 0, 1] }, (pass) => {
      pass.draw(graph.light, { firstVertex: 0, vertices: light.whiteVertices });
      pass.draw(graph.light, {
        firstVertex: light.outgoingFirstVertex,
        vertices: light.outgoingVertices,
      });
      pass.draw(graph.glassBack);
      pass.draw(graph.light, {
        firstVertex: light.internalFirstVertex,
        vertices: light.internalVertices,
      });
    });

    current.pass({ target: sceneTarget, clear: [0, 0, 0, 1] }, (pass) => {
      pass.draw(graph.copyBackground);
      pass.draw(graph.glassFront);
    });

    current.pass({ target: bloomTargets[0]!.vertical, clear: [0, 0, 0, 1] }, (pass) =>
      pass.draw(graph.bloomExtract),
    );
    bloomTargets.forEach((level, index) => {
      current.pass({ target: level.horizontal, clear: [0, 0, 0, 1] }, (pass) =>
        pass.draw(graph.bloomBlur[index]!.horizontal),
      );
      current.pass({ target: level.vertical, clear: [0, 0, 0, 1] }, (pass) =>
        pass.draw(graph.bloomBlur[index]!.vertical),
      );
    });
    // The composite lands in level 0's horizontal target, which has already been consumed.
    current.pass({ target: bloomTargets[0]!.horizontal, clear: [0, 0, 0, 1] }, (pass) =>
      pass.draw(graph.bloomComposite),
    );

    current.pass({ target: presentationTarget, clear: [0, 0, 0, 1] }, (pass) =>
      pass.draw(graph.present),
    );
  }

  current.pass({ target: output }, (pass) => {
    pass.draw(graph.copyPresentation);
    pass.draw(graph.dust, { instances: DUST_PARTICLE_COUNT });
  });
}
