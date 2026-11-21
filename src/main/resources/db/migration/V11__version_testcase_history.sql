WITH revisions AS (
  SELECT event.id,
    md5(COALESCE((
      SELECT string_agg(case_id, E'\n' ORDER BY case_id)
      FROM (
        SELECT DISTINCT COALESCE(item.value->>'testcaseId', item.value->>'testcase_id',
          item.value->'testcaseId'->>'_id', item.value->'testcase_id'->>'_id') AS case_id
        FROM jsonb_array_elements(COALESCE(event.result, '[]'::jsonb)) AS item(value)
        WHERE NULLIF(COALESCE(item.value->>'testcaseId', item.value->>'testcase_id',
          item.value->'testcaseId'->>'_id', item.value->'testcase_id'->>'_id'), '') IS NOT NULL
      ) AS testcase_ids
    ), '')) AS case_set_id
  FROM ranking_event AS event
)
UPDATE ranking_event AS event
SET result = COALESCE((
  SELECT jsonb_agg(item.value || jsonb_build_object('caseSetId', revisions.case_set_id) ORDER BY item.ordinality)
  FROM jsonb_array_elements(COALESCE(event.result, '[]'::jsonb)) WITH ORDINALITY AS item(value, ordinality)
), '[]'::jsonb)
FROM revisions
WHERE event.id = revisions.id;

WITH revisions AS (
  SELECT current_row.contest_id, current_row.problem_id, current_row.team_key,
    md5(COALESCE((
      SELECT string_agg(case_id, E'\n' ORDER BY case_id)
      FROM (
        SELECT DISTINCT COALESCE(item.value->>'testcaseId', item.value->>'testcase_id',
          item.value->'testcaseId'->>'_id', item.value->'testcase_id'->>'_id') AS case_id
        FROM jsonb_array_elements(COALESCE(current_row.result, '[]'::jsonb)) AS item(value)
        WHERE NULLIF(COALESCE(item.value->>'testcaseId', item.value->>'testcase_id',
          item.value->'testcaseId'->>'_id', item.value->'testcase_id'->>'_id'), '') IS NOT NULL
      ) AS testcase_ids
    ), '')) AS case_set_id
  FROM ranking_current AS current_row
)
UPDATE ranking_current AS current_row
SET result = COALESCE((
  SELECT jsonb_agg(item.value || jsonb_build_object('caseSetId', revisions.case_set_id) ORDER BY item.ordinality)
  FROM jsonb_array_elements(COALESCE(current_row.result, '[]'::jsonb)) WITH ORDINALITY AS item(value, ordinality)
), '[]'::jsonb)
FROM revisions
WHERE current_row.contest_id = revisions.contest_id
  AND current_row.problem_id = revisions.problem_id
  AND current_row.team_key = revisions.team_key;

DELETE FROM ranking_case_best;

INSERT INTO ranking_case_best(contest_id,problem_id,team_key,testcase_id,best_time,first_observed_at,updated_at)
SELECT event.contest_id,event.problem_id,event.team_key,
  COALESCE(testcase.value->>'caseSetId','legacy') || ':' || COALESCE(testcase.value->>'testcaseId',testcase.value->>'testcase_id',
    testcase.value->'testcaseId'->>'_id',testcase.value->'testcase_id'->>'_id'),
  MIN((testcase.value->>'time')::numeric),MIN(event.observed_at),now()
FROM ranking_event AS event
CROSS JOIN LATERAL jsonb_array_elements(event.result) AS testcase(value)
WHERE NULLIF(COALESCE(testcase.value->>'testcaseId',testcase.value->>'testcase_id',
    testcase.value->'testcaseId'->>'_id',testcase.value->'testcase_id'->>'_id'),'') IS NOT NULL
  AND COALESCE(testcase.value->>'status',testcase.value->>'testcase_status')='Pass'
  AND jsonb_typeof(testcase.value->'time')='number'
  AND (testcase.value->>'time')::numeric>0
GROUP BY event.contest_id,event.problem_id,event.team_key,
  COALESCE(testcase.value->>'caseSetId','legacy') || ':' || COALESCE(testcase.value->>'testcaseId',testcase.value->>'testcase_id',
    testcase.value->'testcaseId'->>'_id',testcase.value->'testcase_id'->>'_id');
