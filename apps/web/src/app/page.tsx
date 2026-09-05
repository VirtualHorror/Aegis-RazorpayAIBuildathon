import { AEGIS_VERSION } from "@aegis/shared";
import type { Metadata } from "next";
import { Card } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { PageHeader } from "@/components/ui/PageHeader";
import { API_URL, getHealth } from "@/lib/api";

export const metadata: Metadata = { title: "Overview" };
export const dynamic = "force-dynamic";

/**
 * Overview placeholder for Task 17: the shell proves the three packages are wired (web → API over HTTP, web → shared)
 * and shows the API/DB state honestly. The KPI grid, recent actions and the prism arrive in Tasks 18 and 22.
 */
export default async function OverviewPage() {
  const result = await getHealth();
  const apiLine = result.reachable
    ? `API ${result.health.version} · ${result.health.status} · db ${result.health.db}${result.health.error ? ` (${result.health.error})` : ""}`
    : `API unreachable at ${API_URL} (${result.error})`;
  const tone = !result.reachable ? "text-danger" : result.health.status === "ok" ? "text-ok" : "text-warn";

  return (
    <>
      <PageHeader title="Overview" description="One event stream in. Specialised, guard-railed actions out. Every money action explainable, bounded and gated." />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Card title="System">
          <p className={`font-mono text-sm ${tone}`}>{apiLine}</p>
          <p className="mt-1 font-mono text-xs text-fg-muted">shared {AEGIS_VERSION} · web 0.1.0</p>
        </Card>
        <EmptyState compact title="Metrics arrive with Task 18" body="Events, actions, recovered money, x402 revenue and model health will fill this screen from the live API." />
      </div>
    </>
  );
}
