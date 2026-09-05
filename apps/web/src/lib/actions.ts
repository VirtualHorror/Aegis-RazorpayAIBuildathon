/**
 * Pure helpers for the actions audit trail and approvals.
 * Intent: bus envelopes become row updates only in the ways the API reports them; nothing here invents a status.
 */
import { formatInr, humanize } from "./format";
import type { StreamEvent } from "./sse";
import type { ActionDetail, ActionListRow, ActionRow, GuardRule } from "./types";
import { actionOf } from "./overview";

export interface ActionFilters {
  status?: string;
  module?: string;
}

function toListRow(action: ActionRow, previous?: ActionListRow): ActionListRow {
  return { ...action, diagnosis_degraded: previous?.diagnosis_degraded ?? null, diagnosis_provider: previous?.diagnosis_provider ?? null };
}

/**
 * Apply one `action.*` envelope to the loaded rows: a new proposal is prepended when it matches the filters, a known
 * row is replaced by the fresher copy, and a row that no longer matches a status filter is removed.
 */
export function mergeActionEvent(rows: readonly ActionListRow[], event: StreamEvent, filters: ActionFilters = {}): { rows: ActionListRow[]; changed: string | null } {
  const action = actionOf(event.data);
  if (!action) return { rows: [...rows], changed: null };
  const index = rows.findIndex((row) => row.id === action.id);
  const matches = (!filters.status || action.status === filters.status) && (!filters.module || action.module === filters.module);
  if (index >= 0) {
    if (!matches) return { rows: rows.filter((row) => row.id !== action.id), changed: action.id };
    const next = [...rows];
    next[index] = toListRow(action, rows[index]);
    return { rows: next, changed: action.id };
  }
  if (!matches) return { rows: [...rows], changed: null };
  return { rows: [toListRow(action), ...rows], changed: action.id };
}

/** Pending queue: `pending_approval` adds, any terminal status removes. */
export function mergePendingEvent(rows: readonly ActionRow[], event: StreamEvent): ActionRow[] {
  const action = actionOf(event.data);
  if (!action) return [...rows];
  const without = rows.filter((row) => row.id !== action.id);
  return action.status === "pending_approval" ? [...without, action] : without;
}

/** Guard rule values: paise become rupees, booleans become words, objects stay JSON. */
export function formatBound(rule: string, value: unknown): string {
  if (value === null || value === undefined) return "—";
  if (typeof value === "boolean") return value ? "yes" : "no";
  if (typeof value === "number") {
    if (/paise|amount|budget|limit_paise|floor|impact|discount_paise/.test(rule) && Number.isSafeInteger(value)) return formatInr(value);
    return String(value);
  }
  if (typeof value === "string") return value;
  return JSON.stringify(value);
}

export interface TimelineEntry {
  at: string;
  title: string;
  detail?: string;
  tone: "neutral" | "ok" | "warn" | "danger" | "accent";
}

/** Everything the audit trail knows about an action, oldest first. */
export function timelineEntries(detail: ActionDetail): TimelineEntry[] {
  const { action } = detail;
  const entries: TimelineEntry[] = [{ at: action.created_at, title: `Proposed by ${humanize(action.module).toLowerCase()}`, detail: action.reason ? `Reason: ${humanize(action.reason)}` : undefined, tone: "accent" }];
  if (detail.diagnosis) {
    entries.push({ at: detail.diagnosis.created_at, title: detail.diagnosis.degraded ? "Diagnosed by rules (model unavailable)" : `Diagnosed by ${detail.diagnosis.provider}`, detail: humanize(detail.diagnosis.root_cause.toLowerCase()), tone: detail.diagnosis.degraded ? "warn" : "neutral" });
  }
  if (action.decided_at) {
    const rejected = action.status === "rejected";
    entries.push({ at: action.decided_at, title: rejected ? `Rejected by ${action.decided_by ?? "a human"}` : `Approved by ${action.decided_by ?? "a human"}`, tone: rejected ? "danger" : "ok" });
  }
  for (const message of detail.outbound_messages) {
    entries.push({ at: message.created_at, title: message.status === "simulated_sent" ? `Simulated ${message.channel} message` : `${humanize(message.channel)} message suppressed`, detail: message.status === "simulated_sent" ? `${message.template} to ${message.recipient_masked}` : message.suppressed_reason ?? undefined, tone: message.status === "simulated_sent" ? "ok" : "warn" });
  }
  for (const entry of detail.ledger_entries) {
    const amount = entry.credit_paise > 0 ? `credit ${formatInr(entry.credit_paise)}` : `debit ${formatInr(entry.debit_paise)}`;
    entries.push({ at: entry.created_at, title: `Ledger ${humanize(entry.account).toLowerCase()}`, detail: `${amount}${entry.memo ? ` (${entry.memo})` : ""}`, tone: "ok" });
  }
  if (action.executed_at) {
    entries.push({ at: action.executed_at, title: action.status === "failed" ? "Execution failed" : "Executed", detail: action.status === "failed" ? stringField(action.result, "error") : undefined, tone: action.status === "failed" ? "danger" : "ok" });
  }
  for (const audit of detail.audit) {
    if (audit.action === "action.executed" || audit.action === "action.failed" || audit.action === "action.proposed") continue;
    entries.push({ at: audit.created_at, title: `${humanize(audit.action.replace("action.", ""))} by ${audit.actor}`, detail: stringField(audit.metadata, "note"), tone: "neutral" });
  }
  return entries.sort((left, right) => new Date(left.at).getTime() - new Date(right.at).getTime());
}

function stringField(record: Record<string, unknown> | null | undefined, key: string): string | undefined {
  const value = record?.[key];
  return typeof value === "string" ? value : undefined;
}

export function explanationSteps(action: ActionRow): string[] {
  const value = action.proposal.explanation;
  return Array.isArray(value) ? value.filter((step): step is string => typeof step === "string") : [];
}

export function ruleSummary(bounds: readonly GuardRule[]): { passed: number; failed: number } {
  return { passed: bounds.filter((rule) => rule.pass).length, failed: bounds.filter((rule) => !rule.pass).length };
}
