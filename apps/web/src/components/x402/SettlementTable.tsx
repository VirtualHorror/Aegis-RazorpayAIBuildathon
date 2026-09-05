"use client";

import { Badge, statusTone } from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/EmptyState";
import { Table, TableWrap, Td, Th, Tr } from "@/components/ui/Table";
import { formatInr, humanize, maskId } from "@/lib/format";
import type { X402PaymentRow } from "@/lib/types";
import { timeAgo, useNow } from "@/lib/useNow";

function pathOf(resource: string): string {
  try {
    return new URL(resource).pathname;
  } catch {
    // The column stores whatever the request built; show it as-is rather than dropping the row.
    return resource;
  }
}

/** Every challenge and settlement the gateway wrote, newest first. */
export function SettlementTable({ payments, fresh }: { payments: readonly X402PaymentRow[]; fresh: ReadonlySet<string> }) {
  const now = useNow();
  if (payments.length === 0) {
    return <EmptyState compact title="No x402 traffic yet" body="Run the three steps above and the challenge, the settlement and the replay rejection all appear here." />;
  }
  return (
    <TableWrap>
      <Table>
        <thead>
          <tr>
            <Th>Created</Th>
            <Th>Nonce</Th>
            <Th>Payer</Th>
            <Th>Resource</Th>
            <Th numeric>Amount</Th>
            <Th>Status</Th>
          </tr>
        </thead>
        <tbody>
          {payments.map((payment) => (
            <Tr key={payment.id} className={fresh.has(payment.nonce) ? "row-enter" : ""}>
              <Td className="whitespace-nowrap">
                <time dateTime={payment.created_at} suppressHydrationWarning>
                  {timeAgo(payment.created_at, now)}
                </time>
              </Td>
              <Td mono>{maskId(payment.nonce)}</Td>
              <Td mono>{payment.payer ?? "—"}</Td>
              <Td mono className="max-w-[24ch] truncate" title={payment.resource}>
                {payment.method} {pathOf(payment.resource)}
              </Td>
              <Td numeric mono>
                {formatInr(payment.amount_paise)}
              </Td>
              <Td>
                <Badge tone={statusTone(payment.status)} title={payment.reject_reason ?? undefined}>
                  {humanize(payment.status)}
                </Badge>
                {payment.reject_reason ? <div className="mt-0.5 text-[11px] text-danger">{humanize(payment.reject_reason)}</div> : null}
              </Td>
            </Tr>
          ))}
        </tbody>
      </Table>
    </TableWrap>
  );
}
