package cn.cannjudge.watcher.repository;

import cn.cannjudge.watcher.model.Models;
import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.math.BigDecimal;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Timestamp;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Optional;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;
import org.springframework.transaction.annotation.Transactional;

@Repository
public class WatcherRepository {
  private final JdbcTemplate jdbc;
  private final ObjectMapper mapper;
  private final TypeReference<List<Map<String,Object>>> resultType = new TypeReference<>() {};

  public WatcherRepository(JdbcTemplate jdbc, ObjectMapper mapper) { this.jdbc = jdbc; this.mapper = mapper; }

  public void upsertContest(Map<String,Object> c, String sourceStatus, int defaultInterval) {
    boolean active = "ACTIVE".equals(sourceStatus);
    jdbc.update("""
      INSERT INTO contest(id,slug,title,description,start_time,end_time,source_ongoing,source_status,status,
        monitoring_enabled,manual_override,poll_interval_seconds,source_hash,last_seen_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,false,?,?,now(),now())
      ON CONFLICT(id) DO UPDATE SET slug=excluded.slug,title=excluded.title,description=excluded.description,
        start_time=excluded.start_time,end_time=excluded.end_time,source_ongoing=excluded.source_ongoing,
        source_status=excluded.source_status,source_hash=excluded.source_hash,last_seen_at=now(),updated_at=now(),
        poll_interval_seconds=CASE WHEN contest.manual_override THEN contest.poll_interval_seconds ELSE excluded.poll_interval_seconds END,
        monitoring_enabled=CASE WHEN excluded.status='ENDED' THEN false WHEN contest.manual_override THEN contest.monitoring_enabled ELSE excluded.monitoring_enabled END,
        status=CASE WHEN excluded.status='ENDED' THEN 'ENDED' WHEN contest.manual_override THEN contest.status ELSE excluded.status END
      """, c.get("id"), c.get("slug"), c.get("title"), c.get("description"),
        sqlTime(c.get("startTime")), sqlTime(c.get("endTime")), c.get("sourceOngoing"), c.get("sourceStatus"),
        sourceStatus, active, defaultInterval, c.get("sourceHash"));
  }

  public void upsertProblem(String id, String contestId, String slug, String title, Integer difficulty,
      String tagsJson, String hash, String activeCaseSetId) {
    jdbc.update("""
      INSERT INTO problem(id,contest_id,slug,title,difficulty,tags,source_hash,active_case_set_id,updated_at)
      VALUES (?,?,?,?,?,?::jsonb,?,?,now())
      ON CONFLICT(id) DO UPDATE SET contest_id=excluded.contest_id,slug=excluded.slug,title=excluded.title,
        difficulty=excluded.difficulty,tags=excluded.tags,source_hash=excluded.source_hash,
        active_case_set_id=COALESCE(excluded.active_case_set_id,problem.active_case_set_id),updated_at=now()
      """, id, contestId, slug, title, difficulty, tagsJson, hash, activeCaseSetId);
  }

  public List<Models.Contest> findContests() {
    return jdbc.query("SELECT c.*, (SELECT count(*) FROM problem p WHERE p.contest_id=c.id) problem_count FROM contest c ORDER BY c.start_time DESC NULLS LAST,c.title",
        this::mapContest);
  }

  public Optional<Models.Contest> findContest(String id) {
    return jdbc.query("SELECT c.*, (SELECT count(*) FROM problem p WHERE p.contest_id=c.id) problem_count FROM contest c WHERE c.id=?",
        this::mapContest, id).stream().findFirst();
  }

  public List<Models.Problem> findProblems(String contestId) {
    return jdbc.query("SELECT * FROM problem WHERE contest_id=? ORDER BY title", this::mapProblem, contestId);
  }

  public long createPollRun(Instant startedAt) {
    return jdbc.queryForObject("INSERT INTO poll_run(started_at,status) VALUES (?,?) RETURNING id", Long.class, sqlTime(startedAt), "RUNNING");
  }

  public void finishPollRun(long id, String status, Instant finishedAt, int contests, int contestsPolled, int rows, int changed, String responseHash, String error) {
    jdbc.update("UPDATE poll_run SET status=?,finished_at=?,contests_seen=?,contests_polled=?,rows_seen=?,changed_rows=?,response_hash=?,error_message=? WHERE id=?",
        status, sqlTime(finishedAt), contests, contestsPolled, rows, changed, responseHash, error, id);
  }

  public void markContestPolled(String id, Instant at) { jdbc.update("UPDATE contest SET last_poll_at=?,updated_at=now() WHERE id=?", sqlTime(at), id); }

  public List<Map<String,Object>> findDueContests(Instant now) {
    return jdbc.queryForList("SELECT * FROM contest WHERE monitoring_enabled=true AND status='ACTIVE' AND (last_poll_at IS NULL OR last_poll_at + make_interval(secs => poll_interval_seconds) <= ?)", sqlTime(now));
  }

  public Map<String,Object> findContestRow(String id) { return jdbc.queryForMap("SELECT * FROM contest WHERE id=?", id); }

  public void setMonitoring(String id, boolean enabled) {
    jdbc.update("UPDATE contest SET monitoring_enabled=CASE WHEN ? AND (end_time IS NULL OR end_time > now()) THEN true ELSE false END,manual_override=true,status=CASE WHEN ? AND (end_time IS NULL OR end_time > now()) THEN 'ACTIVE' WHEN ? THEN 'ENDED' ELSE 'MANUALLY_DISABLED' END,updated_at=now() WHERE id=?", enabled, enabled, enabled, id);
  }

