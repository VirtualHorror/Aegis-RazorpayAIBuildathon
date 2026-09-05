import type { StreamStatus } from "@/lib/sse";

const LABEL: Record<StreamStatus, string> = { connecting: "Connecting", live: "Live", reconnecting: "Reconnecting" };
const DOT: Record<StreamStatus, string> = { connecting: "bg-fg-muted", live: "bg-ok", reconnecting: "bg-warn" };

/** Live-stream connection state: green when the SSE socket is open, amber while backing off. */
export function StreamPill({ status }: { status: StreamStatus }) {
  return (
    <span className="inline-flex h-7 items-center gap-1.5 rounded-full border border-border px-2 text-[11px] text-fg-muted" title={`Live updates: ${LABEL[status].toLowerCase()}`}>
      <span aria-hidden className={`h-1.5 w-1.5 rounded-full ${DOT[status]}`} />
      <span className="sr-only md:not-sr-only">{LABEL[status]}</span>
    </span>
  );
}
