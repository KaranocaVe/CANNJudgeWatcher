package cn.cannjudge.watcher;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.scheduling.annotation.EnableScheduling;

@SpringBootApplication
@EnableScheduling
public class CANNJudgeWatcherApplication {
  public static void main(String[] args) {
    SpringApplication.run(CANNJudgeWatcherApplication.class, args);
  }
}
