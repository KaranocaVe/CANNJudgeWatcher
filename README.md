# CANNJudge Watcher

CANNJudge Watcher 是一个面向公开赛事的榜单监控与分析平台：自动发现公开且未结束的赛事，按周期采集题目排名，将变化写入无损事件历史，并提供排名、稳定性能分、测试点耗时、采集健康度和站内告警。前端采用 React + TypeScript + HeroUI（Tailwind CSS 4 官方主题链路）+ Apache ECharts，布局以紧凑监控控制台为中心。

## 本地开发

要求：Java 21+、Maven 3.9+、Node.js 22+、PostgreSQL 16+。

```bash
# 后端
cp .env.example .env
mvn spring-boot:run

# 前端（另一个终端）
cd frontend
npm install
npm run dev
```

前端开发地址为 http://localhost:5173，默认代理到 http://localhost:8080。

## Docker Compose

```bash
cp .env.example .env
docker compose up -d --build
```

打开 http://localhost:8088。数据库迁移由 Flyway 在后端启动时自动执行。首次启动会用 `ADMIN_USERNAME` 与 `ADMIN_PASSWORD_HASH` 初始化单管理员；如果没有提供哈希，则将 `ADMIN_PASSWORD` 进行 BCrypt 哈希后保存。

## 数据与采集

采集器只读取 CANNJudge 公开接口，不执行提交、报名或账号管理操作。每轮采集会记录 `poll_run`；只有榜单行首次出现或标准化内容变化时才写入 `ranking_event`，当前值保存在 `ranking_current`。源站总分不参与存储、排序或变化判定；稳定性能分以每个 case 首次完整观测中记录的最佳有效耗时 `T₀` 为永久参考，单 case 取 `min(100, 100 × T₀ / t)`，未通过 case 计 0，再取均值。参考值永不因后续队伍变快而改写，因此历史分数可稳定比较。

默认采集间隔为 120 秒，可在设置中对赛事停用/启用；管理员也可以手工触发一次采集。公开榜单和分析页面无需登录，设置、确认告警和手工采集需要管理员会话。

## 前端功能

- 最新榜单：赛题、状态和队伍搜索，稳定性能分分布图，队伍点击进入趋势。
- 概览：赛题分布、在榜/通过/变化/告警统计。
- 队伍趋势：按 24 小时、7 天或 30 天查看稳定性能分与排名曲线。
- 异常信号：自动分级的站内告警、原始变化证据和冷却去重，不要求人工确认。
- 采集运行：采集状态、行数、变化量和错误信息时间线。
- 管理设置：管理员登录、赛事监控开关、全局间隔/冷却设置和立即采集。

## 检查

```bash
mvn test
cd frontend && npm run build
cd .. && docker compose config -q
```

真实源接口是未公开稳定契约，采集器会校验 HTTP 和 JSON 结构，并把失败记录到采集时间线与告警中心。
