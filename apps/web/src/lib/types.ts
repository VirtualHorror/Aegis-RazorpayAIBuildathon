/**
 * Wire types for the Aegis API as the dashboard sees them (JSON over HTTP: timestamps are ISO strings, bigint paise
 * columns arrive as numbers because the API installs an int8 parser).
 * Intent: one place that names every row the pages render, so a renamed column fails typecheck instead of rendering
 *         `undefined`. Enums come from @aegis/shared so the API, SQL CHECKs and the UI share one definition.
 */
import type {
  ActionStatus,
  BusEventName,
  DisputePhase,
  DisputeStatus,
  EntityType,
  InvoiceStatus,
  NegotiationState,
  ReviewStatus,
  RiskLevel,
  SalvageState,
  SubscriptionStatus,
  WebhookEventStatus,
  X402Status,
} from "@aegis/shared";

export type { ActionStatus, BusEventName, EntityType, ReviewStatus, RiskLevel, WebhookEventStatus, X402Status };

export interface HealthResponse {
  status: "ok" | "degraded";
  db: "ok" | "unavailable";
  db_latency_ms: number;
  error?: string;
  version: string;
  uptime_s: number;
  timestamp: string;
}

export interface SystemInfo {
  provider: string;
  model: string;
  modelFast: string;
  env: string;
  version: string;
  simulated: true;
}

export interface ApiErrorBody {
  error: string;
  details?: string;
  request_id?: string;
}

export interface Paged<T> {
  items: T[];
  /** Cursor for the next page (`before=<created_at>`), or null when this was the last page. */
  next: string | null;
}

export interface WebhookEventListRow {
  event_id: string;
  event_type: string;
  status: WebhookEventStatus;
  signature_valid: boolean;
  rzp_created_at: string | null;
  received_at: string;
  duplicate_count: number;
  processed_at: string | null;
  last_error: string | null;
}

export interface WebhookEventDetail extends WebhookEventListRow {
  id: string;
  account_id: string | null;
  payload: unknown;
  payload_sha256: string;
  last_duplicate_at: string | null;
  diagnoses: DiagnosisRow[];
  actions: ActionRow[];
}

export interface GuardRule {
  rule: string;
  limit: unknown;
  actual: unknown;
  pass: boolean;
  note?: string;
}

export interface ActionRow {
  id: string;
  idempotency_key: string;
  module: string;
  module_version: string;
  trigger_event_id: string | null;
  diagnosis_id: string | null;
  entity_type: EntityType;
  entity_id: string;
  customer_id: string | null;
  kind: string;
  summary: string;
  proposal: Record<string, unknown>;
  bounds: GuardRule[];
  money_impact_paise: number;
  expected_recovery_paise: number;
  requires_approval: boolean;
  status: ActionStatus;
  reason: string | null;
  decided_by: string | null;
  decided_at: string | null;
  executed_at: string | null;
  result: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
}

/** `GET /api/v1/actions` rows carry the diagnosis provider so the audit table can show a degraded badge without N+1 fetches. */
export interface ActionListRow extends ActionRow {
  diagnosis_degraded: boolean | null;
  diagnosis_provider: string | null;
}

export interface DiagnosisRow {
  id: string;
  event_id: string;
  entity_type: EntityType;
  entity_id: string;
  hints: Record<string, unknown>;
  provider: string;
  model: string;
  prompt_version: string;
  input_digest: string;
  output: Record<string, unknown>;
  root_cause: string;
  confidence: number;
  strategy: string;
  rationale: string;
  degraded: boolean;
  degraded_reason: string | null;
  latency_ms: number | null;
  tokens_in: number | null;
  tokens_out: number | null;
  created_at: string;
}

export interface OutboundMessageRow {
  id: string;
  action_id: string;
  channel: "whatsapp" | "email" | "sms";
  recipient_masked: string;
  locale: string;
  template: string;
  payload: Record<string, unknown>;
  status: "simulated_sent" | "suppressed";
  suppressed_reason: string | null;
  created_at: string;
}

export interface LedgerEntryRow {
  id: number;
  account: string;
  debit_paise: number;
  credit_paise: number;
  currency: string;
  ref_type: string;
  ref_id: string;
  memo: string | null;
  created_at: string;
}

