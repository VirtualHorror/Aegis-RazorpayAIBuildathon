"use client";

import { useEffect, useRef } from "react";
import { usePrismFrame } from "./usePrismFrame";
import type { PrismScene } from "./prismGeometry";

export interface PrismRendererProps {
  /** Module key → the timestamp (ms) of its last event; pulses decay over 1.2 s. */
  activity: Readonly<Record<string, number>>;
  className?: string;
}

export const PULSE_MS = 1_200;

/** Pure: the 0..1 pulse for a module at time `now`. */
export function pulseAt(lastEventAt: number | undefined, now: number): number {
  if (!lastEventAt) return 0;
  const age = now - lastEventAt;
  if (age < 0 || age > PULSE_MS) return 0;
  return 1 - age / PULSE_MS;
}

const STARS = Array.from({ length: 90 }, (_, index) => ({
  fx: ((index * 137.508) % 360) / 360,
  fy: ((index * 97.31 + 13) % 100) / 100,
  r: 0.5 + ((index * 7) % 5) * 0.22,
}));

function drawScene(context: CanvasRenderingContext2D, scene: PrismScene, width: number, height: number, activity: Readonly<Record<string, number>>, now: number, still: boolean): void {
  context.clearRect(0, 0, width, height);
  const background = context.createRadialGradient(width * 0.5, height * 0.5, 0, width * 0.5, height * 0.5, Math.max(width, height) * 0.7);
  background.addColorStop(0, "#141a33");
  background.addColorStop(1, "#070810");
  context.fillStyle = background;
  context.fillRect(0, 0, width, height);

  context.fillStyle = "rgba(255,255,255,0.35)";
  for (const star of STARS) {
    const twinkle = still ? 1 : 0.65 + 0.35 * Math.sin(now / 700 + star.fx * 40);
    context.globalAlpha = 0.35 * twinkle;
    context.beginPath();
    context.arc(star.fx * width, star.fy * height, star.r, 0, Math.PI * 2);
    context.fill();
  }
  context.globalAlpha = 1;

  // Additive from here: overlapping beams brighten instead of covering each other (Design.md §5.1).
  context.globalCompositeOperation = "lighter";

  const [apex, right, left] = scene.triangle;
  context.beginPath();
  context.moveTo(apex.x, apex.y);
  context.lineTo(right.x, right.y);
  context.lineTo(left.x, left.y);
  context.closePath();
  context.fillStyle = "rgba(120,140,200,0.05)";
  context.fill();
  context.lineWidth = 1.5;
  context.strokeStyle = "rgba(232,234,242,0.75)";
  context.shadowBlur = 14;
  context.shadowColor = "rgba(180,200,255,0.55)";
  context.stroke();

  const line = (from: { x: number; y: number }, to: { x: number; y: number }, colour: string, lineWidth: number, blur: number) => {
    context.beginPath();
    context.moveTo(from.x, from.y);
    context.lineTo(to.x, to.y);
    context.strokeStyle = colour;
    context.lineWidth = lineWidth;
    context.shadowBlur = blur;
    context.shadowColor = colour;
    context.stroke();
  };

  line(scene.entry.from, scene.entry.to, "rgba(255,255,255,0.9)", 2, 18);
  line(scene.internal.from, scene.internal.to, "rgba(235,240,255,0.8)", 1.5, 10);
  line(scene.specular.from, scene.specular.to, "rgba(255,255,255,0.18)", 1, 6);

  for (const ray of scene.fanRays) {
    const pulse = pulseAt(activity[ray.module], now);
    line(ray.from, ray.to, ray.color, 1.5 + pulse * 2.5, 12 + pulse * 26);
  }

  context.shadowBlur = 0;
  context.globalCompositeOperation = "source-over";
}

/**
 * Canvas 2D prism: the same geometry drawn with `lineTo`, `shadowBlur` and `globalCompositeOperation: "lighter"`.
 * Used when WebGPU is unavailable, and as a single static frame under `prefers-reduced-motion` (C-F4).
 */
export function PrismCanvas2D({ activity, className = "" }: PrismRendererProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const { state, sceneOf } = usePrismFrame(canvasRef);
  // The render loop reads the freshest activity without restarting; refs are written in an effect, never in render.
  const activityRef = useRef(activity);
  useEffect(() => {
    activityRef.current = activity;
  }, [activity]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");
    if (!canvas || !context || state.width === 0) return;
    canvas.width = Math.floor(state.width * state.dpr);
    canvas.height = Math.floor(state.height * state.dpr);

    let raf = 0;
    let running = true;
    const render = (now: number) => {
      context.setTransform(state.dpr, 0, 0, state.dpr, 0, 0);
      drawScene(context, sceneOf(state.width, state.height), state.width, state.height, activityRef.current, now, state.reducedMotion);
    };

    if (state.reducedMotion) {
      render(0);
      return;
    }
    const loop = (now: number) => {
      if (!running) return;
      raf = requestAnimationFrame(loop);
      if (!state.visible || document.hidden) return;
      render(now);
    };
    raf = requestAnimationFrame(loop);
    return () => {
      running = false;
      cancelAnimationFrame(raf);
    };
  }, [state, sceneOf]);

  return <canvas ref={canvasRef} aria-hidden="true" className={`block h-full w-full ${className}`} />;
}
