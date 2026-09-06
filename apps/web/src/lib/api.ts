/**
 * Typed client for the Aegis API. The dashboard never talks to PostgreSQL directly (Decisions D-003).
 * NEXT_PUBLIC_API_URL is the only coupling; it is inlined at build time for client components and read at
 * request time in server components.
 * Intent: every call returns a discriminated result instead of throwing, so a page can render an honest "API offline"
 *         state (C-F5) rather than a Next.js error boundary.
 * Flow: build URL -> fetch with a timeout -> parse JSON (or keep the raw text as details) -> map non-2xx to ApiFailure.
 */
import type {
  ActionDetail,
  ActionListRow,
  ActionRow,
  ApiErrorBody,
  AuditLogRow,
  ApprovalsResponse,
  AskHistoryRow,
  AskResponse,
  ComplianceFlagRow,
  ComplianceFlagStatus,
  DecisionBody,
  DisputeRow,
  EvidencePacketRow,
  GuardrailRow,
  HealthResponse,
  InvoiceRow,
  MetricsSummary,
  MetricsWindow,
  Paged,
  SandboxKeysBody,
  SandboxKeysResponse,
  SimRunResult,
  SubscriptionRow,
  SystemInfo,
  WebhookEventDetail,
  WebhookEventListRow,
  X402PaymentRow,
  X402Product,
} from "./types";
import { sandboxRequestHeaders } from "./sandbox";

export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

export interface ApiSuccess<T> {
  ok: true;
  status: number;
  data: T;
  headers: Headers;
}

export interface ApiFailure {
  ok: false;
  status: number;
  /** Machine code from the API (`not_found`, `validation_error`, …) or `network_error` / `timeout` from the client. */
  error: string;
  details?: string;
  requestId?: string;
  /** Parsed body when the failure carried one (x402 challenges are 402 responses with a JSON body). */
  body?: unknown;
  headers?: Headers;
}

export type ApiResult<T> = ApiSuccess<T> | ApiFailure;

export interface RequestOptions {
  method?: "GET" | "POST" | "PUT";
  body?: unknown;
  headers?: Record<string, string>;
  timeoutMs?: number;
  signal?: AbortSignal;
}

const DEFAULT_TIMEOUT_MS = 8_000;

function isErrorBody(value: unknown): value is ApiErrorBody {
  return typeof value === "object" && value !== null && "error" in value && typeof value.error === "string";
}

export async function apiFetch<T>(path: string, options: RequestOptions = {}): Promise<ApiResult<T>> {
  // Sandbox / BYOK (T25): while Live mode is on in this browser, every call carries the merchant's own model key as
  // `x-aegis-llm-key`; the API binds that request's model calls to it and stores nothing. Server-side renders and
  // Demo mode contribute no headers here. Explicit per-call headers still win.
  const headers: Record<string, string> = { accept: "application/json", ...sandboxRequestHeaders(), ...options.headers };
  if (options.body !== undefined) headers["content-type"] = "application/json";
  try {
    const response = await fetch(`${API_URL}${path}`, {
      method: options.method ?? "GET",
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      cache: "no-store",
      signal: options.signal ?? AbortSignal.timeout(options.timeoutMs ?? DEFAULT_TIMEOUT_MS),
    });
    const text = await response.text();
    let json: unknown = null;
    if (text.length > 0) {
      try {
        json = JSON.parse(text);
      } catch (error) {
        // Intent: a proxy/HTML error page must surface as a readable failure, not a JSON parse exception.
        json = { error: "non_json_response", details: `${error instanceof Error ? error.message : String(error)}: ${text.slice(0, 200)}` };
      }
    }
    if (!response.ok) {
      const body = isErrorBody(json) ? json : { error: `http_${response.status}` };
      return { ok: false, status: response.status, error: body.error, details: body.details, requestId: body.request_id, body: json, headers: response.headers };
    }
    // The API is the contract owner; T names the shape documented in lib/types.ts for this path.
    return { ok: true, status: response.status, data: json as T, headers: response.headers };
  } catch (error) {
    const timeout = error instanceof DOMException && error.name === "TimeoutError";
    return { ok: false, status: 0, error: timeout ? "timeout" : "network_error", details: error instanceof Error ? error.message : String(error) };
  }
}

function query(params: Record<string, string | number | boolean | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== "") search.set(key, String(value));
  }
  const encoded = search.toString();
  return encoded.length > 0 ? `?${encoded}` : "";
}

/** Human-readable message for a failed call; keeps the machine code visible for support. */
export function describeFailure(failure: ApiFailure): string {
  if (failure.error === "network_error") return `The API at ${API_URL} is unreachable.`;
  if (failure.error === "timeout") return `The API at ${API_URL} did not answer in time.`;
  return failure.details ? `${failure.error}: ${failure.details}` : failure.error;
}

