-- Intent: establish the event log and transactional outbox before any projections run.
-- Flow: webhook ingress writes an idempotent event, then enqueues one process job.
-- Intent: retain a durable, idempotent record of every Razorpay delivery.
-- Flow: signature verification persists the raw payload; duplicates increment duplicate_count.
CREATE TABLE webhook_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id text NOT NULL UNIQUE,
  event_type text NOT NULL,
  account_id text,
  payload jsonb NOT NULL,
  payload_sha256 text NOT NULL,
  signature_valid boolean NOT NULL,
  rzp_created_at timestamptz,
  received_at timestamptz NOT NULL DEFAULT now(),
  duplicate_count integer NOT NULL DEFAULT 0,
  last_duplicate_at timestamptz,
  status text NOT NULL DEFAULT 'received' CHECK (status IN ('received','processing','processed','failed','dead_letter','ignored')),
  processed_at timestamptz,
  last_error text
);
CREATE INDEX webhook_events_type_received_idx ON webhook_events (event_type, received_at DESC);

-- Intent: provide a durable transactional outbox and retryable worker queue.
-- Flow: ingress inserts a queued job in the event transaction; workers claim rows with SKIP LOCKED.
CREATE TABLE jobs (
  id bigserial PRIMARY KEY,
  kind text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  dedupe_key text UNIQUE,
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','running','succeeded','failed','dead_letter','cancelled')),
  attempts integer NOT NULL DEFAULT 0,
  max_attempts integer NOT NULL DEFAULT 5,
  run_at timestamptz NOT NULL DEFAULT now(),
  locked_by text,
  locked_at timestamptz,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX jobs_poll_idx ON jobs (run_at, id) WHERE status = 'queued';

-- Intent: store merchant customer preferences and locale needed by deterministic guardrails.
-- Flow: projections upsert customer facts while read-only analytics receives only non-PII columns.
CREATE TABLE customers (
  id text PRIMARY KEY, name text, email text, contact text, country text,
  locale text NOT NULL DEFAULT 'en-IN', opted_out boolean NOT NULL DEFAULT false,
  notes jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);

-- Intent: project Razorpay orders for checkout state and recovery attribution.
-- Flow: each event locks the order row, applies status precedence, and records its source event.
CREATE TABLE orders (
  id text PRIMARY KEY, customer_id text REFERENCES customers(id),
  amount_paise bigint NOT NULL CHECK (amount_paise >= 0), currency text NOT NULL DEFAULT 'INR',
  status text NOT NULL DEFAULT 'created' CHECK (status IN ('created','attempted','paid','abandoned')),
  receipt text, items jsonb NOT NULL DEFAULT '[]'::jsonb, notes jsonb NOT NULL DEFAULT '{}'::jsonb,
  rzp_created_at timestamptz, last_event_id text REFERENCES webhook_events(event_id), version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);

-- Intent: project payment lifecycle facts with an explicit monotonic status rank.
-- Flow: row locks and precedence rules prevent stale deliveries from regressing a payment.
CREATE TABLE payments (
  id text PRIMARY KEY, order_id text REFERENCES orders(id), customer_id text REFERENCES customers(id),
  amount_paise bigint NOT NULL CHECK (amount_paise >= 0), currency text NOT NULL DEFAULT 'INR',
  status text NOT NULL CHECK (status IN ('created','authorized','captured','refunded','failed')),
  status_rank smallint NOT NULL,
  method text, card_network text, card_type text, card_issuer text, card_country text,
  international boolean NOT NULL DEFAULT false,
  error_code text, error_description text, error_source text, error_step text, error_reason text,
  email text, contact text, notes jsonb NOT NULL DEFAULT '{}'::jsonb,
  rzp_created_at timestamptz, last_event_id text REFERENCES webhook_events(event_id), version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);

-- Intent: retain subscription state and deterministic salvage progress for dunning.
-- Flow: the latest Razorpay event timestamp wins while retry counters remain bounded by guardrails.
CREATE TABLE subscriptions (
  id text PRIMARY KEY, plan_id text, customer_id text REFERENCES customers(id),
  status text NOT NULL CHECK (status IN ('created','authenticated','active','pending','halted','cancelled','completed','expired')),
  amount_paise bigint NOT NULL CHECK (amount_paise >= 0), currency text NOT NULL DEFAULT 'INR',
  current_start timestamptz, current_end timestamptz, charge_at timestamptz,
  total_count integer, paid_count integer NOT NULL DEFAULT 0, remaining_count integer,
  salvage_state text NOT NULL DEFAULT 'none' CHECK (salvage_state IN ('none','retry_scheduled','retrying','offer_sent','recovered','churned','escalated')),
  retry_count integer NOT NULL DEFAULT 0, next_retry_at timestamptz,
  last_event_id text REFERENCES webhook_events(event_id), last_event_at timestamptz, version integer NOT NULL DEFAULT 1,
  notes jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);

-- Intent: project invoices and preserve the bounded negotiation state machine.
-- Flow: invoice events update state under a row lock; offers are computed in TypeScript against the floor.
CREATE TABLE invoices (
  id text PRIMARY KEY, customer_id text REFERENCES customers(id),
  amount_paise bigint NOT NULL CHECK (amount_paise >= 0), floor_amount_paise bigint NOT NULL CHECK (floor_amount_paise >= 0),
  currency text NOT NULL DEFAULT 'INR',
  status text NOT NULL CHECK (status IN ('issued','partially_paid','paid','expired','cancelled')),
  due_by timestamptz, line_items jsonb NOT NULL DEFAULT '[]'::jsonb,
  negotiation_state text NOT NULL DEFAULT 'none' CHECK (negotiation_state IN ('none','offer_sent','countered','accepted','rejected','expired','escalated')),
  negotiation_round integer NOT NULL DEFAULT 0, current_offer_paise bigint,
  notes jsonb NOT NULL DEFAULT '{}'::jsonb,
  rzp_created_at timestamptz, last_event_id text REFERENCES webhook_events(event_id), version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);

-- Intent: track payment disputes and their response deadlines for human-reviewed evidence.
-- Flow: dispute projection records lifecycle state; evidence submission is gated separately.
CREATE TABLE disputes (
  id text PRIMARY KEY, payment_id text REFERENCES payments(id),
  amount_paise bigint NOT NULL CHECK (amount_paise >= 0), currency text NOT NULL DEFAULT 'INR',
  reason_code text, reason_description text,
  phase text NOT NULL CHECK (phase IN ('fraud','retrieval','chargeback','pre_arbitration','arbitration')),
  status text NOT NULL CHECK (status IN ('open','under_review','won','lost','closed')),
  respond_by timestamptz, last_event_id text REFERENCES webhook_events(event_id),
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);

-- Intent: pause assembled dispute evidence for an explicit human decision.
-- Flow: packet starts at requires_human_review and can only be approved before simulated submission.
CREATE TABLE evidence_packets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), dispute_id text NOT NULL UNIQUE REFERENCES disputes(id),
  packet jsonb NOT NULL, narrative text,
  review_status text NOT NULL DEFAULT 'requires_human_review' CHECK (review_status IN ('requires_human_review','approved','rejected','submitted')),
  reviewed_by text, reviewed_at timestamptz, review_note text, submitted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Intent: make every AI diagnosis auditable with deterministic hints and provider metadata.
