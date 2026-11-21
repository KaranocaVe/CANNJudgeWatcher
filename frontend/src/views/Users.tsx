import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  ArrowRight,
  Check,
  Gauge,
  LayoutDashboard,
  RefreshCw,
  Search,
  Table2,
  Users,
} from 'lucide-react'
import {
  Button,
  Panel,
  PanelBody,
  PanelHeader,
  Chip,
  Input,
  DataTable,
  Empty,
  Toolbar,
  LoadingRows,
  StatCard,
  Status,
  Timestamp,
} from '../ui'
import { fmt } from '../format'
import { teamLabel } from '../domain'
import type {
  UserDirectoryItem,
  UserPerformanceItem,
  SelectedUser,
  SelectedPerformance,
} from '../types'
import { api } from '../api'
import { isAbortError } from '../useResource'

export default function UserDetailView({
  user,
  onSelectUser,
  onSelectPerformance,
}: {
  user: SelectedUser | null
  onSelectUser: (user: SelectedUser | null) => void
  onSelectPerformance: (performance: SelectedPerformance) => void
}) {
  const [items, setItems] = useState<UserPerformanceItem[]>([])
  const [resolvedUser, setResolvedUser] = useState<{
    id?: string
    nickname?: string
  }>({})
  const [query, setQuery] = useState('')
  const [loading, setLoading] = useState(false)
  const [loadError, setLoadError] = useState('')

  const load = useCallback(() => {
    if (!user?.id && !user?.nickname) {
      setItems([])
      setResolvedUser({})
      setLoadError('')
      return () => undefined
    }
    const controller = new AbortController()
    setLoading(true)
    setLoadError('')
    api
      .userPerformance(user.id, user.nickname, controller.signal)
      .then((data) => {
        if (!controller.signal.aborted) {
          setItems(data.items)
          setResolvedUser({ id: data.userId, nickname: data.userNickname })
        }
      })
      .catch((error) => {
        if (!isAbortError(error) && !controller.signal.aborted)
          setLoadError((error as Error).message || '加载用户表现失败')
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false)
      })
    return () => controller.abort()
  }, [user?.id, user?.nickname])
  useEffect(() => load(), [load])

  const contestRows = useMemo(() => {
    const grouped = new Map<
      string,
      {
        id: string
        title: string
        status?: string
        problemCount: number
        passCount: number
        bestRank?: number
        latest?: string
        teams: Set<string>
      }
    >()
    items.forEach((item) => {
      const row = grouped.get(item.contest_id) || {
        id: item.contest_id,
        title: item.contest_title,
        status: item.contest_status,
        problemCount: 0,
        passCount: 0,
        bestRank: undefined,
        latest: item.observed_at,
        teams: new Set<string>(),
      }
      row.problemCount += 1
      if (item.status === 'Pass') row.passCount += 1
      if (item.best_rank != null)
        row.bestRank = Math.min(row.bestRank ?? item.best_rank, item.best_rank)
      if (
        item.observed_at &&
        (!row.latest ||
          new Date(item.observed_at).getTime() > new Date(row.latest).getTime())
      )
        row.latest = item.observed_at
      if (item.team_name) row.teams.add(teamLabel(item.team_name))
      grouped.set(item.contest_id, row)
    })
    return Array.from(grouped.values()).sort(
      (a, b) =>
        new Date(b.latest || 0).getTime() - new Date(a.latest || 0).getTime(),
    )
  }, [items])
  const visibleItems = useMemo(
    () =>
      items.filter(
        (item) =>
          !query ||
          `${item.contest_title} ${item.problem_title} ${item.team_name || ''} ${item.status || ''}`
            .toLowerCase()
            .includes(query.toLowerCase()),
      ),
    [items, query],
  )
  const problemCount = new Set(
    items.map((item) => `${item.contest_id}:${item.problem_id}`),
  ).size
  const passedCount = items.filter((item) => item.status === 'Pass').length
  const bestRank = items.reduce<number | undefined>(
    (best, item) =>
      item.best_rank == null
        ? best
        : Math.min(best ?? item.best_rank, item.best_rank),
    undefined,
  )
  const latest = items.reduce<string | undefined>(
    (latestValue, item) =>
      !item.observed_at ||
      (latestValue &&
        new Date(latestValue).getTime() >= new Date(item.observed_at).getTime())
        ? latestValue
        : item.observed_at,
    undefined,
  )

  if (!user) return <UserDirectoryView onSelectUser={onSelectUser} />
  const displayName = resolvedUser.nickname || user.nickname || user.name
  return (
    <div className="panel-stack">
      <Panel className="content-card user-profile-card">
        <PanelBody>
          <div className="user-profile-head">
            <div>
              <span className="eyebrow">用户资料</span>
              <h2>{displayName}</h2>
              <p>
                {resolvedUser.id || user.id
                  ? `用户 ID：${resolvedUser.id || user.id}`
                  : '按昵称匹配历史表现'}
              </p>
            </div>
            <div className="user-profile-actions">
              <Chip color={loadError ? 'warning' : 'primary'}>
                {loadError ? '加载失败' : `${items.length} 条表现记录`}
              </Chip>
              <Button
                leading={<Users size={14} />}
                onClick={() => onSelectUser(null)}
              >
                选择其他用户
              </Button>
            </div>
          </div>
        </PanelBody>
      </Panel>
      <div className="stat-grid">
        <StatCard
          label="参与赛事"
          value={contestRows.length}
          hint="全部已采集赛事"
          icon={Table2}
        />
        <StatCard
          label="覆盖题目"
          value={problemCount}
          hint="赛事内去重"
          icon={LayoutDashboard}
        />
        <StatCard
          label="当前通过"
          value={passedCount}
          hint="最新题目状态"
          icon={Check}
        />
        <StatCard
          label="历史最好名次"
          value={bestRank == null ? '—' : `#${bestRank}`}
          hint={latest ? `最近观测 ${fmt(latest)}` : '暂无观测'}
          icon={Gauge}
        />
      </div>
      <Panel className="content-card data-card user-contests-card">
        <PanelHeader>
          <div>
            <h2>赛事表现</h2>
            <p>按赛事汇总该用户的题目状态与历史最好名次</p>
          </div>
        </PanelHeader>
        {loading ? (
          <LoadingRows />
        ) : (
          <DataTable aria-label="用户赛事表现汇总" className="data-table">
            <thead>
              <tr>
                <th scope="col">赛事</th>
                <th scope="col">题目数</th>
                <th scope="col">通过</th>
                <th scope="col">历史最好名次</th>
                <th scope="col">参与队伍</th>
                <th scope="col">最近观测</th>
              </tr>
            </thead>
            <tbody>
              {!contestRows.length && (
                <tr>
                  <td colSpan={6}>
                    <Empty text={loadError || '暂无跨赛事表现记录'} />
                  </td>
                </tr>
              )}
              {contestRows.map((row) => (
                <tr key={row.id}>
                  <td>
                    <div className="user-contest-name">
                      <strong>{row.title}</strong>
                      <small>
                        {row.status === 'ACTIVE' ? '进行中' : '已结束'}
                      </small>
                    </div>
                  </td>
                  <td>{row.problemCount}</td>
                  <td>{row.passCount}</td>
                  <td>{row.bestRank == null ? '—' : `#${row.bestRank}`}</td>
                  <td>
                    {row.teams.size ? Array.from(row.teams).join('、') : '—'}
                  </td>
                  <td>
                    <Timestamp value={row.latest} />
                  </td>
                </tr>
              ))}
            </tbody>
          </DataTable>
        )}
      </Panel>
      <Panel className="content-card data-card user-items-card">
        <Toolbar note={loadError || `${visibleItems.length} 条题目表现`}>
          <div className="section-head">
            <div>
              <h2>题目明细</h2>
              <p>点击对应题目旁的入口，查看该用户在这道题的完整历史</p>
            </div>
          </div>
          <Input
            aria-label="搜索赛事或题目"
            className="search-input"
            placeholder="搜索赛事、题目或队伍"
            leading={<Search size={15} />}
            value={query}
            onValueChange={setQuery}
          />
          <Button leading={<RefreshCw size={14} />} onClick={() => void load()}>
            刷新
          </Button>
        </Toolbar>
        <div className="ranking-table-scroll">
          <DataTable
            aria-label="用户全部赛事题目表现"
            className="data-table user-performance-table"
          >
            <thead>
              <tr>
                <th scope="col">赛事 / 题目</th>
                <th scope="col">队伍</th>
                <th scope="col">当前状态</th>
                <th scope="col">当前名次</th>
                <th scope="col">历史最好</th>
                <th scope="col">性能记录</th>
                <th scope="col">最后观测</th>
              </tr>
            </thead>
            <tbody>
              {!visibleItems.length && (
                <tr>
                  <td colSpan={7}>
                    <Empty text={loadError || '没有匹配的题目表现'} />
                  </td>
                </tr>
              )}
              {visibleItems.map((item) => (
                <tr
                  key={`${item.contest_id}-${item.problem_id}-${item.team_key}`}
                >
                  <td>
                    <div className="user-item-title">
                      <strong>{item.contest_title}</strong>
                      <small>{item.problem_title}</small>
                      <button
                        type="button"
                        className="detail-link user-action"
                        onClick={() =>
                          onSelectPerformance({
                            contestId: item.contest_id,
                            contestTitle: item.contest_title,
                            problemId: item.problem_id,
                            problemTitle: item.problem_title,
                            teamKey: item.team_key || '',
                            teamName: teamLabel(item.team_name),
                          })
                        }
                      >
                        <ArrowRight size={13} />
                        查看该题详细记录
                      </button>
                    </div>
                  </td>
                  <td>{teamLabel(item.team_name)}</td>
                  <td>
                    <Status value={item.status} />
                  </td>
                  <td>{item.rank == null ? '—' : `#${item.rank}`}</td>
                  <td>{item.best_rank == null ? '—' : `#${item.best_rank}`}</td>
                  <td>{item.event_count ?? '—'} 次</td>
                  <td>
                    <Timestamp value={item.observed_at} />
                  </td>
                </tr>
              ))}
            </tbody>
          </DataTable>
        </div>
      </Panel>
    </div>
  )
}

