package cn.cannjudge.watcher.analysis;

import java.net.URI;
import java.util.List;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;

@RestController
@RequestMapping("/api/participation")
public class ParticipationController {
  private final ParticipationService service;
  private final ParticipationRepository repo;

  public ParticipationController(ParticipationService service, ParticipationRepository repo) {
    this.service = service;
    this.repo = repo;
  }

  @GetMapping
  ParticipationService.Response analyze(@RequestParam(defaultValue="2") int minimumContests,
      @RequestParam(defaultValue="100") int minimumSubmissions, @RequestParam(defaultValue="10") int topN,
      @RequestParam(defaultValue="rank") String mode, @RequestParam(defaultValue="false") boolean agentOnly) {
    if (minimumContests < 1 || minimumSubmissions < 0 || topN < 1 || topN > 1000
        || (!mode.equals("rank") && !mode.equals("awards"))) {
      throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "筛选条件无效");
    }
    return service.analyze(minimumContests, minimumSubmissions, topN, "awards".equals(mode), agentOnly);
  }

  public record Awards(String sourceUrl, List<String> winnerIds) {}
  public record AgentEvidence(String sourceUrl) {}

  @PutMapping("/evidence/{contestId}/awards")
  @ResponseStatus(HttpStatus.NO_CONTENT)
  void awards(@PathVariable String contestId, @RequestBody Awards awards) {
    List<String> winners = awards.winnerIds();
    if (winners == null || winners.size() > 10_000 ||
        winners.stream().anyMatch(id -> id == null || id.isBlank() || id.length() > 120)) {
      throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "获奖用户 ID 无效");
    }
    if (!repo.saveAwards(contestId, sourceUrl(awards.sourceUrl()), winners.stream().distinct().toList())) {
      throw new ResponseStatusException(HttpStatus.NOT_FOUND, "赛事不在分析范围内");
    }
  }

  @PutMapping("/evidence/{contestId}/agent/{userId}")
  @ResponseStatus(HttpStatus.NO_CONTENT)
  void agent(@PathVariable String contestId, @PathVariable String userId, @RequestBody AgentEvidence evidence) {
    if (!repo.saveAgentEvidence(contestId, userId, sourceUrl(evidence.sourceUrl()))) {
      throw new ResponseStatusException(HttpStatus.NOT_FOUND, "赛事未收录该用户");
    }
  }

  @DeleteMapping("/evidence/{contestId}/awards")
  @ResponseStatus(HttpStatus.NO_CONTENT)
  void deleteAwards(@PathVariable String contestId) { repo.deleteAwards(contestId); }

  @DeleteMapping("/evidence/{contestId}/agent/{userId}")
  @ResponseStatus(HttpStatus.NO_CONTENT)
  void deleteAgent(@PathVariable String contestId, @PathVariable String userId) {
    repo.deleteAgentEvidence(contestId, userId);
  }

  private static String sourceUrl(String raw) {
    if (raw != null && raw.length() <= 2048) {
      try {
        URI uri = URI.create(raw);
        if ("https".equalsIgnoreCase(uri.getScheme()) && uri.getHost() != null && uri.getUserInfo() == null) {
          return uri.toASCIIString();
        }
      } catch (IllegalArgumentException ignored) { }
    }
    throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "来源须为公开的 HTTPS 链接");
  }
}
