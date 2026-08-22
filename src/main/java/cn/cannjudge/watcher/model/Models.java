package cn.cannjudge.watcher.model;

import java.time.Instant;
import java.util.List;
import java.util.Map;

public final class Models {
  private Models() {}

  public record Contest(String id, String slug, String title, String description, Instant startTime,
      Instant endTime, boolean sourceOngoing, String sourceStatus, String status,
      boolean monitoringEnabled, boolean manualOverride, int pollIntervalSeconds,
      Instant lastSeenAt, Instant lastPollAt, int problemCount) {}

  public record Problem(String id, String contestId, String slug, String title, Integer difficulty, List<String> tags) {}

  public record Ranking(String contestId, String problemId, String teamKey, String teamId, String teamName,
      String userId, String userNickname, String submitterId, String submitterNickname, String submissionId,
      Integer rank, String status, Instant createTime, List<Map<String,Object>> result,
      Instant observedAt, Integer previousRank) {}

  public record Stats(String contestId, String problemId, int attemptCount, int passUserCount, int passCount,
      int wrongCount, int failCount, int submissionCount, Instant observedAt) {}

  public record Alert(long id, Instant createdAt, Instant acknowledgedAt, String ruleCode, String severity,
      String contestId, String problemId, String teamKey, String title, String message,
      Map<String,Object> evidence) {}
}
