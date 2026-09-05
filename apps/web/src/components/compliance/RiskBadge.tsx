import { Badge, type BadgeTone } from "@/components/ui/Badge";
import type { RiskLevel } from "@/lib/types";

const TONE: Record<RiskLevel, BadgeTone> = { prohibited: "danger", high: "danger", medium: "warn", low: "accent", none: "neutral" };
const LABEL: Record<RiskLevel, string> = { prohibited: "Prohibited", high: "High risk", medium: "Medium risk", low: "Low risk", none: "No risk" };

export function RiskBadge({ level }: { level: RiskLevel }) {
  return (
    <Badge tone={TONE[level]} dot>
      {LABEL[level]}
    </Badge>
  );
}

export const RISK_ORDER: readonly RiskLevel[] = ["prohibited", "high", "medium", "low", "none"];
export const RISK_LABEL = LABEL;
