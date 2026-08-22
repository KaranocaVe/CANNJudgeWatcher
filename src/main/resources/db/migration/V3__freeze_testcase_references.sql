-- A historical-best baseline moves whenever somebody gets faster, making a global score drift
-- even when a team's own submission did not change.  Freeze one monitor-owned reference per
-- testcase from its first valid observation instead.

CREATE TABLE testcase_reference (
  contest_id VARCHAR(64) NOT NULL REFERENCES contest(id) ON DELETE CASCADE,
  problem_id VARCHAR(64) NOT NULL REFERENCES problem(id) ON DELETE CASCADE,
  testcase_id VARCHAR(180) NOT NULL,
  reference_time NUMERIC(18,6) NOT NULL CHECK (reference_time > 0),
  established_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY(contest_id, problem_id, testcase_id)
);

WITH valid_measurements AS (
  SELECT event.contest_id, event.problem_id,
    COALESCE(testcase.value ->> 'testcaseId', testcase.value ->> 'testcase_id') AS testcase_id,
    event.observed_at,
    (testcase.value ->> 'time')::numeric AS elapsed
  FROM ranking_event AS event
  CROSS JOIN LATERAL jsonb_array_elements(event.result) AS testcase(value)
  WHERE COALESCE(testcase.value ->> 'status', testcase.value ->> 'testcase_status') = 'Pass'
    AND jsonb_typeof(testcase.value -> 'time') = 'number'
    AND (testcase.value ->> 'time')::numeric > 0
), first_observations AS (
  SELECT contest_id, problem_id, testcase_id, MIN(observed_at) AS observed_at
  FROM valid_measurements
  WHERE testcase_id IS NOT NULL
  GROUP BY contest_id, problem_id, testcase_id
)
INSERT INTO testcase_reference(contest_id,problem_id,testcase_id,reference_time,established_at)
SELECT measurement.contest_id, measurement.problem_id, measurement.testcase_id,
  MIN(measurement.elapsed), first.observed_at
FROM valid_measurements AS measurement
JOIN first_observations AS first ON first.contest_id = measurement.contest_id
  AND first.problem_id = measurement.problem_id
  AND first.testcase_id = measurement.testcase_id
  AND first.observed_at = measurement.observed_at
GROUP BY measurement.contest_id, measurement.problem_id, measurement.testcase_id, first.observed_at;

-- A testcase first seen only in the current state has no history row yet; establish it once.
WITH valid_measurements AS (
  SELECT current.contest_id, current.problem_id,
    COALESCE(testcase.value ->> 'testcaseId', testcase.value ->> 'testcase_id') AS testcase_id,
    (testcase.value ->> 'time')::numeric AS elapsed
  FROM ranking_current AS current
  CROSS JOIN LATERAL jsonb_array_elements(current.result) AS testcase(value)
  WHERE COALESCE(testcase.value ->> 'status', testcase.value ->> 'testcase_status') = 'Pass'
    AND jsonb_typeof(testcase.value -> 'time') = 'number'
    AND (testcase.value ->> 'time')::numeric > 0
)
INSERT INTO testcase_reference(contest_id,problem_id,testcase_id,reference_time,established_at)
SELECT contest_id, problem_id, testcase_id, MIN(elapsed), now()
FROM valid_measurements
WHERE testcase_id IS NOT NULL
GROUP BY contest_id, problem_id, testcase_id
ON CONFLICT(contest_id,problem_id,testcase_id) DO NOTHING;

UPDATE ranking_event SET score = NULL;
UPDATE ranking_current SET score = NULL;

WITH recalculated AS (
  SELECT event.id,
    ROUND(SUM(CASE
      WHEN testcase.value IS NOT NULL
       AND COALESCE(testcase.value ->> 'status', testcase.value ->> 'testcase_status') = 'Pass'
       AND jsonb_typeof(testcase.value -> 'time') = 'number'
       AND (testcase.value ->> 'time')::numeric > 0
      THEN LEAST(100::numeric, 100::numeric * reference.reference_time / (testcase.value ->> 'time')::numeric)
      ELSE 0::numeric END) / COUNT(reference.testcase_id), 6) AS stable_score
  FROM ranking_event AS event
  JOIN testcase_reference AS reference ON reference.contest_id = event.contest_id AND reference.problem_id = event.problem_id
  LEFT JOIN LATERAL (
    SELECT candidate.value
    FROM jsonb_array_elements(event.result) AS candidate(value)
    WHERE COALESCE(candidate.value ->> 'testcaseId', candidate.value ->> 'testcase_id') = reference.testcase_id
    LIMIT 1
  ) AS testcase ON TRUE
  GROUP BY event.id
)
UPDATE ranking_event AS target SET score = recalculated.stable_score
FROM recalculated WHERE target.id = recalculated.id;

WITH recalculated AS (
  SELECT current.contest_id, current.problem_id, current.team_key,
    ROUND(SUM(CASE
      WHEN testcase.value IS NOT NULL
       AND COALESCE(testcase.value ->> 'status', testcase.value ->> 'testcase_status') = 'Pass'
       AND jsonb_typeof(testcase.value -> 'time') = 'number'
       AND (testcase.value ->> 'time')::numeric > 0
      THEN LEAST(100::numeric, 100::numeric * reference.reference_time / (testcase.value ->> 'time')::numeric)
      ELSE 0::numeric END) / COUNT(reference.testcase_id), 6) AS stable_score
  FROM ranking_current AS current
  JOIN testcase_reference AS reference ON reference.contest_id = current.contest_id AND reference.problem_id = current.problem_id
  LEFT JOIN LATERAL (
    SELECT candidate.value
    FROM jsonb_array_elements(current.result) AS candidate(value)
    WHERE COALESCE(candidate.value ->> 'testcaseId', candidate.value ->> 'testcase_id') = reference.testcase_id
    LIMIT 1
  ) AS testcase ON TRUE
  GROUP BY current.contest_id, current.problem_id, current.team_key
)
UPDATE ranking_current AS target SET score = recalculated.stable_score
FROM recalculated
WHERE target.contest_id = recalculated.contest_id
  AND target.problem_id = recalculated.problem_id
  AND target.team_key = recalculated.team_key;
