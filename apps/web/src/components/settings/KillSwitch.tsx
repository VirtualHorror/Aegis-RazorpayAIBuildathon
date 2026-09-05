"use client";

import { useState } from "react";
import { Card } from "@/components/ui/Card";
import { Icon } from "@/components/ui/icons";
import { ConfirmDialog } from "./ConfirmDialog";

export interface KillSwitchProps {
  enabled: boolean;
  saving: boolean;
  onChange: (enabled: boolean) => void;
}

/** The one control that stops everything (C-B5). Deliberately large, always confirmed. */
export function KillSwitch({ enabled, saving, onChange }: KillSwitchProps) {
  const [pending, setPending] = useState<boolean | null>(null);
  return (
    <Card
      title="Kill switch"
      description="Blocks every module and returns 503 from the x402 gateway within one poll cycle. Nothing is cached around it."
      className={enabled ? "border-danger" : ""}
    >
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="min-w-0">
          <p className={`text-lg font-medium ${enabled ? "text-danger" : "text-ok"}`}>{enabled ? "Everything is stopped" : "Modules are running"}</p>
          <p className="mt-1 text-sm text-fg-muted">{enabled ? "No action executes and no agent can buy until this is turned off." : "Actions execute inside their guardrails; money above the auto-approve limit still waits for a human."}</p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={enabled}
          aria-label="Kill switch"
          disabled={saving}
          onClick={() => setPending(!enabled)}
          className={`relative h-11 w-20 shrink-0 rounded-full border transition-colors disabled:opacity-60 ${enabled ? "border-danger bg-danger/20" : "border-border bg-surface-2"}`}
        >
          <span className={`absolute top-1 flex h-8 w-8 items-center justify-center rounded-full text-[#fff] transition-[left] duration-200 ${enabled ? "left-10 bg-danger" : "left-1 bg-fg-muted"}`}>
            <Icon name="power" size={16} />
          </span>
        </button>
      </div>
      <ConfirmDialog
        open={pending !== null}
        danger={pending === true}
        title={pending ? "Stop every module?" : "Let the modules run again?"}
        body={
          pending
            ? "Every action module and the x402 gateway will refuse to run until you switch this back. In-flight work finishes; nothing new starts."
            : "Modules will resume proposing and executing actions inside their guardrails."
        }
        confirmLabel={pending ? "Stop everything" : "Resume"}
        onCancel={() => setPending(null)}
        onConfirm={() => {
          const next = pending === true;
          setPending(null);
          onChange(next);
        }}
      />
    </Card>
  );
}
