-- Intent: Sandbox / BYOK (T25) stores a merchant's own Razorpay webhook secret in `guardrail_config` under
--         `sandbox_secret_<account_id>`. Every other row in that table is an operational bound anyone may read, and
--         the table is deliberately SELECT-able by `aegis_readonly` so Ask Aegis can answer questions about limits
--         (0002_readonly_grants.sql). A credential must not ride along on that grant: model-authored SQL runs as
--         `aegis_readonly` (C-A8, C-D7) and could otherwise select the secret straight out of the allowlisted table.
-- Flow:   enable row level security on the table -> add one SELECT policy that hides only the sandbox rows. The table
--         owner (`aegis`, the application role) bypasses RLS because the table is not FORCE'd, so the ingress HMAC
--         check and the sandbox route keep full access while every other role sees the bounds and nothing else.
ALTER TABLE guardrail_config ENABLE ROW LEVEL SECURITY;

-- `_` is a LIKE wildcard, so both underscores in the prefix are escaped; the policy matches the literal key prefix.
CREATE POLICY guardrail_config_hide_sandbox_secrets ON guardrail_config
  FOR SELECT TO PUBLIC
  USING (key NOT LIKE 'sandbox\_secret\_%');