  public void setPollInterval(String id, int seconds) { jdbc.update("UPDATE contest SET poll_interval_seconds=?,updated_at=now() WHERE id=?", seconds, id); }

  public Map<String,String> settings() {
    Map<String,String> out = new LinkedHashMap<>();
    jdbc.query("SELECT key,value FROM app_setting ORDER BY key", (org.springframework.jdbc.core.RowCallbackHandler) rs -> out.put(rs.getString(1), rs.getString(2)));
    return out;
  }

  public void updateSettings(Map<String,String> values) {
    if (values == null) return;
    Map<String, int[]> ranges = Map.of(
        "default_poll_interval_seconds", new int[]{60, 1800},
        "alert_cooldown_minutes", new int[]{1, 1440},
        "rank_change_threshold", new int[]{1, 1000},
        "top_n", new int[]{1, 1000},
        "score_absolute_threshold", new int[]{0, 100000},
        "score_relative_threshold_percent", new int[]{0, 1000});
    values.forEach((key, value) -> {
      if (!ranges.containsKey(key) || value == null) throw new IllegalArgumentException("Unsupported or empty setting: " + key);
      int parsed;
      try { parsed = Integer.parseInt(value); } catch (NumberFormatException ex) { throw new IllegalArgumentException("Invalid setting: " + key, ex); }
      int[] range = ranges.get(key);
      if (parsed < range[0] || parsed > range[1]) throw new IllegalArgumentException("Setting out of range: " + key);
      jdbc.update("INSERT INTO app_setting(key,value,updated_at) VALUES (?,?,now()) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=now()", key, Integer.toString(parsed));
    });
  }

  public int settingInt(String key, int fallback, int minimum, int maximum) {
    try {
      String value = settings().get(key);
      if (value == null) return fallback;
      int parsed = Integer.parseInt(value);
      return parsed < minimum || parsed > maximum ? fallback : parsed;
    } catch (Exception ignored) { return fallback; }
  }

  public List<Map<String,Object>> currentRankings(String contestId, String problemId, String status, int limit) {
    StringBuilder sql = new StringBuilder("SELECT c.contest_id,c.problem_id,c.team_key,c.team_name,c.user_id,c.user_nickname,c.submitter_nickname,c.rank,c.status,c.create_time,")
        .append(compactResult("c.result")).append(" AS result,")
        .append(compactResult("previous_event.result"))
        .append(" AS previous_result,previous_event.rank AS previous_rank,COALESCE(record_count.total,0) AS record_count,c.updated_at FROM ranking_current c LEFT JOIN LATERAL (SELECT previous_event.result,previous_event.rank FROM ranking_event previous_event WHERE previous_event.contest_id=c.contest_id AND previous_event.problem_id=c.problem_id AND previous_event.team_key=c.team_key AND previous_event.event_type<>'DELETE' ORDER BY previous_event.poll_id DESC,previous_event.id DESC OFFSET 1 LIMIT 1) previous_event ON true LEFT JOIN LATERAL (SELECT count(*) AS total FROM ranking_event recorded WHERE recorded.contest_id=c.contest_id AND recorded.problem_id=c.problem_id AND recorded.team_key=c.team_key AND recorded.event_type<>'DELETE') record_count ON true WHERE c.contest_id=? AND c.problem_id=?");
    List<Object> args = new ArrayList<>(List.of(contestId, problemId));
    if (status != null && !status.isBlank()) { sql.append(" AND status=?"); args.add(status); }
    sql.append(" ORDER BY rank NULLS LAST, create_time ASC NULLS LAST, team_key LIMIT ?");
    args.add(Math.min(Math.max(limit, 1), 1000));
    return friendlyRows(jdbc.queryForList(sql.toString(), args.toArray()));
  }

  public Map<String,Object> caseBestSummary(String contestId, String problemId, List<Map<String,Object>> rankings) {
    return caseBestSummaryForTeams(contestId, problemId, rankings.stream().map(row -> row.get("team_key")).filter(Objects::nonNull).map(String::valueOf).toList());
  }

  public String activeCaseSetId(String contestId, String problemId) {
    List<String> values = jdbc.query("SELECT active_case_set_id FROM problem WHERE contest_id=? AND id=?",
        (rs, rowNum) -> rs.getString(1), contestId, problemId);
    return values.isEmpty() ? null : values.getFirst();
  }

  public Map<String,Object> caseBestSummaryForTeams(String contestId, String problemId, List<String> teamKeys) {
    Map<String,BigDecimal> global = new LinkedHashMap<>();
    jdbc.query("SELECT testcase_id,MIN(best_time) FROM ranking_case_best WHERE contest_id=? AND problem_id=? GROUP BY testcase_id ORDER BY testcase_id",
        (org.springframework.jdbc.core.RowCallbackHandler) rs -> global.put(rs.getString(1), rs.getBigDecimal(2)), contestId, problemId);
    Map<String,Map<String,BigDecimal>> teams = new LinkedHashMap<>();
    if (!teamKeys.isEmpty()) {
      String placeholders = String.join(",", Collections.nCopies(teamKeys.size(), "?"));
      List<Object> args = new ArrayList<>(); args.add(contestId); args.add(problemId); args.addAll(teamKeys);
      jdbc.query("SELECT team_key,testcase_id,best_time FROM ranking_case_best WHERE contest_id=? AND problem_id=? AND team_key IN (" + placeholders + ")",
          (org.springframework.jdbc.core.RowCallbackHandler) rs -> teams.computeIfAbsent(rs.getString(1), ignored -> new LinkedHashMap<>()).put(rs.getString(2), rs.getBigDecimal(3)), args.toArray());
    }
    return Map.of("global", global, "teams", teams);
  }

