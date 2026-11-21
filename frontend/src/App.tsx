import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { Button, Card, CardBody, CardHeader, Chip, Divider, Input, Select, SelectItem, Spinner, Tab, Table, TableBody, TableCell, TableColumn, TableHeader, TableRow, Tabs } from '@heroui/react'
import { AlertCircle, ArrowLeft, ArrowRight, BarChart3, Check, ChevronRight, CircleHelp, Clock3, Eye, EyeOff, Gauge, LayoutDashboard, LockKeyhole, LogOut, Menu, RefreshCw, Search, Settings2, ShieldCheck, Table2, Users, X } from 'lucide-react'
import { api } from './api'
import { alertColor, fmt, fmtFull, formatMetric, rangeStart, statusColor, statusLabel } from './format'
import type { Alert, CaseBestSummary, Contest, ContestOverview, HistoryPoint, PollRun, Problem, ProblemStats, Ranking, Summary, UserDirectoryItem, UserPerformanceItem } from './types'

type View = 'ranking' | 'overview' | 'history' | 'alerts' | 'polls' | 'settings'
type OverviewItem = { problem: Problem; rowCount: number; passCount: number; events: number }
type SelectedUser = { id?: string; nickname?: string; name: string }
type SelectedPerformance = { contestId: string; contestTitle: string; problemId: string; problemTitle: string; teamKey: string; teamName: string }
const ReactECharts = lazy(() => import('echarts-for-react'))
const nav: Array<{ key: View; label: string; icon: typeof Table2 }> = [
  { key: 'ranking', label: '最新榜单', icon: Table2 }, { key: 'overview', label: '概览', icon: LayoutDashboard },
  { key: 'history', label: '用户详情', icon: BarChart3 }, { key: 'alerts', label: '异常信号', icon: AlertCircle },
  { key: 'polls', label: '采集运行', icon: Clock3 },
]

const signalLabel = (rule?: string) => ({ SCORE_CHANGE: '分数变化', RANK_CHANGE: '名次变化', ROW_COUNT_CHANGE: '榜单规模变化', POLL_FAILURE: '采集失败', DATA_GAP: '数据断档' } as Record<string, string>)[rule || ''] || rule || '变化信号'
const selectionStorageKey = 'cannjudge-watcher.selection'
const readSavedSelection = (): { contestId: string; problemId: string } => {
  try {
    const saved = JSON.parse(window.localStorage.getItem(selectionStorageKey) || '{}')
    return {
      contestId: typeof saved.contestId === 'string' ? saved.contestId : '',
      problemId: typeof saved.problemId === 'string' ? saved.problemId : '',
    }
  } catch { return { contestId: '', problemId: '' } }
}
const teamLabel = (name?: string) => (name || '未命名队伍').replace(/\s*的队伍\s*$/, '') || '未命名队伍'
const timeValue = (value?: number) => value == null || value <= 0 ? null : value
const caseVersionLabel = (caseId: string) => { const separator = caseId.indexOf(':'); return separator < 0 ? '' : caseId.slice(0, separator).slice(0, 8) }
const caseSetForKey = (caseId: string) => { const separator = caseId.indexOf(':'); return separator < 0 ? '' : caseId.slice(0, separator) }
const caseKey = (item: { testcaseId?: string; caseSetId?: string }, index: number) => {
  if (!item.testcaseId) return `case-${index + 1}`
  return item.caseSetId ? `${item.caseSetId}:${item.testcaseId}` : item.testcaseId
}
const caseDeltaText = (current?: { time?: number; status?: string }, previous?: { time?: number; status?: string }) => {
  const currentTime = timeValue(current?.time); const previousTime = timeValue(previous?.time)
  if (!previous) return '首次观测'
  if (currentTime != null && previousTime != null) { const delta = currentTime - previousTime; const performance = Math.abs(delta) < .005 ? '未变化' : `${delta > 0 ? '↑ +' : '↓ '}${Math.abs(delta).toFixed(2)} μs`; return current?.status === previous.status ? performance : `${performance} · ${statusLabel(previous.status)} → ${statusLabel(current?.status)}` }
  return current?.status === previous.status ? '未变化' : `${statusLabel(previous.status)} → ${statusLabel(current?.status)}`
}
const caseDeltaClass = (current?: { time?: number; status?: string }, previous?: { time?: number; status?: string }) => {
  const currentTime = timeValue(current?.time); const previousTime = timeValue(previous?.time)
  if (!previous || (currentTime == null && previousTime == null)) return current?.status === previous?.status ? 'metric-flat' : current?.status === 'Pass' ? 'metric-up' : previous?.status === 'Pass' ? 'metric-down' : 'metric-flat'
  return changeClass(currentTime, previousTime) || 'metric-flat'
}
const changeText = (current?: number | null, previous?: number | null) => {
  if (current == null || previous == null) return '—'
  const delta = current - previous
  return Math.abs(delta) < .005 ? '未变化' : `${delta > 0 ? '+' : ''}${delta.toFixed(2)} μs`
}
const changeClass = (current?: number | null, previous?: number | null) => current == null || previous == null ? '' : current > previous ? 'metric-down' : current < previous ? 'metric-up' : 'metric-flat'
const isAbortError = (error: unknown) => error instanceof Error && error.name === 'AbortError'

