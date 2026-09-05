import type { Metadata } from "next";
import { EmptyState } from "@/components/ui/EmptyState";
import { PageHeader } from "@/components/ui/PageHeader";

export const metadata: Metadata = { title: "Approvals" };

/** Placeholder route (Task 17 step 17.6); the real page lands in Task 19. */
export default function Page() {
  return (
    <>
      <PageHeader title="Approvals" description="Actions and evidence packets waiting for a human decision." />
      <EmptyState title="Not built yet" body="The approval queues arrive with Task 19." />
    </>
  );
}