  public List<Map<String,Object>> users() {
    return friendlyRows(jdbc.queryForList("""
      SELECT COALESCE(user_id, 'nickname:' || COALESCE(user_nickname, '')) AS user_key,
        MAX(user_id) AS user_id, MAX(user_nickname) AS user_nickname,
        COUNT(DISTINCT contest_id) AS contest_count,
        COUNT(DISTINCT contest_id || ':' || problem_id) AS problem_count,
        COUNT(*) AS event_count, MAX(observed_at) AS latest_observed_at
      FROM ranking_event
      WHERE event_type <> 'DELETE' AND (user_id IS NOT NULL OR user_nickname IS NOT NULL)
      GROUP BY COALESCE(user_id, 'nickname:' || COALESCE(user_nickname, ''))
      ORDER BY MAX(observed_at) DESC, MAX(user_nickname), MAX(user_id)
      """));
  }

  public Map<String,Object> userPerformance(String userId, String userNickname) { return userPerformance(userId, userNickname, 1000); }

  public Map<String,Object> userPerformance(String userId, String userNickname, int requestedLimit) {
    boolean hasUserId = userId != null && !userId.isBlank();
    boolean hasNickname = userNickname != null && !userNickname.isBlank();
    if (!hasUserId && !hasNickname) return Map.of("userId", "", "userNickname", "", "items", List.of());

    String identity;
    List<Object> args = new ArrayList<>();
    if (hasUserId) {
      identity = hasNickname ? "(e.user_id=? OR (e.user_id IS NULL AND e.user_nickname=?))" : "e.user_id=?";
      args.add(userId);
      if (hasNickname) args.add(userNickname);
    } else {
      identity = "e.user_nickname=?";
      args.add(userNickname);
    }
    String sql = """
      WITH matched AS (
        SELECT e.id,e.contest_id,e.problem_id,e.team_key,e.team_name,e.user_id,e.user_nickname,
          e.rank,e.status,e.observed_at,c.title AS contest_title,c.status AS contest_status,
          p.title AS problem_title
        FROM ranking_event e
        JOIN contest c ON c.id=e.contest_id
        JOIN problem p ON p.id=e.problem_id
        WHERE e.event_type<>'DELETE' AND %s
      ), latest AS (
        SELECT DISTINCT ON (contest_id,problem_id,team_key) *
        FROM matched
        ORDER BY contest_id,problem_id,team_key,observed_at DESC,id DESC
      ), history AS (
        SELECT contest_id,problem_id,team_key,MIN(rank) FILTER (WHERE rank IS NOT NULL) AS best_rank,
          COUNT(*) AS event_count,MIN(observed_at) AS first_observed_at
        FROM matched
        GROUP BY contest_id,problem_id,team_key
      )
      SELECT latest.contest_id,latest.contest_title,latest.contest_status,latest.problem_id,
        latest.problem_title,latest.team_key,latest.team_name,latest.user_id,latest.user_nickname,
        latest.rank,history.best_rank,latest.status,latest.observed_at,history.first_observed_at,
        history.event_count
      FROM latest
      JOIN history ON history.contest_id=latest.contest_id AND history.problem_id=latest.problem_id
        AND history.team_key=latest.team_key
      ORDER BY latest.observed_at DESC,latest.contest_title,latest.problem_title,latest.team_key
      LIMIT ?
      """.formatted(identity);
    args.add(Math.min(Math.max(requestedLimit, 1), 1000));
    List<Map<String,Object>> items = friendlyRows(jdbc.queryForList(sql, args.toArray()));
    String resolvedId = items.stream().map(row -> row.get("user_id")).filter(Objects::nonNull).map(String::valueOf).findFirst().orElse(hasUserId ? userId : "");
    String resolvedNickname = items.stream().map(row -> row.get("user_nickname")).filter(Objects::nonNull).map(String::valueOf).findFirst().orElse(hasNickname ? userNickname : "");
    return Map.of("userId", resolvedId, "userNickname", resolvedNickname, "items", items);
  }

  public List<Map<String,Object>> rankingHistory(String contestId, String problemId, Instant from, Instant to, String teamKey) { return rankingHistory(contestId, problemId, from, to, teamKey, 5000); }

  public List<Map<String,Object>> rankingHistory(String contestId, String problemId, Instant from, Instant to, String teamKey, int requestedLimit) {
    StringBuilder sql = new StringBuilder("SELECT observed_at,team_key,team_name,user_nickname,rank,status,")
        .append(compactResult("result")).append(" AS result,event_type FROM ranking_event WHERE contest_id=? AND problem_id=? AND observed_at BETWEEN ? AND ?");
    List<Object> args = new ArrayList<>(List.of(contestId, problemId, sqlTime(from), sqlTime(to)));
    if (teamKey != null && !teamKey.isBlank()) { sql.append(" AND team_key=?"); args.add(teamKey); }
    sql.append(" ORDER BY observed_at,rank NULLS LAST LIMIT ?");
    args.add(Math.min(Math.max(requestedLimit, 1), 10000));
    return friendlyRows(jdbc.queryForList(sql.toString(), args.toArray()));
  }