function UserDirectoryView({
  onSelectUser,
}: {
  onSelectUser: (user: SelectedUser | null) => void
}) {
  const [users, setUsers] = useState<UserDirectoryItem[]>([])
  const [query, setQuery] = useState('')
  const [loading, setLoading] = useState(false)
  const [loadError, setLoadError] = useState('')
  const load = useCallback(() => {
    const controller = new AbortController()
    setLoading(true)
    setLoadError('')
    api
      .users(controller.signal)
      .then((data) => {
        if (!controller.signal.aborted) setUsers(data)
      })
      .catch((error) => {
        if (!isAbortError(error) && !controller.signal.aborted)
          setLoadError((error as Error).message || '加载用户目录失败')
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false)
      })
    return () => controller.abort()
  }, [])
  useEffect(() => load(), [load])
  const visible = useMemo(
    () =>
      users.filter(
        (item) =>
          !query ||
          `${item.user_nickname || ''} ${item.user_id || ''}`
            .toLowerCase()
            .includes(query.toLowerCase()),
      ),
    [query, users],
  )
  return (
    <div className="panel-stack">
      <Panel className="content-card data-card user-directory-card">
        <PanelHeader>
          <div>
            <h2>选择用户</h2>
            <p>从所有已采集赛事中查找用户，查看其完整表现</p>
          </div>
        </PanelHeader>
        <Toolbar
          note={loadError || `${visible.length} / ${users.length} 位用户`}
        >
          <Input
            aria-label="搜索用户"
            className="search-input"
            placeholder="搜索昵称或用户 ID"
            leading={<Search size={15} />}
            value={query}
            onValueChange={setQuery}
          />
          <Button
            leading={<RefreshCw size={14} />}
            onClick={() => void load()}
            busy={loading}
          >
            刷新
          </Button>
        </Toolbar>
        {loading && !users.length ? (
          <LoadingRows />
        ) : (
          <div className="ranking-table-scroll">
            <DataTable
              aria-label="用户目录"
              className="data-table user-directory-table"
            >
              <thead>
                <tr>
                  <th scope="col">用户</th>
                  <th scope="col">参与赛事</th>
                  <th scope="col">覆盖题目</th>
                  <th scope="col">表现记录</th>
                  <th scope="col">最近观测</th>
                  <th scope="col">操作</th>
                </tr>
              </thead>
              <tbody>
                {!visible.length && (
                  <tr>
                    <td colSpan={6}>
                      <Empty text={loadError || '没有匹配的用户'} />
                    </td>
                  </tr>
                )}
                {visible.map((item) => (
                  <tr key={item.user_key}>
                    <td>
                      <div className="user-directory-name">
                        <strong>{item.user_nickname || '未命名用户'}</strong>
                        <small>{item.user_id || '无用户 ID'}</small>
                      </div>
                    </td>
                    <td>{item.contest_count}</td>
                    <td>{item.problem_count}</td>
                    <td>{item.event_count}</td>
                    <td>
                      <Timestamp value={item.latest_observed_at} />
                    </td>
                    <td>
                      <button
                        type="button"
                        className="detail-link user-action"
                        onClick={() =>
                          onSelectUser({
                            id: item.user_id,
                            nickname: item.user_nickname,
                            name:
                              item.user_nickname ||
                              item.user_id ||
                              '未命名用户',
                          })
                        }
                      >
                        <ArrowRight size={13} />
                        查看详情
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </DataTable>
          </div>
        )}
      </Panel>
    </div>
  )
}
