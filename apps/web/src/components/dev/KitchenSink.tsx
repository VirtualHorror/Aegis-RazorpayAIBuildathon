"use client";

import { useState } from "react";
import { Badge, statusTone } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Drawer } from "@/components/ui/Drawer";
import { EmptyState } from "@/components/ui/EmptyState";
import { GlowInput } from "@/components/ui/GlowInput";
import { Icon } from "@/components/ui/icons";
import { JsonView } from "@/components/ui/JsonView";
import { KpiTile } from "@/components/ui/KpiTile";
import { Skeleton, SkeletonRows } from "@/components/ui/Skeleton";
import { Table, TableWrap, Td, Th, Tr } from "@/components/ui/Table";
import { useToast } from "@/components/ui/Toast";
import { MODULE_LABELS } from "@/lib/format";

const STATUSES = ["proposed", "blocked", "pending_approval", "approved", "rejected", "executed", "failed", "expired"] as const;

function Panel({ forced }: { forced: "light" | "dark" | null }) {
  const [question, setQuestion] = useState("");
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(false);
  const [drawer, setDrawer] = useState(false);
  const [flash, setFlash] = useState(0);
  const toast = useToast();

  const submit = (value: string) => {
    setLoading(true);
    setTimeout(() => {
      setLoading(false);
      toast.push({ title: "Submitted", body: value, tone: "ok" });
    }, 1_200);
  };

  return (
    <div className={`${forced ?? ""} rounded-2xl bg-bg p-4 text-fg`}>
      <div className="flex flex-col gap-4">
        <Card title="Buttons" description="Primary, secondary, ghost, danger; loading and disabled.">
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="primary" icon={<Icon name="play" size={14} />}>
              Run demo
            </Button>
            <Button>Secondary</Button>
            <Button variant="ghost">Ghost</Button>
            <Button variant="danger">Reject</Button>
            <Button loading>Saving</Button>
            <Button disabled>Disabled</Button>
            <Button size="sm" onClick={() => toast.push({ title: "A toast", body: "Announced through the polite live region.", tone: "neutral" })}>
              Toast
            </Button>
            <Button size="sm" onClick={() => setDrawer(true)}>
              Drawer
            </Button>
          </div>
        </Card>

        <Card title="Badges" description="Status tones and the module spectrum.">
          <div className="flex flex-wrap gap-2">
            {STATUSES.map((status) => (
              <Badge key={status} tone={statusTone(status)} dot>
                {status.replace("_", " ")}
              </Badge>
            ))}
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            {Object.entries(MODULE_LABELS).map(([module, label]) => (
              <Badge key={module} module={module} dot>
                {label}
              </Badge>
            ))}
          </div>
        </Card>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <KpiTile label="Money recovered" value="₹4,20,000.00" hint="last 24 h" tone="ok" flashKey={flash} />
          <KpiTile label="Pending approval" value="3" hint="humans decide" tone="warn" />
          <KpiTile label="Loading" value="" loading />
        </div>
        <div>
          <Button size="sm" onClick={() => setFlash((value) => value + 1)}>
            Flash the KPI
          </Button>
        </div>

        <Card title="Glow input" description="Focus intensifies the halo; Tab fills the example; Enter submits.">
          <GlowInput value={question} onChange={setQuestion} onSubmit={submit} loading={loading} label="Ask Aegis" placeholder="Ask about your business…" example="How much revenue did we recover this week by module?" leading={<Icon name="sparkles" />} />
          <div className="mt-3">
            <GlowInput compact value={search} onChange={setSearch} onSubmit={() => undefined} label="Search events" placeholder="Search by event id or type" leading={<Icon name="search" size={14} />} submitLabel="Search" />
          </div>
        </Card>

        <TableWrap>
          <Table>
            <thead>
              <tr>
                <Th>Event</Th>
                <Th>Type</Th>
                <Th>Status</Th>
                <Th numeric>Latency</Th>
              </tr>
            </thead>
            <tbody>
              {[
                ["evt_kitchen_001", "payment.failed", "processed", 41],
                ["evt_kitchen_002", "order.paid", "received", 12],
                ["evt_kitchen_003", "dispute.created", "dead_letter", 380],
              ].map(([id, type, status, latency]) => (
                <Tr key={String(id)} interactive>
                  <Td mono>{id}</Td>
                  <Td>{type}</Td>
                  <Td>
                    <Badge tone={statusTone(String(status))}>{String(status)}</Badge>
                  </Td>
                  <Td numeric mono>
                    {latency} ms
                  </Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        </TableWrap>

        <Card title="JSON" padding={false}>
          <div className="p-3">
            <JsonView value={{ event: "payment.failed", amount_paise: 149900, simulated: true, error: null, nested: { network: "aegis-sim" } }} maxHeight={200} />
          </div>
        </Card>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <EmptyState compact title="No events yet" body="Run the demo to send signed webhooks through the ingress." />
          <Card padding={false}>
            <SkeletonRows rows={4} />
            <div className="px-4 pb-4">
              <Skeleton className="h-8 w-32" />
            </div>
          </Card>
        </div>

        <Drawer open={drawer} onClose={() => setDrawer(false)} title="Drawer" description="Escape or the backdrop closes it; focus returns to the trigger.">
          <p className="text-sm text-fg-muted">Detail panels use this for actions and events.</p>
        </Drawer>
      </div>
    </div>
  );
}

export function KitchenSink() {
  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
      <div>
        <h2 className="mb-2 text-sm font-medium text-fg-muted">Current theme</h2>
        <Panel forced={null} />
      </div>
      <div>
        <h2 className="mb-2 text-sm font-medium text-fg-muted">Opposite theme</h2>
        <OppositePanel />
      </div>
    </div>
  );
}

function OppositePanel() {
  // The wrapper class flips the token set; a `.dark` page renders this subtree `.light` and vice versa.
  return (
    <>
      <div className="dark:hidden">
        <Panel forced="dark" />
      </div>
      <div className="hidden dark:block">
        <Panel forced="light" />
      </div>
    </>
  );
}
