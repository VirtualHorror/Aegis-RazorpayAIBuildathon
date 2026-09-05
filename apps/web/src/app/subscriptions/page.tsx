import type { Metadata } from "next";
import { SubscriptionTable } from "@/components/entities/SubscriptionTable";
import { EmptyState } from "@/components/ui/EmptyState";
import { PageHeader } from "@/components/ui/PageHeader";
import { api, describeFailure } from "@/lib/api";

export const metadata: Metadata = { title: "Subscriptions" };
export const dynamic = "force-dynamic";

/** Salvage state per subscription; linked from an action's entity (Checklist 21 files). */
export default async function SubscriptionsPage() {
  const result = await api.subscriptions({ limit: 50 });
  return (
    <>
      <PageHeader title="Subscriptions" description="Renewal state and where each subscription sits in the dunning machine." />
      {result.ok ? <SubscriptionTable rows={result.data.items} /> : <EmptyState title="Subscriptions could not be loaded" body={describeFailure(result)} />}
    </>
  );
}
