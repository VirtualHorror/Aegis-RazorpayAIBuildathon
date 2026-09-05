import type { Metadata } from "next";
import { FlagList } from "@/components/compliance/FlagList";
import { PageHeader } from "@/components/ui/PageHeader";
import { api, describeFailure } from "@/lib/api";

export const metadata: Metadata = { title: "Compliance" };
export const dynamic = "force-dynamic";

/** Catalog risk with the evidence span highlighted in the product's own words (Checklist 20.2). */
export default async function CompliancePage() {
  const flags = await api.complianceFlags();
  return (
    <>
      <PageHeader
        title="Compliance"
        description="Catalog copy that could breach payment rules. A fixed keyword list runs first, a fast model classifies second, and every quoted span is checked against the product's own words."
      />
      <FlagList initialFlags={flags.ok ? flags.data : []} error={flags.ok ? null : describeFailure(flags)} />
    </>
  );
}