  public Map<String,Object> currentByKey(String contestId, String problemId, String teamKey) {
    List<Map<String,Object>> rows = jdbc.queryForList("SELECT * FROM ranking_current WHERE contest_id=? AND problem_id=? AND team_key=?", contestId, problemId, teamKey);
    return rows.isEmpty() ? null : rows.getFirst();
  }

  public void insertRankingEvent(long pollId, Instant at, Map<String,Object> row, String eventType, String evidenceJson) {
    jdbc.update("""
      INSERT INTO ranking_event(poll_id,observed_at,contest_id,problem_id,team_key,event_type,team_id,team_name,user_id,user_nickname,
      submitter_id,submitter_nickname,submission_id,rank,status,create_time,result,row_hash,evidence)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?::jsonb,?,?::jsonb)
      """, pollId, sqlTime(at), row.get("contestId"), row.get("problemId"), row.get("teamKey"), eventType,
      row.get("teamId"), row.get("teamName"), row.get("userId"), row.get("userNickname"), row.get("submitterId"), row.get("submitterNickname"),
      row.get("submissionId"), row.get("rank"), row.get("status"), sqlTime(row.get("createTime")), row.get("resultJson"), row.get("rowHash"), evidenceJson);
  }

  public Map<String,String> historicalCaseSets(String contestId, String problemId, java.util.Set<String> testcaseIds, String currentCaseSetId) {
    Map<String,String> result = new LinkedHashMap<>();
    if (testcaseIds == null || testcaseIds.isEmpty() || currentCaseSetId == null) return result;
    String testcaseIdSql = "COALESCE(item.value->>'testcaseId',item.value->>'testcase_id',item.value->'testcaseId'->>'_id',item.value->'testcase_id'->>'_id')";
    String placeholders = String.join(",", Collections.nCopies(testcaseIds.size(), "?"));
    List<Object> args = new ArrayList<>();
    args.add(contestId); args.add(problemId); args.add(currentCaseSetId); args.addAll(testcaseIds);
    String sql = """
      SELECT observed.testcase_id,MIN(observed.case_set_id) AS case_set_id
      FROM ranking_event event
      CROSS JOIN LATERAL jsonb_array_elements(event.result) AS item(value)
      CROSS JOIN LATERAL (SELECT %s AS testcase_id,item.value->>'caseSetId' AS case_set_id) observed
      WHERE event.contest_id=? AND event.problem_id=? AND event.event_type<>'DELETE'
        AND observed.case_set_id IS NOT NULL AND observed.case_set_id<>?
        AND observed.testcase_id IN (%s)
      GROUP BY observed.testcase_id
      HAVING count(DISTINCT observed.case_set_id)=1
      """.formatted(testcaseIdSql, placeholders);
    jdbc.query(sql, (org.springframework.jdbc.core.RowCallbackHandler) rs ->
        result.put(rs.getString("testcase_id"), rs.getString("case_set_id")), args.toArray());
    return result;
  }

  public java.util.Set<String> caseIdsAssignedToVersion(String contestId, String problemId, String caseSetId) {
    java.util.Set<String> result = new java.util.LinkedHashSet<>();
    jdbc.query("SELECT DISTINCT substring(testcase_id FROM ?) AS testcase_id FROM ranking_case_best WHERE contest_id=? AND problem_id=? AND testcase_id LIKE ?",
        (org.springframework.jdbc.core.RowCallbackHandler) rs -> result.add(rs.getString("testcase_id")),
        caseSetId.length() + 2, contestId, problemId, caseSetId + ":%");
    return result;
  }

  @Transactional
  public int reconcileCaseSetAssignments(String contestId, String problemId, String currentCaseSetId, Map<String,String> historicalCaseSets) {
    if (historicalCaseSets == null || historicalCaseSets.isEmpty() || currentCaseSetId == null) return 0;
    String mappingJson = json(historicalCaseSets);
    String testcaseIdSql = "COALESCE(testcase.value->>'testcaseId',testcase.value->>'testcase_id',testcase.value->'testcaseId'->>'_id',testcase.value->'testcase_id'->>'_id')";
    String eventSql = """
      WITH case_mapping AS (SELECT key,value #>> '{}' AS case_set_id FROM jsonb_each(?::jsonb))
      UPDATE ranking_event AS event
      SET result=COALESCE((
        SELECT jsonb_agg(CASE WHEN mapping.case_set_id IS NOT NULL AND testcase.value->>'caseSetId'=?
          THEN testcase.value || jsonb_build_object('caseSetId',mapping.case_set_id) ELSE testcase.value END
          ORDER BY testcase.ordinality)
        FROM jsonb_array_elements(COALESCE(event.result,'[]'::jsonb)) WITH ORDINALITY AS testcase(value,ordinality)
        LEFT JOIN case_mapping mapping ON mapping.key=%s
      ),'[]'::jsonb)
      WHERE event.contest_id=? AND event.problem_id=?
        AND EXISTS (
          SELECT 1 FROM jsonb_array_elements(event.result) AS testcase(value)
          JOIN case_mapping mapping ON mapping.key=%s
          WHERE testcase.value->>'caseSetId'=?
        )
      """.formatted(testcaseIdSql, testcaseIdSql);
    int changedEvents = jdbc.update(eventSql, mappingJson, currentCaseSetId, contestId, problemId, currentCaseSetId);

    String currentSql = """
      WITH case_mapping AS (SELECT key,value #>> '{}' AS case_set_id FROM jsonb_each(?::jsonb))
      UPDATE ranking_current AS current_row
      SET result=COALESCE((
        SELECT jsonb_agg(CASE WHEN mapping.case_set_id IS NOT NULL AND testcase.value->>'caseSetId'=?
          THEN testcase.value || jsonb_build_object('caseSetId',mapping.case_set_id) ELSE testcase.value END
          ORDER BY testcase.ordinality)
        FROM jsonb_array_elements(COALESCE(current_row.result,'[]'::jsonb)) WITH ORDINALITY AS testcase(value,ordinality)
        LEFT JOIN case_mapping mapping ON mapping.key=%s
      ),'[]'::jsonb)
      WHERE current_row.contest_id=? AND current_row.problem_id=?
        AND EXISTS (
          SELECT 1 FROM jsonb_array_elements(current_row.result) AS testcase(value)
          JOIN case_mapping mapping ON mapping.key=%s
          WHERE testcase.value->>'caseSetId'=?
        )
      """.formatted(testcaseIdSql, testcaseIdSql);
    int changedCurrent = jdbc.update(currentSql, mappingJson, currentCaseSetId, contestId, problemId, currentCaseSetId);
    int changed = changedEvents + changedCurrent;
    if (changed > 0) rebuildCaseBests(contestId, problemId);
    return changed;
  }