-- Flow: callers persist validated output, cross-check decisions, degradation, and latency after the LLM call.
CREATE TABLE diagnoses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), event_id text NOT NULL REFERENCES webhook_events(event_id),
  entity_type text NOT NULL, entity_id text NOT NULL,
  hints jsonb NOT NULL, provider text NOT NULL, model text NOT NULL, prompt_version text NOT NULL, input_digest text NOT NULL,
  output jsonb NOT NULL, root_cause text NOT NULL, confidence numeric(4,3) NOT NULL, strategy text NOT NULL, rationale text NOT NULL,
  degraded boolean NOT NULL DEFAULT false, degraded_reason text, latency_ms integer, tokens_in integer, tokens_out integer,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX diagnoses_entity_idx ON diagnoses (entity_type, entity_id, created_at DESC);

-- Intent: persist every proposed money or customer action before execution with evaluated guard bounds.
-- Flow: orchestrator inserts once by idempotency_key, then gates approval or executes the action.
CREATE TABLE actions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), idempotency_key text NOT NULL UNIQUE,
  module text NOT NULL, module_version text NOT NULL,
  trigger_event_id text REFERENCES webhook_events(event_id), diagnosis_id uuid REFERENCES diagnoses(id),
  entity_type text NOT NULL, entity_id text NOT NULL, customer_id text,
  kind text NOT NULL, summary text NOT NULL, proposal jsonb NOT NULL, bounds jsonb NOT NULL DEFAULT '[]'::jsonb,
  money_impact_paise bigint NOT NULL DEFAULT 0 CHECK (money_impact_paise <= 0),
  expected_recovery_paise bigint NOT NULL DEFAULT 0 CHECK (expected_recovery_paise >= 0),
  requires_approval boolean NOT NULL DEFAULT false,
  status text NOT NULL CHECK (status IN ('proposed','blocked','pending_approval','approved','rejected','executed','failed','expired','compensated')),
  reason text, decided_by text, decided_at timestamptz, executed_at timestamptz, result jsonb,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX actions_status_idx ON actions (status, created_at DESC);
CREATE INDEX actions_entity_idx ON actions (entity_type, entity_id);

