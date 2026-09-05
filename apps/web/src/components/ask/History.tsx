"use client";

import { Badge, statusTone } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";
import { formatCount, formatMs } from "@/lib/format";
import type { AskHistoryRow } from "@/lib/types";
import { timeAgo, useNow } from "@/lib/useNow";

/** Every question is audited in `nl_queries`, including the ones the validator refused. */
export function History({ rows, onAsk }: { rows: readonly AskHistoryRow[]; onAsk: (question: string) => void }) {
  const now = useNow();
  return (
    <Card title="Earlier questions" description="Every question is stored with its SQL and validation verdict." padding={false}>
      {rows.length === 0 ? (
        <p className="px-4 py-6 text-center text-sm text-fg-muted">Nothing asked yet.</p>
      ) : (
        <ul className="divide-y divide-border">
          {rows.map((row) => (
            <li key={row.id}>
              <button type="button" onClick={() => onAsk(row.question)} className="w-full px-4 py-2.5 text-left hover:bg-surface-2/60">
                <span className="line-clamp-2 text-sm">{row.question}</span>
                <span className="mt-1 flex flex-wrap items-center gap-2 text-xs text-fg-muted">
                  <Badge tone={row.validated ? (row.executed ? statusTone("executed") : "warn") : "danger"}>{row.validated ? (row.executed ? "executed" : "not executed") : "rejected"}</Badge>
                  {row.degraded ? <Badge tone="warn">degraded</Badge> : null}
                  <span suppressHydrationWarning>{timeAgo(row.created_at, now)}</span>
                  {row.row_count !== null ? <span>{formatCount(row.row_count)} rows</span> : null}
                  {row.latency_ms !== null ? <span>{formatMs(row.latency_ms)}</span> : null}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
