import { KpiTile } from "@/components/ui/KpiTile";
import { formatInr } from "@/lib/format";
import type { MetricsSummary } from "@/lib/types";

export interface MoneyStripProps {
  metrics: MetricsSummary | null;
  flash: { actions: number; x402: number };
}

/** Ledger aggregates in rupees; formatting happens here, never in the API (C-B6). */
export function MoneyStrip({ metrics, flash }: MoneyStripProps) {
  const money = metrics?.money;
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      <KpiTile label="Money recovered" value={money ? formatInr(money.recovered_paise) : ""} hint="captured inside the attribution window" tone="ok" loading={!metrics} flashKey={flash.actions} />
      <KpiTile label="Discounts granted" value={money ? formatInr(money.discounts_granted_paise) : ""} hint="never below an invoice floor" loading={!metrics} flashKey={flash.actions} />
      <KpiTile label="x402 revenue" value={money ? formatInr(money.x402_revenue_paise) : ""} hint="simulated settlements from AI buyers" loading={!metrics} flashKey={flash.x402} />
      <KpiTile label="Chargeback exposure" value={money ? formatInr(money.chargeback_exposure_paise) : ""} hint="disputes awaiting evidence" tone={money && money.chargeback_exposure_paise > 0 ? "danger" : "neutral"} loading={!metrics} />
    </div>
  );
}
