"use client";

import { useState } from "react";
import { GlowInput } from "@/components/ui/GlowInput";
import { Icon } from "@/components/ui/icons";
import { api, describeFailure } from "@/lib/api";
import type { AskHistoryRow, AskResponse } from "@/lib/types";
import { AnswerCard } from "./AnswerCard";
import { History } from "./History";

export interface AskComposerProps {
  initialHistory: AskHistoryRow[];
  historyError: string | null;
}

const SUGGESTIONS: readonly string[] = [
  "How much revenue did we recover this week by module?",
  "Which payment error codes failed most often in the last 7 days?",
  "Forecast recovered revenue for the next 7 days",
  "How many actions did humans reject and why?",
];

interface Answered {
  question: string;
  answer: AskResponse;
  latencyMs: number;
}

/**
 * Ask Aegis (Checklist 20.1).
 * Flow: question -> POST /api/v1/ask -> the model proposes SQL, the AST validator accepts or refuses it, the read-only
 *       role executes it -> the answer card shows the SQL first, then the verdict, rows and the labelled summary.
 */
export function AskComposer({ initialHistory, historyError }: AskComposerProps) {
  const [question, setQuestion] = useState("");
  const [loading, setLoading] = useState(false);
  const [answers, setAnswers] = useState<Answered[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [history, setHistory] = useState(initialHistory);

  const ask = async (value: string) => {
    setLoading(true);
    setError(null);
    const started = performance.now();
    const result = await api.ask(value);
    const latencyMs = Math.round(performance.now() - started);
    setLoading(false);
    if (!result.ok) {
      setError(describeFailure(result));
      return;
    }
    setAnswers((current) => [{ question: value, answer: result.data, latencyMs }, ...current].slice(0, 10));
    setQuestion("");
    const refreshed = await api.askHistory(20);
    if (refreshed.ok) setHistory(refreshed.data.items);
  };

  const provider = history[0]?.provider ?? null;

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
      <div className="flex min-w-0 flex-col gap-4 lg:col-span-2">
        <GlowInput
          value={question}
          onChange={setQuestion}
          onSubmit={ask}
          loading={loading}
          label="Ask Aegis a question about your business"
          placeholder="Ask about payments, recoveries, disputes or the next seven days…"
          example={SUGGESTIONS[0]}
          leading={<Icon name="sparkles" />}
          submitLabel="Ask"
        />
        <div className="flex flex-wrap gap-2">
          {SUGGESTIONS.map((suggestion) => (
            <button
              key={suggestion}
              type="button"
              disabled={loading}
              onClick={() => {
                setQuestion(suggestion);
                void ask(suggestion);
              }}
              className="rounded-full border border-border bg-surface px-3 py-1.5 text-xs text-fg-muted hover:bg-surface-2 hover:text-fg disabled:opacity-50"
            >
              {suggestion}
            </button>
          ))}
        </div>

        {error ? <p className="rounded-xl border border-danger/40 bg-danger/10 px-4 py-3 text-sm text-danger">{error}</p> : null}

        {answers.length === 0 && !loading ? (
          <div className="card px-6 py-10 text-center">
            <h2 className="text-sm font-medium">Ask in plain language</h2>
            <p className="mx-auto mt-1 max-w-md text-sm text-fg-muted">
              The model writes SQL; a parser checks it against an allowlist of tables and refuses anything that is not a single read. The query then runs as a role that cannot see personal data and
              cannot write.
            </p>
          </div>
        ) : null}

        <div aria-live="polite" className="flex flex-col gap-4">
          {answers.map((entry, index) => (
            <AnswerCard key={`${entry.question}-${index}`} question={entry.question} answer={entry.answer} latencyMs={entry.latencyMs} provider={index === 0 ? provider : null} />
          ))}
        </div>
      </div>

      <div className="min-w-0">
        {historyError ? <p className="mb-3 text-xs text-danger">{historyError}</p> : null}
        <History rows={history} onAsk={(value) => setQuestion(value)} />
      </div>
    </div>
  );
}
