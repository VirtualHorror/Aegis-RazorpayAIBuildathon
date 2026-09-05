import type { SystemInfo } from "@/lib/types";

/** `LOCAL · SIM` (Design.md §3): where the API runs, and that every outbound effect is simulated (C-B7). */
export function EnvPill({ system }: { system: SystemInfo | null }) {
  const env = system ? (system.env === "development" ? "LOCAL" : system.env.toUpperCase()) : "…";
  return (
    <span className="inline-flex h-7 shrink-0 items-center whitespace-nowrap gap-1 rounded-full border border-border bg-surface px-2.5 font-mono text-[11px] text-fg-muted" title="Environment · every outbound effect is simulated">
      {env} · SIM
    </span>
  );
}
