"use client";

import { useRef, useState } from "react";
import { HalftoneField } from "@/components/fx/HalftoneField";
import { StreamPill } from "@/components/shell/StreamPill";
import { useSystem } from "@/components/shell/SystemProvider";
import { RunDemoButton } from "@/components/shell/RunDemoButton";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { Table, TableWrap, Th } from "@/components/ui/Table";
import { useToast } from "@/components/ui/Toast";
import { api, describeFailure } from "@/lib/api";
import { appendPage, eventIdOf, matchesSearch, mergeStreamEvent } from "@/lib/events";
import { useEventStream, useStreamEffect } from "@/lib/sse";
import { timeAgo, useNow } from "@/lib/useNow";
import type { Paged, WebhookEventListRow } from "@/lib/types";
import { EventDrawer } from "./EventDrawer";
import { EventFilters } from "./EventFilters";
import { EventCard, EventRow } from "./EventRow";

export interface EventFeedProps {
  initial: Paged<WebhookEventListRow>;
  filters: { type?: string; status?: string };
  error: string | null;
}

const IDLE_INTENSITY = 0.3;

/**
 * Live ingress feed (Design.md §4, Checklist 18.2).
 * Flow: server-rendered first page -> SSE notifications are merged into the rows (new rows slide in and flash their
 *       family colour) -> the halftone backdrop pulses -> "Load more" pages with the API cursor -> a row opens the drawer.
 */
export function EventFeed({ initial, filters, error }: EventFeedProps) {
  const [rows, setRows] = useState(initial.items);
  const [next, setNext] = useState(initial.next);
  const [fresh, setFresh] = useState<ReadonlySet<string>>(() => new Set());
  const [intensity, setIntensity] = useState(IDLE_INTENSITY);
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [lastEventAt, setLastEventAt] = useState<number | null>(null);
  const decay = useRef<ReturnType<typeof setTimeout> | null>(null);
  const toast = useToast();
  const system = useSystem();
  const { status } = useEventStream([]);
  const now = useNow();

  useStreamEffect(["event.received", "event.duplicate", "event.rejected", "event.processed"], (event) => {
    const now = Date.now();
    let changed: string | null = null;
    setRows((current) => {
      const result = mergeStreamEvent(current, event, now);
      changed = result.changed;
      return result.changed ? result.rows : current;
    });
    const id = eventIdOf(event.data);
    if (id) {
      setFresh((current) => new Set(current).add(id));
      setTimeout(() => setFresh((current) => {
        const copy = new Set(current);
        copy.delete(id);
        return copy;
      }), 1_200);
    }
    setLastEventAt(now);
    setIntensity(1);
    if (decay.current) clearTimeout(decay.current);
    decay.current = setTimeout(() => setIntensity(IDLE_INTENSITY), 1_500);
    void changed;
  });

  const loadMore = async () => {
    if (!next) return;
    setLoadingMore(true);
    const result = await api.events({ ...filters, limit: 50, before: next });
    setLoadingMore(false);
    if (!result.ok) {
      toast.push({ title: "Could not load more events", body: describeFailure(result), tone: "danger" });
      return;
    }
    setRows((current) => appendPage(current, result.data.items));
    setNext(result.data.next);
  };

  const visible = rows.filter((row) => matchesSearch(row, search));
  const seenTypes = Array.from(new Set(rows.map((row) => row.event_type)));
  const listening =
    status === "live"
      ? lastEventAt
        ? `Live. Last delivery ${timeAgo(lastEventAt, now)}.`
        : "Live. Waiting for the next delivery."
      : status === "reconnecting"
        ? "Reconnecting to the API stream."
        : "Connecting to the API stream.";

  return (
    <div className="flex flex-col gap-4">
      <div className="card relative h-24 overflow-hidden">
        <div className="absolute inset-0 opacity-40">
          <HalftoneField intensity={intensity} />
        </div>
        <div aria-hidden className="absolute inset-y-0 left-0 w-2/3 bg-gradient-to-r from-surface via-surface/85 to-transparent" />
        <div className="relative flex h-full items-center justify-between gap-3 px-4">
          <div className="min-w-0">
            <div className="text-sm font-medium">Listening for webhooks</div>
            <div className="truncate text-xs text-fg-muted">{listening}</div>
          </div>
          <StreamPill status={status} />
        </div>
      </div>

      <EventFilters filters={filters} seenTypes={seenTypes} search={search} onSearch={setSearch} />

      {error ? (
        <EmptyState title="The events list could not be loaded" body={error} action={<Button onClick={() => window.location.reload()}>Try again</Button>} />
      ) : visible.length === 0 ? (
        <EmptyState
          title={rows.length === 0 ? "No events yet" : "No loaded event matches that search"}
          body={rows.length === 0 ? "Deliveries appear here the moment the ingress commits them. Run the demo to send signed webhooks now." : "Clear the search or load more pages."}
          backdrop={<HalftoneField intensity={0.5} className="opacity-30" />}
          action={rows.length === 0 ? <RunDemoButton env={system.system?.env ?? null} apiState={system.api} /> : undefined}
        />
      ) : (
        <div aria-live="polite" aria-relevant="additions">
          <TableWrap className="hidden sm:block">
            <Table>
              <thead>
                <tr>
                  <Th>Received</Th>
                  <Th>Event id</Th>
                  <Th>Type</Th>
                  <Th>Signature</Th>
                  <Th numeric>Dupes</Th>
                  <Th>Status</Th>
                  <Th numeric>Latency</Th>
                </tr>
              </thead>
              <tbody>
                {visible.map((row) => (
                  <EventRow key={row.event_id} row={row} fresh={fresh.has(row.event_id)} onSelect={setSelected} now={now} />
                ))}
              </tbody>
            </Table>
          </TableWrap>
          <ul className="flex flex-col gap-2 sm:hidden">
            {visible.map((row) => (
              <EventCard key={row.event_id} row={row} fresh={fresh.has(row.event_id)} onSelect={setSelected} now={now} />
            ))}
          </ul>
        </div>
      )}

      {next && !error ? (
        <div className="flex justify-center">
          <Button onClick={loadMore} loading={loadingMore}>
            Load older events
          </Button>
        </div>
      ) : null}

      <EventDrawer eventId={selected} onClose={() => setSelected(null)} />
    </div>
  );
}
