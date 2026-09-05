"use client";

import { useEffect, useId, useRef, type ReactNode } from "react";
import { Icon } from "./icons";

export interface DrawerProps {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  /** Tailwind max-width class for the panel. */
  width?: string;
}

/**
 * Right-hand detail panel.
 * Flow: open -> remember the previously focused element -> focus the close button -> Escape/backdrop close ->
 *       restore focus. Body scroll is locked while open so the page behind does not move.
 */
export function Drawer({ open, onClose, title, description, children, footer, width = "max-w-2xl" }: DrawerProps) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const titleId = useId();

  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement;
    closeRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    const { overflow } = document.body.style;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = overflow;
      if (previous instanceof HTMLElement) previous.focus();
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <button type="button" aria-label="Close panel" className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div role="dialog" aria-modal="true" aria-labelledby={titleId} className={`relative flex h-full w-full ${width} flex-col border-l border-border bg-surface`}>
        <header className="flex items-start justify-between gap-3 border-b border-border px-4 py-3">
          <div className="min-w-0">
            <h2 id={titleId} className="truncate text-sm font-medium">
              {title}
            </h2>
            {description !== undefined ? <div className="mt-0.5 text-xs text-fg-muted">{description}</div> : null}
          </div>
          <button ref={closeRef} type="button" onClick={onClose} aria-label="Close" className="rounded-md p-1 text-fg-muted hover:bg-surface-2 hover:text-fg">
            <Icon name="x" size={18} />
          </button>
        </header>
        <div className="scroll-thin flex-1 overflow-y-auto p-4">{children}</div>
        {footer !== undefined ? <footer className="border-t border-border px-4 py-3">{footer}</footer> : null}
      </div>
    </div>
  );
}