export interface AuditLogRow {
  id: number;
  actor: string;
  action: string;
  entity_type: string;
  entity_id: string;
  before: unknown;
  after: unknown;
  metadata: Record<string, unknown> | null;
  created_at: string;
}

export interface ActionDetail {
  action: ActionRow;
  diagnosis: DiagnosisRow | null;
  outbound_messages: OutboundMessageRow[];
  ledger_entries: LedgerEntryRow[];
  audit: AuditLogRow[];
}

export interface EvidencePacket {
  dispute: { id: string; amount_paise: number; reason_code: string | null; reason_description: string | null; phase: string; respond_by: string | null };
  payment: { id: string; amount_paise: number; method: string | null; card_network: string | null; card_last4: string | null; captured_at: string | null; international: boolean };
  order: { id: string | null; items: unknown[]; amount_paise: number; receipt: string | null };
  customer: { id_masked: string; country: string | null; locale: string; account_age_days: number };
  delivery: { carrier: string | null; tracking: string | null; delivered_at: string | null; proof_url: string | null } | null;
  communications: { channel: string; template: string; sent_at: string }[];
  refund_policy: { url: string | null; summary: string };
  prior_disputes: number;
  missing: string[];
}

export interface EvidencePacketRow {
  id: string;
  dispute_id: string;
  packet: EvidencePacket;
  narrative: string | null;
  review_status: ReviewStatus;
  reviewed_by: string | null;
  reviewed_at: string | null;
  review_note: string | null;
  submitted_at: string | null;
  created_at: string;
}

export interface ApprovalsResponse {
  actions: ActionRow[];
  evidence: EvidencePacketRow[];
}

export interface DecisionBody {
  decision: "approve" | "reject";
  note: string;
  actor: string;
}

export interface MetricsSummary {
  events: { received: number; duplicates: number; rejected: number; processed: number; dead_letter: number };
  actions: { proposed: number; blocked: number; pending_approval: number; executed: number; rejected: number };
  money: { recovered_paise: number; discounts_granted_paise: number; x402_revenue_paise: number; chargeback_exposure_paise: number };
  humans: { reviewed: number; approved: number; rejected: number; rejection_rate: number };
  llm: { calls: number; degraded: number; degraded_rate: number; avg_latency_ms: number; by_provider: Record<string, number> };
  window: MetricsWindow;
}

export type MetricsWindow = "24h" | "7d" | "all";

export interface GuardrailRow {
  key: string;
  value: unknown;
  description: string;
  updated_by: string;
  updated_at: string;
}

export interface AskQueryResponse {
  kind: "query";
  sql: string | null;
  validation: { ok: boolean; errors?: string[] };
  rows: Record<string, unknown>[];
  summary: string | null;
  executed: boolean;
  degraded: boolean;
  error?: string;
  queryId?: string;
}

export interface ForecastPoint {
  date: string;
  value: number;
  lower: number;
  upper: number;
}

export interface ForecastResult {
  points: ForecastPoint[];
  method: "ols+ma7";
  slopePerDay: number;
  r2: number;
  intercept: number;
  movingAverage7: number;
  residualStddev: number;
}

export interface AskForecastResponse {
  kind: "forecast";
  sql: string;
  metric: "gmv" | "failed_payments" | "recovered_revenue" | "disputes" | "x402_revenue";
  series: { date: string; value: number }[];
  forecast: ForecastResult;
  summary: string;
  executed: boolean;
  degraded: boolean;
  error?: string;
  queryId?: string;
}

export type AskResponse = AskQueryResponse | AskForecastResponse;

export interface AskHistoryRow {
  id: string;
  question: string;
  generated_sql: string | null;
  validated: boolean;
  validation_errors: unknown;
  executed: boolean;
  row_count: number | null;
  latency_ms: number | null;
  provider: string | null;
  model: string | null;
  degraded: boolean;
  summary: string | null;
  error: string | null;
  created_at: string;
}

export type ComplianceFlagStatus = "open" | "acknowledged" | "resolved" | "false_positive" | "needs_review";

export interface KeywordHit {
  category: string;
  pattern: string;
}

export interface ComplianceAssessment {
  risk_level: RiskLevel;
  category: string;
  evidence_span: string;
  recommendation: string;
  reasoning: string;
}

