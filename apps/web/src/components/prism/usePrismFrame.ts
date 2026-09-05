"use client";

import { useEffect, useRef, useState } from "react";
import { prismGeometry, type Point, type PrismScene } from "./prismGeometry";

export interface PrismFrameState {
  /** Size in CSS pixels; zero until the element is measured. */
  readonly width: number;
  readonly height: number;
  readonly dpr: number;
  readonly reducedMotion: boolean;
  readonly visible: boolean;
}

/**
 * Everything both renderers need from the DOM: element size, device pixel ratio capped at 2, the pointer, whether the
 * canvas is on screen, and the motion preference (Design.md §5.1, C-F4).
 * Flow: observe size -> track the pointer with a resting fallback -> pause offscreen or when the tab is hidden.
 */
export function usePrismFrame(ref: React.RefObject<HTMLCanvasElement | null>): {
  state: PrismFrameState;
  pointerRef: React.RefObject<Point | null>;
  sceneOf: (width: number, height: number) => PrismScene;
} {
  const pointerRef = useRef<Point | null>(null);
  const [state, setState] = useState<PrismFrameState>({ width: 0, height: 0, dpr: 1, reducedMotion: false, visible: true });

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");

    const measure = () => {
      const rect = canvas.getBoundingClientRect();
      setState((current) => {
        const next = {
          width: Math.max(1, Math.round(rect.width)),
          height: Math.max(1, Math.round(rect.height)),
          dpr: Math.min(window.devicePixelRatio || 1, 2),
          reducedMotion: reduced.matches,
          visible: current.visible,
        };
        return next.width === current.width && next.height === current.height && next.dpr === current.dpr && next.reducedMotion === current.reducedMotion ? current : next;
      });
    };

    const resizeObserver = new ResizeObserver(measure);
    resizeObserver.observe(canvas);
    const intersectionObserver = new IntersectionObserver((entries) => {
      const visible = entries[0]?.isIntersecting ?? true;
      setState((current) => (current.visible === visible ? current : { ...current, visible }));
    });
    intersectionObserver.observe(canvas);

    const onPointerMove = (event: PointerEvent) => {
      const rect = canvas.getBoundingClientRect();
      pointerRef.current = { x: event.clientX - rect.left, y: event.clientY - rect.top };
    };
    const onPointerLeave = () => {
      pointerRef.current = null;
    };
    canvas.addEventListener("pointermove", onPointerMove);
    canvas.addEventListener("pointerleave", onPointerLeave);
    reduced.addEventListener("change", measure);
    measure();

    return () => {
      resizeObserver.disconnect();
      intersectionObserver.disconnect();
      canvas.removeEventListener("pointermove", onPointerMove);
      canvas.removeEventListener("pointerleave", onPointerLeave);
      reduced.removeEventListener("change", measure);
    };
  }, [ref]);

  return {
    state,
    pointerRef,
    sceneOf: (width: number, height: number) => prismGeometry({ width, height, pointer: pointerRef.current }),
  };
}
