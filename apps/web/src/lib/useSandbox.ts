"use client";

import { useSyncExternalStore } from "react";
import { DEFAULT_SANDBOX, readSandbox, subscribeSandbox, type SandboxSettings } from "./sandbox";

/**
 * The current Sandbox / BYOK settings for this browser. The server snapshot is Demo mode, so a server render and the
 * first client render agree; the client corrects itself from localStorage right after hydration.
 */
export function useSandbox(): SandboxSettings {
  return useSyncExternalStore(subscribeSandbox, readSandbox, () => DEFAULT_SANDBOX);
}
