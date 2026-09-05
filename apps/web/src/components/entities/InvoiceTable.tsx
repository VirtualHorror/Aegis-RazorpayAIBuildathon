"use client";

import { Badge, statusTone } from "@/components/ui/Badge";
import { formatInr, humanize } from "@/lib/format";
import type { InvoiceRow } from "@/lib/types";
import { timeAgo } from "@/lib/useNow";
import { EntityTable } from "./EntityTable";

export function InvoiceTable({ rows }: { rows: InvoiceRow[] }) {
  return (
    <EntityTable<InvoiceRow>
      rows={rows}
      keyOf={(row) => row.id}
      empty={{ title: "No invoices yet", body: "Invoice events create these rows. Run the demo to send an expired B2B invoice through the ingress." }}
      columns={[
        { header: "Invoice", mono: true, render: (row) => row.id },
        { header: "Status", render: (row) => <Badge tone={statusTone(row.status)}>{humanize(row.status)}</Badge> },
        { header: "Negotiation", render: (row) => <Badge tone={statusTone(row.negotiation_state)}>{humanize(row.negotiation_state)}</Badge> },
        { header: "Round", numeric: true, render: (row) => row.negotiation_round },
        { header: "Amount", numeric: true, mono: true, render: (row) => formatInr(row.amount_paise) },
        { header: "Floor", numeric: true, mono: true, render: (row) => formatInr(row.floor_amount_paise) },
        { header: "Current offer", numeric: true, mono: true, render: (row) => (row.current_offer_paise === null ? "—" : formatInr(row.current_offer_paise)) },
        { header: "Updated", render: (row, now) => <span suppressHydrationWarning>{timeAgo(row.updated_at, now)}</span> },
      ]}
    />
  );
}
