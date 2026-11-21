package cn.cannjudge.watcher.security;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Component;
import org.springframework.dao.DataIntegrityViolationException;

@Component
public class AdminInitializer implements ApplicationRunner {
  private final JdbcTemplate jdbc;
  private final PasswordEncoder encoder;
  private final String username;
  private final String configuredHash;
  private final String configuredPassword;

  public AdminInitializer(JdbcTemplate jdbc, PasswordEncoder encoder,
      @Value("${admin.username:admin}") String username,
      @Value("${admin.password-hash:}") String configuredHash,
      @Value("${admin.password:admin}") String configuredPassword) {
    this.jdbc = jdbc; this.encoder = encoder; this.username = username;
    this.configuredHash = configuredHash; this.configuredPassword = configuredPassword;
  }

  @Override public void run(ApplicationArguments args) {
    Integer count = jdbc.queryForObject("SELECT count(*) FROM admin_user", Integer.class);
    if (count != null && count > 0) return;
    if ((configuredHash == null || configuredHash.isBlank()) && (configuredPassword == null || configuredPassword.isBlank())) {
      throw new IllegalStateException("ADMIN_PASSWORD_HASH or ADMIN_PASSWORD must be configured before the first startup");
    }
    String hash = configuredHash == null || configuredHash.isBlank() ? encoder.encode(configuredPassword) : configuredHash;
    try {
      jdbc.update("INSERT INTO admin_user(username,password_hash) VALUES (?,?) ON CONFLICT (username) DO NOTHING", username, hash);
    } catch (DataIntegrityViolationException ex) {
      // Another application instance initialized the same database concurrently.
      if (jdbc.queryForObject("SELECT count(*) FROM admin_user", Integer.class) == 0) throw ex;
    }
  }
}
