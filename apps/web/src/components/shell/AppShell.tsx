"use client";

import type { ReactNode } from "react";
import { BottomBar } from "./BottomBar";
import { Sidebar } from "./Sidebar";
import { TopBar } from "./TopBar";

/**
 * Application frame (Design.md §3): sidebar, top bar, scrolling content, footer at the bottom of the scroll container,
 * and the mobile bottom bar. Content is capped at 1400px with 24px gutters (16px on mobile).
 */
export function AppShell({ children, footer }: { children: ReactNode; footer: ReactNode }) {
  return (
    <div className="flex min-h-dvh">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-3 focus:top-3 focus:z-[70] focus:rounded-lg focus:border focus:border-border focus:bg-surface focus:px-3 focus:py-2 focus:text-sm"
      >
        Skip to content
      </a>
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar />
        <main id="main" className="flex-1">
          <div className="mx-auto w-full max-w-[1400px] px-4 py-5 sm:px-6">{children}</div>
        </main>
        <div className="pb-14 sm:pb-0">{footer}</div>
      </div>
      <BottomBar />
    </div>
  );
}
