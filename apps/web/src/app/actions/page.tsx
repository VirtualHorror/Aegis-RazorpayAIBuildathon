import type { Metadata } from "next";
import { ActionTable } from "@/components/actions/ActionTable";
import { PageHeader } from "@/components/ui/PageHeader";
import { api, describeFailure } from "@/lib/api";

export const metadata: Metadata = { title: "Actions" };
export const dynamic = "force-dynamic";

function single(value: string | string[] | undefined): string | undefined {
  const item = Array.isArray(value) ? value[0] : value;
  return item && item.length > 0 ? item : undefined;
}

/** Audit trail: every proposed, gated and executed action (Checklist 19.1). */
export default async function ActionsPage({ searchParams }: PageProps<"/actions">) {
  const params = await searchParams;
  const filters = { status: single(params.status), module: single(params.module) };
  const result = await api.actions({ ...filters, limit: 50 });
  return (
    <>
      <PageHeader title="Actions" description="Every proposed, gated and executed action with its guardrails, its diagnosis and the exact outbound payload." />
      <ActionTable key={`${filters.status ?? ""}|${filters.module ?? ""}`} initial={result.ok ? result.data : { items: [], next: null }} filters={filters} error={result.ok ? null : describeFailure(result)} />
    </>
  );
}
