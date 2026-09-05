"use client";

import { Badge } from "@/components/ui/Badge";
import { formatDateTime, formatInr, humanize } from "@/lib/format";
import type { EvidencePacketRow } from "@/lib/types";
import { DecisionForm } from "./DecisionForm";

function Section({ title, rows }: { title: string; rows: readonly [string, React.ReactNode][] }) {
  return (
    <section className="rounded-xl border border-border p-3">
      <h4 className="text-xs font-medium text-fg-muted">{title}</h4>
      <dl className="mt-1 grid grid-cols-2 gap-x-3 gap-y-1 text-sm">
        {rows.map(([label, value]) => (
          <div key={label} className="contents">
            <dt className="text-fg-muted">{label}</dt>
            <dd className="min-w-0 break-words font-mono text-xs">{value ?? "—"}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

function text(value: string | number | boolean | null | undefined): string {
  if (value === null || value === undefined) return "—";
  if (typeof value === "boolean") return value ? "yes" : "no";
  return String(value);
}

export interface EvidencePacketViewProps {
  row: EvidencePacketRow;
  onDecide: (decision: "approve" | "reject", note: string) => Promise<void>;
  conflict: string | null;
  fresh: boolean;
}

/** Deterministic packet on the right, AI narrative on the left, missing items up top (C-B4: never auto-submitted). */
export function EvidencePacketView({ row, onDecide, conflict, fresh }: EvidencePacketViewProps) {
  const packet = row.packet;
  return (
    <article className={`card rail ${fresh ? "row-enter" : ""}`} style={{ "--rail": "var(--mod-chargeback_evidence)" } as React.CSSProperties} aria-labelledby={`evidence-${row.id}`}>
      <header className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-3">
        <Badge module="chargeback_evidence" dot>
          Evidence packet
        </Badge>
        <span id={`evidence-${row.id}`} className="font-mono text-xs">
          {row.dispute_id}
        </span>
        <Badge tone="warn">{humanize(row.review_status)}</Badge>
        <span className="ml-auto text-xs text-fg-muted">assembled {formatDateTime(row.created_at)}</span>
      </header>
      <div className="p-4">
        {packet.missing.length > 0 ? (
          <div className="mb-4 rounded-xl border border-danger/40 bg-danger/10 px-4 py-3 text-sm">
            <p className="font-medium text-danger">Missing from this packet</p>
            <ul className="mt-1 list-disc pl-5 text-danger">
              {packet.missing.map((item) => (
                <li key={item}>{humanize(item)}</li>
              ))}
            </ul>
          </div>
        ) : (
          <p className="mb-4 rounded-xl border border-ok/40 bg-ok/10 px-4 py-2 text-sm text-ok">Every section of the packet is present.</p>
        )}
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <section>
            <h3 className="text-sm font-medium">AI-drafted narrative</h3>
            <p className="mb-2 mt-1 text-xs text-fg-muted">Written by the model from the masked packet. Read it as a draft, not a fact.</p>
            <div className="rounded-xl border border-warn/40 bg-warn/10 px-4 py-3 text-sm leading-6">
              <Badge tone="warn">AI-generated</Badge>
              <p className="mt-2 whitespace-pre-wrap">{row.narrative ?? "No narrative was drafted (the model was unavailable)."}</p>
            </div>
          </section>
          <section className="flex flex-col gap-3">
            <h3 className="text-sm font-medium">Deterministic facts</h3>
            <Section
              title="Dispute"
              rows={[
                ["Id", packet.dispute.id],
                ["Amount", formatInr(packet.dispute.amount_paise)],
                ["Phase", humanize(packet.dispute.phase)],
                ["Reason", packet.dispute.reason_code ? `${packet.dispute.reason_code} ${packet.dispute.reason_description ?? ""}` : "—"],
                ["Respond by", packet.dispute.respond_by ? formatDateTime(packet.dispute.respond_by) : "—"],
              ]}
            />
            <Section
              title="Payment"
              rows={[
                ["Id", packet.payment.id],
                ["Amount", formatInr(packet.payment.amount_paise)],
                ["Method", text(packet.payment.method)],
                ["Card", packet.payment.card_network ? `${packet.payment.card_network} •••• ${packet.payment.card_last4 ?? "????"}` : "—"],
                ["Captured", packet.payment.captured_at ? formatDateTime(packet.payment.captured_at) : "—"],
                ["International", text(packet.payment.international)],
              ]}
            />
            <Section
              title="Order and customer"
              rows={[
                ["Order", text(packet.order.id)],
                ["Order amount", formatInr(packet.order.amount_paise)],
                ["Items", `${packet.order.items.length}`],
                ["Customer", packet.customer.id_masked],
                ["Country", text(packet.customer.country)],
                ["Account age", `${packet.customer.account_age_days} days`],
                ["Prior disputes", `${packet.prior_disputes}`],
              ]}
            />
            <Section
              title="Delivery"
              rows={
                packet.delivery
                  ? [
                      ["Carrier", text(packet.delivery.carrier)],
                      ["Tracking", text(packet.delivery.tracking)],
                      ["Delivered", packet.delivery.delivered_at ? formatDateTime(packet.delivery.delivered_at) : "—"],
                      ["Proof", text(packet.delivery.proof_url)],
                    ]
                  : [["Delivery", "no delivery record"]]
              }
            />
            <Section
              title="Communications and policy"
              rows={[
                ["Messages", packet.communications.length === 0 ? "none" : packet.communications.map((entry) => `${entry.channel}:${entry.template}`).join(", ")],
                ["Refund policy", packet.refund_policy.summary],
              ]}
            />
          </section>
        </div>
      </div>
      <footer className="border-t border-border px-4 py-3">
        <DecisionForm onDecide={onDecide} conflict={conflict} />
      </footer>
    </article>
  );
}
