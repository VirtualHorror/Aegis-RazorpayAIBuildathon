"use client";

import { Badge, statusTone } from "@/components/ui/Badge";
import { formatDateTime, formatInr, humanize } from "@/lib/format";
import type { SubscriptionRow } from "@/lib/types";
import { timeAgo } from "@/lib/useNow";
import { EntityTable } from "./EntityTable";

/** Column definitions are functions, so they are built inside a client component (they cannot cross the RSC boundary). */
export function SubscriptionTable({ rows }: { rows: SubscriptionRow[] }) {
  return (
    <EntityTable<SubscriptionRow>
      rows={rows}
      keyOf={(row) => row.id}
      empty={{ title: "No subscriptions yet", body: "Subscription events create these rows. Run the demo to send a renewal failure through the ingress." }}
      columns={[
        { header: "Subscription", mono: true, render: (row) => row.id },
        { header: "Status", render: (row) => <Badge tone={statusTone(row.status)}>{humanize(row.status)}</Badge> },
        { header: "Salvage", render: (row) => <Badge tone={statusTone(row.salvage_state)}>{humanize(row.salvage_state)}</Badge> },
        { header: "Retries", numeric: true, render: (row) => row.retry_count },
        { header: "Amount", numeric: true, mono: true, render: (row) => formatInr(row.amount_paise) },
        { header: "Next retry", render: (row) => (row.next_retry_at ? formatDateTime(row.next_retry_at) : "—") },
        { header: "Updated", render: (row, now) => <span suppressHydrationWarning>{timeAgo(row.updated_at, now)}</span> },
      ]}
    />
  );
}
