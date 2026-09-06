/**
 * Sandbox / BYOK mode (T25): Demo runs against the deployment's own simulated Razorpay account and model key; Live
 * runs against the merchant's. The dashboard keeps the merchant's values in this browser only.
 * Intent: nothing here is a server secret — the webhook secret is sent to the API exactly once when the user saves it
 *         (`POST /api/v1/sandbox/keys`), and the model key rides on every request as a header the API never stores.
 *         localStorage is the right home for a per-browser credential the user typed and can clear.
 * Flow: `useSandbox` reads the store -> the modal edits a draft -> `setSandbox` persists and notifies subscribers ->
 *       `sandboxHeaders` decorates every `apiFetch` while Live mode is on.
 *
 * No React import and no "use client" directive on purpose: `lib/api.ts` imports `sandboxRequestHeaders` and is itself
 * imported by server components, and the RSC bundler rejects even an unused `useSyncExternalStore` import on that
 * path. The hook lives in `useSandbox.ts`; this module only owns the store.
 */

export type SandboxMode = "demo" | "live";

export interface SandboxSettings {
  readonly mode: SandboxMode;
  /** Razorpay account id (`acc_…`); names the `sandbox_secret_<account_id>` row on the API. */
  readonly accountId: string;
  /** The merchant's Razorpay webhook secret; sent to the API on save, never attached to requests. */
  readonly webhookSecret: string;
  /** The merchant's model provider key; attached as `x-aegis-llm-key` to every request while Live mode is on. */
  readonly llmKey: string;
}

export interface SandboxFieldErrors {
  accountId?: string;
  webhookSecret?: string;
  llmKey?: string;
}

export const LLM_KEY_HEADER = "x-aegis-llm-key";
export const DEFAULT_SANDBOX: SandboxSettings = Object.freeze({ mode: "demo", accountId: "", webhookSecret: "", llmKey: "" });

const STORAGE_KEY = "aegis.sandbox";
/** Mirrors `apps/api/src/sandbox/keys.ts` so the form refuses exactly what the API would refuse. */
const ACCOUNT_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
const PRINTABLE_ASCII = /^[\x21-\x7e]+$/;
const MIN_SECRET_LENGTH = 8;
const MIN_LLM_KEY_LENGTH = 20;

function stringField(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/** Parse what localStorage holds; anything unreadable or off-shape degrades to Demo mode rather than a half-state. */
export function parseSandbox(raw: string | null): SandboxSettings {
  if (raw === null || raw.length === 0) return DEFAULT_SANDBOX;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    // A corrupted entry is the same as no entry: the user can only ever be in Demo mode without re-entering keys.
    return DEFAULT_SANDBOX;
  }
  if (typeof parsed !== "object" || parsed === null) return DEFAULT_SANDBOX;
  const record = parsed as Record<string, unknown>;
  if (record.mode !== "demo" && record.mode !== "live") return DEFAULT_SANDBOX;
  return {
    mode: record.mode,
    accountId: stringField(record.accountId),
    webhookSecret: stringField(record.webhookSecret),
    llmKey: stringField(record.llmKey),
  };
}

export function serializeSandbox(settings: SandboxSettings): string {
  return JSON.stringify({ mode: settings.mode, accountId: settings.accountId, webhookSecret: settings.webhookSecret, llmKey: settings.llmKey });
}

export function isLive(settings: SandboxSettings): boolean {
  return settings.mode === "live";
}

/** Request headers Live mode adds: the model key, and nothing else — the webhook secret never leaves the save call. */
export function sandboxHeaders(settings: SandboxSettings): Record<string, string> {
  const key = settings.llmKey.trim();
  if (!isLive(settings) || key.length === 0) return {};
  return { [LLM_KEY_HEADER]: key };
}

/** Field-level validation for the modal; Demo mode has nothing to validate. */
export function validateSandbox(settings: SandboxSettings): SandboxFieldErrors {
  if (!isLive(settings)) return {};
  const errors: SandboxFieldErrors = {};
  const accountId = settings.accountId.trim();
  if (accountId.length === 0) errors.accountId = "Account id is required in Live mode.";
  else if (!ACCOUNT_ID_PATTERN.test(accountId)) errors.accountId = "Use 1–64 letters, digits, _ or - (Razorpay ids look like acc_…).";

  const secret = settings.webhookSecret.trim();
  if (secret.length === 0) errors.webhookSecret = "Webhook secret is required in Live mode.";
  else if (secret.length < MIN_SECRET_LENGTH) errors.webhookSecret = `Use at least ${MIN_SECRET_LENGTH} characters.`;
  else if (!PRINTABLE_ASCII.test(secret)) errors.webhookSecret = "No spaces or control characters.";

  const llmKey = settings.llmKey.trim();
  if (llmKey.length > 0 && llmKey.length < MIN_LLM_KEY_LENGTH) errors.llmKey = `A provider key is at least ${MIN_LLM_KEY_LENGTH} characters.`;
  else if (llmKey.length > 0 && !PRINTABLE_ASCII.test(llmKey)) errors.llmKey = "No spaces or control characters.";
  return errors;
}

/* ----------------------------------------------------------------------------------------------------------------
 * Browser store. The functions below are safe to call on the server: they see no `window` and answer with Demo mode.
 * ---------------------------------------------------------------------------------------------------------------- */

const listeners = new Set<() => void>();
let cached: { raw: string | null; value: SandboxSettings } | null = null;

export function readSandbox(): SandboxSettings {
  if (typeof window === "undefined") return DEFAULT_SANDBOX;
  let raw: string | null;
  try {
    raw = window.localStorage.getItem(STORAGE_KEY);
  } catch {
    // Storage can be blocked (private mode, disabled site data); the dashboard then simply stays in Demo mode.
    return DEFAULT_SANDBOX;
  }
  // useSyncExternalStore needs a stable snapshot for an unchanged store, so parse only when the raw string changes.
  if (cached === null || cached.raw !== raw) cached = { raw, value: parseSandbox(raw) };
  return cached.value;
}

/** Headers for the current browser state; `{}` on the server and in Demo mode. */
export function sandboxRequestHeaders(): Record<string, string> {
  return sandboxHeaders(readSandbox());
}

/** Notifies on `setSandbox` in this tab and on `storage` events from other tabs; used by `useSandbox`. */
export function subscribeSandbox(listener: () => void): () => void {
  listeners.add(listener);
  window.addEventListener("storage", listener);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", listener);
  };
}

export function setSandbox(next: SandboxSettings): void {
  try {
    if (next.mode === "demo" && next.accountId === "" && next.webhookSecret === "" && next.llmKey === "") {
      window.localStorage.removeItem(STORAGE_KEY);
    } else {
      window.localStorage.setItem(STORAGE_KEY, serializeSandbox(next));
    }
  } catch {
    // Same as readSandbox(): a blocked store only loses persistence across reloads, never the current session.
  }
  for (const listener of [...listeners]) listener();
}
