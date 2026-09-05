import type { Metadata } from "next";
import { ApprovalQueue } from "@/components/approvals/ApprovalQueue";
import { PageHeader } from "@/components/ui/PageHeader";
import { api, describeFailure } from "@/lib/api";

export const metadata: Metadata = { title: "Approvals" };
export const dynamic = "force-dynamic";

/** Humans decide (Checklist 19.3): pending actions and evidence packets, each with the deterministic facts beside it. */
export default async function ApprovalsPage() {
  const result = await api.approvals();
  return (
    <>
      <PageHeader title="Approvals" description="Money above the auto-approve limit and every chargeback evidence packet stop here until a person decides." />
      <ApprovalQueue initialActions={result.ok ? result.data.actions : []} initialEvidence={result.ok ? result.data.evidence : []} error={result.ok ? null : describeFailure(result)} />
    </>
  );
}
