"use client";

import { useEffect, useId, useRef, type ReactNode } from "react";
import { Button } from "@/components/ui/Button";

export interface ConfirmDialogProps {
  open: boolean;
  title: string;
  body: ReactNode;
  confirmLabel: string;
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

/** A real dialog, never `window.confirm` (Checklist 21.2): focusable, Escape-dismissible, restores focus. */
export function ConfirmDialog({ open, title, body, confirmLabel, danger = false, onConfirm, onCancel }: ConfirmDialogProps) {
  const confirmRef = useRef<HTMLButtonElement>(null);
  const titleId = useId();

  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement;
    confirmRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onCancel();
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      if (previous instanceof HTMLElement) previous.focus();
    };
  }, [open, onCancel]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <button type="button" aria-label="Cancel" className="absolute inset-0 bg-black/50" onClick={onCancel} />
      <div role="alertdialog" aria-modal="true" aria-labelledby={titleId} className="card relative w-full max-w-md p-5">
        <h2 id={titleId} className="text-sm font-medium">
          {title}
        </h2>
        <div className="mt-2 text-sm text-fg-muted">{body}</div>
        <div className="mt-5 flex justify-end gap-2">
          <Button onClick={onCancel}>Cancel</Button>
          <Button ref={confirmRef} variant={danger ? "danger" : "primary"} onClick={onConfirm}>
            {confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}
