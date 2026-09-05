"use client";

import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { humanize } from "@/lib/format";
import type { ComplianceFlagRow, ComplianceFlagStatus } from "@/lib/types";
import { timeAgo, useNow } from "@/lib/useNow";
import { EvidenceHighlight } from "./EvidenceHighlight";
import { RiskBadge } from "./RiskBadge";

export interface FlagCardProps {
  flag: ComplianceFlagRow;
  busy: boolean;
  onStatus: (status: ComplianceFlagStatus) => void;
}

/** One flagged product: keyword evidence, the model's assessment and whether the two agreed. */
export function FlagCard({ flag, busy, onStatus }: FlagCardProps) {
  const now = useNow();
  const keywordCategories = new Set(flag.keyword_hits.map((hit) => hit.category));
  const assessment = flag.llm_assessment;
  const agreement = assessment === null ? "degraded" : keywordCategories.size === 0 ? "model-only" : keywordCategories.has(assessment.category) ? "agree" : "disagree";
  return (
    <article className="card rail px-4 py-3" style={{ "--rail": "var(--mod-compliance)" } as React.CSSProperties}>
      <header className="flex flex-wrap items-center gap-2">
        <RiskBadge level={flag.risk_level} />
        <Badge tone="neutral">{humanize(flag.category)}</Badge>
        <span className="font-mono text-xs text-fg-muted">{flag.product_id}</span>
        <span className="text-sm font-medium">{flag.product_name}</span>
        <span className="ml-auto text-xs text-fg-muted" suppressHydrationWarning>
          {timeAgo(flag.created_at, now)}
        </span>
      </header>

      <div className="mt-2">
        <EvidenceHighlight description={flag.product_description} span={flag.evidence_span} />
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
        <Badge tone={agreement === "agree" ? "ok" : agreement === "disagree" ? "warn" : agreement === "degraded" ? "warn" : "accent"}>
          {agreement === "agree" ? "keywords and model agree" : agreement === "disagree" ? "keywords and model disagree" : agreement === "degraded" ? "model unavailable: keywords only" : "model found it, no keyword hit"}
        </Badge>
        {flag.status === "needs_review" ? <Badge tone="warn">needs review</Badge> : <Badge tone="neutral">{humanize(flag.status)}</Badge>}
        {flag.keyword_hits.length > 0 ? <span className="text-fg-muted">matched: {flag.keyword_hits.map((hit) => hit.pattern).join(", ")}</span> : null}
      </div>

      {assessment ? (
        <p className="mt-2 rounded-lg border border-border bg-surface-2 px-3 py-2 text-xs leading-5 text-fg-muted">
          <span className="font-medium text-fg">Model reasoning:</span> {assessment.reasoning}
        </p>
      ) : null}
      {flag.recommendation ? <p className="mt-2 text-sm">{flag.recommendation}</p> : null}
      {flag.reviewed_by ? <p className="mt-1 text-xs text-fg-muted">Last set by {flag.reviewed_by}</p> : null}

      <div className="mt-3 flex flex-wrap gap-2">
        <Button size="sm" onClick={() => onStatus("acknowledged")} disabled={busy || flag.status === "acknowledged"}>
          Acknowledge
        </Button>
        <Button size="sm" onClick={() => onStatus("resolved")} disabled={busy || flag.status === "resolved"}>
          Mark resolved
        </Button>
        <Button size="sm" variant="ghost" onClick={() => onStatus("false_positive")} disabled={busy || flag.status === "false_positive"}>
          False positive
        </Button>
      </div>
    </article>
  );
}
