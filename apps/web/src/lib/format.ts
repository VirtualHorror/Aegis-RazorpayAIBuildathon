/**
 * Display formatting. Money formatting is a UI concern (C-B6): the API ships integer paise, this file turns them into
 * strings and nothing here ever does arithmetic on amounts.
 */
import { formatInr as sharedFormatInr } from "@aegis/shared";

export { sharedFormatInr as formatInr };

/** `formatInr` for values that may be missing or arrive as strings from `SELECT *` rows. */
export function formatPaise(value: unknown): string {
  const paise = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  if (!Number.isSafeInteger(paise)) return "—";
  return sharedFormatInr(paise);
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** "just now", "42s ago", "3m ago", "2h ago", "yesterday", "3d ago", then an absolute date. */
export function relativeTime(value: string | number | Date | null | undefined, now: number = Date.now()): string {
  if (value === null || value === undefined) return "—";
  const time = value instanceof Date ? value.getTime() : new Date(value).getTime();
  if (!Number.isFinite(time)) return "—";
  const delta = now - time;
  if (delta < 0) return "in the future";
  if (delta < 10_000) return "just now";
  if (delta < MINUTE) return `${Math.floor(delta / 1_000)}s ago`;
  if (delta < HOUR) return `${Math.floor(delta / MINUTE)}m ago`;
  if (delta < DAY) return `${Math.floor(delta / HOUR)}h ago`;
  if (delta < 2 * DAY) return "yesterday";
  if (delta < 14 * DAY) return `${Math.floor(delta / DAY)}d ago`;
  return formatDate(time);
}

const dateTimeFormat = new Intl.DateTimeFormat("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });
const dateFormat = new Intl.DateTimeFormat("en-IN", { day: "2-digit", month: "short", year: "numeric" });
const timeFormat = new Intl.DateTimeFormat("en-IN", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });

export function formatDateTime(value: string | number | Date | null | undefined): string {
  if (value === null || value === undefined) return "—";
  const date = value instanceof Date ? value : new Date(value);
  return Number.isFinite(date.getTime()) ? dateTimeFormat.format(date) : "—";
}

export function formatDate(value: string | number | Date): string {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isFinite(date.getTime()) ? dateFormat.format(date) : "—";
}

export function formatTime(value: string | number | Date | null | undefined): string {
  if (value === null || value === undefined) return "—";
  const date = value instanceof Date ? value : new Date(value);
  return Number.isFinite(date.getTime()) ? timeFormat.format(date) : "—";
}

/** Keep the type prefix and the last four characters so an id stays recognisable without being copyable from a screenshot. */
export function maskId(id: string | null | undefined): string {
  if (!id) return "—";
  if (id.length <= 10) return id;
  const underscore = id.indexOf("_");
  const prefix = underscore > 0 && underscore < 8 ? id.slice(0, underscore + 1) : "";
  return `${prefix}…${id.slice(-4)}`;
}

export function formatMs(ms: number | null | undefined): string {
  if (ms === null || ms === undefined || !Number.isFinite(ms)) return "—";
  if (ms < 1_000) return `${Math.round(ms)} ms`;
  return `${(ms / 1_000).toFixed(1)} s`;
}

export function formatPercent(fraction: number | null | undefined, digits = 0): string {
  if (fraction === null || fraction === undefined || !Number.isFinite(fraction)) return "—";
  return `${(fraction * 100).toFixed(digits)}%`;
}

const integerFormat = new Intl.NumberFormat("en-IN");

export function formatCount(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  return integerFormat.format(value);
}

/** `pending_approval` → "Pending approval". */
export function humanize(value: string | null | undefined): string {
  if (!value) return "—";
  const spaced = value.replace(/[_\-.]+/g, " ").trim();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

/** Module identifiers → the short labels used on badges and the prism fan (Design.md §5.1). */
export const MODULE_LABELS: Readonly<Record<string, string>> = {
  checkout_recovery: "Checkout recovery",
  subscription_salvager: "Salvage",
  b2b_negotiator: "Negotiate",
  chargeback_evidence: "Evidence",
  x402: "x402",
  compliance: "Compliance",
  nlq: "Ask Aegis",
};

export function moduleLabel(module: string): string {
  return MODULE_LABELS[module] ?? humanize(module);
}

/** CSS custom property holding the module's spectrum colour (globals.css). */
export function moduleColorVar(module: string): string {
  return module in MODULE_LABELS ? `var(--mod-${module})` : "var(--fg-muted)";
}
