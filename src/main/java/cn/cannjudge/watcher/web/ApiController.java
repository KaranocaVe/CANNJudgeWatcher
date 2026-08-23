package cn.cannjudge.watcher.web;

import cn.cannjudge.watcher.model.Models;
import cn.cannjudge.watcher.repository.WatcherRepository;
import cn.cannjudge.watcher.service.PollService;
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

@RestController
@RequestMapping("/api")
public class ApiController {
  private final WatcherRepository repo;
  private final PollService polls;
  public ApiController(WatcherRepository repo, PollService polls) { this.repo = repo; this.polls = polls; }

  @GetMapping("/dashboard/summary") public Map<String,Object> dashboard() { return repo.pollSummary(); }
  @GetMapping("/contests") public List<Models.Contest> contests() { return repo.findContests(); }
  @GetMapping("/contests/{id}") public ResponseEntity<?> contest(@PathVariable String id) {
    return repo.findContest(id).map(c -> ResponseEntity.ok((Object)new LinkedHashMap<>(Map.of("contest", c, "problems", repo.findProblems(id))))).orElseGet(() -> ResponseEntity.notFound().build());
  }
  @GetMapping("/contests/{id}/problems") public List<Models.Problem> problems(@PathVariable String id) { return repo.findProblems(id); }
  @GetMapping("/rankings") public Map<String,Object> rankings(@RequestParam String contestId, @RequestParam String problemId, @RequestParam(required=false) String status, @RequestParam(defaultValue="1000") int limit) { List<Map<String,Object>> items=repo.currentRankings(contestId, problemId, status, limit); return Map.of("items", items, "caseBests", repo.caseBestSummary(contestId, problemId, items)); }
  @GetMapping("/history") public Map<String,Object> history(@RequestParam String contestId, @RequestParam String problemId, @RequestParam(required=false) Instant from, @RequestParam(required=false) Instant to, @RequestParam(required=false) String teamKey) {
    Instant end=to==null?Instant.now():to; Instant start=from==null?end.minus(7, ChronoUnit.DAYS):from;
    Map<String,Object> result = new LinkedHashMap<>(); result.put("from", start); result.put("to", end); result.put("items", repo.rankingHistory(contestId,problemId,start,end,teamKey));
    if (teamKey != null && !teamKey.isBlank()) result.put("caseBests", repo.caseBestSummaryForTeams(contestId, problemId, List.of(teamKey)));
    return result;
  }
  @GetMapping("/dashboard/contest-overview") public Map<String,Object> contestOverview(@RequestParam String contestId) { return repo.contestOverview(contestId, Instant.now().minus(7, ChronoUnit.DAYS)); }
  @GetMapping("/problem-stats") public Map<String,Object> stats(@RequestParam String contestId, @RequestParam String problemId, @RequestParam(required=false) Instant from, @RequestParam(required=false) Instant to) { Instant end=to==null?Instant.now():to; Instant start=from==null?end.minus(7, ChronoUnit.DAYS):from; return Map.of("items",repo.statsHistory(contestId,problemId,start,end)); }
  @GetMapping("/alerts") public List<Models.Alert> alerts(@RequestParam(defaultValue="false") boolean openOnly, @RequestParam(required=false) String contestId, @RequestParam(required=false) String problemId, @RequestParam(defaultValue="100") int limit) { return repo.alerts(openOnly,contestId,problemId,limit); }
  @GetMapping("/polls") public List<Map<String,Object>> polls(@RequestParam(defaultValue="50") int limit) { return repo.recentPolls(limit); }
  @GetMapping("/source/health") public Map<String,Object> health() { Map<String,Object> m = new LinkedHashMap<>(repo.pollSummary()); m.put("healthy", repo.consecutiveFailures() == 0); return m; }

  @GetMapping("/settings") public Map<String,String> publicSettings() { return repo.settings(); }
  @PutMapping("/settings") public Map<String,String> settings(@RequestBody Map<String,String> values) { repo.updateSettings(values); return repo.settings(); }
  @PutMapping("/contests/{id}/monitoring") public Map<String,Object> monitoring(@PathVariable String id, @RequestBody MonitoringRequest request) { repo.setMonitoring(id, request.enabled()); if (request.pollIntervalSeconds()!=null) repo.setPollInterval(id, Math.max(60, Math.min(1800, request.pollIntervalSeconds()))); return Map.of("ok",true); }
  @PostMapping("/polls/run") public Map<String,Object> runPoll() { return Map.of("accepted", polls.runNow()); }
  @PostMapping("/alerts/{id}/acknowledge") public Map<String,Object> acknowledge(@PathVariable long id) { repo.acknowledgeAlert(id); return Map.of("ok",true); }
  public record MonitoringRequest(boolean enabled, Integer pollIntervalSeconds) {}
}
