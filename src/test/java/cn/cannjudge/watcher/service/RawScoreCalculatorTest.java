package cn.cannjudge.watcher.service;

import static org.assertj.core.api.Assertions.assertThat;

import com.fasterxml.jackson.databind.ObjectMapper;
import java.math.BigDecimal;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;

class RawScoreCalculatorTest {
  private final ObjectMapper mapper = new ObjectMapper();

  @Test
  void derivesScoreFromCaseTimesInsteadOfTheSourceAggregate() {
    var fastest = row("[{\"testcaseId\":\"a\",\"time\":3,\"status\":\"Pass\"},{\"testcaseId\":\"b\",\"time\":6,\"status\":\"Pass\"}]");
    var slower = row("[{\"testcaseId\":\"a\",\"time\":6,\"status\":\"Pass\"},{\"testcaseId\":\"b\",\"time\":6,\"status\":\"Pass\"}]");

    new RawScoreCalculator(mapper).attachScores(List.of(fastest, slower), Map.of("a", new BigDecimal("3"), "b", new BigDecimal("6")));

    assertThat((BigDecimal) fastest.get("score")).isEqualByComparingTo("100.0000");
    assertThat((BigDecimal) slower.get("score")).isEqualByComparingTo("75.0000");
  }

  @Test
  void assignsZeroForAFailedCaseWhileKeepingTheCaseInTheAverage() {
    var pass = row("[{\"testcaseId\":\"a\",\"time\":3,\"status\":\"Pass\"},{\"testcaseId\":\"b\",\"time\":6,\"status\":\"Pass\"}]");
    var failed = row("[{\"testcaseId\":\"a\",\"time\":3,\"status\":\"Pass\"},{\"testcaseId\":\"b\",\"time\":0,\"status\":\"WrongAnswer\"}]");

    new RawScoreCalculator(mapper).attachScores(List.of(pass, failed), Map.of("a", new BigDecimal("3"), "b", new BigDecimal("6")));

    assertThat((BigDecimal) failed.get("score")).isEqualByComparingTo("50.0000");
  }

  @Test
  void capsAFasterSubmissionAtTheFrozenReferenceCeiling() {
    var faster = row("[{\"testcaseId\":\"a\",\"time\":2,\"status\":\"Pass\"}]");

    new RawScoreCalculator(mapper).attachScores(List.of(faster), Map.of("a", new BigDecimal("3")));

    assertThat((BigDecimal) faster.get("score")).isEqualByComparingTo("100.0000");
  }

  private Map<String,Object> row(String result) { return new java.util.LinkedHashMap<>(Map.of("result", result)); }
}
