import { useEffect, useMemo, useState } from 'react'
import { ChevronDown, ChevronUp, RefreshCw, Search } from 'lucide-react'
import {
  Button,
  Chip,
  Empty,
  Input,
  LoadingRows,
  PagedRows,
  SelectField,
  Timestamp,
} from '../ui'
import { api } from '../api'
import { isAbortError } from '../useResource'
import type {
  ParticipationFilters as Filters,
  ParticipationItem,
  ParticipationResponse,
  SelectedUser,
} from '../types'
import './participation.css'

type Mode = Filters['mode']

const initialFilters: Filters = {
  minimumContests: 2,
  minimumSubmissions: 100,
  topN: 10,
  mode: 'rank',
  agentOnly: false,
}

const formatter = new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 2 })
const number = (value: number | undefined | null) =>
  value == null ? '—' : formatter.format(value)

export default function ParticipationView({
  onSelectUser,
}: {
  onSelectUser: (user: SelectedUser) => void
}) {
  const [filters, setFilters] = useState<Filters>(initialFilters)
  const [draft, setDraft] = useState<Filters>(initialFilters)
  const [data, setData] = useState<ParticipationResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [expanded, setExpanded] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [coverageOpen, setCoverageOpen] = useState(false)
  const [coverageQuery, setCoverageQuery] = useState('')

  useEffect(() => {
    const controller = new AbortController()
    setLoading(true)
    setError('')
    api
      .participation(filters, controller.signal)
      .then((next) => {
        if (!controller.signal.aborted) {
          setData(next)
          setExpanded(null)
        }
      })
      .catch((reason) => {
        if (!isAbortError(reason) && !controller.signal.aborted)
          setError((reason as Error).message || '暂时无法加载参赛分析')
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false)
      })
    return () => controller.abort()
  }, [filters])

  const items = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return (data?.items || []).filter(
      (item) =>
        !needle ||
        `${item.nickname} ${item.userId}`.toLowerCase().includes(needle),
    )
  }, [data?.items, query])
  const maxSubmissions = Math.max(
    ...(data?.items.map((item) => item.submissions) ?? []),
    1,
  )
  const emptyMessage =
    data?.coveredContests === 0
      ? '公开总榜尚未同步'
      : filters.mode === 'awards' && data?.awardCoveredContests === 0
        ? '目前缺少可对应到 CANNJudge 账号及具体赛段的获奖名单'
        : filters.agentOnly
          ? '当前条件下没有经来源佐证的 Agent 参赛记录'
          : query
            ? '没有匹配的用户'
            : '当前条件下没有符合条件的用户'

  const apply = () => setFilters({ ...draft })
  const reset = () => {
    setDraft(initialFilters)
    setFilters(initialFilters)
  }

  return (
    <div className="panel-stack participation-page">
      <p className="participation-intro">
        汇总 CANNJudge 公开赛事与 Watcher
        历史赛段。参赛次数合并同一赛事的初赛和决赛，提交和成绩按赛段核对。
      </p>
      <form
        className="participation-filters"
        onSubmit={(event) => {
          event.preventDefault()
          apply()
        }}
      >
        <div className="participation-filter-grid">
          <label className="participation-control">
            <span>至少参赛场次</span>
            <SelectField
              value={draft.minimumContests}
              onChange={(e) =>
                setDraft({ ...draft, minimumContests: Number(e.target.value) })
              }
            >
              <option value={1}>1 场</option>
              <option value={2}>2 场</option>
              <option value={3}>3 场</option>
              <option value={4}>4 场</option>
            </SelectField>
          </label>
          <label className="participation-control">
            <span>至少提交次数</span>
            <SelectField
              value={draft.minimumSubmissions}
              onChange={(e) =>
                setDraft({
                  ...draft,
                  minimumSubmissions: Number(e.target.value),
                })
              }
            >
              <option value={0}>不限</option>
              <option value={50}>50 次</option>
              <option value={100}>100 次</option>
              <option value={200}>200 次</option>
              <option value={300}>300 次</option>
              <option value={1000}>1,000 次</option>
            </SelectField>
          </label>
          <label className="participation-control">
            <span>前列阈值</span>
            <SelectField
              disabled={draft.mode === 'awards'}
              value={draft.topN}
              onChange={(e) =>
                setDraft({ ...draft, topN: Number(e.target.value) })
              }
            >
              <option value={3}>Top 3</option>
              <option value={5}>Top 5</option>
              <option value={10}>Top 10</option>
              <option value={20}>Top 20</option>
            </SelectField>
          </label>
          <label className="participation-control">
            <span>结果口径</span>
            <SelectField
              value={draft.mode}
              onChange={(e) =>
                setDraft({ ...draft, mode: e.target.value as Mode })
              }
            >
              <option value="rank">Top N 排名</option>
              <option value="awards">官方获奖</option>
            </SelectField>
          </label>
          <label className="participation-toggle">
            <input
              type="checkbox"
              checked={draft.agentOnly}
              onChange={(e) =>
                setDraft({ ...draft, agentOnly: e.target.checked })
              }
            />
            <span>仅统计有 Agent 证据的参赛段</span>
          </label>
          <Button color="primary" type="submit">
            应用条件
          </Button>
          <Button onClick={reset}>恢复默认</Button>
        </div>
      </form>

      {loading && <LoadingRows />}
      {!loading && error && (
        <div className="error-line" role="alert">
          {error}{' '}
          <Button
            leading={<RefreshCw size={15} />}
            onClick={() => setFilters({ ...filters })}
          >
            重试
          </Button>
        </div>
      )}
      {!loading && !error && data && (
        <>
          <section
            className="participation-results"
            aria-labelledby="participation-results"
          >
            <div className="participation-toolbar">
              <div>
                <h2 id="participation-results">筛选结果</h2>
                <p>
                  {items.length} 个账号 · 公开总榜覆盖 {data.coveredContests}/
                  {data.eligibleContests} 个赛段 · 用户记录{' '}
                  {data.userCoveredContests ?? 0} 段 · Watcher 观测{' '}
                  {data.observedContests ?? 0} 段 · 有提交统计{' '}
                  {data.totalSubmissionsContests ?? 0} 段
                </p>
              </div>
              <Input
                aria-label="搜索用户"
                placeholder="搜索昵称或用户 ID"
                leading={<Search size={15} />}
                value={query}
                onValueChange={setQuery}
              />
            </div>
            {items.length === 0 ? (
              <Empty text={emptyMessage} />
            ) : (
              <PagedRows key={query} items={items} size={25}>
                {(page) => (
                  <div className="participation-list">
                    <div className="participation-columns" aria-hidden="true">
                      <span>账号</span>
                      <span>参赛场次</span>
                      <span>提交次数</span>
                      <span>
                        {filters.mode === 'awards'
                          ? '获奖赛段'
                          : `进入 Top ${filters.topN}`}
                      </span>
                      <span>筛选分</span>
                      <span />
                    </div>
                    {page.map((item) => (
                      <ParticipationRow
                        key={item.userId}
                        item={item}
                        maxSubmissions={maxSubmissions}
                        expanded={expanded === item.userId}
                        onToggle={() =>
                          setExpanded(
                            expanded === item.userId ? null : item.userId,
                          )
                        }
                        onSelect={() =>
                          onSelectUser({
                            id: item.userId,
                            nickname: item.nickname,
                            name: item.nickname || item.userId,
                          })
                        }
                        mode={filters.mode}
                        topN={filters.topN}
                      />
                    ))}
                  </div>
                )}
              </PagedRows>
            )}
          </section>
          <details className="participation-method">
            <summary>数据来源与排序口径</summary>
            <p>
              个人赛优先使用平台个人提交数。团队赛按明确的提交人统计 Watcher
              已观测的提交，个人总数带 ≥
              时表示下界。匹配到唯一队伍时显示队伍名次。
            </p>
            <p>
              只保留在已知结果中达成目标的赛段少于一半的账号。筛选分为 √参赛场次
              × ln(1 + 提交次数) × (已知未达成段数 + 1)/(已知结果段数 +
              2)。进行中的赛段计入投入，结赛后采到的总榜才计入 Top N。
            </p>
            <p>
              并列采用相同名次。获奖模式只计有完整名单且能匹配 CANNJudge
              账号的赛段。Agent 模式只计有明确来源的个人参赛段。
            </p>
            {data.refreshedAt && (
              <p>
                最近同步 <Timestamp value={data.refreshedAt} />
              </p>
            )}
          </details>
          <section className="participation-method" aria-label="全部赛段覆盖">
            <button
              type="button"
              className="participation-coverage-toggle"
              onClick={() => setCoverageOpen(!coverageOpen)}
              aria-expanded={coverageOpen}
            >
              全部赛段覆盖 <strong>{data.contests.length}</strong>
              <span>{coverageOpen ? '收起' : '展开'}</span>
            </button>
            {coverageOpen && (
              <div className="participation-coverage">
                <Input
                  aria-label="搜索赛段"
                  placeholder="搜索赛段或组织"
                  value={coverageQuery}
                  onValueChange={setCoverageQuery}
                />
                <ul>
                  {data.contests
                    .filter(
                      (contest) =>
                        !coverageQuery.trim() ||
                        `${contest.title} ${contest.organization} ${contest.origin}`
                          .toLowerCase()
                          .includes(coverageQuery.trim().toLowerCase()),
                    )
                    .map((contest) => (
                      <li key={contest.id}>
                        <span className="coverage-title">
                          {contest.sourceUrl ? (
                            <a
                              href={contest.sourceUrl}
                              target="_blank"
                              rel="noreferrer"
                            >
                              {contest.title}
                            </a>
                          ) : (
                            contest.title
                          )}
                        </span>
                        <span className="coverage-meta">
                          <Chip
                            color={
                              contest.origin === 'WATCHER'
                                ? 'primary'
                                : 'default'
                            }
                          >
                            {contest.origin === 'WATCHER'
                              ? 'Watcher'
                              : '公开赛段'}
                          </Chip>
                          <Chip>
                            {contest.status === 'ENDED'
                              ? '已结束'
                              : contest.status === 'ACTIVE'
                                ? '进行中'
                                : contest.status === 'UPCOMING'
                                  ? '未开始'
                                  : '未知状态'}
                          </Chip>
                          <Chip>
                            {contest.organization === 'TEAM'
                              ? '团队'
                              : contest.organization === 'INDIVIDUAL'
                                ? '个人'
                                : '组织未知'}
                          </Chip>
                        </span>
                        <span className="coverage-counts">
                          {contest.sampledAt
                            ? '有总榜'
                            : contest.rankAccess === 'HIDDEN'
                              ? '总榜暂未开放'
                              : contest.rankAccess === 'HISTORICAL'
                                ? '历史目录'
                                : '总榜待同步'}{' '}
                          · 观测提交者 {number(contest.observedParticipants)} ·
                          赛事总提交 {number(contest.totalSubmissions)}
                        </span>
                      </li>
                    ))}
                </ul>
              </div>
            )}
          </section>
        </>
      )}
    </div>
  )
}

