-- Intent: isolate AI-generated SQL behind a PostgreSQL role that cannot read customer PII.
-- Flow: grant only after checking role existence; CI databases without the role emit a warning and continue.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'aegis_readonly') THEN
    GRANT USAGE ON SCHEMA public TO aegis_readonly;
    GRANT SELECT ON webhook_events, jobs, orders, subscriptions, invoices, disputes, evidence_packets, diagnoses, actions, outbound_messages, ledger_entries, products, compliance_scan_runs, compliance_flags, x402_payments, nl_queries, guardrail_config, audit_log TO aegis_readonly;
    GRANT SELECT (id, country, locale, opted_out, created_at, updated_at) ON customers TO aegis_readonly;
    GRANT SELECT (id, order_id, customer_id, amount_paise, currency, status, method, card_network, card_type, card_country, international, error_code, error_source, error_step, error_reason, rzp_created_at, created_at) ON payments TO aegis_readonly;
  ELSE
    RAISE WARNING 'role aegis_readonly does not exist; skipping readonly grants';
  END IF;
END;
$$;
