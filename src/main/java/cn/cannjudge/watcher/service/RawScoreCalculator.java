package cn.cannjudge.watcher.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.math.BigDecimal;
import java.math.RoundingMode;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import org.springframework.stereotype.Component;

/**
 * Derives the monitor's own score from testcase measurements.  The source leaderboard's
 * aggregate score is deliberately not used: its global baseline can change without a team
 * changing its own submission.
 */
@Component
public class RawScoreCalculator {
  private static final double LOG_BASE = Math.log(1.5d);
  private final ObjectMapper mapper;

  public RawScoreCalculator(ObjectMapper mapper) { this.mapper = mapper; }

  /** Adds the derived {@code score} field to each row without mutating stored row content. */
  public void attachScores(List<Map<String,Object>> rows) {
    List<RowCases> casesByRow = new ArrayList<>();
    Map<String, BigDecimal> bestTimes = new LinkedHashMap<>();
    Set<String> testcaseIds = new LinkedHashSet<>();
    for (Map<String,Object> row : rows) {
      Map<String,CaseResult> cases = cases(row.get("result"));
      casesByRow.add(new RowCases(row, cases));
      for (CaseResult testcase : cases.values()) {
        testcaseIds.add(testcase.id());
        if (testcase.valid()) bestTimes.merge(testcase.id(), testcase.time(), BigDecimal::min);
      }
    }
    for (RowCases rowCases : casesByRow) {
      rowCases.row().put("score", score(rowCases.cases(), testcaseIds, bestTimes));
    }
  }

  private BigDecimal score(Map<String,CaseResult> cases, Set<String> testcaseIds, Map<String,BigDecimal> bestTimes) {
    if (testcaseIds.isEmpty()) return null;
    double total = 0d;
    for (String testcaseId : testcaseIds) {
      CaseResult testcase = cases.get(testcaseId);
      BigDecimal best = bestTimes.get(testcaseId);
      if (testcase == null || !testcase.valid() || best == null || best.signum() <= 0) continue;
      double ratio = testcase.time().doubleValue() / best.doubleValue();
      if (ratio <= 0d) continue;
      total += 100d / (1d + Math.log(ratio) / LOG_BASE);
    }
    return BigDecimal.valueOf(total / testcaseIds.size()).setScale(4, RoundingMode.HALF_UP);
  }

  private Map<String,CaseResult> cases(Object value) {
    JsonNode root = node(value);
    Map<String,CaseResult> cases = new LinkedHashMap<>();
    if (!root.isArray()) return cases;
    int index = 0;
    for (JsonNode item : root) {
      String id = text(item, "testcaseId", "testcase_id");
      if (id == null || id.isBlank()) id = "case-" + (++index);
      BigDecimal time = item.hasNonNull("time") && item.get("time").isNumber() ? item.get("time").decimalValue() : null;
      String status = text(item, "status", "testcase_status");
      cases.put(id, new CaseResult(id, time, status));
    }
    return cases;
  }

  private JsonNode node(Object value) {
    if (value instanceof JsonNode node) return node;
    if (value == null) return mapper.createArrayNode();
    try { return mapper.readTree(String.valueOf(value)); }
    catch (Exception ignored) { return mapper.createArrayNode(); }
  }

  private String text(JsonNode node, String... fields) {
    for (String field : fields) if (node.hasNonNull(field)) return node.get(field).asText();
    return null;
  }

  private record CaseResult(String id, BigDecimal time, String status) {
    boolean valid() { return time != null && time.signum() > 0 && (status == null || status.isBlank() || "Pass".equalsIgnoreCase(status)); }
  }

  private record RowCases(Map<String,Object> row, Map<String,CaseResult> cases) {}
}
