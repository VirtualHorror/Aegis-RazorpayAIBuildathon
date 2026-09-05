import type { Metadata } from "next";
import { EmptyState } from "@/components/ui/EmptyState";
import { PageHeader } from "@/components/ui/PageHeader";

export const metadata: Metadata = { title: "Settings" };

/** Placeholder route (Task 17 step 17.6); the real page lands in Task 21. */
export default function Page() {
  return (
    <>
      <PageHeader title="Settings" description="Guardrails, the kill switch and the change history." />
      <EmptyState title="Not built yet" body="The guardrail form arrives with Task 21." />
    </>
  );
}
