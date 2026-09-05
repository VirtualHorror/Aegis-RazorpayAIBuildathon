import Link from "next/link";
import { Badge, statusTone } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";
import { CopyButton } from "@/components/ui/CopyButton";
import { JsonView } from "@/components/ui/JsonView";
import { explanationSteps } from "@/lib/actions";
import { formatDateTime, formatInr, humanize } from "@/lib/format";
import type { ActionDetail } from "@/lib/types";
import { BoundsChecklist } from "./BoundsChecklist";
import { DiagnosisCard } from "./DiagnosisCard";
import { ModuleBadge } from "./ModuleBadge";
import { OutboundPayload } from "./OutboundPayload";
import { Timeline } from "./Timeline";

/** The entity pages that exist; other types render as plain text. */
function entityHref(type: string): string | null {
  if (type === "subscription") return "/subscriptions";
  if (type === "invoice") return "/invoices";
  return null;
}

/** The complete audit trail of one action; used by the `/actions/[id]` page and the drawer. */
export function ActionDetailView({ detail, compact = false }: { detail: ActionDetail; compact?: boolean }) {
  const { action } = detail;
  const steps = explanationSteps(action);
  const href = entityHref(action.entity_type);
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <ModuleBadge module={action.module} version={action.module_version} />
        <Badge tone="neutral">{humanize(action.kind)}</Badge>
        <Badge tone={statusTone(action.status)}>{humanize(action.status)}</Badge>
        {action.requires_approval ? <Badge tone="warn">needs a human</Badge> : null}
        {detail.diagnosis?.degraded ? <Badge tone="warn">rule-based diagnosis</Badge> : null}
      </div>
      <p className="text-base">{action.summary}</p>
      {action.reason ? <p className="rounded-lg border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger">Stopped by {humanize(action.reason).toLowerCase()}</p> : null}

      <div className={`grid grid-cols-1 gap-4 ${compact ? "" : "lg:grid-cols-2"}`}>
        <Card title="Proposal" description="What the module wants to do and why, in its own words.">
          <dl className="grid grid-cols-2 gap-3 text-sm">
            <div>
              <dt className="text-xs text-fg-muted">Money impact</dt>
              <dd className="mt-0.5 font-mono tabular-nums">{action.money_impact_paise === 0 ? "none" : `costs ${formatInr(-action.money_impact_paise)}`}</dd>
            </div>
            <div>
              <dt className="text-xs text-fg-muted">Expected recovery</dt>
              <dd className="mt-0.5 font-mono tabular-nums">{formatInr(action.expected_recovery_paise)}</dd>
            </div>
            <div>
              <dt className="text-xs text-fg-muted">Entity</dt>
              <dd className="mt-0.5 font-mono text-xs">
                {humanize(action.entity_type)} {href ? <Link href={href} className="text-accent hover:underline">{action.entity_id}</Link> : action.entity_id}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-fg-muted">Trigger event</dt>
              <dd className="mt-0.5 flex items-center gap-2 font-mono text-xs">
                {action.trigger_event_id ? (
                  <>
                    <span className="truncate">{action.trigger_event_id}</span>
                    <CopyButton text={action.trigger_event_id} label="" className="h-6 shrink-0 px-1.5" />
                  </>
                ) : (
                  "—"
                )}
              </dd>
            </div>
            <div className="col-span-2">
              <dt className="text-xs text-fg-muted">Idempotency key</dt>
              <dd className="mt-0.5 flex items-center gap-2 font-mono text-xs">
                <span className="truncate">{action.idempotency_key}</span>
                <CopyButton text={action.idempotency_key} label="" className="h-6 px-1.5" />
              </dd>
            </div>
          </dl>
          {steps.length > 0 ? (
            <div className="mt-4">
              <h3 className="text-xs text-fg-muted">Explanation</h3>
              <ol className="mt-1 list-decimal space-y-1 pl-5 text-sm">
                {steps.map((step, index) => (
                  <li key={index}>{step}</li>
                ))}
              </ol>
            </div>
          ) : null}
        </Card>
        <Card title="Guardrails" description="Every bound evaluated before anything could run (C-B1).">
          <BoundsChecklist bounds={action.bounds} />
        </Card>
      </div>

      <DiagnosisCard diagnosis={detail.diagnosis} />
      <OutboundPayload action={action} messages={detail.outbound_messages} />

      <div className={`grid grid-cols-1 gap-4 ${compact ? "" : "lg:grid-cols-2"}`}>
        <Card title="Timeline" description={`Created ${formatDateTime(action.created_at)}`}>
          <Timeline detail={detail} />
        </Card>
        <Card title="Raw proposal" description="The stored JSON, exactly as persisted.">
          <JsonView value={action.proposal} label="Raw proposal" maxHeight={360} />
          {action.result ? (
            <div className="mt-3">
              <h3 className="mb-1 text-xs text-fg-muted">Execution result</h3>
              <JsonView value={action.result} label="Execution result" maxHeight={200} />
            </div>
          ) : null}
        </Card>
      </div>
    </div>
  );
}
