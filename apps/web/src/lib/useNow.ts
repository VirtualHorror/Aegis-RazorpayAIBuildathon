"use client";

import { useSyncExternalStore } from "react";
import { formatDateTime, relativeTime } from "./format";

/**
 * A shared wall clock for relative timestamps.
 * Intent: components must not call `Date.now()` during render (React purity rule), and the server cannot know the
 *         client's clock; this store ticks every 10 s and reports `null` until hydration so server and client render
 *         the same absolute time first, then switch to "3m ago".
 */
const listeners = new Set<() => void>();
let timer: ReturnType<typeof setInterval> | null = null;
let current = 0;

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  if (timer === null) {
    current = Date.now();
    timer = setInterval(() => {
      current = Date.now();
      for (const entry of [...listeners]) entry();
    }, 10_000);
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && timer !== null) {
      clearInterval(timer);
      timer = null;
    }
  };
}

function getSnapshot(): number {
  if (current === 0) current = Date.now();
  return current;
}

const getServerSnapshot = (): number => 0;

export function useNow(): number | null {
  const now = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  return now === 0 ? null : now;
}

/** Relative when the clock is known, absolute before hydration. */
export function timeAgo(value: string | number | Date | null | undefined, now: number | null): string {
  return now === null ? formatDateTime(value) : relativeTime(value, now);
}
