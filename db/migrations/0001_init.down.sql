-- Intent: remove the core schema as one transaction during a controlled rollback.
-- Flow: drop foreign-key dependents first, then projections, ingress tables, and finally the queue.
DROP TABLE IF EXISTS audit_log CASCADE;
DROP TABLE IF EXISTS guardrail_config CASCADE;
DROP TABLE IF EXISTS nl_queries CASCADE;
DROP TABLE IF EXISTS x402_payments CASCADE;
DROP TABLE IF EXISTS compliance_flags CASCADE;
DROP TABLE IF EXISTS compliance_scan_runs CASCADE;
DROP TABLE IF EXISTS products CASCADE;
DROP TABLE IF EXISTS ledger_entries CASCADE;
DROP TABLE IF EXISTS outbound_messages CASCADE;
DROP TABLE IF EXISTS actions CASCADE;
DROP TABLE IF EXISTS diagnoses CASCADE;
DROP TABLE IF EXISTS evidence_packets CASCADE;
DROP TABLE IF EXISTS disputes CASCADE;
DROP TABLE IF EXISTS invoices CASCADE;
DROP TABLE IF EXISTS subscriptions CASCADE;
DROP TABLE IF EXISTS payments CASCADE;
DROP TABLE IF EXISTS orders CASCADE;
DROP TABLE IF EXISTS customers CASCADE;
DROP TABLE IF EXISTS jobs CASCADE;
DROP TABLE IF EXISTS webhook_events CASCADE;
