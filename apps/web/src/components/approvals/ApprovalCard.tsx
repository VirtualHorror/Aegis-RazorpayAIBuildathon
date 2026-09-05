"use client";

import Link from "next/link";
import type { CSSProperties } from "react";
import { BoundsChecklist } from "@/components/actions/BoundsChecklist";
import { ModuleBadge } from "@/components/actions/ModuleBadge";
import { Badge } from "@/components/ui/Badge";
import { explanationSteps } from "@/lib/actions";
import { formatDateTime, formatInr, humanize, moduleColorVar } from "@/lib/format";
import type { ActionRow } from "@/lib/types";
import { DecisionForm } from "./DecisionForm";

export interface ApprovalCardProps {
  action: ActionRow;
  onDecide: (decision: "approve" | "reject", note: string) => Promise<void>;
  conflict: string | null;
  fresh: boolean;
}

/** Side by side: what the module proposes (left) against the deterministic facts that bound it (right). */
export function ApprovalCard({ action, onDecide, conflict, fresh }: ApprovalCardProps) {
  const steps = explanationSteps(action);
  return (
    <article className={`card rail ${fresh ? "row-enter" : ""}`} style={{ "--rail": moduleColorVar(action.module) } as CSSProperties} aria-labelledby={`approval-${action.id}`}>
      <header className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-3">
        <ModuleBadge module={action.module} version={action.module_version} />
        <Badge tone="neutral">{humanize(action.kind)}</Badge>
        <span className="text-xs text-fg-muted">proposed {formatDateTime(action.created_at)}</span>
        <Link href={`/actions/${action.id}`} className="ml-auto text-xs text-accent hover:underline">
          Full audit trail
        </Link>
      </header>
      <div className="grid grid-cols-1 gap-4 p-4 lg:grid-cols-2">
        <section>
          <h3 id={`approval-${action.id}`} className="text-sm font-medium">
            The module proposes
          </h3>
          <p className="mt-1 text-sm">{action.summary}</p>
          <dl className="mt-3 grid grid-cols-2 gap-3 text-sm">
            <div>
              <dt className="text-xs text-fg-muted">Money impact</dt>
              <dd className="mt-0.5 font-mono tabular-nums">{action.money_impact_paise === 0 ? "none" : `costs ${formatInr(-action.money_impact_paise)}`}</dd>
            </div>
            <div>
              <dt className="text-xs text-fg-muted">Expected recovery</dt>
              <dd className="mt-0.5 font-mono tabular-nums">{formatInr(action.expected_recovery_paise)}</dd>
            </div>
            <div className="col-span-2">
              <dt className="text-xs text-fg-muted">Entity</dt>
              <dd className="mt-0.5 font-mono text-xs">
                {humanize(action.entity_type)} {action.entity_id}
              </dd>
            </div>
          </dl>
          {steps.length > 0 ? (
            <ol className="mt-3 list-decimal space-y-1 pl-5 text-sm">
              {steps.map((step, index) => (
                <li key={index}>{step}</li>
              ))}
            </ol>
          ) : null}
        </section>
        <section>
          <h3 className="text-sm font-medium">The rules checked</h3>
          <p className="mb-2 mt-1 text-xs text-fg-muted">Computed in code before this reached you. Approval executes exactly this proposal.</p>
          <BoundsChecklist bounds={action.bounds} />
        </section>
      </div>
      <footer className="border-t border-border px-4 py-3">
        <DecisionForm onDecide={onDecide} conflict={conflict} />
      </footer>
    </article>
  );
}
