import type { ReactNode } from "react";
import { CopyButton } from "./CopyButton";

const TOKEN = /("(?:\\.|[^"\\])*")(\s*:)?|(-?\b\d+(?:\.\d+)?(?:[eE][+-]?\d+)?\b)|(\btrue\b|\bfalse\b)|(\bnull\b)/g;

/** Pure: split pretty-printed JSON into coloured spans (keys, strings, numbers, booleans, null). */
export function highlightJson(json: string): ReactNode[] {
  const parts: ReactNode[] = [];
  let last = 0;
  let key = 0;
  for (const match of json.matchAll(TOKEN)) {
    const index = match.index ?? 0;
    if (index > last) parts.push(json.slice(last, index));
    const [whole, string, colon, number, boolean, nul] = match;
    if (string !== undefined) {
      parts.push(
        <span key={key++} className={colon ? "tok-key" : "tok-str"}>
          {string}
        </span>,
      );
      if (colon) parts.push(colon);
    } else if (number !== undefined) {
      parts.push(
        <span key={key++} className="tok-num">
          {number}
        </span>,
      );
    } else if (boolean !== undefined) {
      parts.push(
        <span key={key++} className="tok-bool">
          {boolean}
        </span>,
      );
    } else if (nul !== undefined) {
      parts.push(
        <span key={key++} className="tok-null">
          {nul}
        </span>,
      );
    } else {
      parts.push(whole);
    }
    last = index + whole.length;
  }
  if (last < json.length) parts.push(json.slice(last));
  return parts;
}

export interface JsonViewProps {
  value: unknown;
  maxHeight?: number;
  className?: string;
  /** Accessible name for the block. */
  label?: string;
}

/** Read-only JSON with syntax colour and a copy button. Always the exact payload, never a summary (Design.md §4). */
export function JsonView({ value, maxHeight = 360, className = "", label = "JSON" }: JsonViewProps) {
  const json = JSON.stringify(value, null, 2) ?? "null";
  return (
    <div className={`relative ${className}`}>
      <CopyButton text={json} className="absolute right-2 top-2" />
      <pre aria-label={label} className="scroll-thin overflow-auto rounded-xl bg-surface-2 p-3 pr-20 font-mono text-xs leading-5" style={{ maxHeight }}>
        <code>{highlightJson(json)}</code>
      </pre>
    </div>
  );
}
