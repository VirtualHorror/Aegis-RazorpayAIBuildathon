-- Reverse 0005: drop the sandbox-secret policy and return `guardrail_config` to plain grant-based access.
DROP POLICY IF EXISTS guardrail_config_hide_sandbox_secrets ON guardrail_config;
ALTER TABLE guardrail_config DISABLE ROW LEVEL SECURITY;
