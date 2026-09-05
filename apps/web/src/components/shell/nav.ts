import type { IconName } from "@/components/ui/icons";

export interface NavItem {
  href: string;
  label: string;
  icon: IconName;
  description: string;
}

/** Primary navigation (Design.md §3). `/kitchen-sink`, `/subscriptions` and `/invoices` exist but are not listed. */
export const NAV_ITEMS: readonly NavItem[] = [
  { href: "/", label: "Overview", icon: "overview", description: "The control plane in one screen" },
  { href: "/events", label: "Events", icon: "activity", description: "Every webhook delivery, verified and deduplicated" },
  { href: "/actions", label: "Actions", icon: "actions", description: "Every proposed, gated and executed action" },
  { href: "/approvals", label: "Approvals", icon: "shield", description: "Decisions waiting for a human" },
  { href: "/ask", label: "Ask Aegis", icon: "sparkles", description: "Plain-language questions answered with validated SQL" },
  { href: "/compliance", label: "Compliance", icon: "scan", description: "Catalog copy that could breach payment rules" },
  { href: "/x402", label: "x402 Lab", icon: "coins", description: "Sell to AI buyers with HTTP 402 challenges" },
  { href: "/settings", label: "Settings", icon: "sliders", description: "Guardrails and the kill switch" },
];

/** Routes that exist but are reached from a link rather than the sidebar. */
const EXTRA_TITLES: readonly { prefix: string; title: string }[] = [
  { prefix: "/actions/", title: "Action" },
  { prefix: "/subscriptions", title: "Subscriptions" },
  { prefix: "/invoices", title: "Invoices" },
  { prefix: "/kitchen-sink", title: "Kitchen sink" },
];

export function isActive(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function pageTitle(pathname: string): string {
  const extra = EXTRA_TITLES.find((entry) => pathname.startsWith(entry.prefix));
  if (extra) return extra.title;
  return NAV_ITEMS.find((item) => isActive(pathname, item.href))?.label ?? "Aegis";
}
