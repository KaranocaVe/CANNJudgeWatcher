CREATE INDEX IF NOT EXISTS idx_ranking_event_previous_lookup
  ON ranking_event(contest_id, problem_id, team_key, poll_id DESC)
  WHERE event_type <> 'DELETE';
