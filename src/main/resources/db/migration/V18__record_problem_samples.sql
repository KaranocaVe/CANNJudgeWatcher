CREATE TABLE problem_poll_sample (
  problem_id VARCHAR(64) NOT NULL REFERENCES problem(id) ON DELETE CASCADE,
  sampled_at TIMESTAMPTZ NOT NULL,
  poll_interval_seconds INTEGER NOT NULL,
  PRIMARY KEY (problem_id, sampled_at)
);

CREATE INDEX idx_poll_run_running ON poll_run(id) WHERE status = 'RUNNING';
