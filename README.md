# CANNJudge Watcher

CANNJudge Watcher 是一个面向公开赛事的榜单监控与分析平台：自动发现公开且未结束的赛事，按周期采集题目排名，将变化写入无损事件历史，并提供官方名次、逐测试点耗时、采集健康度和站内告警。前端采用 React、TypeScript 和按需加载的 Apache ECharts。榜单和测试点历史按页渲染，宽表可横向滚动并固定标识列。

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

打开 http://localhost:8088。数据库迁移由 Flyway 在后端启动时自动执行。首次启动会用 `ADMIN_USERNAME` 与 `ADMIN_PASSWORD_HASH` 初始化单管理员；如果没有提供哈希，则将 `ADMIN_PASSWORD` 进行 BCrypt 哈希后保存。首次启动必须显式设置其中一个密码变量，系统不会使用内置默认密码。

## 数据与采集

采集器只读取 CANNJudge 公开接口，不执行提交、报名或账号管理操作。每轮采集会记录 `poll_run`；只有榜单行首次出现或标准化内容变化时才写入 `ranking_event`，当前值保存在 `ranking_current`。榜单只展示源站给出的官方名次；不保存或合成任何总分。因为公开接口没有完整公开官方总分的基准与并列细则，性能分析以逐测试点的耗时、状态、历史最佳和相邻观测变化为准。

每次成功读取一张完整榜单都会记下赛题采样，包括空榜和无变化的榜单。趋势图会标出缺采区间并断开折线，榜单保留最后一次快照。旧数据按全站运行日志推断可见的采集缺口，无法还原停机期间的提交与名次。

默认采集间隔为 120 秒，可在设置中对赛事停用/启用；管理员也可以手工触发一次采集。公开榜单和分析页面无需登录，设置、确认告警和手工采集需要管理员会话。

## 前端功能

- 最新榜单：按赛题查看官方名次和单个测试点的队伍耗时。通过耗时共用微秒对数轴，展开队伍可原位比较上次和本次读数。支持队伍搜索、状态筛选和矩阵比较。点开队伍可查看每个测试点的本次结果、个人与全场历史最佳、相邻观测变化，再进入用户历史。
- 概览：赛题分布、在榜/通过/变化/告警统计。
- 队伍趋势：按 24 小时、7 天或 30 天查看官方名次曲线，以及逐 case 耗时、历史最佳和相邻变化。
- 异常信号：自动分级的站内告警、原始变化证据和冷却去重，不要求人工确认。
- 采集运行：采集状态、行数、变化量和错误信息时间线。
- 管理设置：管理员登录、赛事监控开关、全局间隔/冷却设置和立即采集。

## 参赛分析

公开个人赛总榜在后端启动后同步，之后每六小时检查一次。管线以 CANNJudge 用户 ID 关联不同赛段，并用 Watcher 历史中的去重提交 ID 显示已观测次数。总提交数来自平台总榜，监控停机不会扣减该数值。以源站标识合并同地区赛事的初赛和决赛。筛选阈值、名次口径和覆盖情况见页面。

管理员可通过以下接口补充已经核验的公开来源。写入与删除须带管理员会话和 `X-XSRF-TOKEN`。

| 方法与路径 | 请求体 |
| --- | --- |
| `PUT /api/participation/evidence/{contestId}/awards` | `{"sourceUrl":"https://…","winnerIds":["CANNJudge 用户 ID"]}` |
| `PUT /api/participation/evidence/{contestId}/agent/{userId}` | `{"sourceUrl":"https://…"}` |
| 同一资源的 `DELETE` | 无 |

获奖来源须覆盖整个赛段，`winnerIds` 写入已对应到 CANNJudge 的完整获奖用户 ID。Agent 来源须明确对应用户、赛段和使用情况，例如参赛者公开自述。两项证据按各自覆盖的赛段计算。

## 检查

```bash
mvn test
cd frontend && npm run build
cd .. && docker compose config -q
```

真实源接口是未公开稳定契约，采集器会校验 HTTP 和 JSON 结构，并把失败记录到采集时间线与告警中心。
