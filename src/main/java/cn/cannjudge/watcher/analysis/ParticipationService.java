package cn.cannjudge.watcher.analysis;

import static cn.cannjudge.watcher.source.CannJudgeClient.instant;
import static cn.cannjudge.watcher.source.CannJudgeClient.text;

import cn.cannjudge.watcher.analysis.ParticipationRepository.Contest;
import cn.cannjudge.watcher.analysis.ParticipationRepository.Key;
import cn.cannjudge.watcher.analysis.ParticipationRepository.Observation;
import cn.cannjudge.watcher.analysis.ParticipationRepository.Snapshot;
import cn.cannjudge.watcher.analysis.ParticipationRepository.Standing;
import cn.cannjudge.watcher.source.CannJudgeClient;
import com.fasterxml.jackson.databind.JsonNode;
import jakarta.annotation.PreDestroy;
import java.math.BigDecimal;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.time.Clock;
import java.time.temporal.ChronoUnit;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.LinkedHashMap;
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
  record ContestResult(String id, String title, String sourceUrl, Instant endedAt, long participants,
                       String awardsSource, Instant sampledAt, String origin, String status, String organization,
                       int observedParticipants, Long totalSubmissions, String rankAccess, Instant summarySampledAt) {}
  record Entry(String contestId, String title, String sourceUrl, int submissions, Integer rank, long participants,
               Boolean award, String awardSource, String agentSource, Integer observedSubmissions,
               String submissionSource, String rankSource, String status, boolean finalRank) {}
  record Candidate(String userId, String nickname, int contestCount, int stageCount, long submissions, int topFinishes,
                   int awardWins, int awardKnown, int agentEvidenceCount, double score, List<Entry> entries,
                   int rankKnown, boolean lowerBound) {}
  record Response(Instant refreshedAt, int eligibleContests, int coveredContests, int awardCoveredContests,
                  List<Candidate> items, List<ContestResult> contests, int observedContests, int userCoveredContests,
                  int totalSubmissionsContests) {}
  private record Evidence(Contest contest, String nickname, Entry entry) {}

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
    Instant now = clock.instant();
    List<Contest> contests = publicCatalog(catalog, now);
    Map<String,Contest> combined = new LinkedHashMap<>();
    repo.watcherContests(now).forEach(contest -> combined.put(contest.id(), contest));
    contests.forEach(contest -> combined.put(contest.id(), contest));
    repo.updateCatalog(new ArrayList<>(combined.values()));
    repo.updateObservations();
    for (Contest contest : contests) {
      if (Thread.currentThread().isInterrupted()) return;
      try {
        JsonNode summary = source.contestSummary(contest.id());
        long participants = summary.path("participantCount").asLong(-1);
        long submissions = summary.path("submissionCount").asLong(-1);
        if (participants < 0 || submissions < 0) throw new IllegalArgumentException("Invalid public contest summary");
        repo.saveSummary(contest.id(), clock.instant(), participants, submissions);
      } catch (RuntimeException error) {
        LOG.warn("Participation summary refresh failed for {}: {}", contest.id(), error.getMessage());
      }
      if (!"PUBLIC".equals(contest.rankAccess())) continue;
      try {
        JsonNode rows = source.contestStandings(contest.id());
        repo.save(contest.id(), clock.instant(), parseStandings(rows, contest.byPassCount(), "TEAM".equals(contest.organization())));
      } catch (RuntimeException error) {
        LOG.warn("Participation standings refresh failed for {}: {}", contest.id(), error.getMessage());
      }
    }
  }

  static List<Contest> publicCatalog(List<JsonNode> catalog, Instant now) {
    List<Contest> contests = new ArrayList<>();
    for (JsonNode item : catalog) {
      String id = text(item, "_id");
      String slug = text(item, "name");
      String title = text(item, "title");
      if (id == null || !id.matches("[a-zA-Z0-9_-]{1,64}")) continue;
      String route = slug == null || slug.isBlank() ? id : slug;
      String url = "https://cannjudge.cn/#/public/" + URLEncoder.encode(route, StandardCharsets.UTF_8).replace("+", "%20");
      Instant start = instant(item.get("start_time"));
      Instant end = instant(item.get("end_time"));
      String status = contestStatus(start, end, now, item.path("ongoing").asBoolean(false));
      String organization = switch (item.path("organization_mode").asText()) {
        case "team", "gitcode_team", "huawei_team" -> "TEAM";
        case "individual" -> "INDIVIDUAL";
        default -> "UNKNOWN";
      };
      boolean hidden = !item.path("show_total_ranking").asBoolean(true)
          || item.path("freeze_hide_ranking").asBoolean(false)
          || "UPCOMING".equals(status)
          || (item.path("freeze_ranking").asBoolean(false) && end != null && now.isBefore(end)
              && !now.isBefore(end.minus(Math.max(0, item.path("freeze_duration").asInt()), ChronoUnit.MINUTES)));
      contests.add(new Contest(id, title == null || title.isBlank() ? route : title, competitionKey(route), url,
          start, end, "PUBLIC", status, organization, hidden ? "HIDDEN" : "PUBLIC", "num".equals(text(item, "ranking_mode"))));
    }
    return contests;
  }

  static String contestStatus(Instant start, Instant end, Instant now, boolean ongoing) {
    if (end != null && !end.isAfter(now)) return "ENDED";
    if (start != null && start.isAfter(now)) return "UPCOMING";
    return ongoing || start != null || end != null ? "ACTIVE" : "UNKNOWN";
  }

  static String competitionKey(String slug) {
    return slug.replaceFirst("(?i)[_-](prelim|preliminary|final)$", "");
  }

  static List<Standing> parseStandings(JsonNode rows, boolean byPassCount, boolean team) {
    if (rows == null || !rows.isArray()) throw new IllegalArgumentException("Contest statistics must be an array");
    List<Standing> parsed = new ArrayList<>();
    var ids = new HashSet<String>();
    for (JsonNode row : rows) {
      if (!team && (row.hasNonNull("team") || row.hasNonNull("team_object_id"))) {
        throw new IllegalArgumentException("Unexpected team row in individual standings");
      }
      String id = team ? text(row, "team_object_id") : text(row, "user_id");
      if (id == null || id.isBlank()) id = text(row.path(team ? "team" : "user"), "_id");
      JsonNode count = row.path("submissionCount");
      JsonNode passed = row.path("passCount");
      JsonNode score = row.path("score");
      if (id == null || id.isBlank() || id.length() > 120 || !ids.add(id)
          || !count.isIntegralNumber() || !count.canConvertToInt() || count.asInt() < 0
          || !passed.isIntegralNumber() || !passed.canConvertToInt() || passed.asInt() < 0 || !score.isNumber()) {
        throw new IllegalArgumentException("Invalid or duplicate individual contest statistic");
      }
      String nickname = team ? text(row.path("team"), "team_name") : text(row.path("user"), "nickname");
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
    for (Snapshot snapshot : snapshots) addEvidence(snapshot, agentEvidence, byUser);
    List<Candidate> items = new ArrayList<>();
    byUser.forEach((userId, evidence) -> {
      List<Evidence> selected = evidence.stream()
          .filter(row -> !agentOnly || row.entry().agentSource() != null).toList();
      List<Entry> entries = selected.stream().map(Evidence::entry).toList();
      int stages = entries.size();
      int competitions = (int) selected.stream().map(e -> e.contest().competitionKey()).distinct().count();
      long submissions = entries.stream().mapToLong(Entry::submissions).sum();
      if (competitions < minimumContests || submissions < minimumSubmissions) return;
      int rankKnown = (int) entries.stream().filter(Entry::finalRank).count();
      int top = (int) entries.stream().filter(e -> e.finalRank() && e.rank() <= topN).count();
      int awardKnown = (int) entries.stream().filter(e -> e.award() != null).count();
      int wins = (int) entries.stream().filter(e -> Boolean.TRUE.equals(e.award())).count();
      int known = awards ? awardKnown : rankKnown;
      int hits = awards ? wins : top;
      if (known == 0 || hits * 2 >= known) return;
      double score = Math.sqrt(competitions) * Math.log1p(submissions) * (known - hits + 1.0) / (known + 2.0);
      String name = selected.stream().map(Evidence::nickname).filter(nickname -> nickname != null && !nickname.equals("未公开昵称"))
          .findFirst().orElse("未公开昵称");
      int agent = (int) entries.stream().filter(e -> e.agentSource() != null).count();
      boolean lowerBound = entries.stream().anyMatch(e -> e.submissionSource().equals("WATCHER"));
      items.add(new Candidate(userId, name, competitions, stages, submissions, top, wins, awardKnown, agent,
          score, entries, rankKnown, lowerBound));
    });
    items.sort(Comparator.comparingDouble(Candidate::score).reversed()
        .thenComparing(Comparator.comparingLong(Candidate::submissions).reversed()).thenComparing(Candidate::userId));

    List<ContestResult> contests = snapshots.stream().map(s -> {
      Contest c = s.contest();
      long participants = s.totalParticipants() != null ? s.totalParticipants() : s.standings().size();
      return new ContestResult(c.id(), c.title(), c.sourceUrl(), c.endedAt(), participants, s.awardsSource(),
          s.sampledAt(), c.origin(), c.status(), c.organization(), s.observations().size(),
          s.totalSubmissions(), c.rankAccess(), s.summarySampledAt());
    }).toList();
    Instant refreshed = contests.stream().flatMap(c -> java.util.stream.Stream.of(c.sampledAt(), c.summarySampledAt()))
        .filter(at -> at != null).max(Comparator.naturalOrder()).orElse(null);
    int publicRanks = (int) contests.stream().filter(c -> c.sampledAt() != null).count();
    int awardsCovered = (int) contests.stream().filter(c -> c.awardsSource() != null).count();
    int observed = (int) snapshots.stream().filter(s -> !s.observations().isEmpty()).count();
    int personal = (int) snapshots.stream().filter(s -> !s.observations().isEmpty()
        || ("INDIVIDUAL".equals(s.contest().organization()) && !s.standings().isEmpty())).count();
    int totals = (int) contests.stream().filter(c -> c.totalSubmissions() != null).count();
    return new Response(refreshed, contests.size(), publicRanks, awardsCovered, items, contests, observed, personal, totals);
  }

  private void addEvidence(Snapshot snapshot, Map<Key,String> agentEvidence, Map<String,List<Evidence>> byUser) {
    Contest contest = snapshot.contest();
    boolean individuallyRanked = "INDIVIDUAL".equals(contest.organization());
    Map<String,Standing> official = new LinkedHashMap<>();
    snapshot.standings().forEach(row -> official.put(row.userId(), row));
    Map<String,Observation> local = new LinkedHashMap<>();
    snapshot.observations().forEach(row -> local.put(row.userId(), row));
    var users = new java.util.LinkedHashSet<>(local.keySet());
    if (individuallyRanked) users.addAll(official.keySet());
    var winners = new HashSet<>(snapshot.winners());
    for (String user : users) {
      Observation observation = local.get(user);
      Standing personal = individuallyRanked ? official.get(user) : null;
      Standing team = "TEAM".equals(contest.organization()) && observation != null && observation.teamIds().size() == 1
          ? official.get(observation.teamIds().getFirst()) : null;
      Standing ranked = personal == null ? team : personal;
      int seen = observation == null ? 0 : observation.submissions();
      int reported = personal == null ? 0 : personal.submissions();
      int submissions = Math.max(seen, reported);
      if (submissions == 0) continue;
      String name = personal != null ? personal.nickname() : observation.nickname();
      boolean ended = "ENDED".equals(contest.status());
      Boolean won = ended && snapshot.awardsSource() != null ? winners.contains(user) : null;
      boolean finalRank = ranked != null && ended && contest.endedAt() != null && snapshot.sampledAt() != null
          && !snapshot.sampledAt().isBefore(contest.endedAt());
      Entry entry = new Entry(contest.id(), contest.title(), contest.sourceUrl(), submissions,
          ranked == null ? null : ranked.rank(), snapshot.standings().size(),
          won, won == null ? null : snapshot.awardsSource(), agentEvidence.get(new Key(contest.id(), user)),
          observation == null ? null : seen, personal != null && reported >= seen ? "OFFICIAL" : "WATCHER",
          ranked == null ? null : personal != null ? "INDIVIDUAL" : "TEAM", contest.status(), finalRank);
      byUser.computeIfAbsent(user, ignored -> new ArrayList<>()).add(new Evidence(contest, name, entry));
    }
  }
}
