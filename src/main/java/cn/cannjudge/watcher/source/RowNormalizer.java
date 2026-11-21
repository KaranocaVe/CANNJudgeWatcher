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
import java.util.Set;
import java.util.TreeSet;

public class RowNormalizer {
  private final ObjectMapper mapper;
  public RowNormalizer(ObjectMapper mapper) { this.mapper = mapper; }

  public Map<String,Object> ranking(String contestId, String problemId, JsonNode raw) {
    return ranking(contestId, problemId, raw, null, Set.of(), Map.of());
  }

  public Map<String,Object> ranking(String contestId, String problemId, JsonNode raw, String problemCaseSetId) {
    return ranking(contestId, problemId, raw, problemCaseSetId, testcaseIds(raw.path("result")), Map.of());
  }

  public Map<String,Object> ranking(String contestId, String problemId, JsonNode raw, String problemCaseSetId,
      Set<String> officialTestcaseIds, Map<String,String> historicalCaseSets) {
    Map<String,Object> row = new LinkedHashMap<>();
    JsonNode team = raw.path("team");
    JsonNode user = raw.path("user");
    JsonNode submitter = raw.path("submitter");
    JsonNode submission = raw.path("submission");
    String teamId = firstText(team, "_id", "id", "team_id");
    String userId = firstText(user, "_id", "id");
    if (userId == null) userId = firstText(raw, "user_id", "userId");
    String teamKey;
    if (teamId != null) teamKey = "team:" + teamId;
    else if (userId != null) teamKey = "user:" + userId;
    else {
      String stableName = firstText(team, "team_name", "name");
      if (stableName == null || stableName.isBlank()) stableName = firstText(user, "nickname", "name");
      if (stableName == null || stableName.isBlank()) stableName = firstText(submitter, "nickname", "name");
      if (stableName == null || stableName.isBlank()) stableName = firstText(raw, "user_nickname", "nickname");
      if (stableName == null || stableName.isBlank()) throw new IllegalArgumentException("ranking row has no stable team or user identity");
      teamKey = "name:" + stableName.trim();
    }
    row.put("contestId", contestId); row.put("problemId", problemId); row.put("teamKey", teamKey);
    row.put("teamId", teamId); row.put("teamName", firstText(team, "team_name", "name"));
    row.put("userId", userId); row.put("userNickname", firstText(user, "nickname", "name", "user_nickname"));
    String submitterId = firstText(submitter, "_id", "id");
    if (submitterId == null) submitterId = firstText(submission, "user_id");
    if (submitterId == null) submitterId = userId;
    String submitterNickname = firstText(submitter, "nickname", "name");
    if (submitterNickname == null) submitterNickname = firstText(submission, "user_nickname");
    if (submitterNickname == null) submitterNickname = firstText(user, "nickname");
    row.put("submitterId", submitterId); row.put("submitterNickname", submitterNickname);
    row.put("submissionId", text(raw, "submission_id"));
    row.put("rank", integer(raw, "rank")); row.put("status", text(raw, "status"));
    // The CANNJudge aggregate score is relative to a moving global baseline.  Do not retain it
    // or include it in the change hash: another team's run can change it for every leaderboard row.
    JsonNode createTime = raw.has("create_time") ? raw.get("create_time") : submission.get("create_time");
    row.put("createTime", CannJudgeClient.instant(createTime));
    List<Map<String,Object>> results = new ArrayList<>();
    JsonNode rawResults = raw.path("result");
    Set<String> currentIds = officialTestcaseIds == null ? Set.of() : officialTestcaseIds;
    Map<String,String> knownHistoricalSets = historicalCaseSets == null ? Map.of() : historicalCaseSets;
    TreeSet<String> unclassifiedIds = new TreeSet<>();
    for (String id : testcaseIds(rawResults)) {
      if (problemCaseSetId == null || problemCaseSetId.isBlank()
          || (!currentIds.contains(id) && !knownHistoricalSets.containsKey(id))) unclassifiedIds.add(id);
    }
    String fallbackCaseSetId = caseSetId(unclassifiedIds);
    if (rawResults.isArray()) rawResults.forEach(r -> {
      String id = testcaseId(r);
      String caseSetId = id != null && currentIds.contains(id) && problemCaseSetId != null
          ? problemCaseSetId : id == null ? problemCaseSetId
          : knownHistoricalSets.getOrDefault(id, fallbackCaseSetId);
      Map<String,Object> item = new LinkedHashMap<>();
      item.put("testcaseId", id); item.put("caseSetId", caseSetId); item.put("time", r.hasNonNull("time") ? r.get("time").decimalValue() : null);
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
  public String caseSetId(JsonNode testcases) {
    if (testcases == null || !testcases.isArray()) return null;
    return caseSetId(testcaseIds(testcases));
  }
  public Set<String> testcaseIds(JsonNode testcases) {
    TreeSet<String> ids = new TreeSet<>();
    if (testcases != null && testcases.isArray()) testcases.forEach(item -> { String id = testcaseId(item); if (id != null && !id.isBlank()) ids.add(id); });
    return ids;
  }
  private String caseSetId(Set<String> ids) {
    if (ids == null || ids.isEmpty()) return null;
    try { return hex(MessageDigest.getInstance("MD5").digest(String.join("\n", new TreeSet<>(ids)).getBytes(StandardCharsets.UTF_8))); }
    catch (Exception e) { throw new IllegalStateException(e); }
  }
  public String testcaseId(JsonNode result) {
    JsonNode id = result == null ? null : result.get("testcase_id");
    if (id == null || id.isNull()) id = result == null ? null : result.get("testcaseId");
    if ((id == null || id.isNull()) && result != null) id = result.get("_id");
    if (id != null && id.isObject()) id = id.get("_id");
    return id == null || id.isNull() ? null : id.asText();
  }
  private String hex(byte[] bytes) { StringBuilder b = new StringBuilder(); for (byte x : bytes) b.append(String.format("%02x", x)); return b.toString(); }
  private String text(JsonNode node, String field) { return CannJudgeClient.text(node, field); }
  private String firstText(JsonNode node, String... fields) {
    for (String field : fields) {
      String value = text(node, field);
      if (value != null && !value.isBlank()) return value;
    }
    return null;
  }
  private Integer integer(JsonNode node, String field) { return node.hasNonNull(field) ? node.get(field).asInt() : null; }
}
