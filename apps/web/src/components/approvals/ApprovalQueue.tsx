"use client";

import { useState } from "react";
import { RunDemoButton } from "@/components/shell/RunDemoButton";
import { useSystem } from "@/components/shell/SystemProvider";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { useToast } from "@/components/ui/Toast";
import { mergePendingEvent } from "@/lib/actions";
import { useActor } from "@/lib/actor";
import { api, describeFailure } from "@/lib/api";
import { humanize } from "@/lib/format";
import { useStreamEffect } from "@/lib/sse";
import type { ActionRow, EvidencePacketRow } from "@/lib/types";
import { ActorField } from "./ActorField";
import { ApprovalCard } from "./ApprovalCard";
import { EvidencePacketView } from "./EvidencePacketView";

export interface ApprovalQueueProps {
  initialActions: ActionRow[];
  initialEvidence: EvidencePacketRow[];
  error: string | null;
}

/**
 * Two queues: actions above the auto-approve limit (C-B2) and evidence packets awaiting review (C-B4).
 * Flow: decide -> optimistic removal -> POST -> toast; a 409 means another reviewer won, so the row is restored with
 *       the conflict message and the queue is refetched.
 */
export function ApprovalQueue({ initialActions, initialEvidence, error }: ApprovalQueueProps) {
  const toast = useToast();
  const actor = useActor();
  const system = useSystem();
  const [actions, setActions] = useState(initialActions);
  const [evidence, setEvidence] = useState(initialEvidence);
  const [conflicts, setConflicts] = useState<Record<string, string>>({});
  const [fresh, setFresh] = useState<ReadonlySet<string>>(() => new Set());
  const [refreshing, setRefreshing] = useState(false);

  useStreamEffect(["action.pending_approval", "action.executed", "action.failed", "action.rejected", "action.blocked"], (event) => {
    setActions((current) => {
      const next = mergePendingEvent(current, event);
      const added = next.find((row) => !current.some((existing) => existing.id === row.id));
      if (added) {
        setFresh((set) => new Set(set).add(added.id));
        setTimeout(() => setFresh((set) => {
          const copy = new Set(set);
          copy.delete(added.id);
          return copy;
        }), 1_200);
      }
      return next;
    });
  });

  const refresh = async () => {
    setRefreshing(true);
    const result = await api.approvals();
    setRefreshing(false);
    if (!result.ok) {
      toast.push({ title: "Could not refresh the queue", body: describeFailure(result), tone: "danger" });
      return;
    }
    setActions(result.data.actions);
    setEvidence(result.data.evidence);
  };

  const decideAction = async (action: ActionRow, decision: "approve" | "reject", note: string) => {
    setConflicts((current) => ({ ...current, [action.id]: "" }));
    const previous = actions;
    setActions((current) => current.filter((row) => row.id !== action.id));
    const result = await api.decideAction(action.id, { decision, note, actor });
    if (result.ok) {
      const status = result.data.action.status;
      toast.push({
        title: decision === "approve" ? "Approved" : "Rejected",
        body: `${action.summary} — now ${humanize(status).toLowerCase()}. Recorded as ${actor}.`,
        tone: decision === "approve" ? "ok" : "neutral",
      });
      return;
    }
    setActions(previous);
    const conflict = result.status === 409 ? "Someone else decided this action first. The queue has been refreshed." : describeFailure(result);
    setConflicts((current) => ({ ...current, [action.id]: conflict }));
    toast.push({ title: result.status === 409 ? "Already decided" : "Decision failed", body: conflict, tone: result.status === 409 ? "warn" : "danger" });
    if (result.status === 409) await refresh();
  };

  const decideEvidence = async (row: EvidencePacketRow, decision: "approve" | "reject", note: string) => {
    setConflicts((current) => ({ ...current, [row.id]: "" }));
    const previous = evidence;
    setEvidence((current) => current.filter((entry) => entry.id !== row.id));
    const result = await api.decideEvidence(row.dispute_id, { decision, note, actor });
    if (result.ok) {
      toast.push({
        title: decision === "approve" ? "Evidence approved" : "Evidence rejected",
        body: `Dispute ${row.dispute_id} — packet ${humanize(result.data.evidence.review_status).toLowerCase()}, action ${humanize(result.data.action.status).toLowerCase()}. Recorded as ${actor}.`,
        tone: decision === "approve" ? "ok" : "neutral",
      });
      return;
    }
    setEvidence(previous);
    const conflict = result.status === 409 ? "Someone else reviewed this packet first. The queue has been refreshed." : describeFailure(result);
    setConflicts((current) => ({ ...current, [row.id]: conflict }));
    toast.push({ title: result.status === 409 ? "Already reviewed" : "Decision failed", body: conflict, tone: result.status === 409 ? "warn" : "danger" });
    if (result.status === 409) await refresh();
  };

  if (error) {
    return <EmptyState title="The approval queue could not be loaded" body={error} action={<Button onClick={refresh} loading={refreshing}>Try again</Button>} />;
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <ActorField />
        <Button size="sm" onClick={refresh} loading={refreshing}>
          Refresh
        </Button>
      </div>

      <section aria-labelledby="queue-actions">
        <h2 id="queue-actions" className="mb-2 text-sm font-medium">
          Actions waiting for a decision ({actions.length})
        </h2>
        {actions.length === 0 ? (
          <EmptyState
            compact
            title="Nothing is waiting"
            body="Actions land here when their money impact is above the auto-approve limit. Everything below it executes inside its guardrails."
            action={<RunDemoButton env={system.system?.env ?? null} apiState={system.api} />}
          />
        ) : (
          <div className="flex flex-col gap-4" aria-live="polite">
            {actions.map((action) => (
              <ApprovalCard key={action.id} action={action} fresh={fresh.has(action.id)} conflict={conflicts[action.id] || null} onDecide={(decision, note) => decideAction(action, decision, note)} />
            ))}
          </div>
        )}
      </section>

      <section aria-labelledby="queue-evidence">
        <h2 id="queue-evidence" className="mb-2 text-sm font-medium">
          Evidence packets awaiting review ({evidence.length})
        </h2>
        {evidence.length === 0 ? (
          <EmptyState compact title="No packets to review" body="Chargeback evidence is assembled deterministically and always stops here before anything is submitted." />
        ) : (
          <div className="flex flex-col gap-4">
            {evidence.map((row) => (
              <EvidencePacketView key={row.id} row={row} fresh={fresh.has(row.id)} conflict={conflicts[row.id] || null} onDecide={(decision, note) => decideEvidence(row, decision, note)} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
