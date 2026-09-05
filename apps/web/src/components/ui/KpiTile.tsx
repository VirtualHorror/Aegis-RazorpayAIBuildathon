import type { ReactNode } from "react";
import { Skeleton } from "./Skeleton";

export interface KpiTileProps {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  tone?: "neutral" | "ok" | "warn" | "danger";
  loading?: boolean;
  /** Increment when a live event changes the value: the number flashes once (the element remounts, no state). */
  flashKey?: number;
}

const TONE_CLASS = { neutral: "", ok: "text-ok", warn: "text-warn", danger: "text-danger" } as const;

/** KPI numbers are text, never canvas (Design.md §8); tabular mono figures that scale with the tile (18–28px) so a rupee amount never clips. */
export function KpiTile({ label, value, hint, tone = "neutral", loading = false, flashKey = 0 }: KpiTileProps) {
  return (
    <div className="card @container px-4 py-3">
      <div className="text-xs text-fg-muted">{label}</div>
      {loading ? (
        <Skeleton className="mt-2 h-8 w-24" />
      ) : (
        <div key={flashKey} className={`mt-1 whitespace-nowrap font-mono text-[clamp(18px,11cqi,28px)] font-medium leading-tight tracking-tight tabular-nums ${TONE_CLASS[tone]} ${flashKey > 0 ? "kpi-flash" : ""}`}>
          {value}
        </div>
      )}
      {hint !== undefined ? <div className="mt-1 text-xs text-fg-muted">{hint}</div> : null}
    </div>
  );
}
