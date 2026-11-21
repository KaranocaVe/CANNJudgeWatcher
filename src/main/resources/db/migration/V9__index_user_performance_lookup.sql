CREATE INDEX IF NOT EXISTS idx_ranking_event_user_lookup
  ON ranking_event(user_id, observed_at DESC)
  WHERE event_type <> 'DELETE';

CREATE INDEX IF NOT EXISTS idx_ranking_event_nickname_lookup
  ON ranking_event(user_nickname, observed_at DESC)
  WHERE event_type <> 'DELETE';
