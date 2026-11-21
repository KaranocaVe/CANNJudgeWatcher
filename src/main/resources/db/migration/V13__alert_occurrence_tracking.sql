ALTER TABLE alert_event
  ADD COLUMN IF NOT EXISTS last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS occurrence_count INTEGER NOT NULL DEFAULT 1 CHECK (occurrence_count > 0);

UPDATE alert_event SET last_seen_at = COALESCE(last_seen_at, created_at), occurrence_count = COALESCE(occurrence_count, 1);
