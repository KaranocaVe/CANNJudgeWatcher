package cn.cannjudge.watcher.web;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.web.context.HttpSessionSecurityContextRepository;

class AuthControllerTest {
  @AfterEach
  void clearContext() { SecurityContextHolder.clearContext(); }

  @Test
  void loginCreatesSessionForNewVisitor() {
    var controller = new AuthController(authentication ->
        UsernamePasswordAuthenticationToken.authenticated(authentication.getPrincipal(), null, java.util.List.of()));
    var request = new MockHttpServletRequest();
    var response = new MockHttpServletResponse();

    assertThat(controller.login(new AuthController.LoginRequest("admin", "password"), request, response))
        .containsEntry("authenticated", true);
    assertThat(request.getSession(false)).isNotNull();
    assertThat(request.getSession(false).getAttribute(HttpSessionSecurityContextRepository.SPRING_SECURITY_CONTEXT_KEY))
        .isNotNull();
  }
}
