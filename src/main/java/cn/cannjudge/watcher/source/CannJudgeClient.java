package cn.cannjudge.watcher.source;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import org.springframework.http.HttpStatusCode;
import org.springframework.stereotype.Component;
import org.springframework.web.client.RestClient;
import org.springframework.web.client.RestClientResponseException;

@Component
public class CannJudgeClient {
  private final RestClient client;
  private final ObjectMapper mapper;

  public CannJudgeClient(RestClient client, ObjectMapper mapper) { this.client = client; this.mapper = mapper; }

  public JsonNode publicGroup() { return get("/api/groups/public"); }

  public List<JsonNode> contests(String groupId) {
    JsonNode node = get("/api/contests/group/" + groupId);
    List<JsonNode> result = new ArrayList<>();
    if (node.isArray()) node.forEach(result::add);
    return result;
  }

  public JsonNode problem(String problemId) { return get("/api/problems/" + problemId); }

  public JsonNode ranking(String problemId, int page, int size) {
    return client.get().uri(uri -> uri.path("/api/problems/{id}/ranking").queryParam("page", page).queryParam("size", size).build(problemId))
        .retrieve().onStatus(HttpStatusCode::isError, (req, res) -> { throw new SourceException("ranking HTTP " + res.getStatusCode()); })
        .body(JsonNode.class);
  }

  public JsonNode stats(String contestId) {
    return client.get().uri(uri -> uri.path("/api/submissions/contest/{id}/stats").queryParam("group", "problem").build(contestId))
        .retrieve().onStatus(HttpStatusCode::isError, (req, res) -> { throw new SourceException("stats HTTP " + res.getStatusCode()); })
        .body(JsonNode.class);
  }

  private JsonNode get(String path) {
    try {
      JsonNode body = client.get().uri(path).retrieve()
          .onStatus(HttpStatusCode::isError, (req, res) -> { throw new SourceException(path + " HTTP " + res.getStatusCode()); })
          .body(JsonNode.class);
      if (body == null) throw new SourceException(path + " returned empty body");
      return body;
    } catch (RestClientResponseException e) { throw new SourceException(path + " HTTP " + e.getStatusCode(), e); }
  }

  public static Instant instant(JsonNode value) {
    if (value == null || value.isNull() || value.asText().isBlank()) return null;
    try { return Instant.parse(value.asText()); } catch (Exception e) { return null; }
  }

  public static String text(JsonNode node, String field) {
    JsonNode value = node == null ? null : node.get(field);
    return value == null || value.isNull() ? null : value.asText();
  }

  public static class SourceException extends RuntimeException {
    public SourceException(String message) { super(message); }
    public SourceException(String message, Throwable cause) { super(message, cause); }
  }
}
