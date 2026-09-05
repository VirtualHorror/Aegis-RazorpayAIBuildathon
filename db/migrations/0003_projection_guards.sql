-- Intent: give every projected entity a timestamp for the event that last changed its state,
--         and give disputes the same optimistic version counter as the other projections.
-- Flow:  apply this additive migration after the core schema -> projections lock rows and compare
--        `last_event_at` before incrementing `version` and recording `last_event_id`.
ALTER TABLE orders ADD COLUMN last_event_at timestamptz;
ALTER TABLE payments ADD COLUMN last_event_at timestamptz;
ALTER TABLE invoices ADD COLUMN last_event_at timestamptz;
ALTER TABLE disputes ADD COLUMN last_event_at timestamptz;
ALTER TABLE disputes ADD COLUMN version integer NOT NULL DEFAULT 1;
