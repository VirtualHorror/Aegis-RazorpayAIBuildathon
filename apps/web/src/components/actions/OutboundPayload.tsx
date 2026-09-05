import { Badge } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";
import { JsonView } from "@/components/ui/JsonView";
import type { ActionRow, OutboundMessageRow } from "@/lib/types";

/** The exact JSON that would have gone out, watermarked because nothing leaves this build (C-B7). */
export function OutboundPayload({ action, messages }: { action: ActionRow; messages: readonly OutboundMessageRow[] }) {
  if (messages.length === 0) {
    const payload = action.proposal.payload;
    return (
      <Card title="Outbound payload" description="Nothing was sent. This is the payload the proposal carries.">
        {payload === undefined ? <p className="text-sm text-fg-muted">The proposal has no outbound payload.</p> : <JsonView value={payload} label="Proposed payload" maxHeight={280} />}
      </Card>
    );
  }
  return (
    <div className="flex flex-col gap-3">
      {messages.map((message) => (
        <Card
          key={message.id}
          title={`Outbound ${message.channel} message`}
          description={`${message.template} to ${message.recipient_masked} (${message.locale})`}
          actions={message.status === "simulated_sent" ? <Badge tone="accent">simulated, not delivered</Badge> : <Badge tone="warn">suppressed: {message.suppressed_reason ?? "unknown"}</Badge>}
        >
          <div className="relative">
            <JsonView value={message.payload} label="Outbound message payload" maxHeight={320} />
            <div aria-hidden className="pointer-events-none absolute inset-0 flex items-center justify-center overflow-hidden">
              <span className="-rotate-12 select-none text-4xl font-semibold tracking-[0.3em] text-fg opacity-[0.07]">SIMULATED</span>
            </div>
          </div>
        </Card>
      ))}
    </div>
  );
}