  private void rebuildCaseBests(String contestId, String problemId) {
    jdbc.update("DELETE FROM ranking_case_best WHERE contest_id=? AND problem_id=?", contestId, problemId);
    jdbc.update("""
      INSERT INTO ranking_case_best(contest_id,problem_id,team_key,testcase_id,best_time,first_observed_at,updated_at)
      SELECT event.contest_id,event.problem_id,event.team_key,
        COALESCE(testcase.value->>'caseSetId','legacy') || ':' || COALESCE(testcase.value->>'testcaseId',testcase.value->>'testcase_id',
          testcase.value->'testcaseId'->>'_id',testcase.value->'testcase_id'->>'_id'),
        MIN((testcase.value->>'time')::numeric),MIN(event.observed_at),now()
      FROM ranking_event event
      CROSS JOIN LATERAL jsonb_array_elements(event.result) AS testcase(value)
      WHERE event.contest_id=? AND event.problem_id=?
        AND NULLIF(COALESCE(testcase.value->>'testcaseId',testcase.value->>'testcase_id',
          testcase.value->'testcaseId'->>'_id',testcase.value->'testcase_id'->>'_id'),'') IS NOT NULL
        AND COALESCE(testcase.value->>'status',testcase.value->>'testcase_status')='Pass'
        AND jsonb_typeof(testcase.value->'time')='number'
        AND (testcase.value->>'time')::numeric>0
      GROUP BY event.contest_id,event.problem_id,event.team_key,
        COALESCE(testcase.value->>'caseSetId','legacy') || ':' || COALESCE(testcase.value->>'testcaseId',testcase.value->>'testcase_id',
          testcase.value->'testcaseId'->>'_id',testcase.value->'testcase_id'->>'_id')
      """, contestId, problemId);
  }

  public void recordCaseBests(Map<String,Object> row, Instant observedAt) {
    jdbc.update("""
      INSERT INTO ranking_case_best(contest_id,problem_id,team_key,testcase_id,best_time,first_observed_at,updated_at)
      SELECT ?,?,?,COALESCE(item->>'caseSetId','legacy') || ':' || (item->>'testcaseId'),(item->>'time')::numeric,?,now()
      FROM jsonb_array_elements(?::jsonb) AS item
      WHERE item->>'testcaseId' IS NOT NULL
        AND COALESCE(item->>'status', item->>'testcase_status')='Pass'
        AND jsonb_typeof(item->'time')='number'
        AND (item->>'time')::numeric>0
      ON CONFLICT(contest_id,problem_id,team_key,testcase_id) DO UPDATE SET
        best_time=LEAST(ranking_case_best.best_time,EXCLUDED.best_time),updated_at=now()
      """, row.get("contestId"), row.get("problemId"), row.get("teamKey"), sqlTime(observedAt), row.get("resultJson"));
  }

  public Map<String,Object> contestOverview(String contestId, Instant from) {
    Map<String,Map<String,Object>> problems = new LinkedHashMap<>();
    jdbc.query("SELECT problem_id,COUNT(*) AS row_count,COUNT(*) FILTER (WHERE status='Pass') AS pass_count FROM ranking_current WHERE contest_id=? GROUP BY problem_id",
        (org.springframework.jdbc.core.RowCallbackHandler) rs -> problems.put(rs.getString(1), new LinkedHashMap<>(Map.of("rowCount", rs.getInt(2), "passCount", rs.getInt(3), "eventCount", 0))), contestId);
    jdbc.query("SELECT problem_id,COUNT(*) FROM ranking_event WHERE contest_id=? AND observed_at>=? GROUP BY problem_id",
        (org.springframework.jdbc.core.RowCallbackHandler) rs -> problems.computeIfAbsent(rs.getString(1), ignored -> new LinkedHashMap<>(Map.of("rowCount", 0, "passCount", 0, "eventCount", 0))).put("eventCount", rs.getInt(2)), contestId, sqlTime(from));
    return Map.of("problems", problems, "activity", performanceActivity(contestId, from));
  }

