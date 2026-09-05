"use client";

import { useId, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/icons";

export interface DecisionFormProps {
  onDecide: (decision: "approve" | "reject", note: string) => Promise<void>;
  /** Set by the parent when the API answered 409: someone else decided first. */
  conflict: string | null;
  disabled?: boolean;
}

/** A note is required (audit_log carries it); both buttons lock while a request is in flight (Checklist 19.3). */
export function DecisionForm({ onDecide, conflict, disabled = false }: DecisionFormProps) {
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState<"approve" | "reject" | null>(null);
  const [touched, setTouched] = useState(false);
  const id = useId();
  const valid = note.trim().length >= 3;

  const submit = async (decision: "approve" | "reject") => {
    setTouched(true);
    if (!valid || busy) return;
    setBusy(decision);
    try {
      await onDecide(decision, note.trim());
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="flex flex-col gap-2">
      <label htmlFor={id} className="text-xs text-fg-muted">
        Decision note (required)
      </label>
      <textarea
        id={id}
        value={note}
        onChange={(event) => setNote(event.target.value)}
        onBlur={() => setTouched(true)}
        rows={2}
        disabled={disabled || busy !== null}
        aria-invalid={touched && !valid ? true : undefined}
        placeholder="Why this decision is right, in one or two sentences."
        className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-fg [field-sizing:content] placeholder:text-fg-muted"
      />
      {touched && !valid ? <p className="text-xs text-danger">Write at least three characters; the note is stored with the decision.</p> : null}
      {conflict ? <p className="rounded-lg border border-warn/40 bg-warn/10 px-3 py-2 text-xs text-warn">{conflict}</p> : null}
      <div className="flex flex-wrap gap-2">
        <Button variant="primary" onClick={() => submit("approve")} loading={busy === "approve"} disabled={disabled || busy !== null} icon={<Icon name="check" size={14} />}>
          Approve
        </Button>
        <Button variant="danger" onClick={() => submit("reject")} loading={busy === "reject"} disabled={disabled || busy !== null} icon={<Icon name="x" size={14} />}>
          Reject
        </Button>
      </div>
    </div>
  );
}
