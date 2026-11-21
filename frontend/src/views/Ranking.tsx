import { useCallback, useDeferredValue, useMemo, useState } from 'react'
import {
  ArrowRight,
  ArrowUpRight,
  Grid3X3,
  List,
  RefreshCw,
  Search,
} from 'lucide-react'
import { api } from '../api'
import {
  caseDeltaText,
  caseKey,
  caseSetForKey,
  caseVersionLabel,
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
  Status,
  Timestamp,
} from '../ui'
import { useResource } from '../useResource'
import {
  LatencyAxis,
  LatencyMarks,
  latencyScale,
  passedTime,
} from './LatencyPlot'
import RankingEvidence, {
  CaseReading,
  nameOf,
  type IndexedRanking,
} from './RankingEvidence'

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
  const [mode, setMode] = useState<'list' | 'matrix'>('list')
  const [caseSelection, setCaseSelection] = useState('')
  const [inspectedTeam, setInspectedTeam] = useState<IndexedRanking | null>(
    null,
  )
  const [expandedKey, setExpandedKey] = useState('')
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

  const caseOptions = useMemo(
    () =>
      cases.map((id, index) => ({
        id,
        label: `用例 ${String(index + 1).padStart(2, '0')}${allVersions && caseVersionLabel(id) ? ` · ${caseVersionLabel(id)}` : ''}`,
      })),
    [cases, allVersions],
  )
  const selectedCase = cases.includes(caseSelection)
    ? caseSelection
    : (cases[0] ?? '')
  const selectedLabel = caseOptions.find(
    (item) => item.id === selectedCase,
  )?.label
  const comparison = useMemo(() => {
    const values: number[] = []
    let fastest: { row: IndexedRanking['row']; time: number } | undefined
    let samples = 0
    for (const { row, current, previous } of model.indexed) {
      const time = passedTime(current.get(selectedCase))
      const prior = passedTime(previous.get(selectedCase))
      if (time != null) {
        values.push(time)
        samples++
        if (!fastest || time < fastest.time) fastest = { row, time }
      }
      if (prior != null) values.push(prior)
    }
    return { scale: latencyScale(values), fastest, samples }
  }, [model.indexed, selectedCase])
  const scale = comparison.scale

  function openProfile({ row }: IndexedRanking) {
    onUserSelect({
      id: row.user_id,
      nickname: row.user_nickname,
      name: row.user_nickname || nameOf(row),
    })
  }

  const problem = problems.find((item) => item.id === problemId)
  if (!problem)
    return (
      <Panel>
        <Empty text="这场赛事暂无公开题目" />
      </Panel>
    )

  return (
    <div className="ranking-layout">
      <div className="ranking-intro">
        <div className="ranking-lead">
          <h1>{problem.title}</h1>
          {problems.length > 1 && (
            <SelectField
              aria-label="选择题目"
              className="topic-switch"
              value={problemId}
              onChange={(event) => {
                setStatus('')
                setAllVersionsFor('')
                setCaseSelection('')
                setInspectedTeam(null)
                setExpandedKey('')
                onProblemChange(event.target.value)
              }}
            >
              {problems.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.title}
                </option>
              ))}
            </SelectField>
          )}
          <dl className="edition-meta">
            <div>
              <dt>在榜</dt>
              <dd>{data ? model.indexed.length : '—'}</dd>
            </div>
            <div>
              <dt>整题通过</dt>
              <dd>{data ? model.passing : '—'}</dd>
            </div>
            <div>
              <dt>更新</dt>
              <dd>
                <Timestamp value={model.updated} />
              </dd>
            </div>
          </dl>
        </div>
      </div>

      <section className="ranking-results" aria-labelledby="ranking-title">
        <div className="results-bar">
          <div className="results-heading">
            <h2 id="ranking-title">官方榜单</h2>
            {data && <span>{filtered.length} 支队伍</span>}
          </div>
          <div className="results-tools">
            <Input
              aria-label="搜索用户或队伍"
              placeholder="搜索队伍或提交者"
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
            />
            <div
              className="segmented mode-switch"
              role="group"
              aria-label="榜单显示方式"
            >
              <button
                type="button"
                aria-pressed={mode === 'list'}
                onClick={() => setMode('list')}
              >
                <List size={15} /> <span>单点比较</span>
              </button>
              <button
                type="button"
                aria-pressed={mode === 'matrix'}
                onClick={() => setMode('matrix')}
              >
                <Grid3X3 size={14} /> <span>矩阵</span>
              </button>
            </div>
          </div>
        </div>
        {activeSet && model.allCases.length > model.activeCases.length && (
          <div className="version-bar">
            <span>测试点版本</span>
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
          </div>
        )}
        {mode === 'list' && caseOptions.length > 0 && (
          <div className="comparison-caption">
            <SelectField
              aria-label="选择对比用例"
              value={selectedCase}
              onChange={(event) => setCaseSelection(event.target.value)}
            >
              {caseOptions.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.label}
                </option>
              ))}
            </SelectField>
            {comparison.fastest ? (
              <p>
                本次通过该用例的 <strong>{comparison.samples}</strong>{' '}
                支队伍中，
                <strong>{nameOf(comparison.fastest.row)}</strong>用时最短
                <span className="caption-time">
                  {' '}
                  {formatMetric(comparison.fastest.time)} μs
                </span>
                。
              </p>
            ) : (
              <p>当前用例暂无已通过的耗时记录。</p>
            )}
          </div>
        )}
        {mode === 'matrix' && cases.length > 0 && (
          <div className="matrix-legend">
            <span aria-hidden="true" />
            色阶表示通过耗时相对全场历史最佳的倍数
          </div>
        )}
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
            {(visible) =>
              mode === 'list' ? (
                <div className="results-list">
                  <div className="result-row result-labels">
                    <span>官方名次</span>
                    <span>队伍 / 提交者</span>
                    <span>提交状态</span>
                    <div className="result-plot-heading">
                      <span>
                        {selectedLabel ?? '用例'} · 通过耗时（μs
                        {scale ? '，对数轴' : ''}）
                      </span>
                      {scale && <LatencyAxis scale={scale} />}
                    </div>
                    <span className="result-value-heading">本次耗时</span>
                    <span />
                  </div>
                  <ol aria-label="官方名次列表">
                    {visible.map((indexed) => {
                      const { row, current, previous } = indexed
                      const item = current.get(selectedCase)
                      const prior = previous.get(selectedCase)
                      const rowKey =
                        row.team_key ?? `${nameOf(row)}-${row.rank}`
                      const expanded = expandedKey === rowKey
                      return (
                        <li key={rowKey} data-expanded={expanded}>
                          <button
                            className="result-row result-item"
                            type="button"
                            aria-expanded={expanded}
                            aria-controls={
                              expanded ? 'rank-inline-evidence' : undefined
                            }
                            onClick={() =>
                              setExpandedKey(expanded ? '' : rowKey)
                            }
                          >
                            <span className="result-rank">
                              <strong>{row.rank ?? '—'}</strong>
                              <RankMovement
                                rank={row.rank}
                                previous={row.previous_rank}
                              />
                            </span>
                            <span className="result-team">
                              <strong>{nameOf(row)}</strong>
                              {row.team_name &&
                                (row.submitter_nickname ||
                                  row.user_nickname) && (
                                  <small>
                                    {row.submitter_nickname ||
                                      row.user_nickname}
                                  </small>
                                )}
                            </span>
                            <span className="result-state">
                              <Status value={row.status} />
                            </span>
                            <span className="result-plot">
                              {scale && (
                                <LatencyMarks
                                  scale={scale}
                                  current={passedTime(item)}
                                  previous={expanded ? passedTime(prior) : null}
                                  selected={expanded}
                                  reference={
                                    !expanded && row === comparison.fastest?.row
                                  }
                                />
                              )}
                            </span>
                            <span className="result-time">
                              <CaseReading item={item} />
                              {item?.status &&
                                item.status !== 'Pass' &&
                                timeValue(item.time) != null && (
                                  <small>{statusLabel(item.status)}</small>
                                )}
                            </span>
                            <ArrowRight
                              className="result-arrow"
                              size={16}
                              aria-hidden
                            />
                          </button>
                          {expanded && (
                            <RankingEvidence
                              inline
                              indexed={indexed}
                              cases={cases}
                              bests={bests}
                              selectedCase={selectedCase}
                              allVersions={allVersions}
                              onClose={() => setExpandedKey('')}
                              onProfile={() => openProfile(indexed)}
                            />
                          )}
                        </li>
                      )
                    })}
                  </ol>
                </div>
              ) : (
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
                    {visible.map((indexed) => {
                      const { row, current, previous } = indexed
                      return (
                        <tr
                          key={row.team_key ?? `${row.team_name}-${row.rank}`}
                        >
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
                            <button
                              className="team-link"
                              type="button"
                              onClick={() => setInspectedTeam(indexed)}
                              aria-haspopup="dialog"
                            >
                              {nameOf(row)}{' '}
                              <ArrowUpRight size={12} aria-hidden />
                            </button>
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
                            const best = bests.global[key]
                            const ratio =
                              item?.status === 'Pass' && best && time != null
                                ? time / best
                                : undefined
                            const level =
                              ratio == null
                                ? 0
                                : Math.min(
                                    4,
                                    1 +
                                      Math.floor(
                                        Math.log2(Math.max(1, ratio)) * 2,
                                      ),
                                  )
                            const description = [
                              ratio == null
                                ? undefined
                                : `${ratio.toFixed(2)}× 全场历史最短耗时`,
                              item?.status
                                ? statusLabel(item.status)
                                : undefined,
                              item ? caseDeltaText(item, before) : undefined,
                            ]
                              .filter(Boolean)
                              .join(' · ')
                            return (
                              <td className="matrix-cell" key={key}>
                                <button
                                  type="button"
                                  data-level={level}
                                  title={description || '暂无数据'}
                                  onClick={() => {
                                    setCaseSelection(key)
                                    setInspectedTeam(indexed)
                                  }}
                                  aria-haspopup="dialog"
                                >
                                  <CaseReading item={item} />
                                </button>
                              </td>
                            )
                          })}
                          <td>
                            <Timestamp
                              value={
                                row.create_time ||
                                row.updated_at ||
                                row.observed_at
                              }
                            />
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </DataTable>
              )
            }
          </PagedRows>
        )}
      </section>
      {inspectedTeam && (
        <RankingEvidence
          indexed={inspectedTeam}
          cases={cases}
          bests={bests}
          selectedCase={selectedCase}
          allVersions={allVersions}
          onClose={() => setInspectedTeam(null)}
          onProfile={() => openProfile(inspectedTeam)}
        />
      )}
    </div>
  )
}
