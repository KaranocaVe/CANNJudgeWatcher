package cn.cannjudge.watcher.source;

import static org.assertj.core.api.Assertions.assertThat;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;

class RowNormalizerTest {
  private final ObjectMapper mapper = new ObjectMapper();

  @Test
  void normalizesTeamAndTestcaseDetailsWithStableHash() throws Exception {
    var raw = mapper.readTree("""
      {"rank":1,"status":"Pass","score":75.3,"team":{"_id":"team-1","team_name":"Alpha"},
       "user":{"_id":"user-1","nickname":"alice"},"submitter":{"_id":"user-1","nickname":"alice"},
       "submission_id":"submission-1","create_time":"2026-08-22T05:58:37.826Z",
       "result":[{"testcase_id":"case-1","time":6.3,"precision_ratio":1,"testcase_status":"Pass"}]}
      """);
    var normalized = new RowNormalizer(mapper).ranking("contest-1", "problem-1", raw);
    assertThat(normalized.get("teamKey")).isEqualTo("team:team-1");
    assertThat(normalized.get("rank")).isEqualTo(1);
    assertThat(normalized.get("resultJson").toString()).contains("case-1");
    assertThat(String.valueOf(normalized.get("rowHash"))).isNotBlank();
  }

  @Test
  void ignoresSourceAggregateScoreWhenBuildingTheChangeHash() throws Exception {
    var original = mapper.readTree("""
      {"rank":1,"status":"Pass","score":12.34,"team":{"_id":"team-1"},
       "result":[{"testcase_id":"case-1","time":6.3,"testcase_status":"Pass"}]}
      """);
    var recalculated = original.deepCopy();
    ((com.fasterxml.jackson.databind.node.ObjectNode) recalculated).put("score", 98.76);
    var normalizer = new RowNormalizer(mapper);

    assertThat(normalizer.ranking("contest-1", "problem-1", original).get("rowHash"))
      .isEqualTo(normalizer.ranking("contest-1", "problem-1", recalculated).get("rowHash"));
    assertThat(normalizer.ranking("contest-1", "problem-1", original)).doesNotContainKey("score");
  }

  @Test
  void ignoresRankAndSubmissionMetadataWhenBuildingTheCaseEvidenceHash() throws Exception {
    var original = mapper.readTree("""
      {"rank":1,"status":"Pass","submission_id":"submission-1","create_time":"2026-08-22T05:58:37.826Z",
       "team":{"_id":"team-1"},"result":[{"testcase_id":"case-1","time":6.3,"testcase_status":"Pass"}]}
      """);
    var reordered = original.deepCopy();
    ((com.fasterxml.jackson.databind.node.ObjectNode) reordered).put("rank", 99).put("submission_id", "submission-2");
    ((com.fasterxml.jackson.databind.node.ObjectNode) reordered).put("create_time", "2026-08-23T05:58:37.826Z");
    var normalizer = new RowNormalizer(mapper);

    assertThat(normalizer.ranking("contest-1", "problem-1", original).get("rowHash"))
      .isEqualTo(normalizer.ranking("contest-1", "problem-1", reordered).get("rowHash"));
  }

  @Test
  void omitsVerboseCompilerLogsFromNormalizedTestcaseEvidence() throws Exception {
    var raw = mapper.readTree("""
      {"rank":1,"status":"Compile Error","user":{"_id":"user-1"},
       "result":[{"testcase_id":"case-1","time":0,"precision_ratio":0,
       "testcase_status":"Compile Error","msg":"very long compiler output"}]}
      """);

    var normalized = new RowNormalizer(mapper).ranking("contest-1", "problem-1", raw);

    assertThat(String.valueOf(normalized.get("resultJson"))).doesNotContain("compiler output");
    assertThat(String.valueOf(normalized.get("resultJson"))).contains("case-1", "Compile Error");
  }

  @Test
  void keepsWrongAnswerTestcaseTimingForPerformanceViews() throws Exception {
    var raw = mapper.readTree("""
      {"rank":1,"status":"WrongAnswer","team":{"_id":"team-1"},
       "result":[{"testcase_id":"case-1","time":18.75,"testcase_status":"WrongAnswer"}]}
      """);

    var normalized = new RowNormalizer(mapper).ranking("contest-1", "problem-1", raw);

    assertThat(String.valueOf(normalized.get("resultJson"))).contains("case-1", "18.75", "WrongAnswer");
  }
}
