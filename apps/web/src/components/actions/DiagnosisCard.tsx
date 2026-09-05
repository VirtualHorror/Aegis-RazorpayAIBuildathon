import { Badge } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";
import { formatMs, formatPercent, humanize } from "@/lib/format";
import type { DiagnosisRow } from "@/lib/types";

function crossCheck(output: Record<string, unknown>): { overridden: boolean; notes: string[] } | null {
  const value = output.cross_check;
  if (typeof value !== "object" || value === null) return null;
  const record = value as Record<string, unknown>;
  const notes = Array.isArray(record.notes) ? record.notes.filter((note): note is string => typeof note === "string") : [];
  return { overridden: record.overridden === true, notes };
}

/** What the model said, what the rules checked, and whether the fallback ran (C-A3, C-A4). */
export function DiagnosisCard({ diagnosis }: { diagnosis: DiagnosisRow | null }) {
  if (!diagnosis) {
    return (
      <Card title="Diagnosis">
        <p className="text-sm text-fg-muted">This action was proposed without a diagnosis: its trigger is projected deterministically.</p>
      </Card>
    );
  }
  const check = crossCheck(diagnosis.output);
  const confidence = Math.max(0, Math.min(1, diagnosis.confidence));
  return (
    <Card
      title="Diagnosis"
      description={`${diagnosis.provider} ${diagnosis.model}${diagnosis.latency_ms !== null ? ` in ${formatMs(diagnosis.latency_ms)}` : ""}`}
      actions={diagnosis.degraded ? <Badge tone="warn">degraded</Badge> : <Badge tone="ok">model</Badge>}
    >
      <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <dt className="text-xs text-fg-muted">Root cause</dt>
          <dd className="mt-0.5 text-sm font-medium">{humanize(diagnosis.root_cause.toLowerCase())}</dd>
        </div>
        <div>
          <dt className="text-xs text-fg-muted">Strategy</dt>
          <dd className="mt-0.5 text-sm font-medium">{humanize(diagnosis.strategy.toLowerCase())}</dd>
        </div>
        <div className="sm:col-span-2">
          <dt className="text-xs text-fg-muted">Confidence {formatPercent(confidence)}</dt>
          <dd className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-surface-2">
            <div className="h-full rounded-full bg-accent" style={{ width: `${confidence * 100}%` }} />
          </dd>
        </div>
        <div className="sm:col-span-2">
          <dt className="text-xs text-fg-muted">Rationale</dt>
          <dd className="mt-0.5 text-sm">{diagnosis.rationale}</dd>
        </div>
        {diagnosis.degraded ? (
          <div className="sm:col-span-2">
            <dt className="text-xs text-fg-muted">Why the rules answered instead</dt>
            <dd className="mt-0.5 text-sm text-warn">{diagnosis.degraded_reason ?? "model unavailable"}</dd>
          </div>
        ) : null}
        {check ? (
          <div className="sm:col-span-2">
            <dt className="text-xs text-fg-muted">Deterministic cross-check {check.overridden ? "(overrode the model)" : "(agreed)"}</dt>
            <dd className="mt-0.5 text-sm">
              {check.notes.length === 0 ? (
                <span className="text-fg-muted">No notes.</span>
              ) : (
                <ul className="list-disc pl-5">
                  {check.notes.map((note, index) => (
                    <li key={index}>{note}</li>
                  ))}
                </ul>
              )}
            </dd>
          </div>
        ) : null}
      </dl>
    </Card>
  );
}
