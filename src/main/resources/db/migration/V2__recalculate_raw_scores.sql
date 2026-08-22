-- The source aggregate score is based on a moving global leaderboard baseline and is not a
-- durable per-submission measurement.  Rebuild all stored scores from testcase timings instead.
-- T is the best positive Pass timing ever observed for the contest/problem/testcase combination.

UPDATE ranking_event SET score = NULL;
UPDATE ranking_current SET score = NULL;

WITH source_rows AS (
  SELECT contest_id, problem_id, result FROM ranking_event
  UNION ALL
  SELECT contest_id, problem_id, result FROM ranking_current
), measurements AS (
  SELECT source_rows.contest_id, source_rows.problem_id,
    COALESCE(testcase.value ->> 'testcaseId', testcase.value ->> 'testcase_id') AS testcase_id,
    CASE WHEN COALESCE(testcase.value ->> 'status', testcase.value ->> 'testcase_status') = 'Pass'
           AND jsonb_typeof(testcase.value -> 'time') = 'number'
           AND (testcase.value ->> 'time')::numeric > 0
      THEN (testcase.value ->> 'time')::numeric END AS elapsed
  FROM source_rows
  CROSS JOIN LATERAL jsonb_array_elements(source_rows.result) AS testcase(value)
), baselines AS (
  SELECT contest_id, problem_id, testcase_id, MIN(elapsed) AS best_elapsed
  FROM measurements
  WHERE testcase_id IS NOT NULL AND elapsed IS NOT NULL
  GROUP BY contest_id, problem_id, testcase_id
), recalculated AS (
  SELECT row.id,
    ROUND(SUM(CASE
      WHEN testcase.value IS NOT NULL
       AND COALESCE(testcase.value ->> 'status', testcase.value ->> 'testcase_status') = 'Pass'
       AND jsonb_typeof(testcase.value -> 'time') = 'number'
       AND (testcase.value ->> 'time')::numeric > 0
      THEN 100::numeric / (1::numeric + log(1.5::numeric, (testcase.value ->> 'time')::numeric / baseline.best_elapsed))
      ELSE 0::numeric END) / COUNT(baseline.testcase_id), 6) AS raw_score
  FROM ranking_event AS row
  JOIN baselines AS baseline ON baseline.contest_id = row.contest_id AND baseline.problem_id = row.problem_id
  LEFT JOIN LATERAL (
    SELECT candidate.value
    FROM jsonb_array_elements(row.result) AS candidate(value)
    WHERE COALESCE(candidate.value ->> 'testcaseId', candidate.value ->> 'testcase_id') = baseline.testcase_id
    LIMIT 1
  ) AS testcase ON TRUE
  GROUP BY row.id
)
UPDATE ranking_event AS target SET score = recalculated.raw_score
FROM recalculated WHERE target.id = recalculated.id;

WITH source_rows AS (
  SELECT contest_id, problem_id, result FROM ranking_event
  UNION ALL
  SELECT contest_id, problem_id, result FROM ranking_current
), measurements AS (
  SELECT source_rows.contest_id, source_rows.problem_id,
    COALESCE(testcase.value ->> 'testcaseId', testcase.value ->> 'testcase_id') AS testcase_id,
    CASE WHEN COALESCE(testcase.value ->> 'status', testcase.value ->> 'testcase_status') = 'Pass'
           AND jsonb_typeof(testcase.value -> 'time') = 'number'
           AND (testcase.value ->> 'time')::numeric > 0
      THEN (testcase.value ->> 'time')::numeric END AS elapsed
  FROM source_rows
  CROSS JOIN LATERAL jsonb_array_elements(source_rows.result) AS testcase(value)
), baselines AS (
  SELECT contest_id, problem_id, testcase_id, MIN(elapsed) AS best_elapsed
  FROM measurements
  WHERE testcase_id IS NOT NULL AND elapsed IS NOT NULL
  GROUP BY contest_id, problem_id, testcase_id
), recalculated AS (
  SELECT row.contest_id, row.problem_id, row.team_key,
    ROUND(SUM(CASE
      WHEN testcase.value IS NOT NULL
       AND COALESCE(testcase.value ->> 'status', testcase.value ->> 'testcase_status') = 'Pass'
       AND jsonb_typeof(testcase.value -> 'time') = 'number'
       AND (testcase.value ->> 'time')::numeric > 0
      THEN 100::numeric / (1::numeric + log(1.5::numeric, (testcase.value ->> 'time')::numeric / baseline.best_elapsed))
      ELSE 0::numeric END) / COUNT(baseline.testcase_id), 6) AS raw_score
  FROM ranking_current AS row
  JOIN baselines AS baseline ON baseline.contest_id = row.contest_id AND baseline.problem_id = row.problem_id
  LEFT JOIN LATERAL (
    SELECT candidate.value
    FROM jsonb_array_elements(row.result) AS candidate(value)
    WHERE COALESCE(candidate.value ->> 'testcaseId', candidate.value ->> 'testcase_id') = baseline.testcase_id
    LIMIT 1
  ) AS testcase ON TRUE
  GROUP BY row.contest_id, row.problem_id, row.team_key
)
UPDATE ranking_current AS target SET score = recalculated.raw_score
FROM recalculated
WHERE target.contest_id = recalculated.contest_id
  AND target.problem_id = recalculated.problem_id
  AND target.team_key = recalculated.team_key;
