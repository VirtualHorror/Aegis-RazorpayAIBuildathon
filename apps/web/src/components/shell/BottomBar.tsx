"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Icon } from "@/components/ui/icons";
import { NAV_ITEMS, isActive } from "./nav";

/** Below 640px the navigation is a fixed bottom bar with 44px targets; labels are for screen readers and tooltips. */
export function BottomBar() {
  const pathname = usePathname();
  return (
    <nav aria-label="Primary" className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-surface sm:hidden">
      <ul className="scroll-thin flex items-stretch overflow-x-auto">
        {NAV_ITEMS.map((item) => {
          const active = isActive(pathname, item.href);
          return (
            <li key={item.href} className="min-w-11 flex-1">
              <Link
                href={item.href}
                aria-current={active ? "page" : undefined}
                title={item.label}
                className={`flex h-14 flex-col items-center justify-center gap-1 text-[10px] ${active ? "text-accent" : "text-fg-muted"}`}
              >
                <span className={`h-0.5 w-6 rounded-full ${active ? "bg-accent" : "bg-transparent"}`} aria-hidden />
                <Icon name={item.icon} size={20} />
                <span className="sr-only">{item.label}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
