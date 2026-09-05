import type { CSSProperties, ReactNode } from "react";
import { moduleColorVar } from "@/lib/format";

export type BadgeTone = "neutral" | "accent" | "ok" | "warn" | "danger";

const TONE_VAR: Record<BadgeTone, string> = {
  neutral: "var(--fg-muted)",
  accent: "var(--accent)",
  ok: "var(--ok)",
  warn: "var(--warn)",
  danger: "var(--danger)",
};

export interface BadgeProps {
  tone?: BadgeTone;
  /** Module identifier: colours the badge with the module's spectrum colour instead of `tone`. */
  module?: string;
  dot?: boolean;
  title?: string;
  className?: string;
  children: ReactNode;
}

/**
 * Small status label. Colour is always accompanied by text (C-F6): the tint says "what kind", the words say what.
 * Text is the tone mixed towards the foreground so it clears 4.5:1 on the tinted background in both themes.
 */
export function Badge({ tone = "neutral", module, dot = false, title, className = "", children }: BadgeProps) {
  const colour = module ? moduleColorVar(module) : TONE_VAR[tone];
  const style: CSSProperties = {
    background: `color-mix(in oklab, ${colour} 14%, transparent)`,
    color: `color-mix(in oklab, ${colour} 72%, var(--fg))`,
  };
  return (
    <span title={title} style={style} className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-md px-1.5 py-0.5 text-xs font-medium leading-4 ${className}`}>
      {dot ? <span aria-hidden className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: colour }} /> : null}
      {children}
    </span>
  );
}

/** Action / event / review statuses → tone. Anything unknown is neutral. */
export function statusTone(status: string | null | undefined): BadgeTone {
  switch (status) {
    case "executed":
    case "processed":
    case "settled":
    case "recovered":
    case "approved":
    case "resolved":
    case "ok":
    case "paid":
    case "won":
      return "ok";
    case "pending_approval":
    case "requires_human_review":
    case "needs_review":
    case "processing":
    case "received":
    case "retrying":
    case "retry_scheduled":
    case "offer_sent":
    case "countered":
    case "challenged":
    case "verified":
    case "degraded":
      return "warn";
    case "blocked":
    case "failed":
    case "rejected":
    case "dead_letter":
    case "expired":
    case "churned":
    case "lost":
    case "prohibited":
    case "high":
      return "danger";
    case "submitted":
    case "acknowledged":
    case "medium":
      return "accent";
    default:
      return "neutral";
  }
}
