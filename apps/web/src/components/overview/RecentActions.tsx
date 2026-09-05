"use client";

import Link from "next/link";
import type { CSSProperties } from "react";
import { RunDemoButton } from "@/components/shell/RunDemoButton";
import { useSystem } from "@/components/shell/SystemProvider";
import { Badge, statusTone } from "@/components/ui/Badge";
import { ButtonLink } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { formatInr, moduleColorVar, moduleLabel } from "@/lib/format";
import { timeAgo, useNow } from "@/lib/useNow";
import type { ActionRow } from "@/lib/types";

/** The last few actions, each linking to its audit trail. */
export function RecentActions({ actions, fresh }: { actions: readonly ActionRow[]; fresh: ReadonlySet<string> }) {
  const system = useSystem();
  const now = useNow();
  return (
    <Card title="Recent actions" description="Newest first, straight from the actions table." actions={<ButtonLink href="/actions" size="sm">All actions</ButtonLink>} padding={false}>
      {actions.length === 0 ? (
        <div className="p-3">
          <EmptyState compact title="No actions yet" body="Actions appear when a webhook needs a response. Run the demo to send every scenario through the ingress." action={<RunDemoButton env={system.system?.env ?? null} apiState={system.api} />} />
        </div>
      ) : (
        <ul className="divide-y divide-border">
          {actions.map((action) => (
            <li key={action.id} className={`rail ${fresh.has(action.id) ? "row-enter" : ""}`} style={{ "--rail": moduleColorVar(action.module) } as CSSProperties}>
              <Link href={`/actions/${action.id}`} className="flex items-center gap-3 px-4 py-2.5 hover:bg-surface-2/60">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge module={action.module} dot>
                      {moduleLabel(action.module)}
                    </Badge>
                    <span className="truncate text-sm">{action.summary}</span>
                  </div>
                  <div className="mt-0.5 flex flex-wrap gap-x-3 text-xs text-fg-muted">
                    <span suppressHydrationWarning>{timeAgo(action.created_at, now)}</span>
                    {action.expected_recovery_paise > 0 ? <span>expects {formatInr(action.expected_recovery_paise)}</span> : null}
                    {action.money_impact_paise < 0 ? <span>costs {formatInr(-action.money_impact_paise)}</span> : null}
                  </div>
                </div>
                <Badge tone={statusTone(action.status)}>{action.status.replace("_", " ")}</Badge>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
