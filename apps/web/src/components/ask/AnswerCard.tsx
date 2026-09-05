"use client";

import { Badge } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";
import { Icon } from "@/components/ui/icons";
import { formatCount, formatMs } from "@/lib/format";
import type { AskResponse } from "@/lib/types";
import { ForecastChart } from "./ForecastChart";
import { ResultTable } from "./ResultTable";
import { SqlBlock } from "./SqlBlock";

export interface AnswerCardProps {
  question: string;
  answer: AskResponse;
  latencyMs: number | null;
  provider: string | null;
}

/**
 * One answer: the SQL that was generated, whether it passed validation, the rows, and the summary — in that order,
 * because the SQL is the auditable artefact and the prose is the least trustworthy part (C-A2, C-A5).
 */
export function AnswerCard({ question, answer, latencyMs, provider }: AnswerCardProps) {
  const validationOk = answer.kind === "forecast" || answer.validation.ok;
  const errors = answer.kind === "query" && answer.validation.errors ? answer.validation.errors : [];
  return (
    <Card
      title={question}
      description={
        <span className="flex flex-wrap items-center gap-2">
          <Badge tone={answer.kind === "forecast" ? "accent" : "neutral"}>{answer.kind === "forecast" ? `forecast · ${answer.metric.replaceAll("_", " ")}` : "query"}</Badge>
          {answer.degraded ? <Badge tone="warn">degraded: written by rules, not the model</Badge> : null}
          {provider ? <span className="font-mono text-[11px]">{provider}</span> : null}
          {latencyMs !== null ? <span className="font-mono text-[11px]">{formatMs(latencyMs)}</span> : null}
        </span>
      }
    >
      <div className="flex flex-col gap-4">
        {answer.kind === "query" ? (
          answer.sql ? (
            <SqlBlock
              sql={answer.sql}
              actions={
                validationOk ? (
                  <Badge tone="ok" dot>
                    validated
                  </Badge>
                ) : (
                  <Badge tone="danger" dot>
                    rejected
                  </Badge>
                )
              }
            />
          ) : (
            <p className="text-sm text-danger">No SQL was generated: the model was unavailable and this question has no deterministic fallback.</p>
          )
        ) : (
          <SqlBlock sql={answer.sql} label="Metric query (written in TypeScript, not by the model)" actions={<Badge tone="ok" dot>deterministic</Badge>} />
        )}

        {errors.length > 0 ? (
          <div className="rounded-xl border border-danger/40 bg-danger/10 px-4 py-3 text-sm">
            <p className="flex items-center gap-2 font-medium text-danger">
              <Icon name="alert" size={16} /> The validator refused this SQL. Nothing was executed.
            </p>
            <ul className="mt-1 list-disc pl-5 text-danger">
              {errors.map((error, index) => (
                <li key={index}>{error}</li>
              ))}
            </ul>
          </div>
        ) : null}

        {answer.error && errors.length === 0 ? <p className="rounded-xl border border-danger/40 bg-danger/10 px-4 py-3 text-sm text-danger">{answer.error}</p> : null}

        {answer.kind === "forecast" ? (
          <ForecastChart answer={answer} />
        ) : answer.executed ? (
          <div>
            <h3 className="mb-1 text-xs text-fg-muted">{formatCount(answer.rows.length)} rows from the read-only role</h3>
            <ResultTable rows={answer.rows} />
          </div>
        ) : null}

        {answer.summary ? (
          <div className="rounded-xl border border-border bg-surface-2 px-4 py-3">
            <Badge tone={answer.degraded ? "warn" : "accent"}>{answer.degraded ? "Written by rules" : "AI-written summary"}</Badge>
            <p className="mt-2 text-sm leading-6">{answer.summary}</p>
          </div>
        ) : null}
      </div>
    </Card>
  );
}
