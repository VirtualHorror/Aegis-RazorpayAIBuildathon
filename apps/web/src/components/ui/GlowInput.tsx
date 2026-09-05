"use client";

import { useId, useState, type KeyboardEvent, type ReactNode } from "react";
import { Icon } from "./icons";

export interface GlowInputProps {
  value: string;
  onChange: (value: string) => void;
  onSubmit: (value: string) => void;
  /** Accessible name. */
  label: string;
  placeholder?: string;
  /** Shown as a `Tab` hint while empty; Tab fills it in. */
  example?: string;
  loading?: boolean;
  disabled?: boolean;
  leading?: ReactNode;
  /** Compact single-line variant for the search boxes on Events/Actions. */
  compact?: boolean;
  submitLabel?: string;
}

/**
 * Slack-composer-style input with a soft multi-colour halo behind it (Design.md §5.3).
 * Flow: Enter submits, Shift+Enter inserts a newline, Tab fills the example while the box is empty (Shift+Tab always
 *       moves focus). Focus intensifies and speeds up the halo and tints the border (visible focus, C-F6); loading
 *       pulses the halo and swaps the send icon for a spinner. The textarea grows with its content (`field-sizing`).
 */
export function GlowInput({ value, onChange, onSubmit, label, placeholder, example, loading = false, disabled = false, leading, compact = false, submitLabel = "Send" }: GlowInputProps) {
  const [focused, setFocused] = useState(false);
  const id = useId();
  const hintId = `${id}-hint`;
  const canSubmit = value.trim().length > 0 && !loading && !disabled;
  const showHint = value === "" && example !== undefined && !disabled;

  const submit = () => {
    if (canSubmit) onSubmit(value.trim());
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Tab" && !event.shiftKey && showHint) {
      event.preventDefault();
      onChange(example);
      return;
    }
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      submit();
    }
  };

  return (
    <form
      className="relative"
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      <div aria-hidden className={`glow-halo ${focused ? "is-focused" : ""} ${loading ? "is-loading" : ""}`} />
      <div className={`relative flex items-end gap-2 rounded-[14px] border border-border bg-surface transition-colors focus-within:border-accent ${compact ? "min-h-10 px-3 py-1" : "min-h-14 px-4 py-2.5"}`}>
        {leading !== undefined ? <div className="flex shrink-0 items-center self-center text-fg-muted">{leading}</div> : null}
        <div className="relative min-w-0 flex-1 self-center">
          <label htmlFor={id} className="sr-only">
            {label}
          </label>
          <textarea
            id={id}
            rows={1}
            value={value}
            placeholder={placeholder}
            disabled={disabled}
            aria-busy={loading || undefined}
            aria-describedby={showHint ? hintId : undefined}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            onChange={(event) => onChange(event.target.value)}
            onKeyDown={onKeyDown}
            className={`block w-full resize-none bg-transparent py-1 text-fg outline-none [field-sizing:content] placeholder:text-fg-muted focus-visible:outline-none ${compact ? "max-h-10 overflow-hidden whitespace-nowrap text-sm" : "max-h-42 text-base"} ${showHint ? "md:pr-72" : ""}`}
          />
          {showHint ? (
            <div id={hintId} className="pointer-events-none absolute inset-y-0 right-0 hidden items-center gap-2 md:flex">
              <kbd className="rounded border border-border bg-surface-2 px-1.5 py-0.5 font-mono text-[10px] text-fg-muted">Tab</kbd>
              <span className="max-w-[28ch] truncate text-xs text-fg-muted">{example}</span>
              <span className="sr-only">Press Tab to use this example question.</span>
            </div>
          ) : null}
        </div>
        <button
          type="submit"
          aria-label={submitLabel}
          disabled={!canSubmit}
          className={`flex shrink-0 items-center justify-center self-center rounded-lg text-white transition-colors disabled:bg-surface-2 disabled:text-fg-muted ${compact ? "h-7 w-7" : "h-9 w-9"} ${canSubmit ? "bg-accent hover:brightness-110" : ""}`}
        >
          {loading ? <Icon name="loader" className="spin" /> : <Icon name="send" />}
        </button>
      </div>
    </form>
  );
}
