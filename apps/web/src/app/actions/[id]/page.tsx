import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ActionDetailView } from "@/components/actions/ActionDetailView";
import { ButtonLink } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { Icon } from "@/components/ui/icons";
import { PageHeader } from "@/components/ui/PageHeader";
import { api, describeFailure } from "@/lib/api";

export const metadata: Metadata = { title: "Action" };
export const dynamic = "force-dynamic";

/** Full-page audit trail for one action (Checklist 19.2). */
export default async function ActionPage({ params }: PageProps<"/actions/[id]">) {
  const { id } = await params;
  const result = await api.action(id);
  if (!result.ok && result.status === 404) notFound();
  return (
    <>
      <PageHeader title="Action" description={<span className="font-mono">{id}</span>} actions={<ButtonLink href="/actions" size="sm" icon={<Icon name="arrowLeft" size={14} />}>All actions</ButtonLink>} />
      {result.ok ? <ActionDetailView detail={result.data} /> : <EmptyState title="The action could not be loaded" body={describeFailure(result)} />}
    </>
  );
}
