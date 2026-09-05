"use client";

import { useState } from "react";
import { Icon } from "./icons";

type CopyState = "idle" | "copied" | "failed";

/** Clipboard copy with visible confirmation; a failure is shown, never swallowed (C-E3). */
export function CopyButton({ text, label = "Copy", className = "" }: { text: string; label?: string; className?: string }) {
  const [state, setState] = useState<CopyState>("idle");

  const onClick = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setState("copied");
    } catch {
      // Clipboard access is denied in some contexts (insecure origin, permissions); tell the user instead of hiding it.
      setState("failed");
    }
    setTimeout(() => setState("idle"), 1_600);
  };

  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={state === "copied" ? "Copied" : state === "failed" ? "Copy failed" : label}
      title={state === "copied" ? "Copied" : state === "failed" ? "Copy failed" : label}
      className={`inline-flex h-7 items-center gap-1 rounded-md border border-border bg-surface px-2 text-xs text-fg-muted hover:bg-surface-2 hover:text-fg ${className}`}
    >
      <Icon name={state === "copied" ? "check" : state === "failed" ? "alert" : "copy"} size={14} />
      <span>{state === "copied" ? "Copied" : state === "failed" ? "Failed" : label}</span>
    </button>
  );
}
