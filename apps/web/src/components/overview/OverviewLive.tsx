"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { api, describeFailure } from "@/lib/api";
import { formatCount } from "@/lib/format";
import { activityModule, actionOf, bumpMetrics, flashGroup, upsertAction } from "@/lib/overview";
import { useStreamEffect } from "@/lib/sse";
import type { ActionRow, MetricsSummary, MetricsWindow } from "@/lib/types";
import { KpiGrid } from "./KpiGrid";
import { LlmHealth } from "./LlmHealth";
import { MoneyStrip } from "./MoneyStrip";
import { PrismPlaceholder } from "./PrismPlaceholder";
import { RecentActions } from "./RecentActions";

export interface OverviewLiveProps {
  initialMetrics: MetricsSummary | null;
  initialActions: ActionRow[];
  initialError: string | null;
}

const WINDOWS: readonly { value: MetricsWindow; label: string }[] = [
  { value: "24h", label: "24 h" },
  { value: "7d", label: "7 days" },
  { value: "all", label: "All time" },
];
const RECONCILE_MS = 1_200;
const ACTIVE_MS = 1_200;

/**
 * Overview state (Checklist 18.1).
 * Flow: server-rendered metrics/actions -> bus events bump the counters and flash the tile at once -> a debounced
 *       refetch replaces them with the durable aggregates -> the window switcher refetches on demand.
 */
export function OverviewLive({ initialMetrics, initialActions, initialError }: OverviewLiveProps) {
  const [window, setWindow] = useState<MetricsWindow>("24h");
  const [metrics, setMetrics] = useState(initialMetrics);
  const [error, setError] = useState(initialError);
  const [pending, setPending] = useState(false);
  const [actions, setActions] = useState(initialActions);
  const [freshActions, setFreshActions] = useState<ReadonlySet<string>>(() => new Set());
  const [flash, setFlash] = useState({ events: 0, actions: 0, x402: 0 });
  const [activeModules, setActiveModules] = useState<ReadonlySet<string>>(() => new Set());
  const [tick, setTick] = useState(0);
  const reconcile = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (tick === 0 && window === "24h" && initialMetrics) return;
    let alive = true;
    void Promise.all([api.metrics(window), api.actions({ limit: 8 })]).then(([summary, recent]) => {
      if (!alive) return;
      setPending(false);
      if (summary.ok) {
        setMetrics(summary.data);
        setError(null);
      } else {
        setError(describeFailure(summary));
      }
      if (recent.ok) setActions(recent.data.items);
    });
    return () => {
      alive = false;
    };
  }, [window, tick, initialMetrics]);

  useStreamEffect(
    ["event.received", "event.duplicate", "event.rejected", "event.processed", "action.proposed", "action.pending_approval", "action.blocked", "action.executed", "action.failed", "x402.settled", "compliance.flag"],
    (event) => {
      setMetrics((current) => (current ? bumpMetrics(current, event.name) : current));
      const group = flashGroup(event.name);
      if (group) setFlash((current) => ({ ...current, [group]: current[group] + 1 }));
      const moduleName = activityModule(event);
      if (moduleName) {
        setActiveModules((current) => new Set(current).add(moduleName));
        setTimeout(() => setActiveModules((current) => {
          const copy = new Set(current);
          copy.delete(moduleName);
          return copy;
        }), ACTIVE_MS);
      }
      const action = actionOf(event.data);
      if (action) {
        setActions((current) => upsertAction(current, action));
        setFreshActions((current) => new Set(current).add(action.id));
        setTimeout(() => setFreshActions((current) => {
          const copy = new Set(current);
          copy.delete(action.id);
          return copy;
        }), 1_200);
      }
      if (reconcile.current) clearTimeout(reconcile.current);
      reconcile.current = setTimeout(() => setTick((value) => value + 1), RECONCILE_MS);
    },
  );

  const eventsIn = metrics ? formatCount(metrics.events.received + metrics.events.processed + metrics.events.dead_letter) : "—";
  const actionsOut = metrics ? formatCount(metrics.actions.executed) : "—";

  return (
    <div className="flex flex-col gap-4">
      <PrismPlaceholder active={activeModules} eventsIn={eventsIn} actionsOut={actionsOut} />

      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-medium text-fg-muted">{metrics ? `Showing ${WINDOWS.find((entry) => entry.value === metrics.window)?.label.toLowerCase() ?? metrics.window}` : "Metrics"}</h2>
        <div role="radiogroup" aria-label="Metrics window" className="inline-flex rounded-full border border-border bg-surface p-0.5 text-xs font-medium">
          {WINDOWS.map((entry) => (
            <button
              key={entry.value}
              type="button"
              role="radio"
              aria-checked={window === entry.value}
              onClick={() => {
                setWindow(entry.value);
                setPending(true);
              }}
              className={`h-7 rounded-full px-3 ${window === entry.value ? "bg-accent text-white" : "text-fg-muted hover:text-fg"}`}
            >
              {entry.label}
            </button>
          ))}
        </div>
      </div>

      {error && !metrics ? (
        <EmptyState title="The metrics could not be loaded" body={error} action={<Button onClick={() => setTick((value) => value + 1)}>Try again</Button>} />
      ) : (
        <div className={`flex flex-col gap-4 transition-opacity ${pending ? "opacity-60" : ""}`} aria-busy={pending || undefined}>
          {error ? <p className="text-xs text-danger">{error}</p> : null}
          <KpiGrid metrics={metrics} flash={flash} />
          <MoneyStrip metrics={metrics} flash={flash} />
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="min-w-0 lg:col-span-2">
          <RecentActions actions={actions} fresh={freshActions} />
        </div>
        <div className="min-w-0">
          <LlmHealth metrics={metrics} />
        </div>
      </div>
    </div>
  );
}
