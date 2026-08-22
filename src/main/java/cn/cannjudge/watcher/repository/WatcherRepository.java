package cn.cannjudge.watcher.repository;

import cn.cannjudge.watcher.model.Models;
import cn.cannjudge.watcher.service.RawScoreCalculator;
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
import java.util.Optional;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

@Repository
public class WatcherRepository {
  private final JdbcTemplate jdbc;
  private final ObjectMapper mapper;
  private final RawScoreCalculator rawScores;
  private final TypeReference<List<Map<String,Object>>> resultType = new TypeReference<>() {};

  public WatcherRepository(JdbcTemplate jdbc, ObjectMapper mapper, RawScoreCalculator rawScores) { this.jdbc = jdbc; this.mapper = mapper; this.rawScores = rawScores; }

  public void upsertContest(Map<String,Object> c, boolean activeByTime, int defaultInterval) {
    jdbc.update("""
      INSERT INTO contest(id,slug,title,description,start_time,end_time,source_ongoing,source_status,status,
        monitoring_enabled,manual_override,poll_interval_seconds,source_hash,last_seen_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,false,?,?,now(),now())
      ON CONFLICT(id) DO UPDATE SET slug=excluded.slug,title=excluded.title,description=excluded.description,
        start_time=excluded.start_time,end_time=excluded.end_time,source_ongoing=excluded.source_ongoing,
        source_status=excluded.source_status,source_hash=excluded.source_hash,last_seen_at=now(),updated_at=now(),
        monitoring_enabled=CASE WHEN excluded.status='ENDED' THEN false WHEN contest.manual_override THEN contest.monitoring_enabled ELSE excluded.monitoring_enabled END,
        status=CASE WHEN excluded.status='ENDED' THEN 'ENDED' WHEN contest.manual_override THEN contest.status ELSE excluded.status END
      """, c.get("id"), c.get("slug"), c.get("title"), c.get("description"),
        sqlTime(c.get("startTime")), sqlTime(c.get("endTime")), c.get("sourceOngoing"), c.get("sourceStatus"),
        activeByTime ? "ACTIVE" : "ENDED", activeByTime, defaultInterval, c.get("sourceHash"));
  }

