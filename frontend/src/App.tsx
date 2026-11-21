import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react'
import {
  Activity,
  ArrowUpRight,
  Bell,
  ChartNoAxesCombined,
  Clock3,
  ChartScatter,
  Signal,
  LayoutGrid,
  ListOrdered,
  Settings2,
} from 'lucide-react'
import { api } from './api'
import { Button, Chip, Empty, LoadingRows, SelectField, Timestamp } from './ui'
import { useResource } from './useResource'
import RankingView from './views/Ranking'
import type { Alert, SelectedPerformance, SelectedUser } from './types'

const OverviewView = lazy(() => import('./views/Overview'))
const ParticipationView = lazy(() => import('./views/Participation'))
const UsersView = lazy(() => import('./views/Users'))
const HistoryView = lazy(() => import('./views/History'))
const AlertsView = lazy(() => import('./views/Alerts'))
const PollsView = lazy(() => import('./views/Polls'))
const SettingsView = lazy(() => import('./views/Settings'))

const navigation = [
  { id: 'ranking', label: '最新榜单', short: '榜单', icon: ListOrdered },
  { id: 'overview', label: '赛事概览', short: '概览', icon: LayoutGrid },
  { id: 'users', label: '用户详情', short: '用户', icon: ChartNoAxesCombined },
  { id: 'participation', label: '参赛分析', short: '分析', icon: ChartScatter },
  { id: 'alerts', label: '异常信号', short: '告警', icon: Bell },
  { id: 'polls', label: '采集运行', short: '采集', icon: Clock3 },
  { id: 'settings', label: '管理设置', short: '设置', icon: Settings2 },
] as const

type View = (typeof navigation)[number]['id']
type Selection = { contestId: string; problemId: string }
const selectionKey = 'cannjudge-watcher.selection'
const scopedViews: View[] = ['ranking', 'overview', 'alerts']

function savedSelection(): Selection {
  try {
    const saved = JSON.parse(localStorage.getItem(selectionKey) || '{}')
    return {
      contestId: typeof saved.contestId === 'string' ? saved.contestId : '',
      problemId: typeof saved.problemId === 'string' ? saved.problemId : '',
    }
  } catch {
    return { contestId: '', problemId: '' }
  }
}