  private List<Map<String,Object>> performanceActivity(String contestId, Instant from) {
    String sql = """
      WITH ordered AS (
        SELECT id,observed_at,event_type,result,
          LAG(result) OVER (PARTITION BY contest_id,problem_id,team_key ORDER BY observed_at,id) AS previous_result
        FROM ranking_event WHERE contest_id=?
      )
      SELECT date_trunc('hour',observed_at) AS observed_at,event_type,%s AS result,%s AS previous_result
      FROM ordered WHERE observed_at>=? ORDER BY observed_at
      """.formatted(compactResult("result"), compactResult("previous_result"));
    Map<Timestamp,Map<String,Object>> buckets = new LinkedHashMap<>();
    for (Map<String,Object> event : friendlyRows(jdbc.queryForList(sql, contestId, sqlTime(from)))) {
      Timestamp observedAt = (Timestamp) event.get("observed_at");
      Map<String,Object> bucket = buckets.computeIfAbsent(observedAt, ignored -> activityBucket(observedAt));
      increment(bucket, "changes");
      if ("DELETE".equals(event.get("event_type"))) { increment(bucket, "deletes"); continue; }
      int direction = performanceDirection(event.get("result"), event.get("previous_result"));
      if (direction > 0) increment(bucket, "improvements");
      if (direction < 0) increment(bucket, "regressions");
    }
    return new ArrayList<>(buckets.values());
  }

  private Map<String,Object> activityBucket(Timestamp observedAt) {
    Map<String,Object> bucket = new LinkedHashMap<>();
    bucket.put("observed_at", observedAt); bucket.put("changes", 0); bucket.put("deletes", 0);
    bucket.put("improvements", 0); bucket.put("regressions", 0);
    return bucket;
  }

  private void increment(Map<String,Object> bucket, String key) { bucket.put(key, ((Number) bucket.get(key)).intValue() + 1); }

  private int performanceDirection(Object currentValue, Object previousValue) {
    if (previousValue == null) return 0;
    Map<String,com.fasterxml.jackson.databind.JsonNode> previous = testcaseMap(previousValue);
    int improvements = 0, regressions = 0;
    for (var entry : testcaseMap(currentValue).entrySet()) {
      var old = previous.get(entry.getKey()); if (old == null) continue;
      BigDecimal current = observedTime(entry.getValue()), prior = observedTime(old);
      if (current != null && prior != null) { int compare = current.compareTo(prior); if (compare < 0) improvements++; if (compare > 0) regressions++; }
      if (isPassed(entry.getValue()) && !isPassed(old)) improvements++;
      if (!isPassed(entry.getValue()) && isPassed(old)) regressions++;
    }
    return Integer.compare(improvements, regressions);
  }

  private Map<String,com.fasterxml.jackson.databind.JsonNode> testcaseMap(Object raw) {
    Map<String,com.fasterxml.jackson.databind.JsonNode> testcases = new LinkedHashMap<>();
    try {
      com.fasterxml.jackson.databind.JsonNode result = raw instanceof com.fasterxml.jackson.databind.JsonNode node ? node : mapper.readTree(String.valueOf(raw));
      if (!result.isArray()) return testcases;
      for (var testcase : result) {
        String id = testcase.path("testcaseId").asText(testcase.path("testcase_id").asText(""));
        String caseSetId = testcase.path("caseSetId").asText("");
        if (!id.isBlank()) testcases.put((caseSetId.isBlank() ? "" : caseSetId + ":") + id, testcase);
      }
    } catch (Exception ignored) { }
    return testcases;
  }

  private BigDecimal observedTime(com.fasterxml.jackson.databind.JsonNode testcase) {
    if (!testcase.path("time").isNumber()) return null;
    BigDecimal time = testcase.path("time").decimalValue(); return time.signum() > 0 ? time : null;
  }

  private boolean isPassed(com.fasterxml.jackson.databind.JsonNode testcase) {
    return "Pass".equals(testcase.path("status").asText(testcase.path("testcase_status").asText("")));
  }

  public void upsertCurrent(Map<String,Object> row, long pollId, Instant at) {
    jdbc.update("""
      INSERT INTO ranking_current(contest_id,problem_id,team_key,team_id,team_name,user_id,user_nickname,submitter_id,submitter_nickname,
      submission_id,rank,status,create_time,result,row_hash,last_poll_id,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?::jsonb,?,?,?)
      ON CONFLICT(contest_id,problem_id,team_key) DO UPDATE SET team_id=excluded.team_id,team_name=excluded.team_name,user_id=excluded.user_id,
      user_nickname=excluded.user_nickname,submitter_id=excluded.submitter_id,submitter_nickname=excluded.submitter_nickname,submission_id=excluded.submission_id,
      rank=excluded.rank,status=excluded.status,create_time=excluded.create_time,result=excluded.result,row_hash=excluded.row_hash,last_poll_id=excluded.last_poll_id,updated_at=excluded.updated_at
      """, row.get("contestId"), row.get("problemId"), row.get("teamKey"), row.get("teamId"), row.get("teamName"), row.get("userId"), row.get("userNickname"),
      row.get("submitterId"), row.get("submitterNickname"), row.get("submissionId"), row.get("rank"), row.get("status"), sqlTime(row.get("createTime")), row.get("resultJson"), row.get("rowHash"), pollId, sqlTime(at));
  }

