package cn.cannjudge.watcher.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.math.BigDecimal;
import java.math.RoundingMode;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.springframework.stereotype.Component;

/**
 * Derives the monitor's own score from testcase measurements.  The source leaderboard's
 * aggregate score is deliberately not used: its global baseline can change without a team
 * changing its own submission.
 */
@Component
public class RawScoreCalculator {
  private final ObjectMapper mapper;

  public RawScoreCalculator(ObjectMapper mapper) { this.mapper = mapper; }

  /** Returns fixed-reference candidates from a complete first observation. */
  public Map<String,BigDecimal> referenceTimes(List<Map<String,Object>> rows) {
    Map<String, BigDecimal> references = new LinkedHashMap<>();
    for (Map<String,Object> row : rows) {
      Map<String,CaseResult> cases = cases(row.get("result"));
      for (CaseResult testcase : cases.values()) {
        if (testcase.valid()) references.merge(testcase.id(), testcase.time(), BigDecimal::min);
      }
    }
    return references;
  }

  /** Adds a stable score based solely on permanently frozen per-case reference timings. */
  public void attachScores(List<Map<String,Object>> rows, Map<String,BigDecimal> references) {
    for (Map<String,Object> row : rows) {
      row.put("score", score(cases(row.get("result")), references));
    }
  }

  private BigDecimal score(Map<String,CaseResult> cases, Map<String,BigDecimal> references) {
    if (references.isEmpty()) return null;
    double total = 0d;
    for (Map.Entry<String,BigDecimal> reference : references.entrySet()) {
      String testcaseId = reference.getKey();
      CaseResult testcase = cases.get(testcaseId);
      if (testcase == null || !testcase.valid() || reference.getValue().signum() <= 0) continue;
      total += Math.min(100d, 100d * reference.getValue().doubleValue() / testcase.time().doubleValue());
    }
    return BigDecimal.valueOf(total / references.size()).setScale(4, RoundingMode.HALF_UP);
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
}
