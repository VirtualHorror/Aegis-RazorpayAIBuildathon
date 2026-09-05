import type { ReactNode } from "react";

export interface CardProps {
  title?: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  /** Set false when the body is a table that should reach the card edges. */
  padding?: boolean;
  id?: string;
}

/** Panel surface: hairline border, no shadow in light mode, inner highlight in dark mode (Design.md §2). */
export function Card({ title, description, actions, children, className = "", padding = true, id }: CardProps) {
  return (
    <section id={id} className={`card ${className}`}>
      {title !== undefined || actions !== undefined ? (
        <header className="flex items-start justify-between gap-3 border-b border-border px-4 py-3">
          <div className="min-w-0">
            {title !== undefined ? <h2 className="text-sm font-medium">{title}</h2> : null}
            {description !== undefined ? <p className="mt-0.5 text-xs text-fg-muted">{description}</p> : null}
          </div>
          {actions !== undefined ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
        </header>
      ) : null}
      <div className={padding ? "p-4" : ""}>{children}</div>
    </section>
  );
}