export default function App() {
  const savedSelection = useMemo(readSavedSelection, [])
  const [view, setView] = useState<View>('ranking')
  const [summary, setSummary] = useState<Summary>({})
  const [contests, setContests] = useState<Contest[]>([])
  const [contestId, setContestId] = useState(() => savedSelection.contestId)
  const [problems, setProblems] = useState<Problem[]>([])
  const [problemId, setProblemId] = useState(() => savedSelection.problemId)
  const [selectedUser, setSelectedUser] = useState<SelectedUser | null>(null)
  const [selectedPerformance, setSelectedPerformance] = useState<SelectedPerformance | null>(null)
  const [loading, setLoading] = useState(true)
  const [mobileOpen, setMobileOpen] = useState(false)
  const [contestAlertCount, setContestAlertCount] = useState(0)
  const baseRequestRef = useRef<AbortController | null>(null)

  const loadBase = useCallback(async (quiet = false) => {
    if (quiet && baseRequestRef.current) return
    baseRequestRef.current?.abort()
    const controller = new AbortController()
    baseRequestRef.current = controller
    if (!quiet) setLoading(true)
    try {
      const [nextSummary, nextContests] = await Promise.all([api.summary(controller.signal), api.contests(controller.signal)])
      if (!controller.signal.aborted) {
        setSummary(nextSummary); setContests(nextContests)
        setContestId(current => nextContests.some(contest => contest.id === current) ? current : nextContests.find(c => c.status === 'ACTIVE' && c.monitoringEnabled)?.id || nextContests[0]?.id || '')
      }
    } catch (error) {
      if (!isAbortError(error)) console.warn('刷新基础数据失败', error)
    } finally { if (baseRequestRef.current === controller) { baseRequestRef.current = null; if (!quiet) setLoading(false) } }
  }, [])
  useEffect(() => { void loadBase(); return () => baseRequestRef.current?.abort() }, [loadBase])
  useEffect(() => { const timer = window.setInterval(() => void loadBase(true), 30000); return () => window.clearInterval(timer) }, [loadBase])
  useEffect(() => {
    try { window.localStorage.setItem(selectionStorageKey, JSON.stringify({ contestId, problemId })) } catch { /* Storage may be disabled by the browser. */ }
  }, [contestId, problemId])
  useEffect(() => {
    if (!contestId) { setProblems([]); setProblemId(''); return }
    const controller = new AbortController()
    api.contest(contestId, controller.signal).then(data => {
      if (controller.signal.aborted) return
      setProblems(data.problems)
      setProblemId(current => current && data.problems.some(p => p.id === current) ? current : data.problems[0]?.id || '')
    }).catch(error => { if (!isAbortError(error)) console.warn('加载赛事题目失败', error) })
    return () => controller.abort()
  }, [contestId])
  useEffect(() => {
    let current = true
    let request: AbortController | null = null
    const loadContestAlerts = () => {
      if (!contestId) { setContestAlertCount(0); return }
      if (request) return
      request = new AbortController()
      api.alerts({ contestId, openOnly: true }, request.signal).then(alerts => { if (current && !request?.signal.aborted) setContestAlertCount(alerts.length) }).catch(error => {
        if (current && !isAbortError(error)) console.warn('刷新赛事异常信号失败', error)
      }).finally(() => { request = null })
    }
    loadContestAlerts()
    const timer = window.setInterval(loadContestAlerts, 30000)
    return () => { current = false; request?.abort(); window.clearInterval(timer) }
  }, [contestId])

  const contest = contests.find(c => c.id === contestId)
  const pageTitle = view === 'history' && selectedPerformance ? `${selectedUser?.name || '用户'} · ${selectedPerformance.problemTitle} · 详细记录` : view === 'history' && selectedUser ? `${selectedUser.name} · 用户详情` : nav.find(item => item.key === view)?.label || '管理设置'
  const latestRun = summary.latestPoll?.[0]
  const latestRunStatus = latestRun?.status
  const sourceState = latestRunStatus === 'FAILED' ? '最近一次失败' : latestRunStatus === 'RUNNING' ? '采集中' : latestRunStatus === 'SUCCESS' ? '正常' : '等待采集'
  const sourceTone = latestRunStatus === 'FAILED' ? 'warning' : latestRunStatus === 'RUNNING' ? 'primary' : latestRunStatus === 'SUCCESS' ? 'success' : 'default'
  const go = (next: View) => { setView(next); setMobileOpen(false) }
  const openAlert = (alert: Alert) => { setSelectedUser(null); setSelectedPerformance(null); if (alert.contestId) setContestId(alert.contestId); if (alert.problemId) { setProblemId(alert.problemId); go("ranking"); return } go(alert.contestId ? "overview" : "polls") }
  if (loading && !contests.length) return <div className="app-loading"><Spinner size="lg" color="primary" /><span>正在连接监控服务…</span></div>
  return <div className="app-shell">
    <aside className={`app-sider ${mobileOpen ? 'open' : ''}`}>
      <div className="brand"><span className="brand-mark"><Gauge size={18} /></span><div><strong>CANNJudge Watcher</strong><small>Leaderboard console</small></div><button className="mobile-close" onClick={() => setMobileOpen(false)} aria-label="关闭菜单"><X size={17} /></button></div>
      <nav className="side-nav">{nav.map(item => { const Icon = item.icon; return <button key={item.key} className={view === item.key ? 'active' : ''} onClick={() => go(item.key)}><Icon size={17} strokeWidth={1.8} /><span>{item.label}</span>{item.key === 'alerts' && contestAlertCount > 0 && <b>{contestAlertCount}</b>}</button> })}</nav>
      <div className="side-foot"><button className={view === 'settings' ? 'active' : ''} onClick={() => go('settings')}><Settings2 size={17} /><span>管理设置</span></button><small>公开榜单监测 · {contests.length} 场赛事</small></div>
    </aside>
    {mobileOpen && <button className="mobile-overlay" onClick={() => setMobileOpen(false)} aria-label="关闭导航" />}
    <section className="app-main">
      <header className="app-header"><div className="heading-wrap"><Button isIconOnly variant="light" className="mobile-menu" onPress={() => setMobileOpen(true)} aria-label="打开菜单"><Menu size={19} /></Button><div><h1>{pageTitle}</h1><p>{selectedPerformance?.contestTitle || contest?.title || 'CANNJudge 公开赛事'}</p></div></div><div className="header-tools"><Select aria-label="选择赛事" size="sm" className="contest-select" selectedKeys={contestId ? new Set([contestId]) : new Set()} onSelectionChange={keys => { const next = Array.from(keys)[0]; if (next) setContestId(String(next)) }}>{contests.map(c => <SelectItem key={c.id}>{c.title}</SelectItem>)}</Select><Chip size="sm" color={sourceTone} variant="flat" startContent={<span className={`status-dot ${sourceTone === 'warning' ? 'warn' : sourceTone === 'primary' ? 'running' : ''}`} />}>{sourceState}</Chip><span className="header-time"><Timestamp value={latestRun?.finished_at || latestRun?.started_at || summary.last_finished} /></span><Button isIconOnly size="sm" variant="light" onPress={() => void loadBase()} isLoading={loading} aria-label="刷新数据"><RefreshCw size={16} /></Button></div></header>
      <main className="app-content"><div className="mobile-tabs"><Tabs aria-label="页面导航" selectedKey={view} onSelectionChange={key => go(String(key) as View)}><Tab key="ranking" title="榜单" /><Tab key="overview" title="概览" /><Tab key="history" title="详情" /><Tab key="alerts" title="异常" /><Tab key="polls" title="采集" /></Tabs></div>{view === 'ranking' && <RankingView contestId={contestId} problems={problems} problemId={problemId} onProblemChange={setProblemId} onUserSelect={user => { setSelectedPerformance(null); setSelectedUser(user); go('history') }} />}{view === 'overview' && <OverviewView summary={summary} contestAlertCount={contestAlertCount} contestId={contestId} problems={problems} pollIntervalSeconds={contest?.pollIntervalSeconds} onProblem={id => { setProblemId(id); go('ranking') }} />}{view === 'history' && (selectedPerformance ? <HistoryView key={`${selectedPerformance.contestId}-${selectedPerformance.problemId}-${selectedPerformance.teamKey}`} contestId={selectedPerformance.contestId} problemId={selectedPerformance.problemId} problems={[{ id: selectedPerformance.problemId, contestId: selectedPerformance.contestId, slug: '', title: selectedPerformance.problemTitle }]} teamKey={selectedPerformance.teamKey} teamName={selectedPerformance.teamName} contestTitle={selectedPerformance.contestTitle} onBack={() => setSelectedPerformance(null)} /> : <UserDetailView user={selectedUser} onSelectUser={user => setSelectedUser(user)} onSelectPerformance={setSelectedPerformance} />)}{view === 'alerts' && <AlertsView contestId={contestId} onOpenAlert={openAlert} />}{view === 'polls' && <PollsView />}{view === 'settings' && <SettingsView contests={contests} onReload={() => void loadBase()} />}</main>
    </section>
  </div>
}

function StatCard({ label, value, hint, icon: Icon }: { label: string; value: ReactNode; hint: string; icon: typeof Users }) { return <Card shadow="none" className="stat-card"><CardBody><div className="stat-label"><span>{label}</span><Icon size={16} /></div><strong>{value}</strong><small>{hint}</small></CardBody></Card> }
function Toolbar({ children, note }: { children: ReactNode; note?: string }) { return <div className="toolbar">{children}{note && <span className="toolbar-note">{note}</span>}</div> }
function Empty({ text }: { text: string }) { return <div className="empty"><CircleHelp size={18} /><span>{text}</span></div> }
function LoadingRows() { return <div className="panel-loading"><Spinner color="primary" /><span>正在加载…</span></div> }
function Chart({ option, height }: { option: any; height: number }) { return <Suspense fallback={<LoadingRows />}><ReactECharts option={option} style={{ height }} /></Suspense> }
function Status({ value }: { value?: string }) { return <Chip size="sm" color={statusColor(value)} variant="flat">{statusLabel(value)}</Chip> }
function Timestamp({ value }: { value?: string | number | null }) { const label = fmt(value); const full = fmtFull(value); return <time title={full === '—' ? undefined : full}>{label}</time> }
function RankMovement({ rank, previousRank }: { rank?: number; previousRank?: number }) {
  if (rank == null || previousRank == null) return null
  const delta = previousRank - rank
  const title = `较上一条性能记录：#${previousRank} → #${rank}`
  if (delta === 0) return <span className="rank-movement rank-flat" title={title} aria-label="名次未变化">—</span>
  const improved = delta > 0
  return <span className={`rank-movement ${improved ? 'rank-up' : 'rank-down'}`} title={title} aria-label={`名次${improved ? '上升' : '下降'} ${Math.abs(delta)} 位`}>{improved ? '↑' : '↓'} {Math.abs(delta)}</span>
}

