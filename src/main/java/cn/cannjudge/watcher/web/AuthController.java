package cn.cannjudge.watcher.web;

import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.util.Map;
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
  public AuthController(AuthenticationManager authenticationManager) { this.authenticationManager = authenticationManager; }

  @GetMapping("/csrf")
  public Map<String,String> csrf(CsrfToken token) { return Map.of("token", token.getToken()); }

  @PostMapping("/login")
  public Map<String,Object> login(@RequestBody LoginRequest request, HttpServletRequest servletRequest, HttpServletResponse response) {
    Authentication authentication = authenticationManager.authenticate(new UsernamePasswordAuthenticationToken(request.username(), request.password()));
    SecurityContextHolder.getContext().setAuthentication(authentication);
    contextRepository.saveContext(SecurityContextHolder.getContext(), servletRequest, response);
    return Map.of("authenticated", true, "username", authentication.getName());
  }

  @GetMapping("/me")
  public Map<String,Object> me(Authentication authentication) {
    return authentication == null ? Map.of("authenticated", false) : Map.of("authenticated", true, "username", authentication.getName());
  }

  public record LoginRequest(String username, String password) {}
}
