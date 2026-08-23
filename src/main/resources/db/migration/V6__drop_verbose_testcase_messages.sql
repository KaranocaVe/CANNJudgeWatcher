-- Keep the normalized testcase evidence (ID, status, elapsed time and precision) while removing
-- opaque compiler/runtime logs.  Some CANNJudge result[].message values are hundreds of KB and
-- are neither shown nor used for ranking/history analysis.

UPDATE ranking_current AS current_row
SET result = COALESCE((
  SELECT jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
    'time', testcase.value->'time',
    'status', COALESCE(testcase.value->'status', testcase.value->'testcase_status'),
    'testcaseId', COALESCE(testcase.value->'testcaseId', testcase.value->'testcase_id'),
    'precisionRatio', COALESCE(testcase.value->'precisionRatio', testcase.value->'precision_ratio')
  )) ORDER BY testcase.position)
  FROM jsonb_array_elements(COALESCE(current_row.result, '[]'::jsonb)) WITH ORDINALITY AS testcase(value, position)
), '[]'::jsonb)
WHERE EXISTS (
  SELECT 1 FROM jsonb_array_elements(COALESCE(current_row.result, '[]'::jsonb)) AS testcase(value)
  WHERE testcase.value ? 'message'
);

UPDATE ranking_event AS event_row
SET result = COALESCE((
  SELECT jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
    'time', testcase.value->'time',
    'status', COALESCE(testcase.value->'status', testcase.value->'testcase_status'),
    'testcaseId', COALESCE(testcase.value->'testcaseId', testcase.value->'testcase_id'),
    'precisionRatio', COALESCE(testcase.value->'precisionRatio', testcase.value->'precision_ratio')
  )) ORDER BY testcase.position)
  FROM jsonb_array_elements(COALESCE(event_row.result, '[]'::jsonb)) WITH ORDINALITY AS testcase(value, position)
), '[]'::jsonb)
WHERE EXISTS (
  SELECT 1 FROM jsonb_array_elements(COALESCE(event_row.result, '[]'::jsonb)) AS testcase(value)
  WHERE testcase.value ? 'message'
);
