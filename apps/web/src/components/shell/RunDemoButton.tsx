"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/icons";
import { useToast } from "@/components/ui/Toast";
import { api, describeFailure } from "@/lib/api";

export interface RunDemoButtonProps {
  /** The sim route only exists outside production (C-D5); the button explains why it is disabled. */
  env: string | null;
  apiState: "checking" | "online" | "offline";
  size?: "sm" | "md";
  iconOnly?: boolean;
}

/**
 * Sends every simulator scenario through the real signed ingress (`POST /api/v1/sim/run {scenario:'all'}`).
 * Flow: click -> progress toast -> the API injects the signed deliveries -> the toast becomes the totals; the pages
 *       update themselves from the SSE stream, nothing here fakes a row.
 */
export function RunDemoButton({ env, apiState, size = "md", iconOnly = false }: RunDemoButtonProps) {
  const toast = useToast();
  const [running, setRunning] = useState(false);
  const production = env === "production";
  const disabled = apiState !== "online" || production;
  const title = production ? "The simulator is not mounted in production" : apiState !== "online" ? "The API is not reachable" : "Send every simulator scenario through the webhook ingress";

  const run = async () => {
    setRunning(true);
    const id = toast.push({ title: "Running the demo…", body: "Signing and posting every scenario to the webhook ingress.", duration: 0 });
    const result = await api.simRun({ scenario: "all" });
    setRunning(false);
    if (!result.ok) {
      toast.update(id, { title: "Demo failed", body: describeFailure(result), tone: "danger", duration: 8_000 });
      return;
    }
    const { totals, results, p95_latency_ms } = result.data;
    toast.update(id, {
      title: `Demo sent ${results.length} webhooks`,
      body: `${totals.accepted} accepted, ${totals.duplicate} duplicate, ${totals.rejected} rejected, ${totals.ignored} ignored. p95 ${p95_latency_ms} ms. Watch the events and actions fill in.`,
      tone: "ok",
      duration: 9_000,
    });
  };

  return (
    <Button variant="primary" size={size} onClick={run} loading={running} disabled={disabled} title={title} icon={<Icon name="play" size={14} />} aria-label={iconOnly ? "Run demo" : undefined}>
      {iconOnly ? null : "Run demo"}
    </Button>
  );
}
