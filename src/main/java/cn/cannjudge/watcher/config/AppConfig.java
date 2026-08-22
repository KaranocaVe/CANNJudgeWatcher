package cn.cannjudge.watcher.config;

import java.time.Clock;
import java.time.Duration;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.http.client.JdkClientHttpRequestFactory;
import org.springframework.web.client.RestClient;

@Configuration
public class AppConfig {
  @Bean
  Clock clock() { return Clock.systemUTC(); }

  @Bean
  RestClient restClient(
      @Value("${cannjudge.base-url}") String baseUrl,
      @Value("${cannjudge.request-timeout-seconds:20}") long timeoutSeconds) {
    var http = java.net.http.HttpClient.newBuilder()
        .connectTimeout(Duration.ofSeconds(timeoutSeconds)).build();
    var factory = new JdkClientHttpRequestFactory(http);
    factory.setReadTimeout(Duration.ofSeconds(timeoutSeconds));
    return RestClient.builder().baseUrl(baseUrl).requestFactory(factory)
        .defaultHeader("Accept", "application/json")
        .defaultHeader("User-Agent", "CANNJudgeWatcher/0.1 (+public leaderboard monitor)")
        .build();
  }
}
