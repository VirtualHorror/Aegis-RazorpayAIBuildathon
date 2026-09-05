-- Intent: one accounting row per account/reference prevents concurrent attribution from double-counting revenue.
-- Flow: enforce uniqueness after the base ledger table exists; inserts use the database constraint as the final guard.
CREATE UNIQUE INDEX ledger_entries_account_ref_unique_idx
  ON ledger_entries (account, ref_type, ref_id);
