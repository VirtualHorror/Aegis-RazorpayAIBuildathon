"use client";

import { createContext, useContext, type ReactNode } from "react";
import { useSystemStatus, type SystemStatus } from "@/lib/system";

const SystemContext = createContext<SystemStatus | null>(null);

/** One poller for the whole shell; the top bar, Run demo buttons and empty states read the same status. */
export function SystemProvider({ children }: { children: ReactNode }) {
  const status = useSystemStatus();
  return <SystemContext.Provider value={status}>{children}</SystemContext.Provider>;
}

export function useSystem(): SystemStatus {
  const context = useContext(SystemContext);
  if (!context) throw new Error("useSystem must be used inside <SystemProvider>");
  return context;
}
