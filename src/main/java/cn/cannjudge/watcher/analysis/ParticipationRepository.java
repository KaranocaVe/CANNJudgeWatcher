package cn.cannjudge.watcher.analysis;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.sql.Timestamp;
import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;
import org.springframework.transaction.annotation.Transactional;

@Repository
public class ParticipationRepository {
  record Contest(String id, String title, String competitionKey, String sourceUrl, Instant endedAt, boolean byPassCount) {}
  record Standing(String userId, String nickname, int submissions, int passed, java.math.BigDecimal score, int rank) {}
  record Snapshot(Contest contest, Instant sampledAt, List<Standing> standings, String awardsSource, List<String> winners) {}
  record Key(String contestId, String userId) {}

  private final JdbcTemplate jdbc;
  private final ObjectMapper mapper;

  public ParticipationRepository(JdbcTemplate jdbc, ObjectMapper mapper) {
    this.jdbc = jdbc;
    this.mapper = mapper;
  }

  @Transactional
  public void updateCatalog(List<Contest> contests) {
    jdbc.update("UPDATE participation_contest SET eligible=false WHERE eligible");
    jdbc.batchUpdate("""
        INSERT INTO participation_contest(contest_id,title,competition_key,source_url,ended_at) VALUES (?,?,?,?,?)
        ON CONFLICT(contest_id) DO UPDATE SET eligible=true,title=excluded.title,competition_key=excluded.competition_key,
          source_url=excluded.source_url,ended_at=excluded.ended_at
        """, contests, 64, (statement, contest) -> {
          statement.setString(1, contest.id());
          statement.setString(2, contest.title());
          statement.setString(3, contest.competitionKey());
          statement.setString(4, contest.sourceUrl());
          statement.setTimestamp(5, Timestamp.from(contest.endedAt()));
        });
  }

  void save(String contestId, Instant at, List<Standing> standings) {
    jdbc.update("UPDATE participation_contest SET sampled_at=?,entries=?::jsonb WHERE contest_id=?",
        Timestamp.from(at), json(standings), contestId);
  }

  List<Snapshot> snapshots() {
    return jdbc.query("""
        SELECT c.*,a.source_url AS award_source,a.winner_ids
        FROM participation_contest c LEFT JOIN participation_awards a USING(contest_id)
        WHERE c.eligible ORDER BY c.ended_at DESC,c.contest_id
        """, (rs, index) -> {
          var contest = new Contest(rs.getString("contest_id"), rs.getString("title"), rs.getString("competition_key"), rs.getString("source_url"),
              rs.getTimestamp("ended_at").toInstant(), false);
          Timestamp sampledAt = rs.getTimestamp("sampled_at");
          return new Snapshot(contest, sampledAt == null ? null : sampledAt.toInstant(),
              parse(rs.getString("entries"), new TypeReference<>() {}), rs.getString("award_source"),
              parse(rs.getString("winner_ids"), new TypeReference<>() {}));
        });
  }

  Map<Key,String> agentEvidence() {
    Map<Key,String> evidence = new LinkedHashMap<>();
    jdbc.query("SELECT contest_id,user_id,source_url FROM participation_agent_evidence", rs -> {
      evidence.put(new Key(rs.getString(1), rs.getString(2)), rs.getString(3));
    });
    return evidence;
  }

  /** Ranking history represents a lower bound because intermediate uploads can miss the sampled leaderboard. */
  Map<Key,Integer> observedSubmissions(List<String> users, List<String> contests) {
    if (users.isEmpty() || contests.isEmpty()) return Map.of();
    Map<Key,Integer> observed = new LinkedHashMap<>();
    jdbc.query(connection -> {
      var statement = connection.prepareStatement("""
          WITH submissions AS (
            SELECT contest_id,user_id,submission_id FROM ranking_event
              WHERE user_id=ANY(?) AND contest_id=ANY(?) AND event_type<>'DELETE'
            UNION ALL
            SELECT contest_id,user_id,submission_id FROM ranking_current
              WHERE user_id=ANY(?) AND contest_id=ANY(?)
          )
          SELECT contest_id,user_id,count(DISTINCT NULLIF(submission_id,'')) AS observed
          FROM submissions GROUP BY contest_id,user_id
          """);
      var userIds = connection.createArrayOf("varchar", users.toArray());
      var contestIds = connection.createArrayOf("varchar", contests.toArray());
      statement.setArray(1, userIds);
      statement.setArray(2, contestIds);
      statement.setArray(3, userIds);
      statement.setArray(4, contestIds);
      return statement;
    }, rs -> { observed.put(new Key(rs.getString(1), rs.getString(2)), rs.getInt(3)); });
    return observed;
  }

  public boolean saveAwards(String contestId, String source, List<String> winners) {
    return jdbc.update("""
        INSERT INTO participation_awards(contest_id,source_url,winner_ids)
        SELECT contest_id,?,?::jsonb FROM participation_contest WHERE contest_id=? AND eligible
        ON CONFLICT(contest_id) DO UPDATE SET source_url=excluded.source_url,winner_ids=excluded.winner_ids
        """, source, json(winners), contestId) > 0;
  }

  public boolean saveAgentEvidence(String contestId, String userId, String source) {
    return jdbc.update("""
        INSERT INTO participation_agent_evidence(contest_id,user_id,source_url)
        SELECT contest_id,?,? FROM participation_contest WHERE contest_id=? AND eligible AND EXISTS (
          SELECT 1 FROM jsonb_array_elements(entries) e WHERE e->>'userId'=?
        )
        ON CONFLICT(contest_id,user_id) DO UPDATE SET source_url=excluded.source_url
        """, userId, source, contestId, userId) > 0;
  }

  public void deleteAgentEvidence(String contestId, String userId) {
    jdbc.update("DELETE FROM participation_agent_evidence WHERE contest_id=? AND user_id=?", contestId, userId);
  }

  public void deleteAwards(String contestId) {
    jdbc.update("DELETE FROM participation_awards WHERE contest_id=?", contestId);
  }

  private String json(Object value) {
    try { return mapper.writeValueAsString(value); }
    catch (JsonProcessingException error) { throw new IllegalStateException("Cannot serialize participation data", error); }
  }

  private <T> List<T> parse(String value, TypeReference<List<T>> type) {
    if (value == null) return List.of();
    try { return mapper.readValue(value, type); }
    catch (JsonProcessingException error) { throw new IllegalStateException("Cannot deserialize participation data", error); }
  }
}
