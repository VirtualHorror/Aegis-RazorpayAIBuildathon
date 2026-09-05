import type { Metadata } from "next";
import { KitchenSink } from "@/components/dev/KitchenSink";
import { PageHeader } from "@/components/ui/PageHeader";

export const metadata: Metadata = { title: "Kitchen sink" };

/** Dev route (not in the nav): every UI component in the current theme and the opposite one. */
export default function KitchenSinkPage() {
  return (
    <>
      <PageHeader title="Kitchen sink" description="Every UI component, rendered in the current theme and in the opposite theme side by side." />
      <KitchenSink />
    </>
  );
}
