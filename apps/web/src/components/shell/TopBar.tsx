"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useStreamStatus } from "@/lib/sse";
import { EnvPill } from "./EnvPill";
import { KillSwitchPill } from "./KillSwitchPill";
import { LlmPill } from "./LlmPill";
import { Logo } from "./Logo";
import { RunDemoButton } from "./RunDemoButton";
import { SandboxPill } from "./SandboxPill";
import { StreamPill } from "./StreamPill";
import { useSystem } from "./SystemProvider";
import { ThemeToggle } from "./ThemeToggle";
import { pageTitle } from "./nav";

/** Environment pill, LLM pill, sandbox/BYOK pill (T25), kill-switch indicator, live-stream state, Run demo and the theme toggle (Design.md §3). */
export function TopBar() {
  const pathname = usePathname();
  const status = useSystem();
  const stream = useStreamStatus();
  const title = pageTitle(pathname);

  return (
    <header className="sticky top-0 z-30 flex h-14 items-center gap-2 border-b border-border bg-bg/85 px-4 backdrop-blur sm:px-6">
      <Link href="/" className="flex items-center gap-2 rounded-md sm:hidden" aria-label="Aegis overview">
        <Logo />
        <span className="text-[15px] font-semibold tracking-tight">Aegis</span>
      </Link>
      <div className="hidden min-w-0 flex-1 truncate text-sm text-fg-muted sm:block" aria-hidden>
        {title}
      </div>
      <div className="ml-auto flex shrink-0 items-center gap-1.5 sm:gap-2">
        <span className="hidden xl:inline-flex">
          <EnvPill system={status.system} />
        </span>
        <span className="hidden lg:inline-flex">
          <LlmPill system={status.system} apiState={status.api} />
        </span>
        <SandboxPill />
        <KillSwitchPill enabled={status.killSwitch} />
        <StreamPill status={stream} />
        <span className="hidden sm:inline-flex">
          <RunDemoButton env={status.system?.env ?? null} apiState={status.api} size="sm" />
        </span>
        <span className="sm:hidden">
          <RunDemoButton env={status.system?.env ?? null} apiState={status.api} size="sm" iconOnly />
        </span>
        <ThemeToggle />
      </div>
    </header>
  );
}
