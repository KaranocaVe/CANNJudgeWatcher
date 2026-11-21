package cn.cannjudge.watcher.web;

import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.util.Map;
import java.time.Duration;
import java.time.Instant;
import java.util.concurrent.ConcurrentHashMap;
import org.springframework.http.HttpStatus;
import org.springframework.web.server.ResponseStatusException;
import org.springframework.security.authentication.AuthenticationManager;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.web.context.HttpSessionSecurityContextRepository;
import org.springframework.security.web.csrf.CsrfToken;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/auth")
public class AuthController {
  private final AuthenticationManager authenticationManager;
  private final HttpSessionSecurityContextRepository contextRepository = new HttpSessionSecurityContextRepository();
  private final Map<String, Attempt> failures = new ConcurrentHashMap<>();
  public AuthController(AuthenticationManager authenticationManager) { this.authenticationManager = authenticationManager; }

  @GetMapping("/csrf")
  public Map<String,String> csrf(CsrfToken token) { return Map.of("token", token.getToken()); }

  @PostMapping("/login")
  public Map<String,Object> login(@RequestBody LoginRequest request, HttpServletRequest servletRequest, HttpServletResponse response) {
    String username = request == null || request.username() == null ? "" : request.username().trim();
    String key = servletRequest.getRemoteAddr() + ":" + username;
    Attempt attempt = failures.get(key);
    if (attempt != null && attempt.blocked()) throw new ResponseStatusException(HttpStatus.TOO_MANY_REQUESTS, "登录尝试过于频繁，请稍后再试");
    Authentication authentication;
    try {
      authentication = authenticationManager.authenticate(new UsernamePasswordAuthenticationToken(username, request == null ? null : request.password()));
      failures.remove(key);
    } catch (RuntimeException ex) {
      failures.compute(key, (ignored, old) -> old == null || old.expired() ? new Attempt(1, Instant.now()) : old.next());
      throw ex;
    }
    if (servletRequest.getSession(false) != null) servletRequest.changeSessionId();
    SecurityContextHolder.getContext().setAuthentication(authentication);
    contextRepository.saveContext(SecurityContextHolder.getContext(), servletRequest, response);
    return Map.of("authenticated", true, "username", authentication.getName());
  }

  @GetMapping("/me")
  public Map<String,Object> me(Authentication authentication) {
    return authentication == null ? Map.of("authenticated", false) : Map.of("authenticated", true, "username", authentication.getName());
  }

  public record LoginRequest(String username, String password) {}
  private record Attempt(int count, Instant firstFailure) {
    boolean expired() { return firstFailure.plus(Duration.ofMinutes(15)).isBefore(Instant.now()); }
    boolean blocked() { return !expired() && count >= 5; }
    Attempt next() { return new Attempt(count + 1, firstFailure); }
  }
}
