"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { useToast } from "@/components/ui/Toast";
import { useActor } from "@/lib/actor";
import { api, describeFailure } from "@/lib/api";
import { useStreamEffect } from "@/lib/sse";
import type { AuditLogRow, GuardrailRow } from "@/lib/types";
import { ActorField } from "@/components/approvals/ActorField";
import { ChangeHistory } from "./ChangeHistory";
import { GuardrailForm } from "./GuardrailForm";
import { KillSwitch } from "./KillSwitch";

export interface SettingsViewProps {
  initialGuardrails: GuardrailRow[];
  initialHistory: AuditLogRow[];
  error: string | null;
}

export function SettingsView({ initialGuardrails, initialHistory, error }: SettingsViewProps) {
  const toast = useToast();
  const actor = useActor();
  const [rows, setRows] = useState(initialGuardrails);
  const [history, setHistory] = useState(initialHistory);
  const [saving, setSaving] = useState(false);

  const killSwitch = rows.find((row) => row.key === "kill_switch");
  const enabled = killSwitch?.value === true;

  // Another operator may flip the switch; the bus tells every dashboard at once (C-B5).
  useStreamEffect(["system.kill_switch"], (event) => {
    const data = event.data;
    if (typeof data === "object" && data !== null && "enabled" in data && typeof data.enabled === "boolean") {
      const next = data.enabled;
      setRows((current) => current.map((row) => (row.key === "kill_switch" ? { ...row, value: next } : row)));
    }
  });

  /** Re-read the audit trail so the edit that just happened appears with its stored before/after values. */
  async function refreshHistory(): Promise<void> {
    const result = await api.guardrailHistory();
    if (result.ok) setHistory(result.data.items);
  }

  const applySaved = (row: GuardrailRow) => {
    setRows((current) => current.map((entry) => (entry.key === row.key ? row : entry)));
    void refreshHistory();
  };

  const setKillSwitch = async (next: boolean) => {
    setSaving(true);
    const result = await api.updateGuardrail("kill_switch", next, actor);
    setSaving(false);
    if (!result.ok) {
      toast.push({ title: "The kill switch did not change", body: describeFailure(result), tone: "danger" });
      return;
    }
    applySaved(result.data.guardrail);
    toast.push({
      title: next ? "Everything is stopped" : "Modules are running again",
      body: next ? "Modules and the x402 gateway will refuse to run until this is switched back." : "Actions resume inside their guardrails.",
      tone: next ? "danger" : "ok",
    });
  };

  if (error) return <EmptyState title="The guardrails could not be loaded" body={error} action={<Button onClick={() => window.location.reload()}>Try again</Button>} />;

  return (
    <div className="flex flex-col gap-4">
      <ActorField />
      <KillSwitch enabled={enabled} saving={saving} onChange={setKillSwitch} />
      <GuardrailForm rows={rows} onSaved={applySaved} />
      <ChangeHistory rows={history} />
    </div>
  );
}
