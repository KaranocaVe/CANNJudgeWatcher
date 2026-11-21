import { useCallback, useDeferredValue, useMemo, useState } from 'react'
import {
  Check,
  Clock3,
  ListOrdered,
  Percent,
  RefreshCw,
  Search,
} from 'lucide-react'
import { api } from '../api'
import {
  caseDeltaClass,
  caseDeltaText,
  caseKey,
  caseSetForKey,
  caseVersionLabel,
  teamLabel,
  timeValue,
} from '../domain'
import { formatMetric, statusLabel } from '../format'
import type { CaseBestSummary, Contest, Problem, SelectedUser } from '../types'
import {
  Button,
  DataTable,
  Empty,
  Input,
  LoadingRows,
  PagedRows,
  Panel,
  SelectField,
  StatCard,
  Status,
  Timestamp,
} from '../ui'
import { useResource } from '../useResource'

type Props = {
  contest: Contest
  problems: Problem[]
  problemId: string
  onProblemChange: (id: string) => void
  onUserSelect: (user: SelectedUser) => void
}

function RankMovement({
  rank,
  previous,
}: {
  rank?: number
  previous?: number
}) {
  if (rank == null || previous == null || rank === previous) return null
  const improved = previous > rank
  const delta = Math.abs(previous - rank)
  return (
    <span
      className={`rank-movement ${improved ? 'metric-up' : 'metric-down'}`}
      title={`上一条记录 #${previous}`}
      aria-label={`名次${improved ? '上升' : '下降'} ${delta} 位`}
    >
      {improved ? '↑' : '↓'} {delta}
    </span>
  )
}

const EMPTY_BESTS: CaseBestSummary = { global: {}, teams: {} }
const intervalMs = 60_000

