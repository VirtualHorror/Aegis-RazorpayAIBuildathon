"use client";

import { Card } from "@/components/ui/Card";
import { humanize } from "@/lib/format";
import type { AuditLogRow } from "@/lib/types";
import { timeAgo, useNow } from "@/lib/useNow";

function valueOf(record: unknown): string {
  if (typeof record !== "object" || record === null || !("value" in record)) return "—";
  const value = (record as { value: unknown }).value;
  return typeof value === "object" ? JSON.stringify(value) : String(value);
}

/** Guardrail edits from `audit_log`: who changed what, from what, to what. */
export function ChangeHistory({ rows }: { rows: readonly AuditLogRow[] }) {
  const now = useNow();
  return (
    <Card title="Change history" description="Every guardrail edit is an audit row; nothing changes silently." padding={false}>
      {rows.length === 0 ? (
        <p className="px-4 py-6 text-center text-sm text-fg-muted">No guardrail has been changed yet.</p>
      ) : (
        <ul className="divide-y divide-border">
          {rows.map((row) => (
            <li key={row.id} className="px-4 py-2.5 text-sm">
              <div className="flex flex-wrap items-baseline gap-x-2">
                <span className="font-medium">{humanize(row.entity_id)}</span>
                <span className="text-fg-muted">by {row.actor}</span>
                <span className="ml-auto text-xs text-fg-muted" suppressHydrationWarning>
                  {timeAgo(row.created_at, now)}
                </span>
              </div>
              <div className="mt-0.5 font-mono text-xs text-fg-muted">
                {valueOf(row.before)} → <span className="text-fg">{valueOf(row.after)}</span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
