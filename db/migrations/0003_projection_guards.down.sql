-- Intent: reverse only the projection guard columns introduced by migration 0003.
-- Flow:  drop the dispute version first, then the shared event timestamps, leaving the core tables intact.
ALTER TABLE disputes DROP COLUMN IF EXISTS version;
ALTER TABLE disputes DROP COLUMN IF EXISTS last_event_at;
ALTER TABLE invoices DROP COLUMN IF EXISTS last_event_at;
ALTER TABLE payments DROP COLUMN IF EXISTS last_event_at;
ALTER TABLE orders DROP COLUMN IF EXISTS last_event_at;
