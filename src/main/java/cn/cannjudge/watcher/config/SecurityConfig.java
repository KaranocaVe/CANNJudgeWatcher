package cn.cannjudge.watcher.config;

import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.config.http.SessionCreationPolicy;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.security.web.SecurityFilterChain;
import org.springframework.security.web.csrf.CookieCsrfTokenRepository;
import org.springframework.security.web.csrf.CsrfTokenRequestAttributeHandler;

@Configuration
public class SecurityConfig {
  @Bean
  PasswordEncoder passwordEncoder() { return new BCryptPasswordEncoder(); }

  @Bean
  SecurityFilterChain securityFilterChain(HttpSecurity http) throws Exception {
    var csrf = CookieCsrfTokenRepository.withHttpOnlyFalse();
    var handler = new CsrfTokenRequestAttributeHandler();
    handler.setCsrfRequestAttributeName(null);
    http
      .csrf(c -> c.csrfTokenRepository(csrf).csrfTokenRequestHandler(handler)
          .ignoringRequestMatchers("/api/auth/login", "/actuator/**"))
      .sessionManagement(s -> s.sessionCreationPolicy(SessionCreationPolicy.IF_REQUIRED))
      .authorizeHttpRequests(a -> a
          .requestMatchers("/api/settings/**", "/api/polls/run", "/api/alerts/*/acknowledge", "/api/contests/*/monitoring").authenticated()
          .requestMatchers("/", "/index.html", "/assets/**", "/favicon.ico", "/api/auth/**", "/api/dashboard/**",
              "/api/contests", "/api/contests/*", "/api/contests/*/problems", "/api/rankings/**", "/api/history/**", "/api/problem-stats/**",
              "/api/users", "/api/users/**", "/api/user-performance", "/api/alerts", "/api/polls", "/api/polls/gaps", "/api/source/health", "/actuator/health").permitAll()
          .anyRequest().denyAll())
      .formLogin(f -> f.disable())
      .httpBasic(b -> b.disable())
      .logout(l -> l.logoutUrl("/api/auth/logout").deleteCookies("JSESSIONID").invalidateHttpSession(true)
          .logoutSuccessHandler((request, response, authentication) -> response.setStatus(204)));
    return http.build();
  }
}