  public void deleteCurrent(String contestId, String problemId, String teamKey) { jdbc.update("DELETE FROM ranking_current WHERE contest_id=? AND problem_id=? AND team_key=?", contestId, problemId, teamKey); }

  public List<Map<String,Object>> currentKeys(String contestId, String problemId) { return jdbc.queryForList("SELECT team_key,row_hash FROM ranking_current WHERE contest_id=? AND problem_id=?", contestId, problemId); }

  public void insertStatsEvent(long pollId, Instant at, Map<String,Object> s) {
    jdbc.update("INSERT INTO problem_stats_event(poll_id,observed_at,contest_id,problem_id,attempt_count,pass_user_count,pass_count,wrong_count,fail_count,submission_count,row_hash) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
        pollId, sqlTime(at), s.get("contestId"), s.get("problemId"), s.get("attemptCount"), s.get("passUserCount"), s.get("passCount"), s.get("wrongCount"), s.get("failCount"), s.get("submissionCount"), s.get("rowHash"));
    jdbc.update("""
      INSERT INTO problem_stats_current(contest_id,problem_id,attempt_count,pass_user_count,pass_count,wrong_count,fail_count,submission_count,row_hash,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?) ON CONFLICT(contest_id,problem_id) DO UPDATE SET attempt_count=excluded.attempt_count,pass_user_count=excluded.pass_user_count,pass_count=excluded.pass_count,wrong_count=excluded.wrong_count,fail_count=excluded.fail_count,submission_count=excluded.submission_count,row_hash=excluded.row_hash,updated_at=excluded.updated_at
      """, s.get("contestId"), s.get("problemId"), s.get("attemptCount"), s.get("passUserCount"), s.get("passCount"), s.get("wrongCount"), s.get("failCount"), s.get("submissionCount"), s.get("rowHash"), sqlTime(at));
  }

  public Map<String,Object> currentStats(String contestId, String problemId) {
    List<Map<String,Object>> rows = jdbc.queryForList("SELECT * FROM problem_stats_current WHERE contest_id=? AND problem_id=?", contestId, problemId);
    return rows.isEmpty() ? null : rows.getFirst();
  }

  public List<Map<String,Object>> statsHistory(String contestId, String problemId, Instant from, Instant to) {
    return jdbc.queryForList("SELECT observed_at,attempt_count,pass_user_count,pass_count,wrong_count,fail_count,submission_count FROM problem_stats_event WHERE contest_id=? AND problem_id=? AND observed_at BETWEEN ? AND ? ORDER BY observed_at", contestId, problemId, sqlTime(from), sqlTime(to));
  }

  public long createAlert(String rule, String severity, String contestId, String problemId, String teamKey, String title, String message, String evidence, String fingerprint) {
    int cooldownMinutes = settingInt("alert_cooldown_minutes", 30, 1, 1440);
    return jdbc.queryForObject("""
      INSERT INTO alert_event(rule_code,severity,contest_id,problem_id,team_key,title,message,evidence,fingerprint,last_seen_at,occurrence_count)
      VALUES (?,?,?,?,?,?,?,?::jsonb,?,now(),1)
      ON CONFLICT(fingerprint) DO UPDATE SET message=excluded.message,evidence=excluded.evidence,
        last_seen_at=now(),occurrence_count=alert_event.occurrence_count+1,
        acknowledged_at=CASE WHEN alert_event.acknowledged_at IS NOT NULL
          AND alert_event.last_seen_at < now() - (? * interval '1 minute') THEN NULL ELSE alert_event.acknowledged_at END
      RETURNING id
      """, Long.class, rule, severity, contestId, problemId, teamKey, title, message, evidence, fingerprint, cooldownMinutes);
  }

  public List<Models.Alert> alerts(boolean openOnly, String contestId, String problemId, int limit) {
    StringBuilder sql = new StringBuilder("SELECT * FROM alert_event");
    List<Object> args = new ArrayList<>();
    List<String> predicates = new ArrayList<>();
    if (openOnly) predicates.add("acknowledged_at IS NULL");
    if (contestId != null && !contestId.isBlank()) { predicates.add("contest_id=?"); args.add(contestId); }
    if (problemId != null && !problemId.isBlank()) { predicates.add("problem_id=?"); args.add(problemId); }
    if (!predicates.isEmpty()) sql.append(" WHERE ").append(String.join(" AND ", predicates));
    sql.append(" ORDER BY created_at DESC LIMIT ?");
    args.add(Math.min(Math.max(limit,1),500));
    return jdbc.query(sql.toString(), (rs,n) -> mapAlert(rs), args.toArray());
  }

  public void acknowledgeAlert(long id) { jdbc.update("UPDATE alert_event SET acknowledged_at=now() WHERE id=?", id); }
  public boolean alertExists(long id) { return jdbc.queryForObject("SELECT count(*) FROM alert_event WHERE id=?", Integer.class, id) > 0; }

