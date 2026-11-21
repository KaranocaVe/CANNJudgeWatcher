-- Cover hot read paths used by the public dashboard and poller.
CREATE INDEX IF NOT EXISTS idx_ranking_current_problem_order
  ON ranking_current(contest_id, problem_id, rank NULLS LAST, create_time NULLS LAST, team_key);
CREATE INDEX IF NOT EXISTS idx_ranking_event_previous_order
  ON ranking_event(contest_id, problem_id, team_key, poll_id DESC, id DESC)
  WHERE event_type <> 'DELETE';
CREATE INDEX IF NOT EXISTS idx_ranking_event_team_time
  ON ranking_event(contest_id, problem_id, team_key, observed_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_ranking_case_best_problem_case
  ON ranking_case_best(contest_id, problem_id, testcase_id);
CREATE INDEX IF NOT EXISTS idx_alert_contest_created
  ON alert_event(contest_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_alert_problem_created
  ON alert_event(problem_id, created_at DESC);
