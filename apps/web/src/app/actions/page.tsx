import type { Metadata } from "next";
import { EmptyState } from "@/components/ui/EmptyState";
import { PageHeader } from "@/components/ui/PageHeader";

export const metadata: Metadata = { title: "Actions" };

/** Placeholder route (Task 17 step 17.6); the real page lands in Task 19. */
export default function Page() {
  return (
    <>
      <PageHeader title="Actions" description="Every proposed, gated and executed action with its bounds and exact outbound payload." />
      <EmptyState title="Not built yet" body="The audit trail arrives with Task 19." />
    </>
  );
}
