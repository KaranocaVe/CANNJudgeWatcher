package cn.cannjudge.watcher.security;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.core.userdetails.User;
import org.springframework.security.core.userdetails.UserDetails;
import org.springframework.security.core.userdetails.UserDetailsService;
import org.springframework.security.core.userdetails.UsernameNotFoundException;
import org.springframework.stereotype.Service;

@Service
public class AdminUserDetailsService implements UserDetailsService {
  private final JdbcTemplate jdbc;
  public AdminUserDetailsService(JdbcTemplate jdbc) { this.jdbc = jdbc; }

  @Override public UserDetails loadUserByUsername(String username) {
    var rows = jdbc.query("SELECT username,password_hash,enabled FROM admin_user WHERE username=?", ps -> ps.setString(1, username),
        (rs, n) -> User.withUsername(rs.getString("username")).password(rs.getString("password_hash"))
            .roles("ADMIN").disabled(!rs.getBoolean("enabled")).build());
    if (rows.isEmpty()) throw new UsernameNotFoundException(username);
    return rows.getFirst();
  }
}
