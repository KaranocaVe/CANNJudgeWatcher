package cn.cannjudge.watcher.web;

import cn.cannjudge.watcher.model.Models;
import cn.cannjudge.watcher.repository.WatcherRepository;
import cn.cannjudge.watcher.service.PollService;
import cn.cannjudge.watcher.service.SamplingCoverage;
import java.sql.Timestamp;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;
import org.springframework.http.HttpStatus;

@RestController
@RequestMapping("/api")
public class ApiController {
  private final WatcherRepository repo;
  private final PollService polls;
  private final SamplingCoverage sampling;
  public ApiController(WatcherRepository repo, PollService polls, SamplingCoverage sampling) {
    this.repo = repo; this.polls = polls; this.sampling = sampling;
  }

  @GetMapping("/dashboard/summary")
  public Map<String,Object> dashboard() {
    Map<String,Object> summary = repo.pollSummary();
    var latest = (List<?>) summary.get("latestPoll");
    var run = latest.isEmpty() ? Map.of() : (Map<?,?>) latest.getFirst();
    Instant runningSince = "RUNNING".equals(run.get("status")) ? timestamp(run.get("started_at")) : null;
    summary.put("collectorLate", sampling.collectorLate(timestamp(summary.get("last_finished")), runningSince));
    return summary;
  }

  private Instant timestamp(Object value) { return value instanceof Timestamp time ? time.toInstant() : null; }
  @GetMapping("/contests") public List<Models.Contest> contests() { return repo.findContests(); }
  @GetMapping("/contests/{id}") public ResponseEntity<?> contest(@PathVariable String id) {
    return repo.findContest(id).map(c -> ResponseEntity.ok((Object)new LinkedHashMap<>(Map.of("contest", c, "problems", repo.findProblems(id))))).orElseGet(() -> ResponseEntity.notFound().build());
  }
  @GetMapping("/contests/{id}/problems") public List<Models.Problem> problems(@PathVariable String id) { return repo.findProblems(id); }
  @GetMapping("/rankings") public Map<String,Object> rankings(@RequestParam String contestId, @RequestParam String problemId, @RequestParam(required=false) String status, @RequestParam(defaultValue="1000") int limit) {
    List<Map<String,Object>> items=repo.currentRankings(contestId, problemId, status, limit);
    Map<String,Object> response = new LinkedHashMap<>();
    response.put("items", items);
    response.put("caseBests", repo.caseBestSummary(contestId, problemId, items));
    response.put("activeCaseSetId", repo.activeCaseSetId(contestId, problemId));
    response.put("sampling", sampling.snapshot(contestId, problemId));
    return response;
  }
  @GetMapping("/users") public List<Map<String,Object>> users() { return repo.users(); }
  @GetMapping("/user-performance") public Map<String,Object> userPerformance(@RequestParam(required=false) String userId, @RequestParam(required=false) String userNickname, @RequestParam(defaultValue="1000") int limit) { return repo.userPerformance(userId, userNickname, limit); }
  @GetMapping("/history") public Map<String,Object> history(@RequestParam String contestId, @RequestParam String problemId, @RequestParam(required=false) Instant from, @RequestParam(required=false) Instant to, @RequestParam(required=false) String teamKey, @RequestParam(defaultValue="5000") int limit) {
    Instant end=to==null?Instant.now():to; Instant start=from==null?end.minus(7, ChronoUnit.DAYS):from;
    Map<String,Object> result = new LinkedHashMap<>(); result.put("from", start); result.put("to", end); result.put("items", repo.rankingHistory(contestId,problemId,start,end,teamKey,limit));
    if (teamKey != null && !teamKey.isBlank()) result.put("caseBests", repo.caseBestSummaryForTeams(contestId, problemId, List.of(teamKey)));
    result.put("gaps", sampling.gaps(contestId, problemId, start, end));
    return result;
  }
  @GetMapping("/dashboard/contest-overview")
  public Map<String,Object> contestOverview(@RequestParam String contestId) {
    Instant to = Instant.now();
    Instant from = to.minus(7, ChronoUnit.DAYS);
    Map<String,Object> response = new LinkedHashMap<>(repo.contestOverview(contestId, from));
    response.put("from", from);
    response.put("to", to);
    response.put("sampling", sampling.snapshot(contestId, null));
    response.put("gaps", sampling.gaps(contestId, null, from, to));
    return response;
  }
  @GetMapping("/problem-stats") public Map<String,Object> stats(@RequestParam String contestId, @RequestParam String problemId, @RequestParam(required=false) Instant from, @RequestParam(required=false) Instant to) { Instant end=to==null?Instant.now():to; Instant start=from==null?end.minus(7, ChronoUnit.DAYS):from; return Map.of("items", repo.statsHistory(contestId,problemId,start,end), "gaps", sampling.gaps(contestId,problemId,start,end)); }
  @GetMapping("/alerts") public List<Models.Alert> alerts(@RequestParam(defaultValue="false") boolean openOnly, @RequestParam(required=false) String contestId, @RequestParam(required=false) String problemId, @RequestParam(defaultValue="100") int limit) { return repo.alerts(openOnly,contestId,problemId,limit); }
  @GetMapping("/polls") public List<Map<String,Object>> polls(@RequestParam(defaultValue="50") int limit) { return repo.recentPolls(limit); }
  @GetMapping("/polls/gaps")
  public List<SamplingCoverage.Gap> pollGaps() {
    Instant now = Instant.now();
    return sampling.collectorGaps(now.minus(7, ChronoUnit.DAYS), now, true);
  }

  @GetMapping("/source/health")
  public Map<String,Object> health() {
    Map<String,Object> summary = dashboard();
    List<Map<String,Object>> latest = repo.recentPolls(1);
    summary.put("healthy", !Boolean.TRUE.equals(summary.get("collectorLate"))
        && !latest.isEmpty() && "SUCCESS".equals(latest.getFirst().get("status"))
        && repo.consecutiveFailures() == 0);
    return summary;
  }

  @GetMapping("/settings") public Map<String,String> publicSettings() { return repo.settings(); }
  @PutMapping("/settings") public Map<String,String> settings(@RequestBody Map<String,String> values) { repo.updateSettings(values); return repo.settings(); }
  @PutMapping("/contests/{id}/monitoring") public Map<String,Object> monitoring(@PathVariable String id, @RequestBody MonitoringRequest request) { if (repo.findContest(id).isEmpty()) throw new ResponseStatusException(HttpStatus.NOT_FOUND, "contest not found"); repo.setMonitoring(id, request.enabled()); if (request.pollIntervalSeconds()!=null) repo.setPollInterval(id, Math.max(60, Math.min(1800, request.pollIntervalSeconds()))); return Map.of("ok",true); }
  @PostMapping("/polls/run") public Map<String,Object> runPoll() { return Map.of("accepted", polls.runNow()); }
  @PostMapping("/alerts/{id}/acknowledge") public Map<String,Object> acknowledge(@PathVariable long id) { if (!repo.alertExists(id)) throw new ResponseStatusException(HttpStatus.NOT_FOUND, "alert not found"); repo.acknowledgeAlert(id); return Map.of("ok",true); }
  public record MonitoringRequest(boolean enabled, Integer pollIntervalSeconds) {}
}