export default function RankingView({
  contest,
  problems,
  problemId,
  onProblemChange,
  onUserSelect,
}: Props) {
  const [status, setStatus] = useState('')
  const [query, setQuery] = useState('')
  const [allVersionsFor, setAllVersionsFor] = useState('')
  const deferredQuery = useDeferredValue(query.trim().toLowerCase())
  const fetchRankings = useCallback(
    (signal: AbortSignal) => api.rankings(contest.id, problemId, {}, signal),
    [contest.id, problemId],
  )
  const { data, pending, error, refresh } = useResource(
    problemId || undefined,
    fetchRankings,
    contest.monitoringEnabled ? intervalMs : undefined,
  )
  const activeSet = data?.activeCaseSetId
  const bests = data?.caseBests ?? EMPTY_BESTS
  const model = useMemo(() => {
    const rows = data?.items ?? []
    const cases = new Set<string>()
    let passing = 0
    let updated: string | undefined
    const statuses = new Set<string>()
    const indexed = rows.map((row) => {
      if (row.status) statuses.add(row.status)
      if (row.status === 'Pass') passing++
      const at = row.updated_at || row.observed_at
      if (at && (!updated || Date.parse(updated) < Date.parse(at))) updated = at
      const current = new Map(
        (row.result ?? []).map((item, index) => [caseKey(item, index), item]),
      )
      current.forEach((_, key) => cases.add(key))
      const previous = new Map(
        (row.previous_result ?? []).map((item, index) => [
          caseKey(item, index),
          item,
        ]),
      )
      return {
        row,
        current,
        previous,
        search: [row.team_name, row.submitter_nickname, row.user_nickname]
          .join(' ')
          .toLowerCase(),
      }
    })
    Object.keys(bests.global).forEach((key) => cases.add(key))
    const allCases = Array.from(cases)
    const activeCases = activeSet
      ? allCases.filter((key) => caseSetForKey(key) === activeSet)
      : allCases
    return {
      indexed,
      allCases,
      activeCases,
      passing,
      updated,
      statuses: Array.from(statuses),
    }
  }, [data, activeSet, bests])

  const selectedStatus = model.statuses.includes(status) ? status : ''
  const filtered = useMemo(
    () =>
      model.indexed.filter(
        ({ row, search }) =>
          (!selectedStatus || row.status === selectedStatus) &&
          (!deferredQuery || search.includes(deferredQuery)),
      ),
    [model.indexed, selectedStatus, deferredQuery],
  )
  const allVersions = allVersionsFor === problemId
  const cases = allVersions ? model.allCases : model.activeCases

  if (!problems.length)
    return (
      <Panel>
        <Empty text="这场赛事暂无公开题目" />
      </Panel>
    )

  return (
    <div className="panel-stack">
      <div className="stat-grid">
        <StatCard
          icon={ListOrdered}
          label="在榜队伍"
          value={data ? model.indexed.length : '—'}
        />
        <StatCard
          icon={Check}
          label="通过队伍"
          value={data ? model.passing : '—'}
        />
        <StatCard
          icon={Percent}
          label="通过率"
          value={
            model.indexed.length
              ? `${Math.round((model.passing / model.indexed.length) * 100)}%`
              : '—'
          }
        />
        <StatCard
          icon={Clock3}
          label="榜单最近更新"
          value={<Timestamp value={model.updated} />}
        />
      </div>
      <Panel className="ranking-card">
        <div className="ranking-heading">
          <div>
            <h2>赛题榜单</h2>
            <span>
              {data
                ? `${filtered.length} 支队伍 · ${cases.length} 个测试点`
                : '逐测试点成绩'}
            </span>
          </div>
          {activeSet && model.allCases.length > model.activeCases.length && (
            <div className="segmented" role="group" aria-label="测试点版本">
              <button
                type="button"
                aria-pressed={!allVersions}
                onClick={() => setAllVersionsFor('')}
              >
                当前版本
              </button>
              <button
                type="button"
                aria-pressed={allVersions}
                onClick={() => setAllVersionsFor(problemId)}
              >
                全部版本
              </button>
            </div>
          )}
        </div>
        <div className="toolbar ranking-tools">
          <SelectField
            aria-label="选择题目"
            className="topic-select"
            value={problemId}
            onChange={(event) => {
              setStatus('')
              setAllVersionsFor('')
              onProblemChange(event.target.value)
            }}
          >
            {problems.map((item) => (
              <option key={item.id} value={item.id}>
                {item.title}
              </option>
            ))}
          </SelectField>
          <Input
            aria-label="搜索用户或队伍"
            placeholder="搜索用户或队伍"
            className="search-input"
            type="search"
            leading={<Search size={15} />}
            value={query}
            onValueChange={setQuery}
          />
          <SelectField
            aria-label="筛选状态"
            className="status-select"
            value={selectedStatus}
            onChange={(event) => setStatus(event.target.value)}
          >
            <option value="">全部状态</option>
            {model.statuses.map((item) => (
              <option key={item} value={item}>
                {statusLabel(item)}
              </option>
            ))}
          </SelectField>
          <Button
            leading={<RefreshCw size={15} />}
            onClick={() => void refresh()}
            busy={pending}
            aria-label="刷新榜单"
          >
            <span>刷新</span>
          </Button>
        </div>
        {error && (
          <div className="error-line" role="alert">
            {error}
          </div>
        )}
        {pending && !data ? (
          <LoadingRows />
        ) : !filtered.length ? (
          <Empty
            text={
              selectedStatus || deferredQuery
                ? '没有匹配的在榜队伍'
                : '该赛题暂无榜单记录'
            }
          />
        ) : (
          <PagedRows
            key={`${problemId}/${selectedStatus}/${deferredQuery}`}
            items={filtered}
            size={25}
          >
            {(visible) => (
              <DataTable
                aria-label="官方榜单及逐测试点成绩"
                className="ranking-table"
              >
                <thead>
                  <tr>
                    <th scope="col" className="rank-column">
                      名次
                    </th>
                    <th scope="col" className="team-column">
                      队伍 / 提交者
                    </th>
                    <th scope="col">状态</th>
                    <th scope="col">记录</th>
                    {cases.map((key, index) => (
                      <th
                        scope="col"
                        className="case-column"
                        key={key}
                        title={key}
                      >
                        <strong>用例 {index + 1}</strong>
                        {allVersions && caseVersionLabel(key) && (
                          <small>版本 {caseVersionLabel(key)}</small>
                        )}
                        <small>
                          全场最快{' '}
                          {bests.global[key] == null
                            ? '—'
                            : `${formatMetric(bests.global[key])} μs`}
                        </small>
                      </th>
                    ))}
                    <th scope="col">最后提交</th>
                  </tr>
                </thead>
                <tbody>
                  {visible.map(({ row, current, previous }) => (
                    <tr key={row.team_key ?? `${row.team_name}-${row.rank}`}>
                      <td className="rank-column">
                        <div className="rank-cell">
                          <strong
                            className={row.rank === 1 ? 'rank-first' : ''}
                          >
                            {row.rank == null ? '—' : `#${row.rank}`}
                          </strong>
                          <RankMovement
                            rank={row.rank}
                            previous={row.previous_rank}
                          />
                        </div>
                      </td>
                      <th scope="row" className="team-column">
                        {row.user_id || row.user_nickname ? (
                          <button
                            className="team-link"
                            onClick={() =>
                              onUserSelect({
                                id: row.user_id,
                                nickname: row.user_nickname,
                                name:
                                  row.user_nickname ||
                                  teamLabel(
                                    row.team_name ||
                                      row.user_nickname ||
                                      row.submitter_nickname,
                                  ),
                              })
                            }
                          >
                            {teamLabel(
                              row.team_name ||
                                row.user_nickname ||
                                row.submitter_nickname,
                            )}
                          </button>
                        ) : (
                          <span>
                            {teamLabel(
                              row.team_name ||
                                row.user_nickname ||
                                row.submitter_nickname,
                            )}
                          </span>
                        )}
                        {row.team_name &&
                          (row.submitter_nickname || row.user_nickname) && (
                            <small>
                              {row.submitter_nickname || row.user_nickname}
                            </small>
                          )}
                      </th>
                      <td>
                        <Status value={row.status} />
                      </td>
                      <td className="numeric">{row.record_count ?? '—'}</td>
                      {cases.map((key) => {
                        const item = current.get(key)
                        const before = previous.get(key)
                        const time = timeValue(item?.time)
                        const best = row.team_key
                          ? bests.teams[row.team_key]?.[key]
                          : undefined
                        return (
                          <td className="case-column" key={key}>
                            <strong className="numeric">
                              {time == null
                                ? item
                                  ? statusLabel(item.status)
                                  : '—'
                                : `${formatMetric(time)} μs`}
                            </strong>
                            {!!time &&
                              item?.status &&
                              item.status !== 'Pass' && (
                                <small>{statusLabel(item.status)}</small>
                              )}
                            {best != null && (
                              <small>历史最佳 {formatMetric(best)} μs</small>
                            )}
                            {item && (
                              <small className={caseDeltaClass(item, before)}>
                                {caseDeltaText(item, before)}
                              </small>
                            )}
                          </td>
                        )
                      })}
                      <td>
                        <Timestamp
                          value={
                            row.create_time || row.updated_at || row.observed_at
                          }
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </DataTable>
            )}
          </PagedRows>
        )}
      </Panel>
    </div>
  )
}
