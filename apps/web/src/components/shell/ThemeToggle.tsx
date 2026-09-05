"use client";

import { useTheme } from "next-themes";
import { useSyncExternalStore } from "react";
import { Icon, type IconName } from "@/components/ui/icons";

const OPTIONS: readonly { value: "system" | "light" | "dark"; label: string; icon: IconName }[] = [
  { value: "system", label: "System", icon: "monitor" },
  { value: "light", label: "Light", icon: "sun" },
  { value: "dark", label: "Dark", icon: "moon" },
];

// Intent: the server cannot know the persisted theme, so the active state is only shown after hydration.
// useSyncExternalStore (server snapshot false, client snapshot true) avoids a setState-in-effect and any mismatch.
const subscribeNoop = () => () => {};
function useHydrated(): boolean {
  return useSyncExternalStore(subscribeNoop, () => true, () => false);
}

/** Three-state segmented control (Design.md §7); icon-only below `sm`. */
export function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  const hydrated = useHydrated();

  return (
    <div role="radiogroup" aria-label="Colour theme" className="inline-flex items-center rounded-full border border-border bg-surface p-0.5 text-xs font-medium">
      {OPTIONS.map((option) => {
        const active = hydrated && (theme ?? "system") === option.value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={active}
            aria-label={option.label}
            title={option.label}
            onClick={() => setTheme(option.value)}
            className={`flex h-7 items-center gap-1 rounded-full px-2 transition-colors ${active ? "bg-accent text-white" : "text-fg-muted hover:text-fg"}`}
          >
            <Icon name={option.icon} size={14} />
            <span className="hidden sm:inline">{option.label}</span>
          </button>
        );
      })}
    </div>
  );
}
