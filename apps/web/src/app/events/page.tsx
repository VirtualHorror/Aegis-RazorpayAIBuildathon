import type { Metadata } from "next";
import { EmptyState } from "@/components/ui/EmptyState";
import { PageHeader } from "@/components/ui/PageHeader";

export const metadata: Metadata = { title: "Events" };

/** Placeholder route (Task 17 step 17.6); the real page lands in Task 18. */
export default function Page() {
  return (
    <>
      <PageHeader title="Events" description="Every webhook delivery: verified, deduplicated, processed." />
      <EmptyState title="Not built yet" body="The live ingress feed arrives with Task 18." />
    </>
  );
}
