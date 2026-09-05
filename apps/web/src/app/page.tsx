import type { Metadata } from "next";
import { OverviewLive } from "@/components/overview/OverviewLive";
import { PageHeader } from "@/components/ui/PageHeader";
import { api, describeFailure } from "@/lib/api";

export const metadata: Metadata = { title: "Overview" };
export const dynamic = "force-dynamic";

/** The pitch in one screen (Design.md §4): server-rendered numbers, then live through the bus (Checklist 18.1). */
export default async function OverviewPage() {
  const [metrics, actions] = await Promise.all([api.metrics("24h"), api.actions({ limit: 8 })]);
  return (
    <>
      <PageHeader title="Overview" description="One event stream in. Specialised, guard-railed actions out. Every money action explainable, bounded and gated." />
      <OverviewLive
        initialMetrics={metrics.ok ? metrics.data : null}
        initialActions={actions.ok ? actions.data.items : []}
        initialError={metrics.ok ? null : describeFailure(metrics)}
      />
    </>
  );
}
