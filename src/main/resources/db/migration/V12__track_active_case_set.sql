ALTER TABLE problem ADD COLUMN active_case_set_id VARCHAR(64);

WITH observed_versions AS (
  SELECT current_row.contest_id,current_row.problem_id,item.value->>'caseSetId' AS case_set_id,
    COUNT(DISTINCT current_row.team_key) AS team_count,MAX(current_row.updated_at) AS last_observed_at
  FROM ranking_current AS current_row
  CROSS JOIN LATERAL jsonb_array_elements(current_row.result) AS item(value)
  WHERE NULLIF(item.value->>'caseSetId','') IS NOT NULL
  GROUP BY current_row.contest_id,current_row.problem_id,item.value->>'caseSetId'
), selected_versions AS (
  SELECT DISTINCT ON (contest_id,problem_id) contest_id,problem_id,case_set_id
  FROM observed_versions
  ORDER BY contest_id,problem_id,team_count DESC,last_observed_at DESC,case_set_id
)
UPDATE problem AS p
SET active_case_set_id=selected.case_set_id
FROM selected_versions AS selected
WHERE p.contest_id=selected.contest_id AND p.id=selected.problem_id;
