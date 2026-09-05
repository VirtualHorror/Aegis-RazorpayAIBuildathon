"use client";

/**
 * Who is clicking. Decisions are audited with `decided_by` (C-B2), so the dashboard asks for a name once and keeps it
 * in localStorage; the default makes the origin obvious in `audit_log` without pretending to know the person.
 */
import { useSyncExternalStore } from "react";

export const DEFAULT_ACTOR = "human:dashboard";
const KEY = "aegis.actor";
const listeners = new Set<() => void>();

function read(): string {
  try {
    const value = window.localStorage.getItem(KEY);
    return value && value.trim().length > 0 ? value : DEFAULT_ACTOR;
  } catch {
    // Storage can be blocked (private mode, disabled site data); the default keeps decisions attributable.
    return DEFAULT_ACTOR;
  }
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  window.addEventListener("storage", listener);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", listener);
  };
}

export function setActor(value: string): void {
  const next = value.trim();
  try {
    if (next.length === 0) window.localStorage.removeItem(KEY);
    else window.localStorage.setItem(KEY, next);
  } catch {
    // Same as read(): a blocked store only loses the convenience, never the decision.
  }
  for (const listener of [...listeners]) listener();
}

export function useActor(): string {
  return useSyncExternalStore(subscribe, read, () => DEFAULT_ACTOR);
}
