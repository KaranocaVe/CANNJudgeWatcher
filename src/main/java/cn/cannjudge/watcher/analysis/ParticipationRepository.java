package cn.cannjudge.watcher.analysis;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.sql.Timestamp;
import java.time.Instant;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;
import org.springframework.transaction.annotation.Transactional;

@Repository
public class ParticipationRepository {
  record Contest(String id, String title, String competitionKey, String sourceUrl, Instant startsAt,
                 Instant endedAt, String origin, String status, String organization, String rankAccess, boolean byPassCount) {}
  record Standing(String userId, String nickname, int submissions, int passed, java.math.BigDecimal score, int rank) {}
  record ProblemRank(String problemTitle, int rank, boolean team) {}
  record Observation(String userId, String nickname, int submissions, List<String> teamIds, ProblemRank problemRank) {}
  record Snapshot(Contest contest, Instant sampledAt, List<Standing> standings, String awardsSource, List<String> winners,
                  Instant summarySampledAt, Long totalParticipants, Long totalSubmissions, List<Observation> observations) {}
  record Key(String contestId, String userId) {}

  private final JdbcTemplate jdbc;
  private final ObjectMapper mapper;

  public ParticipationRepository(JdbcTemplate jdbc, ObjectMapper mapper) {
    this.jdbc = jdbc;
    this.mapper = mapper;
  }

  List<Contest> watcherContests(Instant now) {
    return jdbc.query("SELECT id,slug,title,status,start_time,end_time FROM contest ORDER BY id", (rs, i) -> {
      Instant end = instant(rs.getTimestamp("end_time"));
      Instant start = instant(rs.getTimestamp("start_time"));
      String status = ParticipationService.contestStatus(start, end, now, "ACTIVE".equals(rs.getString("status")));
      String slug = rs.getString("slug");
      return new Contest(rs.getString("id"), rs.getString("title"),
          ParticipationService.competitionKey(slug == null || slug.isBlank() ? rs.getString("id") : slug),
          null, start, end, "WATCHER", status, "UNKNOWN", "HISTORICAL", false);
    });
  }

  @Transactional
  public void updateCatalog(List<Contest> contests) {
    jdbc.update("UPDATE participation_contest SET eligible=false WHERE eligible");
    jdbc.batchUpdate("""
        INSERT INTO participation_contest(contest_id,title,competition_key,source_url,starts_at,ended_at,
          origin,status,organization,rank_access) VALUES (?,?,?,?,?,?,?,?,?,?)
        ON CONFLICT(contest_id) DO UPDATE SET eligible=true,title=excluded.title,competition_key=excluded.competition_key,
          source_url=excluded.source_url,starts_at=excluded.starts_at,ended_at=excluded.ended_at,origin=excluded.origin,
          status=excluded.status,organization=excluded.organization,rank_access=excluded.rank_access,
          sampled_at=CASE WHEN participation_contest.organization=excluded.organization AND excluded.rank_access='PUBLIC'
            THEN participation_contest.sampled_at END,
          entries=CASE WHEN participation_contest.organization=excluded.organization AND excluded.rank_access='PUBLIC'
            THEN participation_contest.entries ELSE '[]'::jsonb END
        """, contests, 64, (statement, contest) -> {
          statement.setString(1, contest.id());
          statement.setString(2, contest.title());
          statement.setString(3, contest.competitionKey());
          statement.setString(4, contest.sourceUrl());
          statement.setTimestamp(5, timestamp(contest.startsAt()));
          statement.setTimestamp(6, timestamp(contest.endedAt()));
          statement.setString(7, contest.origin());
          statement.setString(8, contest.status());
          statement.setString(9, contest.organization());
          statement.setString(10, contest.rankAccess());
        });
  }

  void save(String contestId, Instant at, List<Standing> standings) {
    jdbc.update("UPDATE participation_contest SET sampled_at=?,entries=?::jsonb WHERE contest_id=?",
        Timestamp.from(at), json(standings), contestId);
  }

  void saveSummary(String contestId, Instant at, long participants, long submissions) {
    jdbc.update("UPDATE participation_contest SET summary_sampled_at=?,total_participants=?,total_submissions=? WHERE contest_id=?",
        Timestamp.from(at), participants, submissions, contestId);
  }

