import { Icon } from "@/components/ui/icons";
import { formatBound, ruleSummary } from "@/lib/actions";
import { humanize } from "@/lib/format";
import type { GuardRule } from "@/lib/types";

/** Every guardrail evaluated for the action, pass and fail alike (C-B1): rule, limit versus actual, note. */
export function BoundsChecklist({ bounds }: { bounds: readonly GuardRule[] }) {
  if (bounds.length === 0) return <p className="text-sm text-fg-muted">No guard rules were recorded for this action.</p>;
  const summary = ruleSummary(bounds);
  return (
    <div>
      <p className="mb-2 text-xs text-fg-muted">
        {summary.passed} passed, {summary.failed} failed
      </p>
      <ul className="divide-y divide-border rounded-xl border border-border">
        {bounds.map((rule, index) => (
          <li key={`${rule.rule}-${index}`} className="flex items-start gap-3 px-3 py-2 text-sm">
            <span className={`mt-0.5 shrink-0 ${rule.pass ? "text-ok" : "text-danger"}`} aria-hidden>
              <Icon name={rule.pass ? "check" : "x"} size={16} />
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-baseline gap-x-2">
                <span className="font-medium">{humanize(rule.rule)}</span>
                <span className="sr-only">{rule.pass ? "passed" : "failed"}</span>
              </div>
              {/* Values can be long JSON (quiet hours, schedules), so each column wraps inside its own track. */}
              <div className="mt-0.5 grid grid-cols-1 gap-x-4 font-mono text-xs text-fg-muted sm:grid-cols-2">
                <span className="min-w-0 break-words">
                  limit <span className="text-fg">{formatBound(rule.rule, rule.limit)}</span>
                </span>
                <span className="min-w-0 break-words">
                  actual <span className={rule.pass ? "text-fg" : "text-danger"}>{formatBound(rule.rule, rule.actual)}</span>
                </span>
              </div>
              {rule.note ? <p className="mt-0.5 text-xs text-fg-muted">{rule.note}</p> : null}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