export default function App() {
  const [view, setView] = useState<View>(() =>
    new URLSearchParams(location.search).get('view') === 'participation'
      ? 'participation'
      : 'ranking',
  )
  const [selection, setSelection] = useState(savedSelection)
  const [user, setUser] = useState<SelectedUser | null>(null)
  const [performance, setPerformance] = useState<SelectedPerformance | null>(
    null,
  )
  const main = useRef<HTMLElement>(null)

  const contestList = useResource('contests', api.contests)
  const summary = useResource('summary', api.summary, 60_000)
  const contests = contestList.data
  const contest =
    contests?.find((item) => item.id === selection.contestId) ??
    contests?.find(
      (item) => item.status === 'ACTIVE' && item.monitoringEnabled,
    ) ??
    contests?.[0]
  const contestId = contest?.id ?? ''
  const contestPage = useResource(
    view === 'ranking' || view === 'overview'
      ? contestId || undefined
      : undefined,
    useCallback(
      (signal: AbortSignal) => api.contest(contestId, signal),
      [contestId],
    ),
  )
  const problems = contestPage.data?.problems
  const problem =
    problems?.find((item) => item.id === selection.problemId) ?? problems?.[0]

  useEffect(() => {
    if (!contestId || !problems) return
    try {
      localStorage.setItem(
        selectionKey,
        JSON.stringify({ contestId, problemId: problem?.id ?? '' }),
      )
    } catch {
      /* Storage may be disabled. */
    }
  }, [contestId, problem?.id, problems])

  function go(next: View) {
    if (next === view) return
    setView(next)
    const url = new URL(location.href)
    if (next === 'participation') url.searchParams.set('view', 'participation')
    else url.searchParams.delete('view')
    window.history.replaceState(null, '', url)
    window.scrollTo(0, 0)
    requestAnimationFrame(() => main.current?.focus({ preventScroll: true }))
  }

  function selectProblem(problemId: string) {
    setSelection({ contestId, problemId })
  }

  function openAlert(alert: Alert) {
    if (alert.contestId)
      setSelection({
        contestId: alert.contestId,
        problemId: alert.problemId ?? '',
      })
    go(alert.problemId ? 'ranking' : alert.contestId ? 'overview' : 'polls')
  }

  const scoped = scopedViews.includes(view)
  const title =
    view === 'users'
      ? performance?.problemTitle || user?.name || '用户详情'
      : view === 'participation'
        ? '参赛投入与成绩'
        : navigation.find((item) => item.id === view)?.label
  const run = summary.data?.latestPoll?.[0]
  const tone =
    summary.error ||
    summary.data?.collectorLate ||
    run?.status === 'FAILED' ||
    run?.status === 'INTERRUPTED'
      ? 'danger'
      : run?.status === 'SUCCESS'
        ? 'success'
        : run?.status === 'RUNNING'
          ? 'primary'
          : 'default'
  const label = summary.error
    ? '状态读取失败'
    : summary.data?.collectorLate
      ? '采集已超时'
      : run?.status === 'INTERRUPTED'
        ? '采集已中断'
        : run?.status === 'FAILED'
          ? '采集失败'
          : run?.status === 'SUCCESS'
            ? '采集正常'
            : run?.status === 'RUNNING'
              ? '采集中'
              : '等待采集'

  return (
    <div className="app-shell">
      <header className="masthead">
        <button
          className="brand"
          onClick={() => go('ranking')}
          aria-label="CANNJudge Watcher · 首页"
        >
          <span className="brand-mark">
            <Signal size={22} strokeWidth={2.5} />
          </span>
          <div>
            <strong>CANNJudge</strong>
            <small>WATCHER</small>
          </div>
        </button>
        <nav className="masthead-nav" aria-label="主导航">
          {navigation.map(({ id, label, short, icon: Icon }) => (
            <button
              key={id}
              type="button"
              aria-current={view === id ? 'page' : undefined}
              onClick={() => go(id)}
            >
              <Icon size={18} strokeWidth={1.8} aria-hidden />
              <span className="nav-label">{label}</span>
              <span className="nav-short">{short}</span>
            </button>
          ))}
        </nav>
        <div className="masthead-tools">
          <button
            className="source-status"
            type="button"
            onClick={() => go('polls')}
            aria-label={`${label}，查看采集运行`}
          >
            <Chip color={tone} leading={<Activity size={13} />}>
              {label}
            </Chip>
            <span className="source-time">
              <Timestamp value={run?.finished_at ?? run?.started_at} />
            </span>
          </button>
          <a
            className="source-link"
            aria-label="打开 CANNJudge 源站"
            title="CANNJudge 源站"
            href="https://cannjudge.cn/"
            target="_blank"
            rel="noreferrer"
          >
            <ArrowUpRight size={18} />
          </a>
        </div>
      </header>

      <div className="app-main">
        {scoped && (
          <div className="context-bar">
            <div className="header-context">
              <span className="context-label">赛事</span>
              {
                <SelectField
                  className="contest-select"
                  aria-label="选择赛事"
                  value={contestId}
                  onChange={(event) =>
                    setSelection({
                      contestId: event.target.value,
                      problemId: '',
                    })
                  }
                  disabled={!contests?.length}
                >
                  {!contests?.length && (
                    <option value="">
                      {contestList.pending ? '正在载入赛事…' : '暂无赛事'}
                    </option>
                  )}
                  {contests?.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.title}
                    </option>
                  ))}
                </SelectField>
              }
            </div>
            {contest && (
              <span
                className="contest-state"
                data-active={contest.status === 'ACTIVE'}
              >
                {contest.status === 'ACTIVE'
                  ? '进行中'
                  : contest.status === 'ENDED'
                    ? '已结束'
                    : '未开始'}
              </span>
            )}
          </div>
        )}

        <main className="app-content" tabIndex={-1} ref={main}>
          {(view !== 'ranking' || !contest || !problems) && (
            <div className="page-heading">
              <div>
                <h1>{title}</h1>
                {((scoped && contest) || (performance && view === 'users')) && (
                  <p>
                    {view === 'users'
                      ? performance?.contestTitle
                      : contest?.title}
                  </p>
                )}
              </div>
            </div>
          )}
          {scoped && contestList.error && !contest && (
            <div className="error-line" role="alert">
              {contestList.error}{' '}
              <Button onClick={() => void contestList.refresh()}>重试</Button>
            </div>
          )}
          {scoped &&
            ((contestList.pending && !contests) ||
              (contestPage.pending && !problems)) && <LoadingRows />}
          {scoped && !contestList.pending && !contestList.error && !contest && (
            <Empty text="暂无公开赛事" />
          )}
          {scoped && contestPage.error && !problems && (
            <div className="error-line" role="alert">
              {contestPage.error}{' '}
              <Button onClick={() => void contestPage.refresh()}>重试</Button>
            </div>
          )}
          <Suspense fallback={<LoadingRows />}>
            {view === 'ranking' && contest && problems && (
              <RankingView
                key={contestId}
                contest={contest}
                problems={problems}
                problemId={problem?.id ?? ''}
                onProblemChange={selectProblem}
                onUserSelect={(next) => {
                  setUser(next)
                  setPerformance(null)
                  go('users')
                }}
              />
            )}
            {view === 'overview' && contest && problems && (
              <OverviewView
                key={contestId}
                contestId={contestId}
                problems={problems}
                pollIntervalSeconds={contest.pollIntervalSeconds}
                onProblem={(id) => {
                  selectProblem(id)
                  go('ranking')
                }}
              />
            )}
            {view === 'users' &&
              (performance ? (
                <HistoryView
                  key={`${performance.contestId}-${performance.problemId}-${performance.teamKey}`}
                  {...performance}
                  onBack={() => setPerformance(null)}
                />
              ) : (
                <UsersView
                  key={user?.id ?? user?.nickname ?? ''}
                  user={user}
                  onSelectUser={setUser}
                  onSelectPerformance={setPerformance}
                />
              ))}
            {view === 'alerts' && contest && (
              <AlertsView
                key={contestId}
                contestId={contestId}
                onOpenAlert={openAlert}
              />
            )}
            {view === 'participation' && (
              <ParticipationView
                onSelectUser={(next) => {
                  setUser(next)
                  setPerformance(null)
                  go('users')
                }}
              />
            )}
            {view === 'polls' && <PollsView />}
            {view === 'settings' && (
              <SettingsView
                contests={contests ?? []}
                onReload={() => void contestList.refresh()}
              />
            )}
          </Suspense>
        </main>
      </div>
    </div>
  )
}
