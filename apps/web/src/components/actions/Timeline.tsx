import { timelineEntries } from "@/lib/actions";
import { formatDateTime } from "@/lib/format";
import type { ActionDetail } from "@/lib/types";

const DOT: Record<string, string> = { neutral: "bg-fg-muted", ok: "bg-ok", warn: "bg-warn", danger: "bg-danger", accent: "bg-accent" };

/** Oldest first: proposal, diagnosis, decision, execution, messages, ledger and audit rows. */
export function Timeline({ detail }: { detail: ActionDetail }) {
  const entries = timelineEntries(detail);
  return (
    <ol className="relative ml-2 border-l border-border pl-5">
      {entries.map((entry, index) => (
        <li key={`${entry.at}-${index}`} className="relative pb-4 last:pb-0">
          <span aria-hidden className={`absolute -left-[26px] top-1.5 h-2.5 w-2.5 rounded-full ${DOT[entry.tone]}`} />
          <div className="text-sm font-medium">{entry.title}</div>
          {entry.detail ? <div className="text-xs text-fg-muted">{entry.detail}</div> : null}
          <time dateTime={entry.at} className="font-mono text-[11px] text-fg-muted">
            {formatDateTime(entry.at)}
          </time>
        </li>
      ))}
    </ol>
  );
}
