import type { Metadata } from "next";
import { EmptyState } from "@/components/ui/EmptyState";
import { PageHeader } from "@/components/ui/PageHeader";

export const metadata: Metadata = { title: "Compliance" };

/** Placeholder route (Task 17 step 17.6); the real page lands in Task 20. */
export default function Page() {
  return (
    <>
      <PageHeader title="Compliance" description="Catalog copy that could breach payment rules, with the evidence highlighted." />
      <EmptyState title="Not built yet" body="The flag list arrives with Task 20." />
    </>
  );
}
