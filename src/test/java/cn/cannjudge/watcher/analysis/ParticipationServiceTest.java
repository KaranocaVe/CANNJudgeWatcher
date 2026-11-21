package cn.cannjudge.watcher.analysis;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.*;

class ParticipationServiceTest {
  private final ObjectMapper mapper = new ObjectMapper();

  @Test
  void sourceRankingModesAndSharedRanksUseAllPublishedSortKeys() throws Exception {
    var rows = mapper.readTree("""
        [
          {"user_id":"a","submissionCount":25,"passCount":2,"score":4},
          {"user_id":"b","submissionCount":10,"passCount":2,"score":4.0},
          {"user_id":"c","submissionCount":10,"passCount":2,"score":4.0},
          {"user_id":"d","submissionCount":10,"passCount":3,"score":3}
        ]
        """);
    var byScore = ParticipationService.parseStandings(rows, false);
    assertEquals(java.util.List.of("b","c","a","d"), byScore.stream().map(ParticipationRepository.Standing::userId).toList());
    assertEquals(java.util.List.of(1,1,3,4), byScore.stream().map(ParticipationRepository.Standing::rank).toList());
    assertEquals("d", ParticipationService.parseStandings(rows, true).getFirst().userId());
  }

  @Test
  void stagesOfOneCompetitionShareAnIdentity() {
    assertEquals("western", ParticipationService.competitionKey("western_preliminary"));
    assertEquals("western", ParticipationService.competitionKey("western_final"));
    assertEquals("op_challenge_jiangshan", ParticipationService.competitionKey("op_challenge_jiangshan_prelim"));
    assertEquals("ghm", ParticipationService.competitionKey("ghm"));
  }

  @Test
  void rejectsParticipantDuplicatesWithoutPublishingAnIncorrectSnapshot() throws Exception {
    var rows = mapper.readTree("""
        [
          {"user_id":"a","submissionCount":25,"passCount":2,"score":4},
          {"user_id":"a","submissionCount":10,"passCount":3,"score":3}
        ]
        """);
    assertThrows(IllegalArgumentException.class, () -> ParticipationService.parseStandings(rows, false));
  }
}
