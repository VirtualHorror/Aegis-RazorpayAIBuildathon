import type { Metadata } from "next";
import { EmptyState } from "@/components/ui/EmptyState";
import { PageHeader } from "@/components/ui/PageHeader";

export const metadata: Metadata = { title: "x402 Lab" };

/** Placeholder route (Task 17 step 17.6); the real page lands in Task 21. */
export default function Page() {
  return (
    <>
      <PageHeader title="x402 Lab" description="Sell to AI buyers: challenge, pay, and watch a replay get rejected." />
      <EmptyState title="Not built yet" body="The three-step lab arrives with Task 21." />
    </>
  );
}
