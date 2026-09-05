import type { ReactNode } from "react";
import { Icon } from "@/components/ui/icons";

export interface Step {
  title: string;
  body: string;
  state: "todo" | "active" | "done" | "failed";
}

/** Three fixed steps: challenge, pay, replay. The x402 flow is a sequence, so the numbers here carry real meaning. */
export function Stepper({ steps, children }: { steps: readonly Step[]; children?: ReactNode }) {
  return (
    <ol className="grid grid-cols-1 gap-3 sm:grid-cols-3">
      {steps.map((step, index) => (
        <li key={step.title} className={`card px-4 py-3 ${step.state === "active" ? "border-accent" : ""}`} aria-current={step.state === "active" ? "step" : undefined}>
          <div className="flex items-center gap-2">
            <span
              className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-medium ${
                step.state === "done" ? "bg-ok text-[#04180f]" : step.state === "failed" ? "bg-danger text-[#1b0505]" : step.state === "active" ? "bg-accent text-on-accent" : "bg-surface-2 text-fg-muted"
              }`}
            >
              {step.state === "done" ? <Icon name="check" size={14} /> : step.state === "failed" ? <Icon name="x" size={14} /> : index + 1}
            </span>
            {/* The steps sit above any h2 on the page, so the title is a paragraph, not a heading (heading order). */}
            <p className="text-sm font-medium">{step.title}</p>
          </div>
          <p className="mt-1 text-xs text-fg-muted">{step.body}</p>
        </li>
      ))}
      {children}
    </ol>
  );
}
