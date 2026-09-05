"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { HalftoneField } from "@/components/fx/HalftoneField";
import { Icon } from "@/components/ui/icons";
import { MODULE_LABELS, moduleColorVar } from "@/lib/format";
import { Logo } from "./Logo";
import { NAV_ITEMS, isActive } from "./nav";

/** 240px with labels at ≥1024px, a 64px icon rail at ≥640px, hidden below that (the BottomBar takes over). */
export function Sidebar() {
  const pathname = usePathname();
  return (
    <aside className="sticky top-0 hidden h-dvh shrink-0 flex-col border-r border-border bg-surface sm:flex sm:w-16 lg:w-60">
      <div className="flex h-14 items-center justify-center gap-2 border-b border-border px-3 lg:justify-start lg:px-4">
        <Link href="/" className="flex items-center gap-2 rounded-md text-fg" aria-label="Aegis overview">
          <Logo />
          <span className="hidden text-[15px] font-semibold tracking-tight lg:inline">Aegis</span>
        </Link>
      </div>
      <nav aria-label="Primary" className="flex-1 px-2 py-2">
        <ul className="flex flex-col gap-0.5">
          {NAV_ITEMS.map((item) => {
            const active = isActive(pathname, item.href);
            return (
              <li key={item.href}>
                <Link
                  href={item.href}
                  aria-current={active ? "page" : undefined}
                  title={item.label}
                  className={`flex items-center justify-center gap-3 rounded-lg px-2.5 py-2 text-sm transition-colors lg:justify-start ${
                    active ? "bg-surface-2 font-medium text-fg shadow-[inset_3px_0_0_0_var(--accent)]" : "text-fg-muted hover:bg-surface-2 hover:text-fg"
                  }`}
                >
                  <Icon name={item.icon} size={18} />
                  <span className="hidden lg:inline">{item.label}</span>
                  <span className="sr-only lg:hidden">{item.label}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
      <div className="px-3 pb-4 lg:px-4">
        <div className="mb-3 hidden h-28 overflow-hidden rounded-lg opacity-40 sm:block lg:hidden">
          <HalftoneField pitch={9} intensity={0.55} speed={0.5} />
        </div>
        <SpectrumStrip />
        <p className="mt-2 hidden text-[11px] leading-4 text-fg-muted lg:block">One event stream in. Seven specialised, guard-railed modules out.</p>
      </div>
    </aside>
  );
}

/** The module spectrum as a legend: the same colours mark rails, badges and the prism fan. */
export function SpectrumStrip() {
  return (
    <ul className="flex h-1.5 gap-0.5 overflow-hidden rounded-full" aria-label="Module colours">
      {Object.entries(MODULE_LABELS).map(([module, label]) => (
        <li key={module} className="flex-1" title={label} style={{ background: moduleColorVar(module) }}>
          <span className="sr-only">{label}</span>
        </li>
      ))}
    </ul>
  );
}