export const api = {
  health: () => apiFetch<HealthResponse>("/health", { timeoutMs: 2_500 }),
  system: () => apiFetch<SystemInfo>("/api/v1/system", { timeoutMs: 2_500 }),
  guardrails: () => apiFetch<{ items: GuardrailRow[] }>("/api/v1/guardrails"),
  guardrailHistory: (limit = 50) => apiFetch<Paged<AuditLogRow>>(`/api/v1/guardrails/history${query({ limit })}`),
  updateGuardrail: (key: string, value: unknown, actor: string) =>
    apiFetch<{ guardrail: GuardrailRow }>(`/api/v1/guardrails/${encodeURIComponent(key)}`, { method: "PUT", body: { value, actor } }),
  metrics: (window: MetricsWindow) => apiFetch<MetricsSummary>(`/api/v1/metrics/summary${query({ window })}`),
  events: (params: { type?: string; status?: string; limit?: number; before?: string } = {}) =>
    apiFetch<Paged<WebhookEventListRow>>(`/api/v1/events${query(params)}`),
  event: (eventId: string) => apiFetch<WebhookEventDetail>(`/api/v1/events/${encodeURIComponent(eventId)}`),
  actions: (params: { status?: string; module?: string; limit?: number; before?: string } = {}) =>
    apiFetch<Paged<ActionListRow>>(`/api/v1/actions${query(params)}`),
  action: (id: string) => apiFetch<ActionDetail>(`/api/v1/actions/${encodeURIComponent(id)}`),
  approvals: () => apiFetch<ApprovalsResponse>("/api/v1/approvals"),
  decideAction: (id: string, body: DecisionBody) =>
    apiFetch<{ action: ActionRow }>(`/api/v1/actions/${encodeURIComponent(id)}/decision`, { method: "POST", body }),
  evidence: (disputeId: string) => apiFetch<EvidencePacketRow>(`/api/v1/evidence/${encodeURIComponent(disputeId)}`),
  decideEvidence: (disputeId: string, body: DecisionBody) =>
    apiFetch<{ evidence: EvidencePacketRow; action: ActionRow }>(`/api/v1/evidence/${encodeURIComponent(disputeId)}/decision`, { method: "POST", body }),
  ask: (question: string) => apiFetch<AskResponse>("/api/v1/ask", { method: "POST", body: { question }, timeoutMs: 45_000 }),
  askHistory: (limit = 20) => apiFetch<{ items: AskHistoryRow[] }>(`/api/v1/ask/history${query({ limit })}`),
  complianceFlags: (params: { status?: string; risk?: string } = {}) => apiFetch<ComplianceFlagRow[]>(`/api/v1/compliance/flags${query(params)}`),
  complianceScan: () => apiFetch<{ runId: string; status: string }>("/api/v1/compliance/scan", { method: "POST" }),
  setFlagStatus: (id: string, status: ComplianceFlagStatus, actor: string) =>
    apiFetch<{ flag: ComplianceFlagRow }>(`/api/v1/compliance/flags/${encodeURIComponent(id)}/status`, { method: "POST", body: { status, actor } }),
  x402Payments: () => apiFetch<{ items: X402PaymentRow[] }>("/api/v1/x402/payments"),
  x402Catalog: () => apiFetch<{ items: X402Product[] }>("/x402/catalog"),
  subscriptions: (params: { limit?: number; before?: string } = {}) => apiFetch<Paged<SubscriptionRow>>(`/api/v1/subscriptions${query(params)}`),
  invoices: (params: { limit?: number; before?: string } = {}) => apiFetch<Paged<InvoiceRow>>(`/api/v1/invoices${query(params)}`),
  disputes: (params: { limit?: number; before?: string } = {}) => apiFetch<Paged<DisputeRow>>(`/api/v1/disputes${query(params)}`),
  /**
   * Sandbox / BYOK (T25): registers the merchant's Razorpay webhook secret for their account. The API answers with a
   * fingerprint of what it stored and never returns the secret.
   */
  saveSandboxKeys: (body: SandboxKeysBody) => apiFetch<SandboxKeysResponse>("/api/v1/sandbox/keys", { method: "POST", body }),
  /** Development only: signs an X-PAYMENT header server-side so the facilitator secret never reaches the browser. */
  signX402: (body: { nonce: string; amount: string; payer?: string }) =>
    apiFetch<{ header: string; payload: Record<string, unknown> }>("/api/v1/sim/x402-sign", { method: "POST", body }),
  /** Development only: the API mounts `/api/v1/sim/*` unless NODE_ENV=production (C-D5). */
  simRun: (body: { scenario: string; dupes?: number; burst?: number; seed?: number | string; chaos?: "llm_down" }) =>
    apiFetch<SimRunResult>("/api/v1/sim/run", { method: "POST", body, timeoutMs: 60_000 }),
};

/** Kept for the Task 1 landing page contract; pages now use `api.health()` directly. */
export type HealthResult = { reachable: true; health: HealthResponse } | { reachable: false; error: string };

export async function getHealth(): Promise<HealthResult> {
  const result = await api.health();
  return result.ok ? { reachable: true, health: result.data } : { reachable: false, error: describeFailure(result) };
}
