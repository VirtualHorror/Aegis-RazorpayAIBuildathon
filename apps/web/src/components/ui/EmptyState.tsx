import type { ReactNode } from "react";

export interface EmptyStateProps {
  title: string;
  body?: ReactNode;
  action?: ReactNode;
  /** Decorative layer behind the text (the HalftoneField from Task 18). */
  backdrop?: ReactNode;
  compact?: boolean;
  className?: string;
}

/** An empty screen is an invitation to act: say what will appear here and how to make it happen (C-F5). */
export function EmptyState({ title, body, action, backdrop, compact = false, className = "" }: EmptyStateProps) {
  return (
    <div className={`card relative overflow-hidden text-center ${compact ? "px-4 py-8" : "px-6 py-16"} ${className}`}>
      {backdrop ? (
        <>
          <div aria-hidden className="pointer-events-none absolute inset-0">
            {backdrop}
          </div>
          {/* The text must stay readable over the pattern: a radial scrim of the card's own surface, never a tint. */}
          <div aria-hidden className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_center,var(--surface)_35%,transparent_75%)]" />
        </>
      ) : null}
      <div className="relative mx-auto max-w-md">
        <h3 className="text-sm font-medium">{title}</h3>
        {body ? <p className="mt-1 text-sm text-fg-muted">{body}</p> : null}
        {action ? <div className="mt-4 flex justify-center gap-2">{action}</div> : null}
      </div>
    </div>
  );
}
