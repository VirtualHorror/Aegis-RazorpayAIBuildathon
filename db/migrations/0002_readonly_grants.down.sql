-- Intent: remove all grants owned by the AI SQL role during rollback.
-- Flow: revoke table and schema privileges without failing when the role is absent.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'aegis_readonly') THEN
    REVOKE ALL ON ALL TABLES IN SCHEMA public FROM aegis_readonly;
    REVOKE USAGE ON SCHEMA public FROM aegis_readonly;
  ELSE
    RAISE WARNING 'role aegis_readonly does not exist; skipping readonly grant rollback';
  END IF;
END;
$$;