export interface ComplianceFlagRow {
  id: string;
  product_id: string;
  scan_run_id: string | null;
  keyword_hits: KeywordHit[];
  llm_assessment: ComplianceAssessment | null;
  risk_level: RiskLevel;
  category: string;
  evidence_span: string | null;
  recommendation: string | null;
  status: ComplianceFlagStatus;
  reviewed_by: string | null;
  reviewed_at: string | null;
  created_at: string;
  /** The flagged product's own copy, returned with the flag so the evidence span can be shown in context. */
  product_name: string;
  product_description: string;
  product_category: string | null;
}

export interface X402PaymentRow {
  id: string;
  nonce: string;
  resource: string;
  method: string;
  payer: string | null;
  amount_paise: number;
  asset: string;
  network: string;
  status: X402Status;
  reject_reason: string | null;
  expires_at: string;
  created_at: string;
  settled_at: string | null;
}

export interface X402Product {
  id: string;
  name: string;
  description: string;
  category: string | null;
  price_paise: number;
  currency: string;
}

export interface X402Challenge {
  x402Version: 1;
  error: string;
  accepts?: {
    scheme: string;
    network: string;
    maxAmountRequired: string;
    resource: string;
    description: string;
    mimeType: string;
    payTo: string;
    maxTimeoutSeconds: number;
    asset: string;
    extra: { nonce: string; expiresAt: string; simulated: boolean };
  }[];
}

export interface SubscriptionRow {
  id: string;
  plan_id: string | null;
  customer_id: string | null;
  status: SubscriptionStatus;
  amount_paise: number;
  currency: string;
  charge_at: string | null;
  paid_count: number;
  remaining_count: number | null;
  salvage_state: SalvageState;
  retry_count: number;
  next_retry_at: string | null;
  last_event_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface InvoiceRow {
  id: string;
  customer_id: string | null;
  amount_paise: number;
  floor_amount_paise: number;
  currency: string;
  status: InvoiceStatus;
  due_by: string | null;
  negotiation_state: NegotiationState;
  negotiation_round: number;
  current_offer_paise: number | null;
  created_at: string;
  updated_at: string;
}

export interface DisputeRow {
  id: string;
  payment_id: string | null;
  amount_paise: number;
  currency: string;
  reason_code: string | null;
  reason_description: string | null;
  phase: DisputePhase;
  status: DisputeStatus;
  respond_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface SimRunResult {
  seed: number | string;
  scenario: string;
  results: { scenario: string; status_code: number; status: string; event_id: string; latency_ms: number }[];
  totals: { accepted: number; duplicate: number; rejected: number; ignored: number; rate_limited: number };
  p50_latency_ms: number;
  p95_latency_ms: number;
}

/** `POST /api/v1/sandbox/keys` (T25). */
export interface SandboxKeysBody {
  account_id: string;
  webhook_secret: string;
  actor: string;
}

export interface SandboxKeysResponse {
  sandbox: {
    account_id: string;
    /** `sandbox_secret_<account_id>` — the guardrail_config row the webhook ingress reads. */
    key: string;
    /** First 12 hex characters of sha256(secret): enough to confirm which secret is live, never the secret. */
    webhook_secret_fingerprint: string;
    updated_by: string;
    updated_at: string;
  };
}

/** SSE payload shapes the pages rely on (published by apps/api; everything else is passed through as unknown). */
export interface StreamPayloads {
  "event.received": { eventId: string; eventType?: string; status: string };
  "event.duplicate": { eventId: string; status: string };
  "event.rejected": { eventId: string; reason?: string; status?: string };
  "event.processed": { eventId: string; status: string; actionCount?: number; reason?: string };
  "action.proposed": { eventId: string; action: ActionRow };
  "action.blocked": { eventId: string; action: ActionRow; reason: string | null };
  "action.pending_approval": { eventId: string; action: ActionRow };
  "action.executed": { actionId: string; action: ActionRow; result: Record<string, unknown> };
  "action.failed": { actionId: string; action: ActionRow; error?: string };
  "system.kill_switch": { enabled: boolean };
  "x402.settled": { txId?: string; nonce?: string; amountPaise?: number; payer?: string; settledAt?: string };
  "x402.rejected": { reason: string; nonce: string };
  "compliance.flag": { runId: string; productId: string; flag: unknown };
}
