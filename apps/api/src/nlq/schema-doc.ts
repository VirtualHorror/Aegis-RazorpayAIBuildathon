/**
 * The schema shown to the text-to-SQL model is deliberately smaller than PostgreSQL's catalog.
 * Intent: give the model enough business context to write useful read-only queries without exposing customer or
 * payment contact columns that the readonly role cannot access (C-D7).
 * Flow: prompt builder embeds this document -> validator applies the same table allowlist -> readonly pool executes.
 */
export const READONLY_TABLES = [
  'webhook_events',
  'jobs',
  'orders',
  'subscriptions',
  'invoices',
  'disputes',
  'evidence_packets',
  'diagnoses',
  'actions',
  'outbound_messages',
  'ledger_entries',
  'products',
  'compliance_scan_runs',
  'compliance_flags',
  'x402_payments',
  'nl_queries',
  'guardrail_config',
  'audit_log',
  'customers',
  'payments',
] as const;

export type ReadonlyTable = (typeof READONLY_TABLES)[number];

export const SCHEMA_DOC = `Aegis readonly PostgreSQL schema (all amounts are integer paise, timestamps are timestamptz).
Only SELECT statements are allowed. Sensitive customer and payment fields are intentionally omitted.

webhook_events(event_id, event_type, account_id, payload, payload_sha256, signature_valid, rzp_created_at, received_at,
 duplicate_count, last_duplicate_at, status, processed_at, last_error)
jobs(id, kind, payload, dedupe_key, status, attempts, max_attempts, run_at, locked_by, locked_at, last_error, created_at, updated_at)
orders(id, customer_id, amount_paise, currency, status, receipt, items, notes, rzp_created_at, last_event_id, last_event_at, version, created_at, updated_at)
payments(id, order_id, customer_id, amount_paise, currency, status, method, card_network, card_type, card_country,
 international, error_code, error_source, error_step, error_reason, rzp_created_at, created_at)
subscriptions(id, plan_id, customer_id, status, amount_paise, currency, current_start, current_end, charge_at, total_count,
 paid_count, remaining_count, salvage_state, retry_count, next_retry_at, last_event_id, last_event_at, version, notes, created_at, updated_at)
invoices(id, customer_id, amount_paise, floor_amount_paise, currency, status, due_by, line_items, negotiation_state,
 negotiation_round, current_offer_paise, notes, rzp_created_at, last_event_id, last_event_at, version, created_at, updated_at)
disputes(id, payment_id, amount_paise, currency, reason_code, reason_description, phase, status, respond_by, last_event_id,
 last_event_at, version, created_at, updated_at)
evidence_packets(id, dispute_id, packet, narrative, review_status, reviewed_by, reviewed_at, review_note, submitted_at, created_at)
diagnoses(id, event_id, entity_type, entity_id, hints, provider, model, prompt_version, input_digest, output, root_cause,
 confidence, strategy, rationale, degraded, degraded_reason, latency_ms, tokens_in, tokens_out, created_at)
actions(id, idempotency_key, module, module_version, trigger_event_id, diagnosis_id, entity_type, entity_id, customer_id, kind,
 summary, proposal, bounds, money_impact_paise, expected_recovery_paise, requires_approval, status, reason, decided_by,
 decided_at, executed_at, result, created_at, updated_at)
outbound_messages(id, action_id, channel, recipient_masked, locale, template, payload, status, suppressed_reason, created_at)
ledger_entries(id, account, debit_paise, credit_paise, currency, ref_type, ref_id, memo, created_at)
products(id, merchant_id, name, description, category, price_paise, currency, sku, active, agent_purchasable, created_at, updated_at)
compliance_scan_runs(id, started_at, finished_at, products_scanned, flags_created, provider, model, degraded_count, status)
compliance_flags(id, product_id, scan_run_id, keyword_hits, llm_assessment, risk_level, category, evidence_span, recommendation,
 status, reviewed_by, reviewed_at, created_at)
x402_payments(id, nonce, resource, method, payer, amount_paise, asset, network, status, reject_reason, payment_payload,
 request_id, expires_at, created_at, settled_at)
nl_queries(id, question, generated_sql, validated, validation_errors, executed, row_count, latency_ms, provider, model, degraded,
 summary, error, created_at)
guardrail_config(key, value, description, updated_by, updated_at)
audit_log(id, actor, action, entity_type, entity_id, before, after, metadata, created_at)
customers(id, country, locale, opted_out, created_at, updated_at)

Examples:
1. Weekly recovered revenue by module -> SELECT a.module, SUM(l.credit_paise) AS recovered_paise FROM actions a JOIN ledger_entries l ON l.ref_type = 'action' AND l.ref_id = a.id::text WHERE l.account = 'recovered_revenue' AND l.created_at >= now() - interval '7 days' GROUP BY a.module ORDER BY recovered_paise DESC
2. Failed payments today -> SELECT count(*) AS failed FROM payments WHERE status = 'failed' AND created_at >= date_trunc('day', now())
3. Open disputes -> SELECT id, amount_paise, reason_code, respond_by FROM disputes WHERE status IN ('open','under_review')
4. Active products -> SELECT id, name, price_paise FROM products WHERE active = true ORDER BY name
5. Discount total this month -> SELECT COALESCE(SUM(-money_impact_paise), 0) AS discounts_paise FROM actions WHERE status = 'executed' AND money_impact_paise < 0 AND created_at >= date_trunc('month', now())
6. x402 revenue -> SELECT COALESCE(SUM(credit_paise), 0) AS x402_paise FROM ledger_entries WHERE account = 'x402_revenue' AND created_at >= now() - interval '30 days'`;

export const SCHEMA_EXAMPLES = SCHEMA_DOC.slice(SCHEMA_DOC.indexOf('Examples:'));
