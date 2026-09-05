"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { useToast } from "@/components/ui/Toast";
import { useActor } from "@/lib/actor";
import { api, describeFailure } from "@/lib/api";
import { GUARDRAIL_SPECS, formatGuardrail, guardrailUnit, parseGuardrail } from "@/lib/guardrails";
import type { GuardrailRow } from "@/lib/types";

export interface GuardrailFormProps {
  rows: readonly GuardrailRow[];
  onSaved: (row: GuardrailRow) => void;
}

/** One field per editable guardrail; the kill switch has its own control above (Checklist 21.2). */
export function GuardrailForm({ rows, onSaved }: GuardrailFormProps) {
  const editable = rows.filter((row) => row.key !== "kill_switch" && row.key in GUARDRAIL_SPECS);
  return (
    <Card title="Guardrails" description="Every bound the modules read before proposing an action. Changes take effect on the next job, and each edit is audited.">
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {editable.map((row) => (
          <GuardrailField key={row.key} row={row} onSaved={onSaved} />
        ))}
      </div>
    </Card>
  );
}

function GuardrailField({ row, onSaved }: { row: GuardrailRow; onSaved: (row: GuardrailRow) => void }) {
  const spec = GUARDRAIL_SPECS[row.key];
  const toast = useToast();
  const actor = useActor();
  const [text, setText] = useState(() => formatGuardrail(row.key, row.value));
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const stored = formatGuardrail(row.key, row.value);
  const dirty = text !== stored;
  const unit = guardrailUnit(row.key);

  const save = async () => {
    const parsed = parseGuardrail(row.key, text);
    if (!parsed.ok) {
      setError(parsed.error ?? "That value cannot be used.");
      return;
    }
    setError(null);
    setSaving(true);
    const result = await api.updateGuardrail(row.key, parsed.value, actor);
    setSaving(false);
    if (!result.ok) {
      setError(describeFailure(result));
      return;
    }
    onSaved(result.data.guardrail);
    setText(formatGuardrail(row.key, result.data.guardrail.value));
    toast.push({ title: `${spec?.label ?? row.key} updated`, body: `Recorded as ${actor}.`, tone: "ok" });
  };

  return (
    <div>
      <label className="text-sm font-medium" htmlFor={`guardrail-${row.key}`}>
        {spec?.label ?? row.key}
      </label>
      <p className="mt-0.5 text-xs text-fg-muted">{row.description}</p>
      <div className="mt-1.5 flex items-center gap-2">
        {unit === "₹" ? <span className="text-sm text-fg-muted">₹</span> : null}
        <input
          id={`guardrail-${row.key}`}
          value={text}
          onChange={(event) => {
            setText(event.target.value);
            setError(null);
          }}
          aria-invalid={error !== null ? true : undefined}
          aria-describedby={error ? `guardrail-${row.key}-error` : undefined}
          className={`h-9 min-w-0 flex-1 rounded-lg border bg-surface px-2.5 font-mono text-sm text-fg ${error ? "border-danger" : "border-border"}`}
        />
        {unit && unit !== "₹" ? <span className="text-xs text-fg-muted">{unit}</span> : null}
        <Button size="sm" onClick={save} loading={saving} disabled={!dirty}>
          Save
        </Button>
      </div>
      {spec?.hint ? <p className="mt-1 text-xs text-fg-muted">{spec.hint}</p> : null}
      {error ? (
        <p id={`guardrail-${row.key}-error`} className="mt-1 text-xs text-danger">
          {error}
        </p>
      ) : null}
      <p className="mt-1 text-[11px] text-fg-muted">
        Stored: <span className="font-mono">{typeof row.value === "object" ? JSON.stringify(row.value) : String(row.value)}</span> · last set by {row.updated_by}
      </p>
    </div>
  );
}
