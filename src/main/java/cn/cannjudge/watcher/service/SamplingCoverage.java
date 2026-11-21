package cn.cannjudge.watcher.service;

import cn.cannjudge.watcher.repository.WatcherRepository;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

@Service
public class SamplingCoverage {
  public record Sample(Instant sampledAt, int intervalSeconds) {}
  public record Gap(Instant from, Instant to, String source) {}
  public record Snapshot(Instant sampledAt, String status, boolean verified) {}

  private final WatcherRepository repo;
  private final Clock clock;
  private final long globalTolerance;

  public SamplingCoverage(WatcherRepository repo, Clock clock,
      @Value("${cannjudge.scheduler-tick-seconds:30}") long schedulerTick) {
    this.repo = repo;
    this.clock = clock;
    this.globalTolerance = Math.max(180, schedulerTick * 4);
  }

  public Snapshot snapshot(String contestId, String problemId) {
    return repo.findContest(contestId).map(contest -> {
      Instant sample = problemId == null ? null : repo.latestProblemSample(contestId, problemId);
      boolean verified = sample != null;
      // Legacy releases only recorded completion at contest granularity.
      if (problemId == null || (!verified && repo.legacyContestSample(contest.lastPollAt()))) {
        sample = contest.lastPollAt();
      }
      String status;
      if ("ENDED".equals(contest.status())) status = "ENDED";
      else if ("UPCOMING".equals(contest.status())) status = "UPCOMING";
      else if (!contest.monitoringEnabled()) status = "PAUSED";
      else if (sample == null) status = "UNOBSERVED";
      else if (stale(sample, clock.instant(), tolerance(contest.pollIntervalSeconds()))) status = "STALE";
      else status = "RECENT";
      return new Snapshot(sample, status, verified);
    }).orElse(new Snapshot(null, "UNOBSERVED", false));
  }

  public List<Gap> gaps(String contestId, String problemId, Instant from, Instant to) {
    var contest = repo.findContest(contestId);
    if (contest.isEmpty()) return List.of();
    Instant start = later(from, repo.contestCreatedAt(contestId));
    if (contest.get().startTime() != null) start = later(start, contest.get().startTime());
    boolean active = "ACTIVE".equals(contest.get().status()) && contest.get().monitoringEnabled();
    Instant end = earlier(to, clock.instant());
    if (contest.get().endTime() != null) end = earlier(end, contest.get().endTime());
    if (!start.isBefore(end)) return List.of();

    // If an automatically monitored contest ended during an outage, its final snapshot may be missing.
    boolean expectedThroughEnd = active || ("ENDED".equals(contest.get().status()) && !contest.get().manualOverride());
    if (problemId == null) return collectorGaps(start, end, expectedThroughEnd);
    List<Sample> samples = repo.problemSamples(contestId, problemId, start, end);
    if (samples.isEmpty()) return collectorGaps(start, end, expectedThroughEnd);
    Instant first = samples.getFirst().sampledAt();
    List<Gap> gaps = new ArrayList<>(collectorGaps(start, earlier(end, first), false));
    gaps.addAll(problemGaps(samples, start, end, expectedThroughEnd));
    return gaps.stream().sorted(Comparator.comparing(Gap::from)).toList();
  }

  public List<Gap> collectorGaps(Instant from, Instant to, boolean includeTail) {
    if (!from.isBefore(to)) return List.of();
    return repo.collectorGaps(from, to, globalTolerance, includeTail);
  }

  public boolean collectorLate(Instant lastFinished, Instant runningSince) {
    Instant now = clock.instant();
    return runningSince != null ? stale(runningSince, now, Math.max(600, globalTolerance))
        : lastFinished != null && stale(lastFinished, now, globalTolerance);
  }

  List<Gap> problemGaps(List<Sample> samples, Instant from, Instant to, boolean includeTail) {
    List<Gap> gaps = new ArrayList<>();
    Sample previous = null;
    for (Sample sample : samples) {
      if (previous != null && stale(previous.sampledAt(), sample.sampledAt(),
          tolerance(Math.max(previous.intervalSeconds(), sample.intervalSeconds())))) {
        addGap(gaps, previous.sampledAt(), sample.sampledAt(), from, to);
      }
      previous = sample;
    }
    if (includeTail && previous != null && stale(previous.sampledAt(), to, tolerance(previous.intervalSeconds()))) {
      addGap(gaps, previous.sampledAt(), to, from, to);
    }
    return gaps;
  }

  private void addGap(List<Gap> gaps, Instant start, Instant end, Instant from, Instant to) {
    Instant left = later(start, from);
    Instant right = earlier(end, to);
    if (left.isBefore(right)) gaps.add(new Gap(left, right, "PROBLEM"));
  }

  private long tolerance(int intervalSeconds) {
    return Math.max(2L * intervalSeconds, intervalSeconds + globalTolerance);
  }

  private static boolean stale(Instant previous, Instant now, long seconds) {
    return Duration.between(previous, now).compareTo(Duration.ofSeconds(seconds)) > 0;
  }

  private static Instant later(Instant a, Instant b) { return a.isAfter(b) ? a : b; }
  private static Instant earlier(Instant a, Instant b) { return a.isBefore(b) ? a : b; }
}
