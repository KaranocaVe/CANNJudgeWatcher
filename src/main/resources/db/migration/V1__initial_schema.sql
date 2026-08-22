CREATE TABLE admin_user (
  id BIGSERIAL PRIMARY KEY,
  username VARCHAR(120) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE app_setting (
  key VARCHAR(120) PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE contest (
  id VARCHAR(64) PRIMARY KEY,
  slug VARCHAR(200),
  title TEXT NOT NULL,
  description TEXT,
  start_time TIMESTAMPTZ,
  end_time TIMESTAMPTZ,
  source_ongoing BOOLEAN NOT NULL DEFAULT FALSE,
  source_status VARCHAR(40) NOT NULL DEFAULT 'DISCOVERED',
  status VARCHAR(40) NOT NULL DEFAULT 'DISCOVERED',
  monitoring_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  manual_override BOOLEAN NOT NULL DEFAULT FALSE,
  poll_interval_seconds INTEGER NOT NULL DEFAULT 120 CHECK (poll_interval_seconds BETWEEN 60 AND 1800),
  source_hash VARCHAR(64),
  last_seen_at TIMESTAMPTZ,
  last_poll_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_contest_status ON contest(status, monitoring_enabled);

CREATE TABLE problem (
  id VARCHAR(64) PRIMARY KEY,
  contest_id VARCHAR(64) NOT NULL REFERENCES contest(id) ON DELETE CASCADE,
  slug VARCHAR(240),
  title TEXT NOT NULL,
  difficulty INTEGER,
  tags JSONB NOT NULL DEFAULT '[]'::jsonb,
  source_hash VARCHAR(64),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(contest_id, id)
);
CREATE INDEX idx_problem_contest ON problem(contest_id);

CREATE TABLE poll_run (
  id BIGSERIAL PRIMARY KEY,
  started_at TIMESTAMPTZ NOT NULL,
  finished_at TIMESTAMPTZ,
  status VARCHAR(32) NOT NULL,
  source VARCHAR(80) NOT NULL DEFAULT 'cannjudge.cn',
  contests_seen INTEGER NOT NULL DEFAULT 0,
  rows_seen INTEGER NOT NULL DEFAULT 0,
  changed_rows INTEGER NOT NULL DEFAULT 0,
  response_hash VARCHAR(64),
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_poll_run_started ON poll_run(started_at DESC);

CREATE TABLE ranking_current (
  contest_id VARCHAR(64) NOT NULL REFERENCES contest(id) ON DELETE CASCADE,
  problem_id VARCHAR(64) NOT NULL REFERENCES problem(id) ON DELETE CASCADE,
  team_key VARCHAR(180) NOT NULL,
  team_id VARCHAR(120),
  team_name TEXT,
  user_id VARCHAR(120),
  user_nickname TEXT,
  submitter_id VARCHAR(120),
  submitter_nickname TEXT,
  submission_id VARCHAR(120),
  rank INTEGER,
  status VARCHAR(80),
  score NUMERIC(18,6),
  create_time TIMESTAMPTZ,
  result JSONB NOT NULL DEFAULT '[]'::jsonb,
  row_hash VARCHAR(64) NOT NULL,
  last_poll_id BIGINT REFERENCES poll_run(id),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY(contest_id, problem_id, team_key)
);
CREATE INDEX idx_ranking_current_problem ON ranking_current(contest_id, problem_id, rank);

CREATE TABLE ranking_event (
  id BIGSERIAL PRIMARY KEY,
  poll_id BIGINT NOT NULL REFERENCES poll_run(id) ON DELETE CASCADE,
  observed_at TIMESTAMPTZ NOT NULL,
  contest_id VARCHAR(64) NOT NULL REFERENCES contest(id) ON DELETE CASCADE,
  problem_id VARCHAR(64) NOT NULL REFERENCES problem(id) ON DELETE CASCADE,
  team_key VARCHAR(180) NOT NULL,
  event_type VARCHAR(16) NOT NULL,
  team_id VARCHAR(120),
  team_name TEXT,
  user_id VARCHAR(120),
  user_nickname TEXT,
  submitter_id VARCHAR(120),
  submitter_nickname TEXT,
  submission_id VARCHAR(120),
  rank INTEGER,
  status VARCHAR(80),
  score NUMERIC(18,6),
  create_time TIMESTAMPTZ,
  result JSONB NOT NULL DEFAULT '[]'::jsonb,
  row_hash VARCHAR(64),
  evidence JSONB NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX idx_ranking_event_lookup ON ranking_event(contest_id, problem_id, team_key, observed_at DESC);
CREATE INDEX idx_ranking_event_time ON ranking_event(contest_id, problem_id, observed_at DESC);

CREATE TABLE problem_stats_current (
  contest_id VARCHAR(64) NOT NULL REFERENCES contest(id) ON DELETE CASCADE,
  problem_id VARCHAR(64) NOT NULL REFERENCES problem(id) ON DELETE CASCADE,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  pass_user_count INTEGER NOT NULL DEFAULT 0,
  pass_count INTEGER NOT NULL DEFAULT 0,
  wrong_count INTEGER NOT NULL DEFAULT 0,
  fail_count INTEGER NOT NULL DEFAULT 0,
  submission_count INTEGER NOT NULL DEFAULT 0,
  row_hash VARCHAR(64) NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY(contest_id, problem_id)
);

CREATE TABLE problem_stats_event (
  id BIGSERIAL PRIMARY KEY,
  poll_id BIGINT NOT NULL REFERENCES poll_run(id) ON DELETE CASCADE,
  observed_at TIMESTAMPTZ NOT NULL,
  contest_id VARCHAR(64) NOT NULL REFERENCES contest(id) ON DELETE CASCADE,
  problem_id VARCHAR(64) NOT NULL REFERENCES problem(id) ON DELETE CASCADE,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  pass_user_count INTEGER NOT NULL DEFAULT 0,
  pass_count INTEGER NOT NULL DEFAULT 0,
  wrong_count INTEGER NOT NULL DEFAULT 0,
  fail_count INTEGER NOT NULL DEFAULT 0,
  submission_count INTEGER NOT NULL DEFAULT 0,
  row_hash VARCHAR(64) NOT NULL
);
CREATE INDEX idx_stats_event_time ON problem_stats_event(contest_id, problem_id, observed_at DESC);

CREATE TABLE alert_event (
  id BIGSERIAL PRIMARY KEY,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  acknowledged_at TIMESTAMPTZ,
  rule_code VARCHAR(80) NOT NULL,
  severity VARCHAR(20) NOT NULL,
  contest_id VARCHAR(64),
  problem_id VARCHAR(64),
  team_key VARCHAR(180),
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  evidence JSONB NOT NULL DEFAULT '{}'::jsonb,
  fingerprint VARCHAR(128) NOT NULL,
  UNIQUE(fingerprint)
);
CREATE INDEX idx_alert_open ON alert_event(acknowledged_at, created_at DESC);

INSERT INTO app_setting(key, value) VALUES
  ('default_poll_interval_seconds', '120'),
  ('rank_change_threshold', '5'),
  ('score_absolute_threshold', '5'),
  ('score_relative_threshold_percent', '10'),
  ('top_n', '10')
ON CONFLICT DO NOTHING;
