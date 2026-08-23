-- Latest-ranking views need per-team and global testcase bests.  Materializing them avoids
-- returning every lossless ranking event (and its result JSON) every time a user changes problem.

CREATE TABLE ranking_case_best (
  contest_id VARCHAR(64) NOT NULL,
  problem_id VARCHAR(64) NOT NULL,
  team_key VARCHAR(160) NOT NULL,
  testcase_id VARCHAR(160) NOT NULL,
  best_time NUMERIC(18,6) NOT NULL CHECK (best_time > 0),
  first_observed_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (contest_id, problem_id, team_key, testcase_id)
);

CREATE INDEX idx_ranking_case_best_problem ON ranking_case_best(contest_id, problem_id, testcase_id, best_time);

INSERT INTO ranking_case_best(contest_id,problem_id,team_key,testcase_id,best_time,first_observed_at)
SELECT event.contest_id,event.problem_id,event.team_key,testcase.value->>'testcaseId',
  MIN((testcase.value->>'time')::numeric),MIN(event.observed_at)
FROM ranking_event AS event
CROSS JOIN LATERAL jsonb_array_elements(event.result) AS testcase(value)
WHERE testcase.value->>'testcaseId' IS NOT NULL
  AND COALESCE(testcase.value->>'status',testcase.value->>'testcase_status')='Pass'
  AND jsonb_typeof(testcase.value->'time')='number'
  AND (testcase.value->>'time')::numeric>0
GROUP BY event.contest_id,event.problem_id,event.team_key,testcase.value->>'testcaseId';
