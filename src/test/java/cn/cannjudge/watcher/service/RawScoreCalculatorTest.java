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

    new RawScoreCalculator(mapper).attachScores(List.of(fastest, slower));

    assertThat((BigDecimal) fastest.get("score")).isEqualByComparingTo("100.0000");
    assertThat((BigDecimal) slower.get("score")).isCloseTo(new BigDecimal("68.4535"), org.assertj.core.data.Offset.offset(new BigDecimal("0.0001")));
  }

  @Test
  void assignsZeroForAFailedCaseWhileKeepingTheCaseInTheAverage() {
    var pass = row("[{\"testcaseId\":\"a\",\"time\":3,\"status\":\"Pass\"},{\"testcaseId\":\"b\",\"time\":6,\"status\":\"Pass\"}]");
    var failed = row("[{\"testcaseId\":\"a\",\"time\":3,\"status\":\"Pass\"},{\"testcaseId\":\"b\",\"time\":0,\"status\":\"WrongAnswer\"}]");

    new RawScoreCalculator(mapper).attachScores(List.of(pass, failed));

    assertThat((BigDecimal) failed.get("score")).isEqualByComparingTo("50.0000");
  }

  private Map<String,Object> row(String result) { return new java.util.LinkedHashMap<>(Map.of("result", result)); }
}
