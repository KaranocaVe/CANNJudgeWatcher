package cn.cannjudge.watcher.service;

import cn.cannjudge.watcher.repository.WatcherRepository;
import cn.cannjudge.watcher.source.CannJudgeClient;
import cn.cannjudge.watcher.source.RowNormalizer;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.time.Clock;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.sql.Timestamp;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.concurrent.atomic.AtomicBoolean;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class PollService {
  private final CannJudgeClient source;
  private final WatcherRepository repo;
  private final RowNormalizer normalizer;
  private final ObjectMapper mapper;
  private final Clock clock;
  private final int defaultInterval;
  private final int pageSize;
  private final AtomicBoolean running = new AtomicBoolean();

  public PollService(CannJudgeClient source, WatcherRepository repo, ObjectMapper mapper, Clock clock,
      @Value("${cannjudge.default-poll-interval-seconds:120}") int defaultInterval,
      @Value("${cannjudge.max-page-size:100}") int pageSize) {
    this.source = source; this.repo = repo; this.mapper = mapper; this.normalizer = new RowNormalizer(mapper);
    this.clock = clock; this.defaultInterval = defaultInterval; this.pageSize = pageSize;
  }

  @Scheduled(fixedDelayString = "${cannjudge.scheduler-tick-seconds:30}000", initialDelayString = "5000")
  public void scheduledPoll() { run(false); }

  public boolean runNow() { return run(true); }

  @Transactional
  public boolean run(boolean force) {
    if (!running.compareAndSet(false, true)) return false;
    Instant started = clock.instant(); long pollId = repo.createPollRun(started);
    int contestsSeen = 0, rows = 0, changed = 0; String error = null; String status = "SUCCESS";
    try {
      JsonNode group = source.publicGroup();
      String groupId = CannJudgeClient.text(group, "_id");
      if (groupId == null) throw new CannJudgeClient.SourceException("public group has no _id");
      List<JsonNode> contests = source.contests(groupId);
      Instant now = clock.instant();
      for (JsonNode contest : contests) {
        String contestId = CannJudgeClient.text(contest, "_id"); if (contestId == null) continue;
        Instant start = CannJudgeClient.instant(contest.get("start_time"));
        Instant end = CannJudgeClient.instant(contest.get("end_time"));
        String contestStatus = state(start, end, now);
        Map<String,Object> metadata = contestMetadata(contest, contestStatus, now);
        repo.upsertContest(metadata, "ACTIVE".equals(contestStatus), defaultInterval);
        contestsSeen++;
        if ("ENDED".equals(contestStatus)) continue;
        for (JsonNode p : contest.path("problems")) {
          String problemId = CannJudgeClient.text(p, "problem_id"); if (problemId == null) continue;
          JsonNode problem = safeProblem(problemId);
          repo.upsertProblem(problemId, contestId, problemSlug(problem), problemTitle(problem, problemId), difficulty(problem), tags(problem), hash(problem));
        }
        if (!"ACTIVE".equals(contestStatus) || !isEnabled(contestId) || (!force && !isDue(contestId, now))) continue;
        Map<String,Map<String,Object>> stats = fetchStats(contestId);
        for (JsonNode p : contest.path("problems")) {
          String problemId = CannJudgeClient.text(p, "problem_id"); if (problemId == null) continue;
          List<JsonNode> ranking = fetchAllRanking(problemId);
          List<Map<String,Object>> normalizedRanking = ranking.stream().map(raw -> normalizer.ranking(contestId, problemId, raw)).toList();
          Set<String> seen = new HashSet<>();
          for (Map<String,Object> row : normalizedRanking) {
            String key = String.valueOf(row.get("teamKey"));
            if (!seen.add(key)) { alert("DUPLICATE_TEAM", "WARNING", contestId, problemId, key, "榜单存在重复队伍", "同一题目在一次采集中出现重复队伍键", Map.of("teamKey", key)); continue; }
            Map<String,Object> previous = repo.currentByKey(contestId, problemId, key);
            if (previous == null || !String.valueOf(previous.get("row_hash")).equals(row.get("rowHash"))) {
              // Existing databases may have hashes made before source aggregate scores were excluded.
              // Refresh those current rows without manufacturing a one-off event for every team.
              if (previous != null && sameStoredContent(previous, row)) {
                repo.upsertCurrent(row, pollId, now);
                rows++;
                continue;
              }
              repo.insertRankingEvent(pollId, now, row, previous == null ? "UPSERT" : "UPDATE", repo.json(evidence(previous, row)));
              repo.upsertCurrent(row, pollId, now); changed++;
              evaluateChange(previous, row);
            }
            rows++;
          }
          for (Map<String,Object> old : repo.currentKeys(contestId, problemId)) {
            String key = String.valueOf(old.get("team_key"));
            if (!seen.contains(key)) {
              Map<String,Object> previous = repo.currentByKey(contestId, problemId, key);
              if (previous != null) { Map<String,Object> deleted = databaseRow(contestId, problemId, previous); repo.insertRankingEvent(pollId, now, deleted, "DELETE", repo.json(Map.of("reason", "missing_from_source"))); repo.deleteCurrent(contestId, problemId, key); changed++; }
            }
          }
          Map<String,Object> stat = stats.get(problemId);
          if (stat != null) {
            Map<String,Object> current = repo.currentStats(contestId, problemId);
            if (current == null || !String.valueOf(current.get("row_hash")).equals(stat.get("rowHash"))) repo.insertStatsEvent(pollId, now, stat);
          }
          repo.markContestPolled(contestId, now);
        }
      }
    } catch (Exception ex) {
      status = "FAILED"; error = rootMessage(ex);
      alert("SOURCE_FAILURE", "ERROR", null, null, null, "CANNJudge 采集失败", error, Map.of("pollId", pollId));
    } finally {
      repo.finishPollRun(pollId, status, clock.instant(), contestsSeen, rows, changed, null, error);
      if ("FAILED".equals(status) && repo.consecutiveFailures() >= 2) alert("CONSECUTIVE_FAILURE", "ERROR", null, null, null, "连续采集失败", "最近两个采集周期均未成功", Map.of("consecutiveFailures", repo.consecutiveFailures()));
      running.set(false);
    }
    return true;
  }

  private List<JsonNode> fetchAllRanking(String problemId) {
    List<JsonNode> all = new ArrayList<>(); int page = 1; int total = Integer.MAX_VALUE;
    while (all.size() < total) {
      JsonNode response = source.ranking(problemId, page, pageSize);
      if (!response.has("rows") || !response.get("rows").isArray()) throw new CannJudgeClient.SourceException("ranking response missing rows for " + problemId);
      total = response.path("total").asInt(response.get("rows").size()); response.get("rows").forEach(all::add);
      if (response.get("rows").isEmpty() || ++page > 1000) break;
    }
    return all;
  }

  private Map<String,Map<String,Object>> fetchStats(String contestId) {
    Map<String,Map<String,Object>> out = new LinkedHashMap<>(); JsonNode node = source.stats(contestId);
    if (node.isArray()) node.forEach(n -> { Map<String,Object> s = normalizer.stats(contestId, n); out.put(String.valueOf(s.get("problemId")), s); });
    return out;
  }

  private JsonNode safeProblem(String id) { try { return source.problem(id); } catch (Exception e) { return mapper.createObjectNode().put("name", id).put("title", id); } }
  private String problemSlug(JsonNode p) { return first(p, "name", "slug"); }
  private String problemTitle(JsonNode p, String id) { String title = first(p, "title", "name"); return title == null ? id : title; }
  private Integer difficulty(JsonNode p) { return p.hasNonNull("difficulty") ? p.get("difficulty").asInt() : null; }
  private String tags(JsonNode p) { try { return mapper.writeValueAsString(p.has("tags") ? p.get("tags") : mapper.createArrayNode()); } catch (Exception e) { return "[]"; } }
  private String hash(JsonNode p) { try { return Integer.toHexString(p.toString().hashCode()); } catch (Exception e) { return ""; } }
  private String first(JsonNode n, String... fields) { for (String f : fields) { String s = CannJudgeClient.text(n, f); if (s != null && !s.isBlank()) return s; } return null; }
  private String state(Instant start, Instant end, Instant now) { if (end != null && !end.isAfter(now)) return "ENDED"; if (start != null && start.isAfter(now)) return "UPCOMING"; return "ACTIVE"; }
  private boolean isEnabled(String id) { return Boolean.TRUE.equals(repo.findContestRow(id).get("monitoring_enabled")); }
  private boolean isDue(String id, Instant now) { Map<String,Object> row = repo.findContestRow(id); Object last = row.get("last_poll_at"); int interval = ((Number)row.get("poll_interval_seconds")).intValue(); return last == null || !((java.sql.Timestamp)last).toInstant().plusSeconds(interval).isAfter(now); }
  private Map<String,Object> contestMetadata(JsonNode c, String status, Instant now) { Map<String,Object> m = new LinkedHashMap<>(); m.put("id", CannJudgeClient.text(c,"_id")); m.put("slug", first(c,"name","slug")); m.put("title", first(c,"title","name")); m.put("description", CannJudgeClient.text(c,"desc")); m.put("startTime", CannJudgeClient.instant(c.get("start_time"))); m.put("endTime", CannJudgeClient.instant(c.get("end_time"))); m.put("sourceOngoing", c.path("ongoing").asBoolean(false)); m.put("sourceStatus", status); m.put("sourceHash", Integer.toHexString(c.toString().hashCode())); return m; }
  private Map<String,Object> evidence(Map<String,Object> previous, Map<String,Object> row) { Map<String,Object> e = new LinkedHashMap<>(); if (previous != null) { e.put("previousRank", previous.get("rank")); e.put("previousStatus", previous.get("status")); } e.put("rank", row.get("rank")); return e; }
  private Map<String,Object> databaseRow(String contestId, String problemId, Map<String,Object> p) { Map<String,Object> row = new LinkedHashMap<>(); row.put("contestId",contestId);row.put("problemId",problemId);row.put("teamKey",p.get("team_key"));row.put("teamId",p.get("team_id"));row.put("teamName",p.get("team_name"));row.put("userId",p.get("user_id"));row.put("userNickname",p.get("user_nickname"));row.put("submitterId",p.get("submitter_id"));row.put("submitterNickname",p.get("submitter_nickname"));row.put("submissionId",p.get("submission_id"));row.put("rank",p.get("rank"));row.put("status",p.get("status"));row.put("createTime",p.get("create_time"));row.put("resultJson",String.valueOf(p.getOrDefault("result","[]")));row.put("rowHash",p.get("row_hash"));return row; }
  private void evaluateChange(Map<String,Object> previous, Map<String,Object> row) { if (previous == null) return; Integer oldRank = number(previous.get("rank")); Integer newRank = number(row.get("rank")); if (oldRank != null && newRank != null && Math.abs(oldRank-newRank) >= threshold("rank_change_threshold",5)) alert("RANK_CHANGE","INFO",String.valueOf(row.get("contestId")),String.valueOf(row.get("problemId")),String.valueOf(row.get("teamKey")),"榜单名次发生显著变化",oldRank+" → "+newRank,Map.of("previousRank",oldRank,"rank",newRank)); }
  private int threshold(String key, int fallback) { try { return Integer.parseInt(repo.settings().getOrDefault(key,String.valueOf(fallback))); } catch (Exception e) { return fallback; } }
  private void alert(String rule, String severity, String contest, String problem, String team, String title, String message, Map<String,Object> evidence) { repo.createAlert(rule,severity,contest,problem,team,title,message,repo.json(evidence),rule+":"+String.valueOf(contest)+":"+String.valueOf(problem)+":"+String.valueOf(team)); }
  private Integer number(Object v) { return v instanceof Number n ? n.intValue() : v == null ? null : Integer.valueOf(v.toString()); }
  private boolean sameStoredContent(Map<String,Object> previous, Map<String,Object> row) {
    String[][] fields = {{"team_id","teamId"},{"team_name","teamName"},{"user_id","userId"},{"user_nickname","userNickname"},{"submitter_id","submitterId"},{"submitter_nickname","submitterNickname"},{"submission_id","submissionId"},{"rank","rank"},{"status","status"}};
    for (String[] field : fields) if (!Objects.equals(value(previous.get(field[0])), value(row.get(field[1])))) return false;
    if (!Objects.equals(instant(previous.get("create_time")), instant(row.get("createTime")))) return false;
    try { return mapper.readTree(String.valueOf(previous.get("result"))).equals(mapper.readTree(String.valueOf(row.get("resultJson")))); }
    catch (Exception ignored) { return false; }
  }
  private String value(Object value) { return value == null ? null : String.valueOf(value); }
  private Instant instant(Object value) { if (value instanceof Timestamp timestamp) return timestamp.toInstant(); if (value instanceof Instant instant) return instant; return null; }
  private String rootMessage(Exception e) { Throwable x=e; while(x.getCause()!=null) x=x.getCause(); return x.getMessage()==null?x.getClass().getSimpleName():x.getMessage(); }
}
