"use client";

/**
 * Top-bar system status: API reachability, LLM provider/model, environment and the kill switch.
 * Intent: the pills must never invent a state (C-F5) — while the first requests are in flight they say "checking",
 *         and an unreachable API is shown as such.
 * Flow: mount -> fetch /health, /api/v1/system, /api/v1/guardrails -> poll every 30 s -> SSE `system.kill_switch`
 *       flips the switch immediately -> a stream reconnect triggers a refetch (values may have changed while offline).
 */
import { useCallback, useEffect, useState } from "react";
import { api, describeFailure } from "./api";
import { useStreamEffect, useStreamStatus } from "./sse";
import type { HealthResponse, SystemInfo } from "./types";

export interface SystemStatus {
  readonly api: "checking" | "online" | "offline";
  readonly health: HealthResponse | null;
  readonly system: SystemInfo | null;
  readonly killSwitch: boolean | null;
  readonly error: string | null;
  readonly refresh: () => void;
}

const POLL_MS = 30_000;

export function useSystemStatus(): SystemStatus {
  const [state, setState] = useState<Omit<SystemStatus, "refresh">>({ api: "checking", health: null, system: null, killSwitch: null, error: null });
  const [tick, setTick] = useState(0);
  const streamStatus = useStreamStatus();

  const refresh = useCallback(() => setTick((value) => value + 1), []);

  // `streamStatus` is a dependency on purpose: a reconnect means the API was away and the guardrails may have changed,
  // and a drop refetches immediately so the pills turn "offline" without waiting for the next poll.
  useEffect(() => {
    let alive = true;
    void (async () => {
      const [health, system, guardrails] = await Promise.all([api.health(), api.system(), api.guardrails()]);
      if (!alive) return;
      const killRow = guardrails.ok ? guardrails.data.items.find((row) => row.key === "kill_switch") : undefined;
      setState({
        api: health.ok ? "online" : "offline",
        health: health.ok ? health.data : null,
        system: system.ok ? system.data : null,
        killSwitch: killRow ? killRow.value === true : null,
        error: health.ok ? null : describeFailure(health),
      });
    })();
    const interval = setInterval(() => setTick((value) => value + 1), POLL_MS);
    return () => {
      alive = false;
      clearInterval(interval);
    };
  }, [tick, streamStatus]);

  useStreamEffect(["system.kill_switch"], (event) => {
    const data = event.data;
    if (typeof data === "object" && data !== null && "enabled" in data && typeof data.enabled === "boolean") {
      const enabled = data.enabled;
      setState((current) => ({ ...current, killSwitch: enabled }));
    }
  });

  return { ...state, refresh };
}
