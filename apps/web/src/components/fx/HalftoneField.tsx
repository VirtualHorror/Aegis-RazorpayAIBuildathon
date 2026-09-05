"use client";

import { useEffect, useRef } from "react";
import { halftoneCells } from "./halftone";

export interface HalftoneFieldProps {
  /** Grid pitch in CSS pixels. */
  pitch?: number;
  /** Dot colour; defaults to the element's CSS `color` (theme foreground). */
  color?: string;
  /** 0..1 — the events page raises it when new events arrive. */
  intensity?: number;
  /** Time multiplier. */
  speed?: number;
  className?: string;
}

const TARGET_FPS = 30;
const MAX_DPR = 1.5;

/**
 * Warp-style halftone: a dot matrix on which a flowing field "prints" shapes that dissolve as it passes (Design.md §5.2).
 * Flow: size the canvas (DPR ≤ 1.5) -> requestAnimationFrame throttled to 30 fps -> skip frames while offscreen or the
 *       tab is hidden -> under prefers-reduced-motion draw one frame and stop. Decorative: `aria-hidden`.
 */
export function HalftoneField({ pitch = 14, color, intensity = 0.6, speed = 1, className = "" }: HalftoneFieldProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const intensityRef = useRef(intensity);

  useEffect(() => {
    intensityRef.current = intensity;
  }, [intensity]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const context = canvas.getContext("2d");
    if (!context) return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
    let width = 0;
    let height = 0;
    let dpr = 1;
    let visible = true;
    let running = true;
    let raf = 0;
    let last = 0;

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR);
      width = Math.max(1, Math.floor(rect.width));
      height = Math.max(1, Math.floor(rect.height));
      canvas.width = Math.floor(width * dpr);
      canvas.height = Math.floor(height * dpr);
    };

    const draw = (t: number) => {
      context.setTransform(dpr, 0, 0, dpr, 0, 0);
      context.clearRect(0, 0, width, height);
      context.fillStyle = color ?? getComputedStyle(canvas).color;
      const half = pitch / 2;
      context.beginPath();
      for (const cell of halftoneCells(width, height, pitch, t, intensityRef.current)) {
        if (cell.merged) {
          context.rect(cell.x - half, cell.y - half, pitch, pitch);
        } else {
          context.moveTo(cell.x + cell.radius, cell.y);
          context.arc(cell.x, cell.y, cell.radius, 0, Math.PI * 2);
        }
      }
      context.fill();
    };

    const frame = (now: number) => {
      if (!running) return;
      raf = requestAnimationFrame(frame);
      if (!visible || document.hidden) return;
      if (now - last < 1000 / TARGET_FPS) return;
      last = now;
      draw((now / 1000) * speed);
    };

    const start = () => {
      cancelAnimationFrame(raf);
      if (reduced.matches) {
        draw(1.3);
        return;
      }
      raf = requestAnimationFrame(frame);
    };

    const resizeObserver = new ResizeObserver(() => {
      resize();
      draw(reduced.matches ? 1.3 : (performance.now() / 1000) * speed);
    });
    resizeObserver.observe(canvas);
    const intersectionObserver = new IntersectionObserver((entries) => {
      visible = entries[0]?.isIntersecting ?? true;
    });
    intersectionObserver.observe(canvas);

    resize();
    start();
    reduced.addEventListener("change", start);
    return () => {
      running = false;
      cancelAnimationFrame(raf);
      resizeObserver.disconnect();
      intersectionObserver.disconnect();
      reduced.removeEventListener("change", start);
    };
  }, [pitch, color, speed]);

  return <canvas ref={canvasRef} aria-hidden="true" className={`block h-full w-full text-fg ${className}`} />;
}
