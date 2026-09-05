"use client";

import { useSystem } from "@/components/shell/SystemProvider";
import { Badge } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";
import { Skeleton } from "@/components/ui/Skeleton";
import { formatCount, formatMs, formatPercent } from "@/lib/format";
import type { MetricsSummary } from "@/lib/types";

/** Model health from the diagnoses table plus the live provider description. */
export function LlmHealth({ metrics }: { metrics: MetricsSummary | null }) {
  const system = useSystem();
  const llm = metrics?.llm;
  const degradedTone = llm && llm.degraded_rate > 0.2 ? "danger" : llm && llm.degraded_rate > 0 ? "warn" : "ok";
  return (
    <Card title="Model health" description="Every model call is validated and cross-checked; a fallback is recorded as degraded.">
      {!llm ? (
        <Skeleton className="h-16 w-full" />
      ) : (
        <dl className="grid grid-cols-3 gap-3">
          <div>
            <dt className="text-xs text-fg-muted">Calls</dt>
            <dd className="mt-0.5 font-mono text-xl tabular-nums">{formatCount(llm.calls)}</dd>
          </div>
          <div>
            <dt className="text-xs text-fg-muted">Degraded</dt>
            <dd className={`mt-0.5 font-mono text-xl tabular-nums ${degradedTone === "ok" ? "" : degradedTone === "warn" ? "text-warn" : "text-danger"}`}>{formatPercent(llm.degraded_rate)}</dd>
          </div>
          <div>
            <dt className="text-xs text-fg-muted">Avg latency</dt>
            <dd className="mt-0.5 font-mono text-xl tabular-nums">{llm.calls > 0 ? formatMs(llm.avg_latency_ms) : "—"}</dd>
          </div>
        </dl>
      )}
      <div className="mt-4 flex flex-wrap items-center gap-2 text-xs text-fg-muted">
        <span>Provider now:</span>
        {system.system ? (
          <Badge tone={system.system.provider === "stub" ? "warn" : "accent"} dot>
            {system.system.provider} {system.system.provider === "stub" ? "(deterministic rules)" : system.system.model}
          </Badge>
        ) : (
          <Badge tone="neutral">{system.api === "offline" ? "API offline" : "checking…"}</Badge>
        )}
        {llm && Object.keys(llm.by_provider).length > 0
          ? Object.entries(llm.by_provider).map(([provider, count]) => (
              <Badge key={provider} tone="neutral">
                {provider}: {formatCount(count)} diagnoses
              </Badge>
            ))
          : null}
      </div>
    </Card>
  );
}
