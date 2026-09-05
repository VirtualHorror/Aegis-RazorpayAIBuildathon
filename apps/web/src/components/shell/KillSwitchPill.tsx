import Link from "next/link";
import { Icon } from "@/components/ui/icons";

/** Kill-switch indicator (C-B5): when on, every module and the x402 gateway are blocked. Links to Settings. */
export function KillSwitchPill({ enabled }: { enabled: boolean | null }) {
  if (enabled === null) {
    return (
      <span className="inline-flex h-7 items-center gap-1 rounded-full border border-border px-2 text-[11px] text-fg-muted" title="Kill switch state unknown">
        <Icon name="power" size={13} />
        <span className="hidden md:inline">checking…</span>
      </span>
    );
  }
  return (
    <Link
      href="/settings"
      className={`inline-flex h-7 items-center gap-1 rounded-full border px-2 text-[11px] font-medium ${enabled ? "border-danger bg-danger/10 text-danger" : "border-border text-fg-muted hover:text-fg"}`}
      title={enabled ? "Kill switch is ON: every module and the x402 gateway are blocked" : "Kill switch is off: modules run inside their guardrails"}
    >
      <Icon name="power" size={13} />
      <span className={enabled ? "" : "hidden md:inline"}>{enabled ? "Kill switch ON" : "Kill switch off"}</span>
    </Link>
  );
}
