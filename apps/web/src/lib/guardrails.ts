/**
 * Editing rules for `guardrail_config`, mirroring the API's zod schemas (`routes/approvals.ts`).
 * Intent: the form validates before it sends so a wrong value reads as a sentence, not a 400; the API remains the
 *         authority and its refusal is still shown if the two ever disagree.
 */
export type GuardrailKind = "boolean" | "paise" | "percent" | "count" | "hours" | "hour-range" | "hour-list";

export interface GuardrailSpec {
  kind: GuardrailKind;
  label: string;
  /** Shown under the field, in addition to the description the API stores. */
  hint?: string;
  min?: number;
  max?: number;
}

export const GUARDRAIL_SPECS: Readonly<Record<string, GuardrailSpec>> = {
  kill_switch: { kind: "boolean", label: "Kill switch" },
  auto_approve_limit_paise: { kind: "paise", label: "Auto-approve limit", hint: "Money impact above this waits for a human." },
  max_discount_pct: { kind: "percent", label: "Maximum discount", min: 0, max: 100 },
  max_negotiation_rounds: { kind: "count", label: "Maximum negotiation rounds", min: 0, max: 20 },
  max_dunning_retries: { kind: "count", label: "Maximum dunning retries", min: 0, max: 20 },
  dunning_schedule_hours: { kind: "hour-list", label: "Dunning schedule", hint: "Hours after the failure, comma separated." },
  message_cooldown_hours: { kind: "hours", label: "Message cooldown", min: 0, max: 8_760 },
  quiet_hours_local: { kind: "hour-range", label: "Quiet hours", hint: "No outbound message inside this local window." },
  daily_discount_budget_paise: { kind: "paise", label: "Daily discount budget" },
  attribution_window_hours: { kind: "hours", label: "Attribution window", min: 1, max: 8_760 },
  x402_max_amount_paise: { kind: "paise", label: "x402 per-request cap" },
  x402_daily_cap_per_payer_paise: { kind: "paise", label: "x402 daily cap per payer" },
};

export interface ParseResult {
  ok: boolean;
  value?: unknown;
  error?: string;
}

/** Turn what the person typed into the JSON value the API expects, or explain why it cannot be. */
export function parseGuardrail(key: string, input: string): ParseResult {
  const spec = GUARDRAIL_SPECS[key];
  if (!spec) return { ok: false, error: "Aegis does not know this guardrail." };
  const text = input.trim();
  switch (spec.kind) {
    case "boolean": {
      if (text === "true" || text === "false") return { ok: true, value: text === "true" };
      return { ok: false, error: "Use true or false." };
    }
    case "paise": {
      // Typed in rupees, stored in integer paise: money never round-trips through a float (C-B6).
      if (!/^\d{1,12}(\.\d{1,2})?$/.test(text)) return { ok: false, error: "Enter rupees, at most two decimals, no separators." };
      const [rupees, fraction = ""] = text.split(".");
      const paise = Number(rupees) * 100 + Number(fraction.padEnd(2, "0"));
      if (!Number.isSafeInteger(paise)) return { ok: false, error: "That amount is too large." };
      return { ok: true, value: paise };
    }
    case "percent": {
      const value = Number(text);
      if (!Number.isFinite(value) || value < 0 || value > 100) return { ok: false, error: "Enter a percentage between 0 and 100." };
      return { ok: true, value };
    }
    case "count":
    case "hours": {
      const value = Number(text);
      const min = spec.min ?? 0;
      const max = spec.max ?? Number.MAX_SAFE_INTEGER;
      if (!Number.isSafeInteger(value) || value < min || value > max) return { ok: false, error: `Enter a whole number between ${min} and ${max}.` };
      return { ok: true, value };
    }
    case "hour-list": {
      const parts = text.split(",").map((part) => part.trim()).filter((part) => part.length > 0);
      if (parts.length === 0) return { ok: false, error: "Enter at least one hour offset." };
      const values = parts.map(Number);
      if (values.some((value) => !Number.isSafeInteger(value) || value < 0)) return { ok: false, error: "Every offset must be a whole number of hours, zero or more." };
      return { ok: true, value: values };
    }
    case "hour-range": {
      const match = /^(\d{1,2})\s*(?:-|to|–)\s*(\d{1,2})$/.exec(text);
      if (!match) return { ok: false, error: "Write it as start-end in local hours, for example 21-8." };
      const start = Number(match[1]);
      const end = Number(match[2]);
      if (start > 23 || end > 23) return { ok: false, error: "Hours run from 0 to 23." };
      return { ok: true, value: { start, end } };
    }
    default:
      return { ok: false, error: "Unsupported guardrail type." };
  }
}

/** Render a stored value as the text the field shows. */
export function formatGuardrail(key: string, value: unknown): string {
  const spec = GUARDRAIL_SPECS[key];
  if (!spec) return typeof value === "object" ? JSON.stringify(value) : String(value);
  switch (spec.kind) {
    case "boolean":
      return value === true ? "true" : "false";
    case "paise": {
      if (typeof value !== "number") return String(value);
      const rupees = Math.floor(value / 100);
      const fraction = String(value % 100).padStart(2, "0");
      return fraction === "00" ? String(rupees) : `${rupees}.${fraction}`;
    }
    case "hour-list":
      return Array.isArray(value) ? value.join(", ") : String(value);
    case "hour-range": {
      if (typeof value !== "object" || value === null) return String(value);
      const range = value as { start?: unknown; end?: unknown };
      return `${String(range.start ?? "")}-${String(range.end ?? "")}`;
    }
    default:
      return String(value);
  }
}

/** Unit for the field suffix. */
export function guardrailUnit(key: string): string | null {
  const spec = GUARDRAIL_SPECS[key];
  if (!spec) return null;
  switch (spec.kind) {
    case "paise":
      return "₹";
    case "percent":
      return "%";
    case "hours":
      return "hours";
    default:
      return null;
  }
}
