import { Badge } from "@/components/ui/Badge";
import { moduleLabel } from "@/lib/format";

export function ModuleBadge({ module, version }: { module: string; version?: string }) {
  return (
    <Badge module={module} dot title={version ? `${module} ${version}` : module}>
      {moduleLabel(module)}
    </Badge>
  );
}
