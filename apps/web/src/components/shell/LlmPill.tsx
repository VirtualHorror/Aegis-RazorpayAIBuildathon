import type { SystemInfo } from "@/lib/types";

/** `openai · gpt-5.6` or `stub · degraded` (Design.md §3). */
export function LlmPill({ system, apiState }: { system: SystemInfo | null; apiState: "checking" | "online" | "offline" }) {
  if (apiState === "offline") {
    return (
      <span className="inline-flex h-7 items-center rounded-full border border-danger/40 px-2.5 font-mono text-[11px] text-danger" title="The API is unreachable">
        API offline
      </span>
    );
  }
  if (!system) {
    return <span className="inline-flex h-7 items-center rounded-full border border-border px-2.5 font-mono text-[11px] text-fg-muted">checking…</span>;
  }
  const stub = system.provider === "stub";
  return (
    <span
      className={`inline-flex h-7 items-center gap-1.5 rounded-full border px-2.5 font-mono text-[11px] ${stub ? "border-warn/40 text-warn" : "border-border text-fg-muted"}`}
      title={stub ? "Deterministic stub model: every model call falls back to rules" : `Language model: ${system.provider} ${system.model}`}
    >
      {system.provider} · {stub ? "degraded" : system.model || "model"}
    </span>
  );
}
