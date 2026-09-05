"use client";

import { DEFAULT_ACTOR, setActor, useActor } from "@/lib/actor";

/** The name recorded as `decided_by` on every decision (C-B2). Stored in this browser only. */
export function ActorField() {
  const actor = useActor();
  return (
    <label className="flex flex-wrap items-center gap-2 text-xs text-fg-muted">
      <span>Deciding as</span>
      <input
        type="text"
        value={actor}
        onChange={(event) => setActor(event.target.value)}
        placeholder={DEFAULT_ACTOR}
        className="h-8 w-56 rounded-lg border border-border bg-surface px-2.5 font-mono text-xs text-fg"
        aria-label="Your name for the audit log"
      />
      <span>recorded in the audit log with every decision</span>
    </label>
  );
}