function ParticipationRow({
  item,
  maxSubmissions,
  expanded,
  onToggle,
  onSelect,
  mode,
  topN,
}: {
  item: ParticipationItem
  maxSubmissions: number
  expanded: boolean
  onToggle: () => void
  onSelect: () => void
  mode: Mode
  topN: number
}) {
  return (
    <article className={`participation-row ${expanded ? 'is-expanded' : ''}`}>
      <button
        type="button"
        className="participation-row-main"
        onClick={onToggle}
        aria-expanded={expanded}
      >
        <span className="participation-identity">
          <strong>{item.nickname || item.userId}</strong>
          <small>
            {item.agentEvidenceCount > 0
              ? `${item.agentEvidenceCount} 段有 Agent 证据`
              : 'Agent 使用情况未知'}
          </small>
        </span>
        <span className="participation-metric">
          <span className="metric-label">参赛场次</span>
          <b>
            {number(item.contestCount)}
            {item.lowerBound ? ' ≥' : ''}
          </b>
        </span>
        <span className="participation-metric submission-metric">
          <span className="metric-label">提交次数</span>
          <span className="metric-bar" aria-hidden>
            <i
              style={{ width: `${(item.submissions / maxSubmissions) * 100}%` }}
            />
          </span>
          <b>{number(item.submissions)}</b>
        </span>
        <span className="participation-metric">
          <span className="metric-label">
            {mode === 'awards' ? '获奖赛段' : `进入 Top ${topN}`}
          </span>
          <b>
            {mode === 'awards' ? item.awardWins : item.topFinishes} /{' '}
            {mode === 'awards' ? item.awardKnown : item.rankKnown}
          </b>
        </span>
        <span className="participation-metric score-metric">
          <span className="metric-label">筛选分</span>
          <b>{number(item.score)}</b>
        </span>
        <span className="participation-expand" aria-hidden>
          {expanded ? <ChevronUp size={17} /> : <ChevronDown size={17} />}
        </span>
      </button>
      {expanded && (
        <div className="participation-detail">
          <div className="participation-detail-head">
            <span>逐赛段记录</span>
            <button type="button" onClick={onSelect}>
              查看用户历史 <span aria-hidden>→</span>
            </button>
          </div>
          <ul className="participation-entries">
            {item.entries.map((entry) => (
              <li className="participation-entry" key={entry.contestId}>
                {entry.sourceUrl ? (
                  <a href={entry.sourceUrl} target="_blank" rel="noreferrer">
                    {entry.title}
                  </a>
                ) : (
                  <span>{entry.title}</span>
                )}
                <span>
                  {entry.submissionSource === 'WATCHER' ? '≥ ' : ''}
                  {number(entry.submissions)} 次提交 ·{' '}
                  {entry.status === 'ACTIVE'
                    ? '进行中'
                    : entry.status === 'UPCOMING'
                      ? '未开始'
                      : entry.status === 'ENDED'
                        ? '已结束'
                        : '状态未知'}
                  <small>
                    Watcher 观测{' '}
                    {entry.observedSubmissions == null
                      ? '无记录'
                      : `${entry.observedSubmissions} 次`}
                  </small>
                </span>
                <span>
                  {entry.rank == null
                    ? '名次未知'
                    : `第 ${number(entry.rank)} 名 / ${number(entry.participants)}`}
                  {entry.rank != null && (
                    <small>
                      {entry.rankSource === 'TEAM' ? '团队排名' : '个人排名'}
                      {entry.finalRank ? '' : ' · 阶段快照'}
                    </small>
                  )}
                </span>
                {entry.awardSource ? (
                  <a href={entry.awardSource} target="_blank" rel="noreferrer">
                    <Chip color={entry.award ? 'success' : 'default'}>
                      {entry.award ? '已获奖' : '未获奖'}
                    </Chip>
                  </a>
                ) : (
                  <span>获奖未知</span>
                )}
                {entry.agentSource ? (
                  <a href={entry.agentSource} target="_blank" rel="noreferrer">
                    Agent 来源
                  </a>
                ) : (
                  <span>Agent 未知</span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </article>
  )
}
