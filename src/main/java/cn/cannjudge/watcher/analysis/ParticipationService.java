package cn.cannjudge.watcher.analysis;

import static cn.cannjudge.watcher.source.CannJudgeClient.instant;
import static cn.cannjudge.watcher.source.CannJudgeClient.text;

import cn.cannjudge.watcher.analysis.ParticipationRepository.Contest;
import cn.cannjudge.watcher.analysis.ParticipationRepository.Key;
import cn.cannjudge.watcher.analysis.ParticipationRepository.Snapshot;
import cn.cannjudge.watcher.analysis.ParticipationRepository.Standing;
import cn.cannjudge.watcher.source.CannJudgeClient;
import com.fasterxml.jackson.databind.JsonNode;
import jakarta.annotation.PreDestroy;
import java.math.BigDecimal;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.time.Clock;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicBoolean;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;

@Service
public class ParticipationService {
  record ContestResult(String id, String title, String sourceUrl, Instant endedAt, int participants,
                       String awardsSource, Instant sampledAt) {}
  record Entry(String contestId, String title, String sourceUrl, int submissions, int rank, int participants,
               Boolean award, String awardSource, String agentSource, Integer observedSubmissions) {}
  record Candidate(String userId, String nickname, int contestCount, int stageCount, long submissions, int topFinishes,
                   int awardWins, int awardKnown, int agentEvidenceCount, double score, List<Entry> entries) {}
  record Response(Instant refreshedAt, int eligibleContests, int coveredContests, int awardCoveredContests,
                  List<Candidate> items, List<ContestResult> contests) {}
  private record Evidence(Snapshot snapshot, Standing standing, String agentSource, Boolean won) {}
  private record Calculated(String userId, String nickname, List<Evidence> evidence, int competitionCount, long submissions,
                            int top, int wins, int known, int agent, double score) {}

  private static final Logger LOG = LoggerFactory.getLogger(ParticipationService.class);
  private final ParticipationRepository repo;
  private final CannJudgeClient source;
  private final Clock clock;
  private final ExecutorService worker = Executors.newSingleThreadExecutor();
  private final AtomicBoolean refreshing = new AtomicBoolean();

  public ParticipationService(ParticipationRepository repo, CannJudgeClient source, Clock clock) {
    this.repo = repo;
    this.source = source;
    this.clock = clock;
  }

  // Keep this crawl off the scheduler thread that runs live ranking collection.
  @Scheduled(initialDelayString = "${cannjudge.participation-initial-delay-ms:15000}",
      fixedDelayString = "${cannjudge.participation-refresh-ms:21600000}")
  public void refresh() {
    if (!refreshing.compareAndSet(false, true)) return;
    worker.submit(() -> {
      try { fetch(); }
      catch (RuntimeException error) { LOG.warn("Participation catalog refresh failed: {}", error.getMessage()); }
      finally { refreshing.set(false); }
    });
  }

  @PreDestroy
  void stop() { worker.shutdownNow(); }

  private void fetch() {
    String groupId = text(source.publicGroup(), "_id");
    if (groupId == null || groupId.isBlank()) throw new IllegalStateException("Missing public group ID");
    List<JsonNode> catalog = source.contests(groupId);
    if (catalog.isEmpty()) throw new IllegalStateException("Public catalog is empty");
    List<Contest> contests = eligible(catalog, clock.instant());
    repo.updateCatalog(contests);
    for (Contest contest : contests) {
      if (Thread.currentThread().isInterrupted()) return;
      try {
        JsonNode rows = source.contestStandings(contest.id());
        repo.save(contest.id(), clock.instant(), parseStandings(rows, contest.byPassCount()));
      } catch (RuntimeException error) {
        LOG.warn("Participation standings refresh failed for {}: {}", contest.id(), error.getMessage());
      }
    }
  }

  static List<Contest> eligible(List<JsonNode> catalog, Instant now) {
    List<Contest> contests = new ArrayList<>();
    for (JsonNode item : catalog) {
      Instant end = instant(item.get("end_time"));
      if (end == null || end.isAfter(now) || item.path("ongoing").asBoolean(false)
          || !item.path("show_total_ranking").asBoolean(true)
          || item.path("freeze_hide_ranking").asBoolean(false)
          || !"individual".equals(text(item, "organization_mode"))) continue;
      String id = text(item, "_id");
      String slug = text(item, "name");
      String title = text(item, "title");
      if (id == null || !id.matches("[a-zA-Z0-9_-]{1,64}") || slug == null || slug.isBlank()
          || title == null || title.isBlank() || title.contains("练习赛")) continue;
      String url = "https://cannjudge.cn/#/public/" + URLEncoder.encode(slug, StandardCharsets.UTF_8).replace("+", "%20") + "/ranking";
      contests.add(new Contest(id, title, competitionKey(slug), url, end, "num".equals(text(item, "ranking_mode"))));
    }
    return contests;
  }

  static String competitionKey(String slug) {
    return slug.replaceFirst("(?i)[_-](prelim|preliminary|final)$", "");
  }

