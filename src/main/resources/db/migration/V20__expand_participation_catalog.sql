ALTER TABLE participation_contest
  ALTER COLUMN ended_at DROP NOT NULL,
  ALTER COLUMN source_url DROP NOT NULL,
  ADD COLUMN origin VARCHAR(12) NOT NULL DEFAULT 'PUBLIC',
  ADD COLUMN status VARCHAR(12) NOT NULL DEFAULT 'ENDED',
  ADD COLUMN organization VARCHAR(12) NOT NULL DEFAULT 'INDIVIDUAL',
  ADD COLUMN rank_access VARCHAR(12) NOT NULL DEFAULT 'PUBLIC',
  ADD COLUMN starts_at TIMESTAMPTZ,
  ADD COLUMN summary_sampled_at TIMESTAMPTZ,
  ADD COLUMN total_participants BIGINT,
  ADD COLUMN total_submissions BIGINT,
  ADD COLUMN observed_entries JSONB NOT NULL DEFAULT '[]'::jsonb;

-- Keep the old snapshots and their verified evidence during the upgrade.
