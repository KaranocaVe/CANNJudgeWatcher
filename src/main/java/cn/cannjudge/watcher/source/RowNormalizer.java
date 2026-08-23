package cn.cannjudge.watcher.source;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.math.BigDecimal;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.time.Instant;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

public class RowNormalizer {
  private final ObjectMapper mapper;
  public RowNormalizer(ObjectMapper mapper) { this.mapper = mapper; }

  public Map<String,Object> ranking(String contestId, String problemId, JsonNode raw) {
    Map<String,Object> row = new LinkedHashMap<>();
    JsonNode team = raw.path("team");
    JsonNode user = raw.path("user");
    JsonNode submitter = raw.path("submitter");
    JsonNode submission = raw.path("submission");
    String teamId = text(team, "_id");
    String userId = text(user, "_id");
    String teamKey = teamId != null ? "team:" + teamId : "user:" + (userId == null ? raw.path("rank").asText() : userId);
    row.put("contestId", contestId); row.put("problemId", problemId); row.put("teamKey", teamKey);
    row.put("teamId", teamId); row.put("teamName", text(team, "team_name"));
    row.put("userId", userId); row.put("userNickname", text(user, "nickname"));
    row.put("submitterId", text(submitter, "_id")); row.put("submitterNickname", text(submitter, "nickname"));
    row.put("submissionId", text(raw, "submission_id"));
    row.put("rank", integer(raw, "rank")); row.put("status", text(raw, "status"));
    // The CANNJudge aggregate score is relative to a moving global baseline.  Do not retain it
    // or include it in the change hash: another team's run can change it for every leaderboard row.
    row.put("createTime", CannJudgeClient.instant(raw.get("create_time")));
    List<Map<String,Object>> results = new ArrayList<>();
    if (raw.path("result").isArray()) raw.path("result").forEach(r -> {
      Map<String,Object> item = new LinkedHashMap<>();
      item.put("testcaseId", text(r, "testcase_id")); item.put("time", r.hasNonNull("time") ? r.get("time").decimalValue() : null);
      item.put("precisionRatio", r.hasNonNull("precision_ratio") ? r.get("precision_ratio").decimalValue() : null);
      // CANNJudge's msg may contain megabytes of compiler output.  It is not a testcase metric,
      // and including it would turn routine leaderboard observations into log archival.
      item.put("status", text(r, "testcase_status"));
      results.add(item);
    });
    // A ranking row is an event only when its per-testcase evidence changes.  Official aggregate
    // scores and rank may be recalculated globally while this team's submission stays identical.
    row.put("result", results); row.put("resultJson", canonical(results)); row.put("rowHash", hash(results));
    return row;
  }

  public Map<String,Object> stats(String contestId, JsonNode raw) {
    Map<String,Object> row = new LinkedHashMap<>();
    row.put("contestId", contestId); row.put("problemId", text(raw, "problem_id"));
    row.put("attemptCount", raw.path("attemptCount").asInt(0)); row.put("passUserCount", raw.path("passUserCount").asInt(0));
    row.put("passCount", raw.path("passCount").asInt(0)); row.put("wrongCount", raw.path("wrongCount").asInt(0));
    row.put("failCount", raw.path("failCount").asInt(0)); row.put("submissionCount", raw.path("submissionCount").asInt(0));
    row.put("rowHash", hash(row)); return row;
  }

  private String canonical(Object value) { try { return mapper.writeValueAsString(value); } catch (Exception e) { return "[]"; } }
  private String hash(Object value) { try { return hex(MessageDigest.getInstance("SHA-256").digest(canonical(value).getBytes(StandardCharsets.UTF_8))); } catch (Exception e) { throw new IllegalStateException(e); } }
  private String hex(byte[] bytes) { StringBuilder b = new StringBuilder(); for (byte x : bytes) b.append(String.format("%02x", x)); return b.toString(); }
  private String text(JsonNode node, String field) { return CannJudgeClient.text(node, field); }
  private Integer integer(JsonNode node, String field) { return node.hasNonNull(field) ? node.get(field).asInt() : null; }
}