  public void updateObservations() {
    Map<String,List<Observation>> observations = new LinkedHashMap<>();
    // Only credit an explicit submitter on team rows. Never assign the team's total to a member.
    jdbc.query("""
        WITH samples AS (
          SELECT contest_id,team_id,user_id,user_nickname,submitter_id,submitter_nickname,submission_id,observed_at,problem_id,rank
            FROM ranking_event WHERE event_type<>'DELETE' AND submission_id<>''
          UNION ALL
          SELECT contest_id,team_id,user_id,user_nickname,submitter_id,submitter_nickname,submission_id,updated_at,problem_id,rank
            FROM ranking_current WHERE submission_id<>''
        ), named AS (
          SELECT contest_id, NULLIF(team_id,'') AS team_id,
            COALESCE(NULLIF(submitter_id,''),CASE WHEN NULLIF(team_id,'') IS NULL THEN NULLIF(user_id,'') END) AS person,
            COALESCE(NULLIF(submitter_nickname,''),CASE WHEN submitter_id=user_id OR NULLIF(team_id,'') IS NULL
              THEN NULLIF(user_nickname,'') END) AS name,
            submission_id,observed_at,problem_id,rank FROM samples
        ), distinct_submissions AS (
          SELECT contest_id, submission_id, min(person) AS person,
            (array_agg(name ORDER BY observed_at DESC) FILTER (WHERE name IS NOT NULL))[1] AS name,
            CASE WHEN count(DISTINCT team_id)=1 THEN min(team_id) END AS team_id,
            max(observed_at) AS observed_at,
            CASE WHEN count(DISTINCT problem_id)=1 THEN min(problem_id) END AS problem_id,
            min(rank) FILTER (WHERE rank>0) AS best_rank,
            bool_or(team_id IS NOT NULL) AS team
          FROM named WHERE person IS NOT NULL
          GROUP BY contest_id, submission_id HAVING count(DISTINCT person)=1
        ), participant_counts AS (
          SELECT contest_id,person,count(*) AS submissions,
            (array_agg(name ORDER BY observed_at DESC) FILTER (WHERE name IS NOT NULL))[1] AS nickname,
            COALESCE(array_agg(DISTINCT team_id) FILTER (WHERE team_id IS NOT NULL),ARRAY[]::varchar[]) AS teams
          FROM distinct_submissions GROUP BY contest_id,person
        ), best_problem AS (
          SELECT DISTINCT ON (contest_id,person) contest_id,person,problem_id,best_rank,team
          FROM distinct_submissions
          WHERE problem_id IS NOT NULL AND best_rank IS NOT NULL
          ORDER BY contest_id,person,best_rank,observed_at DESC,problem_id,submission_id
        )
        SELECT c.*,r.best_rank,r.team,p.title AS problem_title
        FROM participant_counts c LEFT JOIN best_problem r USING (contest_id,person)
        LEFT JOIN problem p ON p.id=r.problem_id AND p.contest_id=r.contest_id
        """, rs -> {
          Integer rank = rs.getObject("best_rank", Integer.class);
          String title = rs.getString("problem_title");
          ProblemRank problemRank = rank != null && title != null ? new ProblemRank(title, rank, rs.getBoolean("team")) : null;
          var row = new Observation(rs.getString("person"), rs.getString("nickname"), rs.getInt("submissions"),
              List.of((String[]) rs.getArray("teams").getArray()), problemRank);
          observations.computeIfAbsent(rs.getString("contest_id"), ignored -> new ArrayList<>()).add(row);
        });
    List<String> contests = jdbc.queryForList("SELECT contest_id FROM participation_contest WHERE eligible", String.class);
    jdbc.batchUpdate("UPDATE participation_contest SET observed_entries=?::jsonb WHERE contest_id=?", contests, 64,
        (statement, id) -> {
          statement.setString(1, json(observations.getOrDefault(id, List.of())));
          statement.setString(2, id);
        });
  }

  List<Snapshot> snapshots() {
    return jdbc.query("""
        SELECT c.*,a.source_url AS award_source,a.winner_ids
        FROM participation_contest c LEFT JOIN participation_awards a USING(contest_id)
        WHERE c.eligible ORDER BY c.ended_at DESC NULLS FIRST,c.contest_id
        """, (rs, index) -> {
          var contest = new Contest(rs.getString("contest_id"), rs.getString("title"), rs.getString("competition_key"),
              rs.getString("source_url"), instant(rs.getTimestamp("starts_at")), instant(rs.getTimestamp("ended_at")),
              rs.getString("origin"), rs.getString("status"), rs.getString("organization"), rs.getString("rank_access"), false);
          return new Snapshot(contest, instant(rs.getTimestamp("sampled_at")),
              parse(rs.getString("entries"), new TypeReference<>() {}), rs.getString("award_source"),
              parse(rs.getString("winner_ids"), new TypeReference<>() {}), instant(rs.getTimestamp("summary_sampled_at")),
              rs.getObject("total_participants", Long.class), rs.getObject("total_submissions", Long.class),
              parse(rs.getString("observed_entries"), new TypeReference<>() {}));
        });
  }

  Map<Key,String> agentEvidence() {
    Map<Key,String> evidence = new LinkedHashMap<>();
    jdbc.query("SELECT contest_id,user_id,source_url FROM participation_agent_evidence", rs -> {
      evidence.put(new Key(rs.getString(1), rs.getString(2)), rs.getString(3));
    });
    return evidence;
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
        SELECT contest_id,?,? FROM participation_contest WHERE contest_id=? AND eligible AND (
          EXISTS (SELECT 1 FROM jsonb_array_elements(observed_entries) e WHERE e->>'userId'=?)
          OR (organization='INDIVIDUAL' AND EXISTS (SELECT 1 FROM jsonb_array_elements(entries) e WHERE e->>'userId'=?))
        )
        ON CONFLICT(contest_id,user_id) DO UPDATE SET source_url=excluded.source_url
        """, userId, source, contestId, userId, userId) > 0;
  }

  public void deleteAgentEvidence(String contestId, String userId) {
    jdbc.update("DELETE FROM participation_agent_evidence WHERE contest_id=? AND user_id=?", contestId, userId);
  }

  public void deleteAwards(String contestId) {
    jdbc.update("DELETE FROM participation_awards WHERE contest_id=?", contestId);
  }

  private static Instant instant(Timestamp value) { return value == null ? null : value.toInstant(); }
  private static Timestamp timestamp(Instant value) { return value == null ? null : Timestamp.from(value); }

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
