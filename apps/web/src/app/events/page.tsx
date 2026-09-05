import type { Metadata } from "next";
import { EventFeed } from "@/components/events/EventFeed";
import { PageHeader } from "@/components/ui/PageHeader";
import { api, describeFailure } from "@/lib/api";

export const metadata: Metadata = { title: "Events" };
export const dynamic = "force-dynamic";

function single(value: string | string[] | undefined): string | undefined {
  const item = Array.isArray(value) ? value[0] : value;
  return item && item.length > 0 ? item : undefined;
}

/** Server-rendered first page of `GET /api/v1/events`; the client feed takes over with SSE (Checklist 18.2). */
export default async function EventsPage({ searchParams }: PageProps<"/events">) {
  const params = await searchParams;
  const filters = { type: single(params.type), status: single(params.status) };
  const result = await api.events({ ...filters, limit: 50 });
  return (
    <>
      <PageHeader title="Events" description="Every webhook delivery: verified with the raw bytes, deduplicated by event id, processed exactly once." />
      <EventFeed
        key={`${filters.type ?? ""}|${filters.status ?? ""}`}
        initial={result.ok ? result.data : { items: [], next: null }}
        filters={filters}
        error={result.ok ? null : describeFailure(result)}
      />
    </>
  );
}
