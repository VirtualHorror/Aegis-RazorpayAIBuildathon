"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Badge, statusTone } from "@/components/ui/Badge";
import { Drawer } from "@/components/ui/Drawer";
import { JsonView } from "@/components/ui/JsonView";
import { SkeletonRows } from "@/components/ui/Skeleton";
import { api, describeFailure } from "@/lib/api";
import { latencyMs } from "@/lib/events";
import { formatDateTime, formatMs, formatPercent, moduleLabel } from "@/lib/format";
import type { WebhookEventDetail } from "@/lib/types";

export function EventDrawer({ eventId, onClose }: { eventId: string | null; onClose: () => void }) {
  return (
    <Drawer open={eventId !== null} onClose={onClose} title={eventId ?? ""} description="Raw delivery, diagnoses and the actions it triggered">
      {eventId ? <EventDetail key={eventId} eventId={eventId} /> : null}
    </Drawer>
  );
}

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs text-fg-muted">{label}</dt>
      <dd className="mt-0.5 text-sm">{children}</dd>
    </div>
  );
}

/** Keyed by event id by the parent, so state starts fresh for every event (no setState inside effects). */
function EventDetail({ eventId }: { eventId: string }) {
  const [detail, setDetail] = useState<WebhookEventDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    void api.event(eventId).then((result) => {
      if (!alive) return;
      if (result.ok) setDetail(result.data);
      else setError(describeFailure(result));
    });
    return () => {
      alive = false;
    };
  }, [eventId]);

  if (error) return <p className="text-sm text-danger">{error}</p>;
  if (!detail) return <SkeletonRows rows={6} />;
  const latency = latencyMs(detail);

  return (
    <div className="flex flex-col gap-5">
      <dl className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-3">
        <Fact label="Type">
          <span className="font-mono text-xs">{detail.event_type}</span>
        </Fact>
        <Fact label="Status">
          <Badge tone={statusTone(detail.status)}>{detail.status.replace("_", " ")}</Badge>
        </Fact>
        <Fact label="Signature">
          <span className={detail.signature_valid ? "text-ok" : "text-danger"}>{detail.signature_valid ? "valid" : "invalid"}</span>
        </Fact>
        <Fact label="Received">{formatDateTime(detail.received_at)}</Fact>
        <Fact label="Processed">{detail.processed_at ? formatDateTime(detail.processed_at) : "not yet"}</Fact>
        <Fact label="Latency">{latency === null ? "—" : formatMs(latency)}</Fact>
        <Fact label="Duplicates">{detail.duplicate_count}</Fact>
        <Fact label="Account">
          <span className="font-mono text-xs">{detail.account_id ?? "—"}</span>
        </Fact>
        <Fact label="Payload sha256">
          <span className="font-mono text-xs">{detail.payload_sha256.slice(0, 16)}…</span>
        </Fact>
      </dl>
      {detail.last_error ? <p className="rounded-lg border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger">{detail.last_error}</p> : null}

      <section>
        <h3 className="mb-2 text-sm font-medium">Raw payload</h3>
        <JsonView value={detail.payload} label="Raw webhook payload" maxHeight={320} />
      </section>

      <section>
        <h3 className="mb-2 text-sm font-medium">Diagnoses</h3>
        {detail.diagnoses.length === 0 ? (
          <p className="text-sm text-fg-muted">No diagnosis: this event type is projected without a model call.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {detail.diagnoses.map((diagnosis) => (
              <li key={diagnosis.id} className="card px-3 py-2 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{diagnosis.root_cause.replaceAll("_", " ").toLowerCase()}</span>
                  <Badge tone="accent">{diagnosis.strategy.replaceAll("_", " ").toLowerCase()}</Badge>
                  <Badge tone="neutral">confidence {formatPercent(diagnosis.confidence)}</Badge>
                  {diagnosis.degraded ? <Badge tone="warn">degraded</Badge> : null}
                </div>
                <p className="mt-1 text-xs text-fg-muted">{diagnosis.rationale}</p>
                <p className="mt-1 font-mono text-[11px] text-fg-muted">
                  {diagnosis.provider} {diagnosis.model} {diagnosis.latency_ms !== null ? `in ${formatMs(diagnosis.latency_ms)}` : ""}
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h3 className="mb-2 text-sm font-medium">Actions</h3>
        {detail.actions.length === 0 ? (
          <p className="text-sm text-fg-muted">No action was proposed for this event.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {detail.actions.map((action) => (
              <li key={action.id} className="card flex items-center justify-between gap-3 px-3 py-2 text-sm">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge module={action.module} dot>
                      {moduleLabel(action.module)}
                    </Badge>
                    <Badge tone={statusTone(action.status)}>{action.status.replace("_", " ")}</Badge>
                  </div>
                  <p className="mt-1 truncate text-xs text-fg-muted">{action.summary}</p>
                </div>
                <Link href={`/actions/${action.id}`} className="shrink-0 text-xs text-accent hover:underline">
                  Open
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