function RankingView({ contestId, problems, problemId, onProblemChange, onUserSelect }: { contestId: string; problems: Problem[]; problemId: string; onProblemChange: (id: string) => void; onUserSelect: (user: SelectedUser) => void }) {
  const [rows, setRows] = useState<Ranking[]>([]); const [caseBests, setCaseBests] = useState<CaseBestSummary>({ global: {}, teams: {} }); const [activeCaseSetId, setActiveCaseSetId] = useState<string | null>(null); const [showAllCaseVersions, setShowAllCaseVersions] = useState(false); const [query, setQuery] = useState(''); const [status, setStatus] = useState(''); const [loading, setLoading] = useState(false); const [loadError, setLoadError] = useState(''); const requestRef = useRef<AbortController | null>(null)
  const load = useCallback(async () => { if (!contestId || !problemId) return; requestRef.current?.abort(); const controller = new AbortController(); requestRef.current = controller; setLoading(true); setLoadError(''); try { const ranking = await api.rankings(contestId, problemId, { status }, controller.signal); if (!controller.signal.aborted) { setRows(ranking.items); setCaseBests(ranking.caseBests || { global: {}, teams: {} }); setActiveCaseSetId(ranking.activeCaseSetId || null) } } catch (error) { if (!isAbortError(error) && !controller.signal.aborted) setLoadError((error as Error).message || '加载榜单失败') } finally { if (requestRef.current === controller) setLoading(false) } }, [contestId, problemId, status])
  useEffect(() => { void load(); return () => requestRef.current?.abort() }, [load])
  useEffect(() => {
    const timer = window.setInterval(() => void load(), 30000)
    return () => window.clearInterval(timer)
  }, [load])
  useEffect(() => { setShowAllCaseVersions(false) }, [contestId, problemId])
  const filtered = rows.filter(row => !query || `${row.team_name} ${row.user_nickname} ${row.submitter_nickname}`.toLowerCase().includes(query.toLowerCase()))
  const topRank = rows.reduce<number | undefined>((best, row) => row.rank == null ? best : Math.min(best ?? row.rank, row.rank), undefined)
  const caseIds = useMemo(() => {
    const ids: string[] = []; const seen = new Set<string>()
    rows.forEach(row => (row.result || []).forEach((item, index) => { const caseId = caseKey(item, index); if (!seen.has(caseId)) { seen.add(caseId); ids.push(caseId) } }))
    Object.keys(caseBests.global).forEach(caseId => { if (!seen.has(caseId)) { seen.add(caseId); ids.push(caseId) } })
    return ids
  }, [caseBests.global, rows])
  const currentCaseIds = useMemo(() => activeCaseSetId
    ? caseIds.filter(caseId => caseSetForKey(caseId) === activeCaseSetId)
    : caseIds, [activeCaseSetId, caseIds])
  const historicalCaseCount = caseIds.length - currentCaseIds.length
  const visibleCaseIds = showAllCaseVersions ? caseIds : currentCaseIds
  const rankingColumns = useMemo(() => [
    { key: 'rank', label: '官方名次' }, { key: 'team', label: '队伍 / 提交者' }, { key: 'status', label: '状态' }, { key: 'records', label: '总记录数' },
    ...visibleCaseIds.map((caseId, index) => ({ key: `case:${caseId}`, label: <div className="ranking-case-header" title={caseId}><strong>用例 {index + 1}</strong>{showAllCaseVersions && caseVersionLabel(caseId) && <small className="case-version">版本 {caseVersionLabel(caseId)}</small>}<span>全场最佳 {formatMetric(caseBests.global[caseId])} μs</span></div> })),
    { key: 'updated', label: '最后提交' },
  ], [caseBests.global, showAllCaseVersions, visibleCaseIds])
  return <div className="panel-stack"><div className="stat-grid"><StatCard label="官方榜单" value={rows.length} hint="支队伍" icon={Table2} /><StatCard label="通过队伍" value={rows.filter(r => r.status === 'Pass').length} hint="当前题目" icon={Check} /><StatCard label="Top 10" value={rows.filter(r => (r.rank ?? Number.POSITIVE_INFINITY) <= 10).length} hint={topRank ? `最高官方名次 #${topRank}` : '暂无官方名次'} icon={Users} /><StatCard label="最近更新" value={fmt(rows[0]?.updated_at || rows[0]?.observed_at)} hint="采样时间" icon={Clock3} /></div><Card shadow="none" className="content-card data-card ranking-card"><Toolbar note={loadError || `${filtered.length} 条 · ${fmt(rows[0]?.updated_at || rows[0]?.observed_at)}`}><Select aria-label="选择题目" size="sm" className="topic-select" selectedKeys={problemId ? new Set([problemId]) : new Set()} onSelectionChange={keys => { const next = Array.from(keys)[0]; if (next) onProblemChange(String(next)) }}>{problems.map(p => <SelectItem key={p.id}>{p.title}</SelectItem>)}</Select><Select aria-label="筛选状态" size="sm" className="status-select" selectedKeys={new Set([status])} onSelectionChange={keys => setStatus(String(Array.from(keys)[0] || ''))}><SelectItem key="">全部状态</SelectItem><SelectItem key="Pass">通过</SelectItem><SelectItem key="CompileError">编译错误</SelectItem><SelectItem key="WrongAnswer">答案错误</SelectItem></Select>{activeCaseSetId && historicalCaseCount > 0 && <div className="case-version-switch" role="group" aria-label="用例版本"><button type="button" aria-pressed={!showAllCaseVersions} onClick={() => setShowAllCaseVersions(false)}>当前版本 ({currentCaseIds.length})</button><button type="button" aria-pressed={showAllCaseVersions} onClick={() => setShowAllCaseVersions(true)}>全部版本 ({caseIds.length})</button></div>}<Input aria-label="搜索用户" size="sm" className="search-input" placeholder="搜索用户或队伍" startContent={<Search size={15} />} value={query} onValueChange={setQuery} /><Button size="sm" variant="flat" startContent={<RefreshCw size={14} />} onPress={() => void load()} isLoading={loading}>刷新</Button></Toolbar><div className="ranking-table-scroll"><Table aria-label="最新榜单及逐测试点成绩" removeWrapper className="data-table ranking-case-table"><TableHeader columns={rankingColumns}>{column => <TableColumn key={column.key}>{column.label}</TableColumn>}</TableHeader><TableBody emptyContent={<Empty text={loadError || '没有匹配的在榜队伍'} />} items={filtered}>{row => <TableRow key={`${row.team_key}-${row.rank}`}>{columnKey => { const key = String(columnKey); if (key === 'rank') return <TableCell><div className="rank-cell"><span className="rank">#{row.rank ?? '—'}</span><RankMovement rank={row.rank} previousRank={row.previous_rank} /></div></TableCell>; if (key === 'team') return <TableCell><div className="team-detail-cell"><button className="team-link" onClick={() => onUserSelect({ id: row.user_id, nickname: row.user_nickname, name: row.user_nickname || teamLabel(row.team_name) })}><strong>{row.user_nickname || teamLabel(row.team_name)}</strong><small>{teamLabel(row.team_name)}</small></button><button type="button" className="detail-link" onClick={() => onUserSelect({ id: row.user_id, nickname: row.user_nickname, name: row.user_nickname || teamLabel(row.team_name) })}><ArrowRight size={13} />查看详情</button></div></TableCell>; if (key === 'status') return <TableCell><Status value={row.status} /></TableCell>; if (key === 'records') return <TableCell>{row.record_count ?? '—'}</TableCell>; if (key === 'updated') return <TableCell>{fmt(row.create_time || row.updated_at || row.observed_at)}</TableCell>; const caseId = key.slice('case:'.length); const current = (row.result || []).find((item, index) => caseKey(item, index) === caseId); const currentTime = timeValue(current?.time); const previous = (row.previous_result || []).find((item, index) => caseKey(item, index) === caseId); const personalBest = row.team_key ? caseBests.teams[row.team_key]?.[caseId] : undefined; return <TableCell><div className="ranking-case-cell"><strong className={currentTime == null ? 'case-status' : ''}>{currentTime == null ? statusLabel(current?.status) : `${formatMetric(currentTime)} μs${current?.status && current.status !== 'Pass' ? ` · ${statusLabel(current.status)}` : ''}`}</strong><small>个人最佳 {formatMetric(personalBest)} μs</small><small className={`case-delta ${caseDeltaClass(current, previous)}`}>较上次 {caseDeltaText(current, previous)}</small></div></TableCell> }}</TableRow>}</TableBody></Table></div></Card></div>
}

function OverviewView({ summary, contestAlertCount, contestId, problems, pollIntervalSeconds, onProblem }: { summary: Summary; contestAlertCount: number; contestId: string; problems: Problem[]; pollIntervalSeconds?: number; onProblem: (id: string) => void }) {
  const [overview, setOverview] = useState<ContestOverview>({ problems: {}, activity: [] }); const [loading, setLoading] = useState(true); const [loadError, setLoadError] = useState('')
  useEffect(() => { if (!contestId || !problems.length) { setOverview({ problems: {}, activity: [] }); setLoading(false); return } const controller = new AbortController(); setLoading(true); setLoadError(''); api.contestOverview(contestId, controller.signal).then(data => { if (!controller.signal.aborted) setOverview(data) }).catch(error => { if (!isAbortError(error) && !controller.signal.aborted) setLoadError((error as Error).message || '加载赛事概览失败') }).finally(() => { if (!controller.signal.aborted) setLoading(false) }); return () => controller.abort() }, [contestId, problems])
  const items = useMemo<OverviewItem[]>(() => problems.map(problem => { const counts = overview.problems[problem.id] || { rowCount: 0, passCount: 0, eventCount: 0 }; return { problem, rowCount: counts.rowCount, passCount: counts.passCount, events: counts.eventCount } }), [overview.problems, problems])
  const chart = useMemo(() => ({ tooltip: { trigger: 'axis' }, legend: { top: 0, textStyle: { color: '#667085' } }, grid: { left: 42, right: 18, top: 34, bottom: 34 }, xAxis: { type: 'category', data: items.map(i => i.problem.title.slice(0, 10)), axisLabel: { color: '#7b8790' } }, yAxis: { type: 'value', splitLine: { lineStyle: { color: '#edf0f3' } } }, series: [{ name: '在榜队伍', type: 'bar', data: items.map(i => i.rowCount), itemStyle: { color: '#006fee', borderRadius: [5, 5, 0, 0] } }, { name: '通过队伍', type: 'bar', data: items.map(i => i.passCount), itemStyle: { color: '#17c964', borderRadius: [5, 5, 0, 0] } }] }), [items])
  const activity = useMemo(() => overview.activity.map(point => ({ timestamp: new Date(point.observed_at).getTime(), changes: point.changes, deletes: point.deletes, improvements: point.improvements ?? 0, regressions: point.regressions ?? 0 })).filter(point => Number.isFinite(point.timestamp)), [overview.activity])
  const activityChart = useMemo(() => {
    const labels = activity.map(point => new Date(point.timestamp).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }))
    return { tooltip: { trigger: 'axis' }, legend: { top: 0, textStyle: { color: '#667085' } }, grid: { left: 42, right: 18, top: 34, bottom: 42 }, xAxis: { type: 'category', data: labels, axisLabel: { color: '#7b8790', hideOverlap: true } }, yAxis: { type: 'value', minInterval: 1, name: '性能变化记录', nameTextStyle: { color: '#7b8790' }, axisLabel: { color: '#7b8790' }, splitLine: { lineStyle: { color: '#edf0f3' } } }, series: [{ name: '性能变好', type: 'line', stack: 'performance', smooth: true, showSymbol: false, data: activity.map(point => point.improvements), itemStyle: { color: '#17c964' }, lineStyle: { color: '#17c964', width: 2 }, areaStyle: { color: 'rgba(23, 201, 100, .20)' } }, { name: '性能变差', type: 'line', stack: 'performance', smooth: true, showSymbol: false, data: activity.map(point => point.regressions), itemStyle: { color: '#f31260' }, lineStyle: { color: '#f31260', width: 2 }, areaStyle: { color: 'rgba(243, 18, 96, .16)' } }, { name: '离榜/删除', type: 'bar', data: activity.map(point => point.deletes), itemStyle: { color: '#f5a524', borderRadius: [4, 4, 0, 0] }, barMaxWidth: 18 }] }
  }, [activity])
  const totalPerformanceChanges = activity.reduce((sum, point) => sum + point.improvements + point.regressions, 0)
  return <div className="panel-stack"><div className="stat-grid"><StatCard label="在榜记录" value={items.reduce((sum, i) => sum + i.rowCount, 0)} hint="当前赛事" icon={Table2} /><StatCard label="通过队伍" value={items.reduce((sum, i) => sum + i.passCount, 0)} hint="当前赛事" icon={Users} /><StatCard label="开放告警" value={contestAlertCount} hint="当前赛事" icon={AlertCircle} /><StatCard label="采集间隔" value={`${Math.round((pollIntervalSeconds || 120) / 60)} 分钟`} hint="当前赛事" icon={Clock3} /></div><Card shadow="none" className="content-card activity-card"><CardHeader><div><h2>榜单活跃度</h2></div><Chip size="sm" variant="flat">{totalPerformanceChanges} 次性能变化</Chip></CardHeader><CardBody>{loading ? <LoadingRows /> : loadError ? <Empty text={loadError} /> : activity.length ? <Chart option={activityChart} height={280} /> : <Empty text="最近 7 天暂无榜单变动" />}</CardBody></Card><div className="overview-grid"><Card shadow="none" className="content-card chart-card"><CardHeader><div><h2>赛题分布</h2></div></CardHeader><CardBody>{loading ? <LoadingRows /> : loadError ? <Empty text={loadError} /> : <Chart option={chart} height={340} />}</CardBody></Card><Card shadow="none" className="content-card data-card"><CardHeader><div><h2>赛题状态</h2></div></CardHeader><Table aria-label="赛题状态" removeWrapper className="data-table compact-table"><TableHeader><TableColumn>赛题</TableColumn><TableColumn>在榜</TableColumn><TableColumn>通过</TableColumn><TableColumn>变化事件</TableColumn></TableHeader><TableBody emptyContent={<Empty text={loadError || '暂无赛题数据'} />} items={items}>{item => <TableRow key={item.problem.id}><TableCell><button className="topic-link" onClick={() => onProblem(item.problem.id)}>{item.problem.title}</button></TableCell><TableCell>{item.rowCount}</TableCell><TableCell>{item.passCount}</TableCell><TableCell>{item.events}</TableCell></TableRow>}</TableBody></Table></Card></div></div>
}

function UserDetailView({ user, onSelectUser, onSelectPerformance }: { user: SelectedUser | null; onSelectUser: (user: SelectedUser | null) => void; onSelectPerformance: (performance: SelectedPerformance) => void }) {
  const [items, setItems] = useState<UserPerformanceItem[]>([])
  const [resolvedUser, setResolvedUser] = useState<{ id?: string; nickname?: string }>({})
  const [query, setQuery] = useState('')
  const [loading, setLoading] = useState(false)
  const [loadError, setLoadError] = useState('')

  const load = useCallback(() => {
    if (!user?.id && !user?.nickname) {
      setItems([]); setResolvedUser({}); setLoadError(''); return () => undefined
    }
    const controller = new AbortController()
    setLoading(true); setLoadError('')
    api.userPerformance(user.id, user.nickname, controller.signal).then(data => {
      if (!controller.signal.aborted) { setItems(data.items); setResolvedUser({ id: data.userId, nickname: data.userNickname }) }
    }).catch(error => {
      if (!isAbortError(error) && !controller.signal.aborted) setLoadError((error as Error).message || '加载用户表现失败')
    }).finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => controller.abort()
  }, [user?.id, user?.nickname])
  useEffect(() => load(), [load])

  const contestRows = useMemo(() => {
    const grouped = new Map<string, { id: string; title: string; status?: string; problemCount: number; passCount: number; bestRank?: number; latest?: string; teams: Set<string> }>()
    items.forEach(item => {
      const row = grouped.get(item.contest_id) || { id: item.contest_id, title: item.contest_title, status: item.contest_status, problemCount: 0, passCount: 0, bestRank: undefined, latest: item.observed_at, teams: new Set<string>() }
      row.problemCount += 1
      if (item.status === 'Pass') row.passCount += 1
      if (item.best_rank != null) row.bestRank = Math.min(row.bestRank ?? item.best_rank, item.best_rank)
      if (item.observed_at && (!row.latest || new Date(item.observed_at).getTime() > new Date(row.latest).getTime())) row.latest = item.observed_at
      if (item.team_name) row.teams.add(teamLabel(item.team_name))
      grouped.set(item.contest_id, row)
    })
    return Array.from(grouped.values()).sort((a, b) => new Date(b.latest || 0).getTime() - new Date(a.latest || 0).getTime())
  }, [items])
  const visibleItems = useMemo(() => items.filter(item => !query || `${item.contest_title} ${item.problem_title} ${item.team_name || ''} ${item.status || ''}`.toLowerCase().includes(query.toLowerCase())), [items, query])
  const problemCount = new Set(items.map(item => `${item.contest_id}:${item.problem_id}`)).size
  const passedCount = items.filter(item => item.status === 'Pass').length
  const bestRank = items.reduce<number | undefined>((best, item) => item.best_rank == null ? best : Math.min(best ?? item.best_rank, item.best_rank), undefined)
  const latest = items.reduce<string | undefined>((latestValue, item) => !item.observed_at || latestValue && new Date(latestValue).getTime() >= new Date(item.observed_at).getTime() ? latestValue : item.observed_at, undefined)

  if (!user) return <UserDirectoryView onSelectUser={onSelectUser} />
  const displayName = resolvedUser.nickname || user.nickname || user.name
  return <div className="panel-stack">
    <Card shadow="none" className="content-card user-profile-card"><CardBody><div className="user-profile-head"><div><span className="eyebrow">USER PROFILE</span><h2>{displayName}</h2><p>{resolvedUser.id || user.id ? `用户 ID：${resolvedUser.id || user.id}` : '按昵称匹配历史表现'}</p></div><div className="user-profile-actions"><Chip size="sm" color={loadError ? 'warning' : 'primary'} variant="flat">{loadError ? '加载失败' : `${items.length} 条表现记录`}</Chip><Button size="sm" variant="flat" startContent={<Users size={14} />} onPress={() => onSelectUser(null)}>选择其他用户</Button></div></div></CardBody></Card>
    <div className="stat-grid"><StatCard label="参与赛事" value={contestRows.length} hint="全部已采集赛事" icon={Table2} /><StatCard label="覆盖题目" value={problemCount} hint="赛事内去重" icon={LayoutDashboard} /><StatCard label="当前通过" value={passedCount} hint="最新题目状态" icon={Check} /><StatCard label="历史最好名次" value={bestRank == null ? '—' : `#${bestRank}`} hint={latest ? `最近观测 ${fmt(latest)}` : '暂无观测'} icon={Gauge} /></div>
    <Card shadow="none" className="content-card data-card user-contests-card"><CardHeader><div><h2>赛事表现</h2><p>按赛事汇总该用户的题目状态与历史最好名次</p></div></CardHeader>{loading ? <LoadingRows /> : <Table aria-label="用户赛事表现汇总" removeWrapper className="data-table"><TableHeader><TableColumn>赛事</TableColumn><TableColumn>题目数</TableColumn><TableColumn>通过</TableColumn><TableColumn>历史最好名次</TableColumn><TableColumn>参与队伍</TableColumn><TableColumn>最近观测</TableColumn></TableHeader><TableBody emptyContent={<Empty text={loadError || '暂无跨赛事表现记录'} />} items={contestRows}>{row => <TableRow key={row.id}><TableCell><div className="user-contest-name"><strong>{row.title}</strong><small>{row.status === 'ACTIVE' ? '进行中' : '已结束'}</small></div></TableCell><TableCell>{row.problemCount}</TableCell><TableCell>{row.passCount}</TableCell><TableCell>{row.bestRank == null ? '—' : `#${row.bestRank}`}</TableCell><TableCell>{row.teams.size ? Array.from(row.teams).join('、') : '—'}</TableCell><TableCell><Timestamp value={row.latest} /></TableCell></TableRow>}</TableBody></Table>}</Card>
    <Card shadow="none" className="content-card data-card user-items-card"><Toolbar note={loadError || `${visibleItems.length} 条题目表现`}><div className="section-head"><div><h2>题目明细</h2><p>点击对应题目旁的入口，查看该用户在这道题的完整历史</p></div></div><Input aria-label="搜索赛事或题目" size="sm" className="search-input" placeholder="搜索赛事、题目或队伍" startContent={<Search size={15} />} value={query} onValueChange={setQuery} /><Button size="sm" variant="flat" startContent={<RefreshCw size={14} />} onPress={() => void load()}>刷新</Button></Toolbar><div className="ranking-table-scroll"><Table aria-label="用户全部赛事题目表现" removeWrapper className="data-table user-performance-table"><TableHeader><TableColumn>赛事 / 题目</TableColumn><TableColumn>队伍</TableColumn><TableColumn>当前状态</TableColumn><TableColumn>当前名次</TableColumn><TableColumn>历史最好</TableColumn><TableColumn>性能记录</TableColumn><TableColumn>最后观测</TableColumn></TableHeader><TableBody emptyContent={<Empty text={loadError || '没有匹配的题目表现'} />} items={visibleItems}>{item => <TableRow key={`${item.contest_id}-${item.problem_id}-${item.team_key}`}><TableCell><div className="user-item-title"><strong>{item.contest_title}</strong><small>{item.problem_title}</small><button type="button" className="detail-link user-action" onClick={() => onSelectPerformance({ contestId: item.contest_id, contestTitle: item.contest_title, problemId: item.problem_id, problemTitle: item.problem_title, teamKey: item.team_key || '', teamName: teamLabel(item.team_name) })}><ArrowRight size={13} />查看该题详细记录</button></div></TableCell><TableCell>{teamLabel(item.team_name)}</TableCell><TableCell><Status value={item.status} /></TableCell><TableCell>{item.rank == null ? '—' : `#${item.rank}`}</TableCell><TableCell>{item.best_rank == null ? '—' : `#${item.best_rank}`}</TableCell><TableCell>{item.event_count ?? '—'} 次</TableCell><TableCell><Timestamp value={item.observed_at} /></TableCell></TableRow>}</TableBody></Table></div></Card>
  </div>
}

function UserDirectoryView({ onSelectUser }: { onSelectUser: (user: SelectedUser | null) => void }) {
  const [users, setUsers] = useState<UserDirectoryItem[]>([])
  const [query, setQuery] = useState('')
  const [loading, setLoading] = useState(false)
  const [loadError, setLoadError] = useState('')
  const load = useCallback(() => {
    const controller = new AbortController(); setLoading(true); setLoadError('')
    api.users(controller.signal).then(data => { if (!controller.signal.aborted) setUsers(data) }).catch(error => {
      if (!isAbortError(error) && !controller.signal.aborted) setLoadError((error as Error).message || '加载用户目录失败')
    }).finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => controller.abort()
  }, [])
  useEffect(() => load(), [load])
  const visible = useMemo(() => users.filter(item => !query || `${item.user_nickname || ''} ${item.user_id || ''}`.toLowerCase().includes(query.toLowerCase())), [query, users])
  return <div className="panel-stack"><Card shadow="none" className="content-card data-card user-directory-card"><CardHeader><div><h2>选择用户</h2><p>从所有已采集赛事中查找用户，查看其完整表现</p></div></CardHeader><Toolbar note={loadError || `${visible.length} / ${users.length} 位用户`}><Input aria-label="搜索用户" size="sm" className="search-input" placeholder="搜索昵称或用户 ID" startContent={<Search size={15} />} value={query} onValueChange={setQuery} /><Button size="sm" variant="flat" startContent={<RefreshCw size={14} />} onPress={() => void load()} isLoading={loading}>刷新</Button></Toolbar>{loading && !users.length ? <LoadingRows /> : <div className="ranking-table-scroll"><Table aria-label="用户目录" removeWrapper className="data-table user-directory-table"><TableHeader><TableColumn>用户</TableColumn><TableColumn>参与赛事</TableColumn><TableColumn>覆盖题目</TableColumn><TableColumn>表现记录</TableColumn><TableColumn>最近观测</TableColumn><TableColumn>操作</TableColumn></TableHeader><TableBody emptyContent={<Empty text={loadError || '没有匹配的用户'} />} items={visible}>{item => <TableRow key={item.user_key}><TableCell><div className="user-directory-name"><strong>{item.user_nickname || '未命名用户'}</strong><small>{item.user_id || '无用户 ID'}</small></div></TableCell><TableCell>{item.contest_count}</TableCell><TableCell>{item.problem_count}</TableCell><TableCell>{item.event_count}</TableCell><TableCell><Timestamp value={item.latest_observed_at} /></TableCell><TableCell><button type="button" className="detail-link user-action" onClick={() => onSelectUser({ id: item.user_id, nickname: item.user_nickname, name: item.user_nickname || item.user_id || '未命名用户' })}><ArrowRight size={13} />查看详情</button></TableCell></TableRow>}</TableBody></Table></div>}</Card></div>
}

function HistoryView({ contestId, problemId, problems, teamKey, teamName, contestTitle, onBack }: { contestId: string; problemId: string; problems: Problem[]; teamKey: string; teamName: string; contestTitle: string; onBack: () => void }) {
  const [days, setDays] = useState('all'); const [history, setHistory] = useState<HistoryPoint[]>([]); const [caseBests, setCaseBests] = useState<CaseBestSummary>({ global: {}, teams: {} }); const [loading, setLoading] = useState(false); const [loadError, setLoadError] = useState('')
  useEffect(() => { if (!teamKey || !contestId || !problemId) { setHistory([]); setCaseBests({ global: {}, teams: {} }); setLoadError(''); return } const controller = new AbortController(); setLoading(true); setLoadError(''); const from = days === 'all' ? '1970-01-01T00:00:00.000Z' : rangeStart(Number(days)); api.history(contestId, problemId, from, undefined, { teamKey, signal: controller.signal }).then(data => { if (!controller.signal.aborted) { setHistory(data.items); setCaseBests(data.caseBests || { global: {}, teams: {} }) } }).catch(error => { if (!isAbortError(error) && !controller.signal.aborted) setLoadError((error as Error).message || '加载队伍历史失败') }).finally(() => { if (!controller.signal.aborted) setLoading(false) }); return () => controller.abort() }, [contestId, problemId, teamKey, days])
  const chart = useMemo(() => ({ tooltip: { trigger: 'axis' }, grid: { left: 56, right: 28, top: 36, bottom: 36 }, xAxis: { type: 'time' }, yAxis: { type: 'value', name: '官方名次', inverse: true, min: 1, minInterval: 1 }, series: [{ name: '官方名次', type: 'line', smooth: true, showSymbol: false, data: history.filter(p => p.rank != null).map(p => [p.observed_at, Number(p.rank)]), itemStyle: { color: '#006fee' }, lineStyle: { width: 2 }, areaStyle: { color: 'rgba(0, 111, 238, .08)' } }] }), [history])
  const caseIds = useMemo(() => {
    const ids: string[] = []; const seen = new Set<string>()
    history.forEach(point => (point.result || []).forEach((item, index) => { const caseId = caseKey(item, index); if (!seen.has(caseId)) { seen.add(caseId); ids.push(caseId) } }))
    return ids
  }, [history])
  const observationColumns = useMemo(() => {
    const personalBests = caseBests.teams[teamKey] || {}
    return [{ key: 'observedAt', label: '观测时间' }, ...caseIds.map((caseId, index) => ({ key: caseId, label: <div className="case-history-header" title={caseId}><strong>用例 {index + 1}</strong>{caseVersionLabel(caseId) && <small className="case-version">版本 {caseVersionLabel(caseId)}</small>}<span>个人 {formatMetric(personalBests[caseId])} μs</span><span>全局 {formatMetric(caseBests.global[caseId])} μs</span></div> }))]
  }, [caseBests, caseIds, teamKey])
  const observationRows = useMemo(() => {
    type Observation = { observedAt?: string; values: Map<string, { value?: number; status?: string }> }
    type CaseObservation = { value?: number; status?: string; previous?: number }
    type ObservationRow = { observedAt?: string; cases: Record<string, CaseObservation> }
    const grouped = new Map<string, Observation>()
    history.forEach(point => {
      const groupKey = point.observed_at || `unknown-${grouped.size}`
      const row: Observation = grouped.get(groupKey) || { observedAt: point.observed_at, values: new Map<string, { value?: number; status?: string }>() }
      ;(point.result || []).forEach((item, index) => row.values.set(caseKey(item, index), { value: timeValue(item.time) ?? undefined, status: item.status }))
      grouped.set(groupKey, row)
    })
    const previousByCase = new Map<string, number | undefined>()
    return Array.from(grouped.values())
      .sort((a, b) => new Date(a.observedAt || 0).getTime() - new Date(b.observedAt || 0).getTime())
      .map<ObservationRow>(row => {
        const cases: Record<string, CaseObservation> = {}
        caseIds.forEach(caseId => {
          const observation = row.values.get(caseId); const value = observation?.value
          const previous = previousByCase.get(caseId)
          cases[caseId] = { value, status: observation?.status, previous }
          previousByCase.set(caseId, value)
        })
        return { observedAt: row.observedAt, cases }
      })
  }, [caseIds, history])
  const performanceChart = useMemo(() => {
    const baseline = new Map<string, number>()
    history.forEach(point => (point.result || []).forEach((item, index) => {
      const value = timeValue(item.time)
      const id = caseKey(item, index)
      if (value != null && !baseline.has(id)) baseline.set(id, value)
    }))
    const data = history.flatMap(point => {
      const byCase = new Map((point.result || []).map((item, index) => [caseKey(item, index), item]))
      const ratios = caseIds.map(id => {
        const item = byCase.get(id); const value = timeValue(item?.time)
        const initial = baseline.get(id)
        return value != null && initial != null ? initial / value : null
      })
      const validRatios = ratios.filter((value): value is number => value != null)
      if (!point.observed_at || !ratios.length || validRatios.length !== ratios.length) return []
      const index = Math.exp(validRatios.reduce((sum, value) => sum + Math.log(value), 0) / validRatios.length) * 100
      return [[point.observed_at, Number(index.toFixed(2))]]
    })
    return { tooltip: { trigger: 'axis', valueFormatter: (value: number) => `${value.toFixed(2)} 指数` }, grid: { left: 56, right: 28, top: 36, bottom: 36 }, xAxis: { type: 'time' }, yAxis: { type: 'value', name: '性能指数', axisLabel: { formatter: '{value}' }, splitLine: { lineStyle: { color: '#edf0f3' } } }, series: [{ name: '归一化性能', type: 'line', smooth: true, showSymbol: false, data, itemStyle: { color: '#17c964' }, lineStyle: { color: '#17c964', width: 2 }, areaStyle: { color: 'rgba(23, 201, 100, .13)' }, markLine: { symbol: 'none', label: { formatter: '基线 100' }, lineStyle: { color: '#aab5bf', type: 'dashed' }, data: [{ yAxis: 100 }] } }] }
  }, [caseIds, history])
  if (!teamName) return <Card shadow="none" className="content-card empty-card"><Empty text="请先从最新榜单选择队伍" /></Card>
  const problem = problems.find(p => p.id === problemId); const latest = history.at(-1); const bestRank = history.reduce<number | undefined>((best, item) => item.rank == null ? best : Math.min(best ?? item.rank, item.rank), undefined)
  return <div className="panel-stack"><Card shadow="none" className="content-card history-card"><Toolbar note={loadError || undefined}><Button size="sm" variant="flat" startContent={<ArrowLeft size={14} />} onPress={onBack}>返回用户详情</Button><div className="history-title"><strong>{teamName}</strong><span>{contestTitle} · {problem?.title || '当前题目'}</span></div><Select aria-label="趋势时间范围" size="sm" className="range-select" selectedKeys={new Set([days])} onSelectionChange={keys => setDays(String(Array.from(keys)[0] || 'all'))}><SelectItem key="all">全部记录</SelectItem><SelectItem key="1">最近 24 小时</SelectItem><SelectItem key="7">最近 7 天</SelectItem><SelectItem key="30">最近 30 天</SelectItem></Select></Toolbar>{loading ? <LoadingRows /> : history.length ? <Chart option={chart} height={360} /> : <Empty text={loadError || '该时间范围内暂无历史观测'} />}</Card><Card shadow="none" className="content-card history-card"><CardHeader><div><h2>归一化性能趋势</h2></div></CardHeader><CardBody>{loading ? <LoadingRows /> : history.length && caseIds.length ? <Chart option={performanceChart} height={280} /> : <Empty text={loadError || '暂无可归一的性能观测'} />}</CardBody></Card><div className="history-summary"><StatCard label="当前官方名次" value={latest?.rank == null ? '—' : `#${latest.rank}`} hint="最近一次观测" icon={Table2} /><StatCard label="历史最高名次" value={bestRank == null ? '—' : `#${bestRank}`} hint="仅按官方名次" icon={Check} /><StatCard label="变化事件" value={history.length} hint="无损历史" icon={BarChart3} /></div><Card shadow="none" className="content-card case-card"><CardHeader><div><h2>测试点完整历史</h2></div><Chip size="sm" variant="flat">{caseIds.length} 个 case</Chip></CardHeader><CardBody><Table aria-label="测试点按观测时间的完整历史" removeWrapper className="data-table history-table case-history-table"><TableHeader columns={observationColumns}>{column => <TableColumn key={column.key}>{column.label}</TableColumn>}</TableHeader><TableBody emptyContent={<Empty text={loadError || '暂无测试点历史'} />} items={observationRows}>{row => <TableRow key={row.observedAt || 'unknown'}>{columnKey => { const key = String(columnKey); if (key === 'observedAt') return <TableCell>{fmt(row.observedAt)}</TableCell>; const observation = row.cases[key]; return <TableCell><div className="case-history-cell"><strong>{observation?.value == null ? statusLabel(observation?.status) : `${formatMetric(observation.value)} μs${observation?.status && observation.status !== 'Pass' ? ` · ${statusLabel(observation.status)}` : ''}`}</strong><small className={changeClass(observation?.value, observation?.previous)}>较上次 {changeText(observation?.value, observation?.previous)}</small></div></TableCell> }}</TableRow>}</TableBody></Table></CardBody></Card></div>
}

function AlertsView({ contestId, onOpenAlert }: { contestId: string; onOpenAlert: (alert: Alert) => void }) {
  const [alerts, setAlerts] = useState<Alert[]>([]); const [severityFilter, setSeverityFilter] = useState('all'); const [loading, setLoading] = useState(true); const [loadError, setLoadError] = useState(''); const requestRef = useRef<AbortController | null>(null)
  const load = useCallback(async () => { requestRef.current?.abort(); const controller = new AbortController(); requestRef.current = controller; setLoading(true); setLoadError(''); try { const next = await api.alerts({ contestId: contestId || undefined }, controller.signal); if (!controller.signal.aborted) setAlerts(next) } catch (error) { if (!isAbortError(error) && !controller.signal.aborted) setLoadError((error as Error).message || '加载异常信号失败') } finally { if (requestRef.current === controller) setLoading(false) } }, [contestId])
  useEffect(() => { void load(); return () => requestRef.current?.abort() }, [load])
  const visible = alerts.filter(alert => severityFilter === 'all' || (severityFilter === 'high' ? ['HIGH', 'ERROR'].includes(alert.severity) : !['HIGH', 'ERROR'].includes(alert.severity)))
  const acknowledge = async (alert: Alert) => {
    try {
      const token = (await api.csrf()).token
      await api.acknowledge(alert.id, token)
      setAlerts(current => current.map(item => item.id === alert.id ? { ...item, acknowledgedAt: new Date().toISOString() } : item))
    } catch (error) { setLoadError((error as Error).message || '确认告警失败') }
  }
  const high = alerts.filter(alert => ['HIGH', 'ERROR'].includes(alert.severity)).length; const info = alerts.filter(alert => !['HIGH', 'ERROR'].includes(alert.severity)).length; const latest = alerts[0]
  return <div className="panel-stack"><div className="alert-overview"><Card shadow="none" className="risk-card risk-danger"><CardBody><span>高风险信号</span><strong>{high}</strong><small>需要优先查看证据</small></CardBody></Card><Card shadow="none" className="risk-card risk-warning"><CardBody><span>关注信号</span><strong>{info}</strong><small>仅表示数据变化</small></CardBody></Card><Card shadow="none" className="risk-card risk-neutral"><CardBody><span>最新信号</span><strong>{latest ? signalLabel(latest.ruleCode) : '—'}</strong><small>{fmt(latest?.createdAt)}</small></CardBody></Card></div><Card shadow="none" className="content-card data-card"><Toolbar note={loadError || '异常信号保留原始证据，不作违规定性'}><div className="alert-summary"><ShieldCheck size={16} /><strong>{visible.length} 条原始变化信号</strong></div><Select aria-label="信号级别" size="sm" className="range-select" selectedKeys={new Set([severityFilter])} onSelectionChange={keys => setSeverityFilter(String(Array.from(keys)[0] || 'all'))}><SelectItem key="all">全部级别</SelectItem><SelectItem key="high">高风险</SelectItem><SelectItem key="watch">关注</SelectItem></Select><Button size="sm" variant="flat" startContent={<RefreshCw size={14} />} onPress={() => void load()} isLoading={loading}>刷新</Button></Toolbar><Table aria-label="异常信号" removeWrapper className="data-table alerts-table"><TableHeader><TableColumn>时间</TableColumn><TableColumn>变化类型</TableColumn><TableColumn>严重度</TableColumn><TableColumn>证据</TableColumn><TableColumn>来源</TableColumn><TableColumn>操作</TableColumn></TableHeader><TableBody emptyContent={<Empty text={loadError || '暂无异常信号'} />} items={visible}>{alert => <TableRow key={alert.id}><TableCell>{fmt(alert.createdAt)}</TableCell><TableCell><button type="button" className="signal-link" onClick={() => onOpenAlert(alert)} title={alert.problemId ? "打开对应题目榜单" : alert.contestId ? "打开赛事概览" : "打开采集运行"}><Chip size="sm" color={alertColor(alert.severity)} variant="flat">{signalLabel(alert.ruleCode)}</Chip><strong>{alert.title}</strong><ChevronRight size={15} /></button></TableCell><TableCell><Chip size="sm" color={alertColor(alert.severity)} variant="flat">{alert.severity || 'INFO'}</Chip></TableCell><TableCell><div className="evidence-cell"><strong>{alert.message}</strong>{alert.evidence && <small>{Object.entries(alert.evidence).map(([key, value]) => `${key}: ${String(value)}`).join(' · ')}</small>}</div></TableCell><TableCell>{alert.contestId ? 'CANNJudge 采集器' : '系统监控'}</TableCell><TableCell>{alert.acknowledgedAt ? '已确认' : <Button size="sm" variant="flat" onPress={() => void acknowledge(alert)}>确认</Button>}</TableCell></TableRow>}</TableBody></Table></Card></div>
}

type PollOutcomeKey = 'idle' | 'unchanged' | 'changed' | 'empty' | 'failed' | 'unknown' | 'running'
type PollOutcome = { key: PollOutcomeKey; label: string; color: 'default' | 'primary' | 'success' | 'warning' | 'danger'; detail: string }

function pollOutcome(run: PollRun): PollOutcome {
  if (run.status === 'FAILED') return { key: 'failed', label: '采集失败', color: 'danger', detail: run.contests_polled == null ? '本轮采集场数未记录' : '已尝试 ' + run.contests_polled + ' 场后中断' }
  if (run.status === 'RUNNING') return { key: 'running', label: '运行中', color: 'primary', detail: '本轮统计尚未完成' }
  if (run.contests_polled == null) {
    if ((run.changed_rows ?? 0) > 0) return { key: 'changed', label: '历史有变更', color: 'success', detail: '旧记录未保存实际采集场数' }
    if ((run.rows_seen ?? 0) > 0) return { key: 'unchanged', label: '历史采集无变化', color: 'default', detail: '扫描到榜单行；旧记录未保存实际采集场数' }
    return { key: 'unknown', label: '历史范围待判定', color: 'warning', detail: '旧记录无法区分未到期与空榜单' }
  }
  if (run.contests_polled === 0) return { key: 'idle', label: '无赛事实际采集', color: 'default', detail: '本轮没有满足采集条件的赛事' }
  if ((run.rows_seen ?? 0) === 0) return { key: 'empty', label: '已采集 · 0 行', color: 'warning', detail: '实际采集 ' + run.contests_polled + ' 场，未返回榜单行' }
  if ((run.changed_rows ?? 0) > 0) return { key: 'changed', label: '已采集 · 有变更', color: 'success', detail: '本轮检测到榜单变化' }
  return { key: 'unchanged', label: '已采集 · 无变化', color: 'default', detail: '榜单已扫描，但与上次相比无变化' }
}

function pollDuration(run: PollRun) {
  if (!run.started_at || !run.finished_at) return '—'
  const seconds = (Date.parse(run.finished_at) - Date.parse(run.started_at)) / 1000
  if (!Number.isFinite(seconds) || seconds < 0) return '—'
  if (seconds < 60) return seconds.toFixed(1) + ' 秒'
  const total = Math.round(seconds)
  return Math.floor(total / 60) + ' 分 ' + (total % 60) + ' 秒'
}

function PollsView() {
  const [runs, setRuns] = useState<PollRun[]>([]); const [loading, setLoading] = useState(true)
  useEffect(() => { const controller = new AbortController(); api.polls(controller.signal).then(runs => { if (!controller.signal.aborted) setRuns(runs) }).catch(error => { if (!isAbortError(error)) console.warn('加载采集运行失败', error) }).finally(() => { if (!controller.signal.aborted) setLoading(false) }); return () => controller.abort() }, [])
  const counts = useMemo(() => {
    const result: Record<PollOutcomeKey, number> = { idle: 0, unchanged: 0, changed: 0, empty: 0, failed: 0, unknown: 0, running: 0 }
    runs.forEach(run => { result[pollOutcome(run).key] += 1 })
    return result
  }, [runs])
  return <Card shadow="none" className="content-card data-card"><Toolbar note={'最近 ' + runs.length + ' 条记录 · 旧记录待判定 ' + counts.unknown + ' 条'}><div className="alert-summary"><Clock3 size={16} /><strong>采集运行</strong></div></Toolbar><div className="poll-run-summary"><Chip size="sm" color="default" variant="flat">无赛事实际采集 {counts.idle}</Chip><Chip size="sm" color="default" variant="flat">已采集无变化 {counts.unchanged}</Chip><Chip size="sm" color="warning" variant="flat">采集但无榜单行 {counts.empty}</Chip><Chip size="sm" color="success" variant="flat">有变更 {counts.changed}</Chip><Chip size="sm" color="danger" variant="flat">失败 {counts.failed}</Chip><Chip size="sm" color="primary" variant="flat">运行中 {counts.running}</Chip></div>{loading ? <LoadingRows /> : <Table aria-label="采集运行" removeWrapper className="data-table polls-table"><TableHeader><TableColumn>本轮结果</TableColumn><TableColumn>开始</TableColumn><TableColumn>完成</TableColumn><TableColumn>耗时</TableColumn><TableColumn>赛事（发现 / 采集）</TableColumn><TableColumn>榜单行</TableColumn><TableColumn>变更行</TableColumn><TableColumn>错误</TableColumn></TableHeader><TableBody emptyContent={<Empty text="暂无采集记录" />} items={runs}>{run => { const outcome = pollOutcome(run); return <TableRow key={run.id}><TableCell><div className="poll-run-result"><Chip size="sm" color={outcome.color} variant="flat">{outcome.label}</Chip><small>{outcome.detail}</small></div></TableCell><TableCell>{fmt(run.started_at)}</TableCell><TableCell>{fmt(run.finished_at)}</TableCell><TableCell>{pollDuration(run)}</TableCell><TableCell>{run.contests_seen ?? '—'} / {run.contests_polled ?? '—'}</TableCell><TableCell>{run.rows_seen ?? '—'}</TableCell><TableCell>{run.changed_rows ?? '—'}</TableCell><TableCell>{run.error_message || '—'}</TableCell></TableRow> }}</TableBody></Table>}</Card>
}

function SettingsView({ contests, onReload }: { contests: Contest[]; onReload: () => void }) {
  const [authenticated, setAuthenticated] = useState(false); const [username, setUsername] = useState(''); const [password, setPassword] = useState(''); const [showPassword, setShowPassword] = useState(false); const [message, setMessage] = useState(''); const [settings, setSettings] = useState<Record<string, string>>({}); const [busy, setBusy] = useState(false)
  useEffect(() => { api.me().then(data => { setAuthenticated(data.authenticated); if (data.authenticated) api.settings().then(setSettings) }) }, [])
  const login = async () => { setMessage(''); setBusy(true); try { await api.login(username, password); setAuthenticated(true); setMessage('登录成功'); setSettings(await api.settings()) } catch (e) { setMessage((e as Error).message) } finally { setBusy(false) } }
  const toggle = async (contest: Contest) => { try { const token = (await api.csrf()).token; await api.monitor(contest.id, !contest.monitoringEnabled, contest.pollIntervalSeconds, token); onReload() } catch (error) { setMessage((error as Error).message || '更新赛事监控失败') } }
  const runNow = async () => { try { const token = (await api.csrf()).token; const result = await api.runPoll(token); setMessage(result.accepted ? '已加入采集队列' : '已有采集任务运行中') } catch (error) { setMessage((error as Error).message || '启动采集失败') } }
  if (!authenticated) return <div className="auth-stage"><Card shadow="none" className="content-card auth-card"><CardBody><div className="auth-brand"><span className="auth-icon"><LockKeyhole size={19} strokeWidth={2.1} /></span><div><strong>CANNJudge Watcher</strong><span>管理员控制台</span></div></div><div className="auth-intro"><div className="eyebrow">欢迎回来</div><h2>登录管理控制台</h2></div><form className="auth-form" onSubmit={(event: FormEvent<HTMLFormElement>) => { event.preventDefault(); void login() }}><Input label="用户名" placeholder="请输入用户名" variant="bordered" isRequired value={username} onValueChange={setUsername} autoComplete="username" /><Input label="密码" placeholder="请输入密码" variant="bordered" isRequired type={showPassword ? 'text' : 'password'} value={password} onValueChange={setPassword} autoComplete="current-password" endContent={<Button type="button" isIconOnly size="sm" variant="light" className="password-toggle" onPress={() => setShowPassword(value => !value)} aria-label={showPassword ? '隐藏密码' : '显示密码'}>{showPassword ? <EyeOff size={17} /> : <Eye size={17} />}</Button>} /><Button type="submit" color="primary" size="lg" endContent={!busy && <ArrowRight size={17} />} isLoading={busy}>登录</Button>{message && <span className={`form-message ${message === '登录成功' ? 'success' : 'error'}`} role="alert">{message}</span>}</form><div className="auth-footnote"><ShieldCheck size={14} /><span>使用安全会话 Cookie · 公开榜单无需登录</span></div></CardBody></Card></div>
  return <div className="panel-stack"><Card shadow="none" className="content-card"><CardHeader><div><h2>运行控制</h2></div></CardHeader><CardBody><div className="settings-actions"><Button color="primary" startContent={<RefreshCw size={15} />} onPress={() => void runNow()}>立即采集</Button><Button variant="flat" startContent={<LogOut size={15} />} onPress={async () => { try { const token = (await api.csrf()).token; await api.logoutWithToken(token); setAuthenticated(false) } catch (error) { setMessage((error as Error).message || '退出登录失败') } }}>退出登录</Button>{message && <span className="form-message">{message}</span>}</div><Divider /><div className="setting-fields"><Input label="默认采集间隔（秒）" type="number" value={settings.default_poll_interval_seconds || '120'} onValueChange={value => setSettings(prev => ({ ...prev, default_poll_interval_seconds: value }))} /><Input label="告警冷却时间（分钟）" type="number" value={settings.alert_cooldown_minutes || '30'} onValueChange={value => setSettings(prev => ({ ...prev, alert_cooldown_minutes: value }))} /><Button variant="flat" onPress={async () => { try { const token = (await api.csrf()).token; await api.updateSettings(settings, token); setMessage('设置已保存') } catch (error) { setMessage((error as Error).message || '保存设置失败') } }}>保存全局设置</Button></div></CardBody></Card><Card shadow="none" className="content-card data-card"><CardHeader><div><h2>赛事监控</h2></div></CardHeader><Table aria-label="赛事监控设置" removeWrapper className="data-table"><TableHeader><TableColumn>赛事</TableColumn><TableColumn>状态</TableColumn><TableColumn>间隔</TableColumn><TableColumn>源状态</TableColumn><TableColumn>开关</TableColumn></TableHeader><TableBody items={contests}>{contest => <TableRow key={contest.id}><TableCell><strong>{contest.title}</strong></TableCell><TableCell><Chip size="sm" color={contest.status === 'ACTIVE' ? 'success' : 'default'} variant="flat">{contest.status === 'ACTIVE' ? '进行中' : '已停用'}</Chip></TableCell><TableCell>{Math.round(contest.pollIntervalSeconds / 60)} 分钟</TableCell><TableCell>{contest.sourceStatus || '—'}</TableCell><TableCell><Button size="sm" variant={contest.monitoringEnabled ? 'flat' : 'bordered'} onPress={() => void toggle(contest)}>{contest.monitoringEnabled ? '监控中' : '已停用'}</Button></TableCell></TableRow>}</TableBody></Table></Card></div>
}
