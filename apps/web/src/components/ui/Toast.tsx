"use client";

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import { Icon } from "./icons";

export type ToastTone = "neutral" | "ok" | "warn" | "danger";

export interface ToastInput {
  title: string;
  body?: string;
  tone?: ToastTone;
  /** Milliseconds before auto-dismiss; 0 keeps it until dismissed or updated. */
  duration?: number;
}

interface ToastItem extends Required<Pick<ToastInput, "title" | "tone">> {
  id: number;
  body?: string;
}

export interface ToastApi {
  push: (toast: ToastInput) => number;
  update: (id: number, toast: ToastInput) => void;
  dismiss: (id: number) => void;
}

const ToastContext = createContext<ToastApi | null>(null);

const TONE_VAR: Record<ToastTone, string> = {
  neutral: "var(--accent)",
  ok: "var(--ok)",
  warn: "var(--warn)",
  danger: "var(--danger)",
};

let counter = 0;

/** Toasts announce results (`role="status"`, Design.md §8). One provider in the root layout. */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);

  const dismiss = useCallback((id: number) => setItems((list) => list.filter((item) => item.id !== id)), []);

  const schedule = useCallback(
    (id: number, duration: number | undefined) => {
      const ms = duration ?? 5_000;
      if (ms > 0) setTimeout(() => dismiss(id), ms);
    },
    [dismiss],
  );

  const push = useCallback(
    (toast: ToastInput) => {
      counter += 1;
      const id = counter;
      setItems((list) => [...list, { id, title: toast.title, body: toast.body, tone: toast.tone ?? "neutral" }]);
      schedule(id, toast.duration);
      return id;
    },
    [schedule],
  );

  const update = useCallback(
    (id: number, toast: ToastInput) => {
      setItems((list) => list.map((item) => (item.id === id ? { ...item, title: toast.title, body: toast.body, tone: toast.tone ?? item.tone } : item)));
      schedule(id, toast.duration);
    },
    [schedule],
  );

  const value = useMemo<ToastApi>(() => ({ push, update, dismiss }), [push, update, dismiss]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div role="status" aria-live="polite" className="pointer-events-none fixed inset-x-0 bottom-20 z-[60] flex flex-col items-center gap-2 px-4 sm:bottom-4 sm:items-end">
        {items.map((item) => (
          <div
            key={item.id}
            className="card rail pointer-events-auto flex w-full max-w-sm items-start gap-3 px-4 py-3 text-sm"
            style={{ "--rail": TONE_VAR[item.tone] } as React.CSSProperties}
          >
            <div className="min-w-0 flex-1">
              <div className="font-medium">{item.title}</div>
              {item.body ? <div className="mt-0.5 text-xs text-fg-muted">{item.body}</div> : null}
            </div>
            <button type="button" aria-label="Dismiss" onClick={() => dismiss(item.id)} className="rounded-md p-0.5 text-fg-muted hover:text-fg">
              <Icon name="x" />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastApi {
  const context = useContext(ToastContext);
  if (!context) throw new Error("useToast must be used inside <ToastProvider>");
  return context;
}
