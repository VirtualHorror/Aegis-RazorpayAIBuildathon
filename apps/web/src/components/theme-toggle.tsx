"use client";

import { useTheme } from "next-themes";
import { useSyncExternalStore } from "react";

const OPTIONS = [
  { value: "system", label: "System" },
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
] as const;

// Intent: the server cannot know the persisted theme, so the active state is only shown after hydration.
// useSyncExternalStore (server snapshot false, client snapshot true) avoids a setState-in-effect and any mismatch.
const subscribeNoop = () => () => {};
function useHydrated(): boolean {
  return useSyncExternalStore(subscribeNoop, () => true, () => false);
}

/** Three-state theme control (Design.md §7). */
export function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  const hydrated = useHydrated();

  return (
    <div
      role="radiogroup"
      aria-label="Colour theme"
      className="inline-flex items-center rounded-full border border-border bg-surface p-0.5 text-xs font-medium"
    >
      {OPTIONS.map((option) => {
        const active = hydrated && (theme ?? "system") === option.value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => setTheme(option.value)}
            className={
              "rounded-full px-3 py-1 transition-colors " +
              (active ? "bg-accent text-white" : "text-fg-muted hover:text-fg")
            }
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
