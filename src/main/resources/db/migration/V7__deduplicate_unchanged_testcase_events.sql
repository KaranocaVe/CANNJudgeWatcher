-- A source aggregate-score/rank recalculation can change a leaderboard row even when its own
-- testcase evidence is byte-for-byte identical.  History is performance evidence, so retain
-- only UPDATE events whose normalized testcase result differs from the preceding observation.

WITH ordered AS (
  SELECT id,contest_id,problem_id,team_key,observed_at,event_type,rank,result,
    LAG(result) OVER observation AS previous_result,
    LAG(rank) OVER observation AS previous_rank
  FROM ranking_event
  WINDOW observation AS (PARTITION BY contest_id,problem_id,team_key ORDER BY observed_at,id)
), redundant AS (
  SELECT * FROM ordered WHERE event_type='UPDATE' AND result=previous_result
)
DELETE FROM alert_event AS alert
USING redundant
WHERE alert.rule_code='RANK_CHANGE'
  AND alert.contest_id=redundant.contest_id
  AND alert.problem_id=redundant.problem_id
  AND alert.team_key=redundant.team_key
  AND NULLIF(alert.evidence->>'previousRank', '')::integer IS NOT DISTINCT FROM redundant.previous_rank
  AND NULLIF(alert.evidence->>'rank', '')::integer IS NOT DISTINCT FROM redundant.rank
  AND alert.created_at BETWEEN redundant.observed_at - INTERVAL '5 minutes' AND redundant.observed_at + INTERVAL '5 minutes';

-- Source/custom aggregate scores are intentionally no longer a monitored metric.
DELETE FROM alert_event WHERE rule_code='SCORE_CHANGE';

WITH ordered AS (
  SELECT id,event_type,result,
    LAG(result) OVER (PARTITION BY contest_id,problem_id,team_key ORDER BY observed_at,id) AS previous_result
  FROM ranking_event
), redundant AS (
  SELECT id FROM ordered WHERE event_type='UPDATE' AND result=previous_result
)
DELETE FROM ranking_event AS event USING redundant WHERE event.id=redundant.id;

-- changed_rows contains ranking-event writes; align historical run metadata with the cleaned
-- event stream so the collection view does not report discarded pseudo-changes.
UPDATE poll_run AS poll
SET changed_rows=(SELECT count(*) FROM ranking_event AS event WHERE event.poll_id=poll.id);
