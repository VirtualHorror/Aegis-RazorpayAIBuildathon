import type { Metadata } from "next";
import { InvoiceTable } from "@/components/entities/InvoiceTable";
import { EmptyState } from "@/components/ui/EmptyState";
import { PageHeader } from "@/components/ui/PageHeader";
import { api, describeFailure } from "@/lib/api";

export const metadata: Metadata = { title: "Invoices" };
export const dynamic = "force-dynamic";

/** B2B invoices with the floor the negotiator may never cross (Checklist 21 files). */
export default async function InvoicesPage() {
  const result = await api.invoices({ limit: 50 });
  return (
    <>
      <PageHeader title="Invoices" description="Every B2B invoice, its merchant floor, and where the bounded negotiation has reached." />
      {result.ok ? <InvoiceTable rows={result.data.items} /> : <EmptyState title="Invoices could not be loaded" body={describeFailure(result)} />}
    </>
  );
}
