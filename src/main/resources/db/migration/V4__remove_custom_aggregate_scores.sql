-- The public result payload does not expose the complete official scoring baseline or all
-- tie-break rules.  A locally derived aggregate would therefore look authoritative while
-- sometimes changing the official order.  Keep the official rank and the per-testcase evidence
-- only; remove every legacy/custom aggregate score and its frozen-reference state.

DROP TABLE IF EXISTS testcase_reference;

ALTER TABLE ranking_event DROP COLUMN IF EXISTS score;
ALTER TABLE ranking_current DROP COLUMN IF EXISTS score;