  static List<Standing> parseStandings(JsonNode rows, boolean byPassCount) {
    if (rows == null || !rows.isArray()) throw new IllegalArgumentException("Contest statistics must be an array");
    List<Standing> parsed = new ArrayList<>();
    var ids = new HashSet<String>();
    for (JsonNode row : rows) {
      if (row.hasNonNull("team") || row.hasNonNull("team_id")) {
        throw new IllegalArgumentException("Team standings cannot represent personal submissions");
      }
      String id = text(row, "user_id");
      if (id == null || id.isBlank()) id = text(row.path("user"), "_id");
      JsonNode count = row.path("submissionCount");
      JsonNode passed = row.path("passCount");
      JsonNode score = row.path("score");
      if (id == null || id.isBlank() || id.length() > 120 || !ids.add(id)
          || !count.isIntegralNumber() || !count.canConvertToInt() || count.asInt() < 0
          || !passed.isIntegralNumber() || !passed.canConvertToInt() || passed.asInt() < 0 || !score.isNumber()) {
        throw new IllegalArgumentException("Invalid or duplicate individual contest statistic");
      }
      String nickname = text(row.path("user"), "nickname");
      parsed.add(new Standing(id, nickname == null || nickname.isBlank() ? "未公开昵称" : nickname,
          count.asInt(), passed.asInt(), score.decimalValue(), 0));
    }
    Comparator<Standing> scoreOrder = Comparator.comparing(Standing::score).reversed();
    Comparator<Standing> passOrder = Comparator.comparingInt(Standing::passed).reversed();
    // Mirror the source's sorting keys. Use a shared rank when all keys tie.
    Comparator<Standing> order = (byPassCount ? passOrder.thenComparing(scoreOrder) : scoreOrder.thenComparing(passOrder))
        .thenComparingInt(Standing::submissions);
    parsed.sort(order);
    List<Standing> ranked = new ArrayList<>();
    int rank = 1;
    for (int i = 0; i < parsed.size(); i++) {
      Standing row = parsed.get(i);
      if (i > 0 && order.compare(parsed.get(i - 1), row) != 0) rank = i + 1;
      ranked.add(new Standing(row.userId(), row.nickname(), row.submissions(), row.passed(), row.score(), rank));
    }
    return ranked;
  }

  Response analyze(int minimumContests, int minimumSubmissions, int topN, boolean awards, boolean agentOnly) {
    List<Snapshot> snapshots = repo.snapshots();
    Map<Key,String> agentEvidence = repo.agentEvidence();
    Map<String,List<Evidence>> byUser = new HashMap<>();
    for (Snapshot snapshot : snapshots) {
      if (awards && snapshot.awardsSource() == null) continue;
      var winners = new HashSet<>(snapshot.winners());
      for (Standing row : snapshot.standings()) {
        if (row.submissions() == 0) continue;
        String agentSource = agentEvidence.get(new Key(snapshot.contest().id(), row.userId()));
        if (agentOnly && agentSource == null) continue;
        Boolean won = snapshot.awardsSource() == null ? null : winners.contains(row.userId());
        byUser.computeIfAbsent(row.userId(), ignored -> new ArrayList<>()).add(new Evidence(snapshot, row, agentSource, won));
      }
    }

    List<Calculated> selected = new ArrayList<>();
    byUser.forEach((userId, evidence) -> {
      int stages = evidence.size();
      int competitions = (int) evidence.stream().map(e -> e.snapshot().contest().competitionKey()).distinct().count();
      long submissions = evidence.stream().mapToLong(e -> e.standing().submissions()).sum();
      int topFinishes = (int) evidence.stream().filter(e -> e.standing().rank() <= topN).count();
      int awardWins = (int) evidence.stream().filter(e -> Boolean.TRUE.equals(e.won())).count();
      int awardKnown = (int) evidence.stream().filter(e -> e.won() != null).count();
      int agent = (int) evidence.stream().filter(e -> e.agentSource() != null).count();
      int hits = awards ? awardWins : topFinishes;
      if (competitions < minimumContests || submissions < minimumSubmissions || hits * 2 >= stages) return;
      double score = Math.sqrt(competitions) * Math.log1p(submissions) * (stages - hits + 1.0) / (stages + 2.0);
      selected.add(new Calculated(userId, evidence.getFirst().standing().nickname(), evidence, competitions, submissions,
          topFinishes, awardWins, awardKnown, agent, score));
    });
    selected.sort(Comparator.comparingDouble(Calculated::score).reversed()
        .thenComparing(Comparator.comparingLong(Calculated::submissions).reversed()).thenComparing(Calculated::userId));

    Map<Key,Integer> observed = repo.observedSubmissions(selected.stream().map(Calculated::userId).toList(),
        snapshots.stream().map(s -> s.contest().id()).toList());
    List<Candidate> items = selected.stream().map(candidate -> new Candidate(candidate.userId(), candidate.nickname(),
        candidate.competitionCount(), candidate.evidence().size(), candidate.submissions(), candidate.top(), candidate.wins(), candidate.known(),
        candidate.agent(), candidate.score(), candidate.evidence().stream().map(e -> entry(e, observed)).toList())).toList();
    List<ContestResult> contests = snapshots.stream().map(s -> new ContestResult(s.contest().id(), s.contest().title(),
        s.contest().sourceUrl(), s.contest().endedAt(), s.standings().size(), s.awardsSource(), s.sampledAt())).toList();
    Instant refreshed = snapshots.stream().map(Snapshot::sampledAt).filter(at -> at != null).max(Comparator.naturalOrder()).orElse(null);
    return new Response(refreshed, contests.size(), (int) contests.stream().filter(c -> c.sampledAt() != null).count(),
        (int) contests.stream().filter(c -> c.sampledAt() != null && c.awardsSource() != null).count(), items, contests);
  }

  private Entry entry(Evidence evidence, Map<Key,Integer> observed) {
    Snapshot snapshot = evidence.snapshot();
    Standing standing = evidence.standing();
    Contest contest = snapshot.contest();
    return new Entry(contest.id(), contest.title(), contest.sourceUrl(), standing.submissions(), standing.rank(),
        snapshot.standings().size(), evidence.won(), snapshot.awardsSource(), evidence.agentSource(),
        observed.get(new Key(contest.id(), standing.userId())));
  }
}