-- Intent: record simulated outbound customer messages and their suppression reasons.
-- Flow: an executed action inserts a template payload labelled simulated_sent or suppressed.
CREATE TABLE outbound_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), action_id uuid NOT NULL REFERENCES actions(id),
  channel text NOT NULL CHECK (channel IN ('whatsapp','email','sms')), recipient_masked text NOT NULL, locale text NOT NULL,
  template text NOT NULL, payload jsonb NOT NULL,
  status text NOT NULL CHECK (status IN ('simulated_sent','suppressed')), suppressed_reason text,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Intent: provide an append-only, integer-paise ledger for recoveries, discounts, and simulated revenue.
-- Flow: action execution writes debit/credit entries with a reference to the originating action or payment.
CREATE TABLE ledger_entries (
  id bigserial PRIMARY KEY, account text NOT NULL,
  debit_paise bigint NOT NULL DEFAULT 0 CHECK (debit_paise >= 0), credit_paise bigint NOT NULL DEFAULT 0 CHECK (credit_paise >= 0),
  currency text NOT NULL DEFAULT 'INR', ref_type text NOT NULL, ref_id text NOT NULL, memo text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ledger_entries_account_idx ON ledger_entries (account, created_at DESC);

-- Intent: hold the merchant catalog used by compliance scans and the simulated x402 gateway.
-- Flow: catalog rows are seeded first, then scanners and agent purchases read active products.
CREATE TABLE products (
  id text PRIMARY KEY, merchant_id text NOT NULL, name text NOT NULL, description text NOT NULL, category text,
  price_paise bigint NOT NULL CHECK (price_paise >= 0), currency text NOT NULL DEFAULT 'INR', sku text,
  active boolean NOT NULL DEFAULT true, agent_purchasable boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);

-- Intent: summarize each deterministic-plus-LLM catalog compliance scan batch.
-- Flow: scanner creates a running row, updates counts/provider, and finishes it succeeded or failed.
CREATE TABLE compliance_scan_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), started_at timestamptz NOT NULL DEFAULT now(), finished_at timestamptz,
  products_scanned integer NOT NULL DEFAULT 0, flags_created integer NOT NULL DEFAULT 0,
  provider text, model text, degraded_count integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'running' CHECK (status IN ('running','succeeded','failed'))
);

-- Intent: retain keyword evidence and validated risk assessments for every flagged product.
-- Flow: prescreen hits are stored with optional LLM assessment; evidence failures enter needs_review.
CREATE TABLE compliance_flags (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), product_id text NOT NULL REFERENCES products(id),
  scan_run_id uuid REFERENCES compliance_scan_runs(id),
  keyword_hits jsonb NOT NULL DEFAULT '[]'::jsonb, llm_assessment jsonb,
  risk_level text NOT NULL CHECK (risk_level IN ('none','low','medium','high','prohibited')),
  category text NOT NULL, evidence_span text, recommendation text,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','acknowledged','resolved','false_positive','needs_review')),
  reviewed_by text, reviewed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Intent: persist x402 challenge, verification, settlement, and replay state in PostgreSQL.
-- Flow: each server-issued nonce transitions challenged -> verified/settled or rejected/expired exactly once.
CREATE TABLE x402_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), nonce text NOT NULL UNIQUE,
  resource text NOT NULL, method text NOT NULL, payer text,
  amount_paise bigint NOT NULL CHECK (amount_paise >= 0), asset text NOT NULL DEFAULT 'INR', network text NOT NULL DEFAULT 'aegis-sim',
  status text NOT NULL CHECK (status IN ('challenged','verified','settled','rejected','expired')),
  reject_reason text, payment_payload jsonb, request_id text, expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(), settled_at timestamptz
);

-- Intent: audit every Ask Aegis question, generated SQL validation, and execution outcome.
-- Flow: store the SQL before execution; readonly execution and summary metadata complete the row afterward.
CREATE TABLE nl_queries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), question text NOT NULL, generated_sql text,
  validated boolean NOT NULL DEFAULT false, validation_errors jsonb, executed boolean NOT NULL DEFAULT false,
  row_count integer, latency_ms integer, provider text, model text, degraded boolean NOT NULL DEFAULT false,
  summary text, error text, created_at timestamptz NOT NULL DEFAULT now()
);

-- Intent: keep all editable action bounds in PostgreSQL so every worker uses the same snapshot.
-- Flow: the seed writes defaults; guardrail edits are audited and loaded by key before proposing actions.
CREATE TABLE guardrail_config (
  key text PRIMARY KEY, value jsonb NOT NULL, description text NOT NULL,
  updated_by text NOT NULL DEFAULT 'seed', updated_at timestamptz NOT NULL DEFAULT now()
);

-- Intent: provide an append-only record of automated and human decisions across the control plane.
-- Flow: each state transition stores actor, entity, and before/after JSON for review.
CREATE TABLE audit_log (
  id bigserial PRIMARY KEY, actor text NOT NULL, action text NOT NULL,
  entity_type text NOT NULL, entity_id text NOT NULL, before jsonb, after jsonb, metadata jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
