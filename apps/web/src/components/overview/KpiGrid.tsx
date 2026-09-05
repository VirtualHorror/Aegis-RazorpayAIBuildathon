import { KpiTile } from "@/components/ui/KpiTile";
import { formatCount } from "@/lib/format";
import type { MetricsSummary } from "@/lib/types";

export interface KpiGridProps {
  metrics: MetricsSummary | null;
  flash: { events: number; actions: number };
}

/** Events and actions (Design.md §4). Every number is text from the metrics endpoint. */
export function KpiGrid({ metrics, flash }: KpiGridProps) {
  const events = metrics?.events;
  const actions = metrics?.actions;
  const seen = events ? events.received + events.processed + events.dead_letter : 0;
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      <KpiTile
        label="Events received"
        value={formatCount(seen)}
        hint={events ? `${formatCount(events.duplicates)} duplicates and ${formatCount(events.rejected)} bad signatures turned away` : undefined}
        loading={!metrics}
        flashKey={flash.events}
      />
      <KpiTile label="Actions executed" value={formatCount(actions?.executed)} hint={actions ? `${formatCount(actions.proposed)} proposed` : undefined} tone="ok" loading={!metrics} flashKey={flash.actions} />
      <KpiTile label="Waiting for a human" value={formatCount(actions?.pending_approval)} hint="above the auto-approve limit" tone={actions && actions.pending_approval > 0 ? "warn" : "neutral"} loading={!metrics} flashKey={flash.actions} />
      <KpiTile label="Blocked by guardrails" value={formatCount(actions?.blocked)} hint={actions ? `${formatCount(actions.rejected)} rejected by humans` : undefined} tone={actions && actions.blocked > 0 ? "danger" : "neutral"} loading={!metrics} flashKey={flash.actions} />
    </div>
  );
}
