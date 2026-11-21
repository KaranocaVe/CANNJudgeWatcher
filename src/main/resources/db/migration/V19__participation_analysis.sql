CREATE TABLE participation_contest (
  contest_id VARCHAR(64) PRIMARY KEY,
  title TEXT NOT NULL,
  competition_key VARCHAR(240) NOT NULL,
  source_url TEXT NOT NULL,
  ended_at TIMESTAMPTZ NOT NULL,
  eligible BOOLEAN NOT NULL DEFAULT true,
  sampled_at TIMESTAMPTZ,
  entries JSONB NOT NULL DEFAULT '[]'::jsonb
);

CREATE TABLE participation_awards (
  contest_id VARCHAR(64) PRIMARY KEY REFERENCES participation_contest(contest_id) ON DELETE CASCADE,
  source_url TEXT NOT NULL,
  winner_ids JSONB NOT NULL
);

CREATE TABLE participation_agent_evidence (
  contest_id VARCHAR(64) NOT NULL REFERENCES participation_contest(contest_id) ON DELETE CASCADE,
  user_id VARCHAR(120) NOT NULL,
  source_url TEXT NOT NULL,
  PRIMARY KEY(contest_id, user_id)
);