  public Map<String,Object> pollSummary() {
    var row = jdbc.queryForMap("SELECT count(*) FILTER (WHERE status='SUCCESS') successful,count(*) FILTER (WHERE status='FAILED') failed,max(finished_at) last_finished FROM poll_run");
    row.put("activeContests", jdbc.queryForObject("SELECT count(*) FROM contest WHERE status='ACTIVE' AND monitoring_enabled", Integer.class));
    row.put("openAlerts", jdbc.queryForObject("SELECT count(*) FROM alert_event WHERE acknowledged_at IS NULL", Integer.class));
    row.put("latestPoll", jdbc.queryForList("SELECT id,started_at,finished_at,status,contests_polled,rows_seen,changed_rows,error_message FROM poll_run ORDER BY id DESC LIMIT 1"));
    return row;
  }

  public List<Map<String,Object>> recentPolls(int limit) { return jdbc.queryForList("SELECT id,started_at,finished_at,status,contests_seen,contests_polled,rows_seen,changed_rows,response_hash,error_message FROM poll_run ORDER BY id DESC LIMIT ?", Math.min(Math.max(limit,1),200)); }

  public int consecutiveFailures() { Integer n = jdbc.queryForObject("SELECT count(*) FROM (SELECT status FROM poll_run ORDER BY id DESC LIMIT 2) x WHERE status='FAILED'", Integer.class); return n == null ? 0 : n; }

  public boolean latestPollHealthy() {
    List<String> statuses = jdbc.query("SELECT status FROM poll_run ORDER BY id DESC LIMIT 1", (rs, n) -> rs.getString(1));
    return !statuses.isEmpty() && "SUCCESS".equals(statuses.getFirst());
  }

  public boolean tryAcquirePollLock() {
    List<Integer> updated = jdbc.query("UPDATE poll_lease SET locked_until=now() + interval '10 minutes' WHERE id=1 AND locked_until <= now() RETURNING 1", (rs, n) -> rs.getInt(1));
    return !updated.isEmpty();
  }

  public void releasePollLock() { jdbc.update("UPDATE poll_lease SET locked_until=to_timestamp(0) WHERE id=1"); }

  private Models.Contest mapContest(ResultSet rs, int n) throws SQLException {
    return new Models.Contest(rs.getString("id"), rs.getString("slug"), rs.getString("title"), rs.getString("description"),
      instant(rs.getTimestamp("start_time")), instant(rs.getTimestamp("end_time")), rs.getBoolean("source_ongoing"), rs.getString("source_status"), rs.getString("status"),
      rs.getBoolean("monitoring_enabled"), rs.getBoolean("manual_override"), rs.getInt("poll_interval_seconds"), instant(rs.getTimestamp("last_seen_at")), instant(rs.getTimestamp("last_poll_at")), rs.getInt("problem_count"));
  }
  private Models.Problem mapProblem(ResultSet rs, int n) throws SQLException {
    return new Models.Problem(rs.getString("id"), rs.getString("contest_id"), rs.getString("slug"), rs.getString("title"),
        (Integer)rs.getObject("difficulty"), parseList(rs.getString("tags")), rs.getString("active_case_set_id"));
  }
  private Models.Alert mapAlert(ResultSet rs) throws SQLException {
    return new Models.Alert(rs.getLong("id"), instant(rs.getTimestamp("created_at")), instant(rs.getTimestamp("acknowledged_at")), rs.getString("rule_code"), rs.getString("severity"), rs.getString("contest_id"), rs.getString("problem_id"), rs.getString("team_key"), rs.getString("title"), rs.getString("message"), parseMap(rs.getString("evidence")));
  }
  private Instant instant(Timestamp t) { return t == null ? null : t.toInstant(); }
  private Object sqlTime(Object value) { return value instanceof Instant i ? Timestamp.from(i) : value; }
  /**
   * CANNJudge sometimes embeds megabytes of compiler output in result[].message.  Raw results
   * remain in the current/event tables for forensic use, but UI endpoints only need these stable
   * per-testcase metrics.  Keeping the projection in SQL avoids moving opaque logs over JDBC.
   */
  private String compactResult(String resultColumn) {
    return """
      COALESCE((
        SELECT jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
          'time', testcase.value->'time',
          'status', COALESCE(testcase.value->'status', testcase.value->'testcase_status'),
          'testcaseId', COALESCE(testcase.value->'testcaseId', testcase.value->'testcase_id'),
          'caseSetId', testcase.value->'caseSetId',
          'precisionRatio', COALESCE(testcase.value->'precisionRatio', testcase.value->'precision_ratio')
        )))
        FROM jsonb_array_elements(COALESCE(%s, '[]'::jsonb)) AS testcase(value)
      ), '[]'::jsonb)
      """.formatted(resultColumn);
  }
  private List<String> parseList(String json) { try { return json == null ? List.of() : mapper.readValue(json, new TypeReference<>() {}); } catch (Exception e) { return List.of(); } }
  private Map<String,Object> parseMap(String json) { try { return json == null ? Map.of() : mapper.readValue(json, new TypeReference<>() {}); } catch (Exception e) { return Map.of(); } }
  public String json(Object value) { try { return mapper.writeValueAsString(value); } catch (JsonProcessingException e) { return "{}"; } }

  private List<Map<String,Object>> friendlyRows(List<Map<String,Object>> rows) {
    rows.forEach(row -> row.replaceAll((key, value) -> {
      if (value != null && "org.postgresql.util.PGobject".equals(value.getClass().getName())) {
        try {
          String jsonValue = String.valueOf(value.getClass().getMethod("getValue").invoke(value));
          return mapper.readTree(jsonValue);
        } catch (Exception ignored) { return value.toString(); }
      }
      return value;
    }));
    return rows;
  }

}
