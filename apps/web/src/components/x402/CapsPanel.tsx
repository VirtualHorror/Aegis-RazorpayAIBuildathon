import { Card } from "@/components/ui/Card";
import { formatInr } from "@/lib/format";
import type { GuardrailRow, X402PaymentRow } from "@/lib/types";

function paise(rows: readonly GuardrailRow[], key: string): number | null {
  const value = rows.find((row) => row.key === key)?.value;
  return typeof value === "number" ? value : null;
}

/** The caps the facilitator enforces, and what today's settlements have used against them. */
export function CapsPanel({ guardrails, payments }: { guardrails: readonly GuardrailRow[]; payments: readonly X402PaymentRow[] }) {
  const perRequest = paise(guardrails, "x402_max_amount_paise");
  const perPayerDay = paise(guardrails, "x402_daily_cap_per_payer_paise");
  const today = new Date().toISOString().slice(0, 10);
  const settledToday = payments.filter((payment) => payment.status === "settled" && (payment.settled_at ?? "").startsWith(today));
  const byPayer = new Map<string, number>();
  for (const payment of settledToday) {
    const payer = payment.payer ?? "unknown";
    byPayer.set(payer, (byPayer.get(payer) ?? 0) + payment.amount_paise);
  }
  const busiest = [...byPayer.entries()].sort((left, right) => right[1] - left[1])[0];
  return (
    <Card title="Caps" description="Enforced by the facilitator before any settlement is written.">
      <dl className="grid grid-cols-2 gap-3 text-sm">
        <div>
          <dt className="text-xs text-fg-muted">Per request</dt>
          <dd className="mt-0.5 font-mono tabular-nums">{perRequest === null ? "—" : formatInr(perRequest)}</dd>
        </div>
        <div>
          <dt className="text-xs text-fg-muted">Per payer per day</dt>
          <dd className="mt-0.5 font-mono tabular-nums">{perPayerDay === null ? "—" : formatInr(perPayerDay)}</dd>
        </div>
        <div>
          <dt className="text-xs text-fg-muted">Settled today</dt>
          <dd className="mt-0.5 font-mono tabular-nums">{formatInr(settledToday.reduce((total, payment) => total + payment.amount_paise, 0))}</dd>
        </div>
        <div>
          <dt className="text-xs text-fg-muted">Busiest payer today</dt>
          <dd className="mt-0.5 font-mono text-xs">{busiest ? `${busiest[0]} · ${formatInr(busiest[1])}` : "none"}</dd>
        </div>
      </dl>
    </Card>
  );
}
