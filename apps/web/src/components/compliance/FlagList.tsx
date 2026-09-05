"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { HalftoneField } from "@/components/fx/HalftoneField";
import { Icon } from "@/components/ui/icons";
import { useToast } from "@/components/ui/Toast";
import { useActor } from "@/lib/actor";
import { api, describeFailure } from "@/lib/api";
import { useStreamEffect } from "@/lib/sse";
import type { ComplianceFlagRow, ComplianceFlagStatus, RiskLevel } from "@/lib/types";
import { FlagCard } from "./FlagCard";
import { RISK_LABEL, RISK_ORDER } from "./RiskBadge";

export interface FlagListProps {
  initialFlags: ComplianceFlagRow[];
  error: string | null;
}

/** Flags grouped by risk, prohibited first (Checklist 20.2), with a scan button driven by SSE progress. */
export function FlagList({ initialFlags, error }: FlagListProps) {
  const toast = useToast();
  const actor = useActor();
  const [flags, setFlags] = useState(initialFlags);
  const [scanning, setScanning] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [scanned, setScanned] = useState(0);

  useStreamEffect(["compliance.flag"], () => {
    setScanned((count) => count + 1);
  });

  const refresh = async () => {
    const result = await api.complianceFlags();
    if (result.ok) setFlags(result.data);
    return result.ok;
  };

  const scan = async () => {
    setScanning(true);
    setScanned(0);
    const started = await api.complianceScan();
    if (!started.ok) {
      setScanning(false);
      toast.push({ title: "Scan could not start", body: describeFailure(started), tone: "danger" });
      return;
    }
    const id = toast.push({ title: "Scanning the catalog…", body: "Keyword prescreen first, then the fast model for every active product.", duration: 0 });
    // The scan is a queued job; poll the flag list until it stops changing rather than guessing a duration.
    let previous = -1;
    for (let attempt = 0; attempt < 20; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 1_500));
      const result = await api.complianceFlags();
      if (!result.ok) continue;
      const current = result.data.length;
      setFlags(result.data);
      if (current === previous && attempt > 1) break;
      previous = current;
    }
    setScanning(false);
    toast.update(id, { title: "Scan finished", body: `${previous} flags in the catalog. Every model claim was checked against the product copy.`, tone: "ok", duration: 6_000 });
  };

  const setStatus = async (flag: ComplianceFlagRow, status: ComplianceFlagStatus) => {
    setBusyId(flag.id);
    const result = await api.setFlagStatus(flag.id, status, actor);
    setBusyId(null);
    if (!result.ok) {
      toast.push({ title: "Could not update the flag", body: describeFailure(result), tone: "danger" });
      return;
    }
    setFlags((current) => current.map((row) => (row.id === flag.id ? result.data.flag : row)));
    toast.push({ title: `Marked ${status.replace("_", " ")}`, body: `${flag.product_id} — recorded as ${actor}.`, tone: "ok" });
  };

  const grouped = RISK_ORDER.map((level: RiskLevel) => ({ level, rows: flags.filter((flag) => flag.risk_level === level) })).filter((group) => group.rows.length > 0);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-fg-muted">
          {flags.length} flags · {flags.filter((flag) => flag.status === "needs_review").length} need review
          {scanning && scanned > 0 ? ` · ${scanned} products assessed in this run` : ""}
        </p>
        <div className="flex gap-2">
          <Button size="sm" onClick={() => void refresh()}>
            Refresh
          </Button>
          <Button size="sm" variant="primary" onClick={scan} loading={scanning} icon={<Icon name="scan" size={14} />}>
            Run scan
          </Button>
        </div>
      </div>

      {error ? (
        <EmptyState title="The flags could not be loaded" body={error} />
      ) : flags.length === 0 ? (
        <EmptyState
          title="No flags yet"
          body="The scanner reads active catalog copy, prescreens it with a fixed keyword list, then asks a fast model to classify it. Run a scan to see what it finds."
          backdrop={<HalftoneField intensity={0.45} className="opacity-25" />}
          action={
            <Button variant="primary" onClick={scan} loading={scanning} icon={<Icon name="scan" size={14} />}>
              Run scan
            </Button>
          }
        />
      ) : (
        grouped.map((group) => (
          <section key={group.level} aria-labelledby={`risk-${group.level}`}>
            <h2 id={`risk-${group.level}`} className="mb-2 text-sm font-medium">
              {RISK_LABEL[group.level]} ({group.rows.length})
            </h2>
            <div className="flex flex-col gap-3">
              {group.rows.map((flag) => (
                <FlagCard key={flag.id} flag={flag} busy={busyId === flag.id} onStatus={(status) => setStatus(flag, status)} />
              ))}
            </div>
          </section>
        ))
      )}
    </div>
  );
}
