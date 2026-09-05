"use client";

import { KNOWN_EVENT_TYPES, WEBHOOK_EVENT_STATUSES } from "@aegis/shared";
import { useRouter } from "next/navigation";
import { GlowInput } from "@/components/ui/GlowInput";
import { Icon } from "@/components/ui/icons";

export interface EventFiltersProps {
  filters: { type?: string; status?: string };
  /** Types seen on the loaded page, merged with the known Razorpay list. */
  seenTypes: readonly string[];
  search: string;
  onSearch: (value: string) => void;
}

const SELECT = "h-9 rounded-lg border border-border bg-surface px-2.5 text-sm text-fg";

/** Type/status filters live in the URL (server-rendered first page); the search box narrows the loaded rows. */
export function EventFilters({ filters, seenTypes, search, onSearch }: EventFiltersProps) {
  const router = useRouter();
  const types = Array.from(new Set([...KNOWN_EVENT_TYPES, ...seenTypes, "settlement.processed", "unknown"])).sort();

  const apply = (next: { type?: string; status?: string }) => {
    const params = new URLSearchParams();
    if (next.type) params.set("type", next.type);
    if (next.status) params.set("status", next.status);
    const query = params.toString();
    router.push(query ? `/events?${query}` : "/events");
  };

  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
      <div className="min-w-0 flex-1">
        <GlowInput compact value={search} onChange={onSearch} onSubmit={onSearch} label="Search loaded events" placeholder="Search by event id or type" leading={<Icon name="search" size={14} />} submitLabel="Search" />
      </div>
      <label className="flex items-center gap-2 text-xs text-fg-muted">
        <span>Type</span>
        <select className={SELECT} value={filters.type ?? ""} onChange={(event) => apply({ ...filters, type: event.target.value || undefined })}>
          <option value="">All types</option>
          {types.map((type) => (
            <option key={type} value={type}>
              {type}
            </option>
          ))}
        </select>
      </label>
      <label className="flex items-center gap-2 text-xs text-fg-muted">
        <span>Status</span>
        <select className={SELECT} value={filters.status ?? ""} onChange={(event) => apply({ ...filters, status: event.target.value || undefined })}>
          <option value="">All statuses</option>
          {WEBHOOK_EVENT_STATUSES.map((status) => (
            <option key={status} value={status}>
              {status.replace("_", " ")}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}
