"use client";

import type { CSSProperties } from "react";
import { Badge, statusTone } from "@/components/ui/Badge";
import { CopyButton } from "@/components/ui/CopyButton";
import { Icon } from "@/components/ui/icons";
import { Td, Tr } from "@/components/ui/Table";
import { eventColorVar, latencyMs } from "@/lib/events";
import { formatDateTime, formatMs } from "@/lib/format";
import { timeAgo } from "@/lib/useNow";
import type { WebhookEventListRow } from "@/lib/types";

export interface EventRowProps {
  row: WebhookEventListRow;
  fresh: boolean;
  onSelect: (eventId: string) => void;
  now: number | null;
}

function railStyle(type: string): CSSProperties {
  return { "--rail": eventColorVar(type) } as CSSProperties;
}

/** One delivery. Colour carries the entity family; every fact is also text (C-F6). */
export function EventRow({ row, fresh, onSelect, now }: EventRowProps) {
  const latency = latencyMs(row);
  return (
    <Tr interactive className={`rail ${fresh ? "row-enter" : ""}`} style={railStyle(row.event_type)} onClick={() => onSelect(row.event_id)}>
      <Td className="whitespace-nowrap">
        <time dateTime={row.received_at} title={formatDateTime(row.received_at)} suppressHydrationWarning>
          {timeAgo(row.received_at, now)}
        </time>
      </Td>
      <Td mono>
        <span className="inline-flex items-center gap-1.5">
          <button type="button" className="rounded-sm text-left hover:underline" onClick={() => onSelect(row.event_id)}>
            {row.event_id}
          </button>
          <span onClick={(event) => event.stopPropagation()}>
            <CopyButton text={row.event_id} label="" className="h-6 px-1.5" />
          </span>
        </span>
      </Td>
      <Td>
        <span className="font-mono text-xs">{row.event_type}</span>
      </Td>
      <Td>
        {row.signature_valid ? (
          <span className="inline-flex items-center gap-1 text-ok">
            <Icon name="check" size={14} />
            <span className="sr-only sm:not-sr-only">valid</span>
          </span>
        ) : (
          <span className="inline-flex items-center gap-1 text-danger">
            <Icon name="x" size={14} />
            <span className="sr-only sm:not-sr-only">invalid</span>
          </span>
        )}
      </Td>
      <Td numeric>{row.duplicate_count > 0 ? <Badge tone="warn">{row.duplicate_count} dup</Badge> : <span className="text-fg-muted">0</span>}</Td>
      <Td>
        <Badge tone={statusTone(row.status)} title={row.last_error ?? undefined}>
          {row.status.replace("_", " ")}
        </Badge>
      </Td>
      <Td numeric mono>
        {latency === null ? <span className="text-fg-muted">—</span> : formatMs(latency)}
      </Td>
    </Tr>
  );
}

/** Card layout for narrow screens (Checklist 18.3). */
export function EventCard({ row, fresh, onSelect, now }: EventRowProps) {
  const latency = latencyMs(row);
  return (
    <li className={`rail card px-4 py-3 ${fresh ? "row-enter" : ""}`} style={railStyle(row.event_type)}>
      <button type="button" className="w-full text-left" onClick={() => onSelect(row.event_id)}>
        <div className="flex items-center justify-between gap-2">
          <span className="font-mono text-xs">{row.event_type}</span>
          <Badge tone={statusTone(row.status)}>{row.status.replace("_", " ")}</Badge>
        </div>
        <div className="mt-1 truncate font-mono text-xs text-fg-muted">{row.event_id}</div>
        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-fg-muted">
          <span suppressHydrationWarning>{timeAgo(row.received_at, now)}</span>
          <span className={row.signature_valid ? "text-ok" : "text-danger"}>{row.signature_valid ? "signature valid" : "signature invalid"}</span>
          {row.duplicate_count > 0 ? <span className="text-warn">{row.duplicate_count} duplicates</span> : null}
          {latency !== null ? <span>{formatMs(latency)}</span> : null}
        </div>
      </button>
    </li>
  );
}
