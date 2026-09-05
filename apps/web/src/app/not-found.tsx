import { ButtonLink } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";

export default function NotFound() {
  return <EmptyState title="There is nothing at this address" body="The page may have moved, or the id in the link is not one Aegis knows." action={<ButtonLink href="/">Back to the overview</ButtonLink>} />;
}