  public void upsertProblem(String id, String contestId, String slug, String title, Integer difficulty, String tagsJson, String hash) {
    jdbc.update("""
      INSERT INTO problem(id,contest_id,slug,title,difficulty,tags,source_hash,updated_at)
      VALUES (?,?,?,?,?,?::jsonb,?,now())
      ON CONFLICT(id) DO UPDATE SET contest_id=excluded.contest_id,slug=excluded.slug,title=excluded.title,
        difficulty=excluded.difficulty,tags=excluded.tags,source_hash=excluded.source_hash,updated_at=now()
      """, id, contestId, slug, title, difficulty, tagsJson, hash);
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

  public void finishPollRun(long id, String status, Instant finishedAt, int contests, int rows, int changed, String responseHash, String error) {
    jdbc.update("UPDATE poll_run SET status=?,finished_at=?,contests_seen=?,rows_seen=?,changed_rows=?,response_hash=?,error_message=? WHERE id=?",
        status, sqlTime(finishedAt), contests, rows, changed, responseHash, error, id);
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
    values.forEach((k,v) -> jdbc.update("INSERT INTO app_setting(key,value,updated_at) VALUES (?,?,now()) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=now()", k, v));
  }

  public List<Map<String,Object>> currentRankings(String contestId, String problemId, String status, int limit) {
    List<Map<String,Object>> rows = jdbc.queryForList("SELECT * FROM ranking_current WHERE contest_id=? AND problem_id=? ORDER BY rank NULLS LAST, create_time ASC NULLS LAST, team_key", contestId, problemId);
    rawScores.attachScores(rows);
    if (status != null && !status.isBlank()) rows = rows.stream().filter(row -> status.equals(row.get("status"))).toList();
    return friendlyRows(new ArrayList<>(rows.subList(0, Math.min(rows.size(), Math.min(Math.max(limit, 1), 500)))));
  }

  public List<Map<String,Object>> rankingHistory(String contestId, String problemId, Instant from, Instant to) {
    String sql = "SELECT observed_at,team_key,team_name,user_nickname,rank,status,score,result,event_type,evidence FROM ranking_event WHERE contest_id=? AND problem_id=? AND observed_at BETWEEN ? AND ? ORDER BY observed_at,rank NULLS LAST";
    return withRawScores(jdbc.queryForList(sql, contestId, problemId, sqlTime(from), sqlTime(to)));
  }

  public List<Map<String,Object>> latestRankingHistory(String contestId, String problemId, Instant at) {
    return withRawScores(jdbc.queryForList("""
      SELECT DISTINCT ON (team_key) team_key,team_name,user_nickname,rank,status,score,create_time,result,event_type,observed_at
      FROM ranking_event WHERE contest_id=? AND problem_id=? AND observed_at<=? ORDER BY team_key,observed_at DESC,id DESC
      """, contestId, problemId, sqlTime(at)));
  }

  public Map<String,Object> currentByKey(String contestId, String problemId, String teamKey) {
    List<Map<String,Object>> rows = jdbc.queryForList("SELECT * FROM ranking_current WHERE contest_id=? AND problem_id=? AND team_key=?", contestId, problemId, teamKey);
    return rows.isEmpty() ? null : rows.getFirst();
  }

  public void insertRankingEvent(long pollId, Instant at, Map<String,Object> row, String eventType, String evidenceJson) {
    jdbc.update("""
      INSERT INTO ranking_event(poll_id,observed_at,contest_id,problem_id,team_key,event_type,team_id,team_name,user_id,user_nickname,
      submitter_id,submitter_nickname,submission_id,rank,status,score,create_time,result,row_hash,evidence)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?::jsonb,?,?::jsonb)
      """, pollId, sqlTime(at), row.get("contestId"), row.get("problemId"), row.get("teamKey"), eventType,
      row.get("teamId"), row.get("teamName"), row.get("userId"), row.get("userNickname"), row.get("submitterId"), row.get("submitterNickname"),
      row.get("submissionId"), row.get("rank"), row.get("status"), row.get("score"), sqlTime(row.get("createTime")), row.get("resultJson"), row.get("rowHash"), evidenceJson);
  }

  public void upsertCurrent(Map<String,Object> row, long pollId, Instant at) {
    jdbc.update("""
      INSERT INTO ranking_current(contest_id,problem_id,team_key,team_id,team_name,user_id,user_nickname,submitter_id,submitter_nickname,
      submission_id,rank,status,score,create_time,result,row_hash,last_poll_id,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?::jsonb,?,?,?)
      ON CONFLICT(contest_id,problem_id,team_key) DO UPDATE SET team_id=excluded.team_id,team_name=excluded.team_name,user_id=excluded.user_id,
      user_nickname=excluded.user_nickname,submitter_id=excluded.submitter_id,submitter_nickname=excluded.submitter_nickname,submission_id=excluded.submission_id,
      rank=excluded.rank,status=excluded.status,score=excluded.score,create_time=excluded.create_time,result=excluded.result,row_hash=excluded.row_hash,last_poll_id=excluded.last_poll_id,updated_at=excluded.updated_at
      """, row.get("contestId"), row.get("problemId"), row.get("teamKey"), row.get("teamId"), row.get("teamName"), row.get("userId"), row.get("userNickname"),
      row.get("submitterId"), row.get("submitterNickname"), row.get("submissionId"), row.get("rank"), row.get("status"), row.get("score"), sqlTime(row.get("createTime")), row.get("resultJson"), row.get("rowHash"), pollId, sqlTime(at));
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
    try {
      return jdbc.queryForObject("INSERT INTO alert_event(rule_code,severity,contest_id,problem_id,team_key,title,message,evidence,fingerprint) VALUES (?,?,?,?,?,?,?,?::jsonb,?) ON CONFLICT(fingerprint) DO UPDATE SET message=excluded.message RETURNING id", Long.class,
          rule, severity, contestId, problemId, teamKey, title, message, evidence, fingerprint);
    } catch (Exception ignored) { return -1; }
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

  public Map<String,Object> pollSummary() {
    var row = jdbc.queryForMap("SELECT count(*) FILTER (WHERE status='SUCCESS') successful,count(*) FILTER (WHERE status='FAILED') failed,max(finished_at) last_finished FROM poll_run");
    row.put("activeContests", jdbc.queryForObject("SELECT count(*) FROM contest WHERE status='ACTIVE' AND monitoring_enabled", Integer.class));
    row.put("openAlerts", jdbc.queryForObject("SELECT count(*) FROM alert_event WHERE acknowledged_at IS NULL", Integer.class));
    row.put("latestPoll", jdbc.queryForList("SELECT id,started_at,finished_at,status,rows_seen,changed_rows,error_message FROM poll_run ORDER BY id DESC LIMIT 1"));
    return row;
  }

  public List<Map<String,Object>> recentPolls(int limit) { return jdbc.queryForList("SELECT id,started_at,finished_at,status,contests_seen,rows_seen,changed_rows,response_hash,error_message FROM poll_run ORDER BY id DESC LIMIT ?", Math.min(Math.max(limit,1),200)); }

  public int consecutiveFailures() { Integer n = jdbc.queryForObject("SELECT count(*) FROM (SELECT status FROM poll_run ORDER BY id DESC LIMIT 2) x WHERE status='FAILED'", Integer.class); return n == null ? 0 : n; }

  private Models.Contest mapContest(ResultSet rs, int n) throws SQLException {
    return new Models.Contest(rs.getString("id"), rs.getString("slug"), rs.getString("title"), rs.getString("description"),
      instant(rs.getTimestamp("start_time")), instant(rs.getTimestamp("end_time")), rs.getBoolean("source_ongoing"), rs.getString("source_status"), rs.getString("status"),
      rs.getBoolean("monitoring_enabled"), rs.getBoolean("manual_override"), rs.getInt("poll_interval_seconds"), instant(rs.getTimestamp("last_seen_at")), instant(rs.getTimestamp("last_poll_at")), rs.getInt("problem_count"));
  }
  private Models.Problem mapProblem(ResultSet rs, int n) throws SQLException {
    return new Models.Problem(rs.getString("id"), rs.getString("contest_id"), rs.getString("slug"), rs.getString("title"), (Integer)rs.getObject("difficulty"), parseList(rs.getString("tags")));
  }
  private Models.Alert mapAlert(ResultSet rs) throws SQLException {
    return new Models.Alert(rs.getLong("id"), instant(rs.getTimestamp("created_at")), instant(rs.getTimestamp("acknowledged_at")), rs.getString("rule_code"), rs.getString("severity"), rs.getString("contest_id"), rs.getString("problem_id"), rs.getString("team_key"), rs.getString("title"), rs.getString("message"), parseMap(rs.getString("evidence")));
  }
  private Instant instant(Timestamp t) { return t == null ? null : t.toInstant(); }
  private Object sqlTime(Object value) { return value instanceof Instant i ? Timestamp.from(i) : value; }
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

  private List<Map<String,Object>> withRawScores(List<Map<String,Object>> rows) {
    rawScores.attachScores(rows);
    return friendlyRows(rows);
  }
}
