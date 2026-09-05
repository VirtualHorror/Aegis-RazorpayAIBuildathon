import type { Metadata } from "next";
import { EmptyState } from "@/components/ui/EmptyState";
import { PageHeader } from "@/components/ui/PageHeader";

export const metadata: Metadata = { title: "Ask Aegis" };

/** Placeholder route (Task 17 step 17.6); the real page lands in Task 20. */
export default function Page() {
  return (
    <>
      <PageHeader title="Ask Aegis" description="Ask a question in plain language; the SQL is validated before anything runs." />
      <EmptyState title="Not built yet" body="The composer arrives with Task 20." />
    </>
  );
}
