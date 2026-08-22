import { useCallback, useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react'
import { Button, Card, CardBody, CardHeader, Chip, Divider, Input, Select, SelectItem, Spinner, Tab, Table, TableBody, TableCell, TableColumn, TableHeader, TableRow, Tabs } from '@heroui/react'
import { AlertCircle, ArrowRight, BarChart3, Check, ChevronRight, CircleHelp, Clock3, Eye, EyeOff, Gauge, LayoutDashboard, LockKeyhole, LogOut, Menu, RefreshCw, Search, Settings2, ShieldCheck, Table2, Users, X } from 'lucide-react'
import ReactECharts from 'echarts-for-react'
import { api } from './api'
import { alertColor, fmt, rangeStart, score, statusColor, statusLabel } from './format'
import type { Alert, Contest, HistoryPoint, PollRun, Problem, ProblemStats, Ranking, Summary } from './types'

type View = 'ranking' | 'overview' | 'history' | 'alerts' | 'polls' | 'settings'
type OverviewItem = { problem: Problem; rows: Ranking[]; events: number; history: HistoryPoint[] }
const nav: Array<{ key: View; label: string; icon: typeof Table2 }> = [
  { key: 'ranking', label: '最新榜单', icon: Table2 }, { key: 'overview', label: '概览', icon: LayoutDashboard },
  { key: 'history', label: '队伍趋势', icon: BarChart3 }, { key: 'alerts', label: '异常信号', icon: AlertCircle },
  { key: 'polls', label: '采集运行', icon: Clock3 },
]

const signalLabel = (rule?: string) => ({ SCORE_CHANGE: '分数变化', RANK_CHANGE: '名次变化', ROW_COUNT_CHANGE: '榜单规模变化', POLL_FAILURE: '采集失败', DATA_GAP: '数据断档' } as Record<string, string>)[rule || ''] || rule || '变化信号'
const timeValue = (value?: number) => value == null || value <= 0 ? null : value
const caseKey = (item: { testcaseId?: string }, index: number) => item.testcaseId || `case-${index + 1}`
const changeText = (current?: number | null, previous?: number | null) => current == null || previous == null ? '—' : `${current - previous > 0 ? '+' : ''}${(current - previous).toFixed(2)} μs`
const changeClass = (current?: number | null, previous?: number | null) => current == null || previous == null ? '' : current > previous ? 'metric-down' : current < previous ? 'metric-up' : 'metric-flat'

export default function App() {
  const [view, setView] = useState<View>('ranking')
  const [summary, setSummary] = useState<Summary>({})
  const [contests, setContests] = useState<Contest[]>([])
  const [contestId, setContestId] = useState('')
  const [problems, setProblems] = useState<Problem[]>([])
  const [problemId, setProblemId] = useState('')
  const [selectedTeam, setSelectedTeam] = useState('')
  const [loading, setLoading] = useState(true)
  const [mobileOpen, setMobileOpen] = useState(false)
  const [contestAlertCount, setContestAlertCount] = useState(0)

  const loadBase = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true)
    try {
      const [nextSummary, nextContests] = await Promise.all([api.summary(), api.contests()])
      setSummary(nextSummary); setContests(nextContests)
      setContestId(current => current || nextContests.find(c => c.status === 'ACTIVE' && c.monitoringEnabled)?.id || nextContests[0]?.id || '')
    } finally { if (!quiet) setLoading(false) }
  }, [])
  useEffect(() => { void loadBase() }, [loadBase])
  useEffect(() => { const timer = window.setInterval(() => void loadBase(true), 30000); return () => window.clearInterval(timer) }, [loadBase])
  useEffect(() => { if (!contestId) return; api.contest(contestId).then(data => { setProblems(data.problems); setProblemId(current => current && data.problems.some(p => p.id === current) ? current : data.problems[0]?.id || '') }) }, [contestId])
  useEffect(() => {
    let current = true
    const loadContestAlerts = () => {
      if (!contestId) { setContestAlertCount(0); return }
      api.alerts({ contestId, openOnly: true }).then(alerts => { if (current) setContestAlertCount(alerts.length) }).catch(() => { if (current) setContestAlertCount(0) })
    }
    loadContestAlerts()
    const timer = window.setInterval(loadContestAlerts, 30000)
    return () => { current = false; window.clearInterval(timer) }
  }, [contestId])

  const contest = contests.find(c => c.id === contestId)
  const pageTitle = view === 'history' && selectedTeam ? `${selectedTeam} · 队伍趋势` : nav.find(item => item.key === view)?.label || '管理设置'
  const latestRun = summary.latestPoll?.[0]
  const latestRunStatus = latestRun?.status
  const sourceState = latestRunStatus === 'FAILED' ? '最近一次失败' : latestRunStatus === 'RUNNING' ? '采集中' : latestRunStatus === 'SUCCESS' ? '正常' : '等待采集'
  const sourceTone = latestRunStatus === 'FAILED' ? 'warning' : latestRunStatus === 'RUNNING' ? 'primary' : latestRunStatus === 'SUCCESS' ? 'success' : 'default'
  const go = (next: View) => { setView(next); setMobileOpen(false) }
  if (loading && !contests.length) return <div className="app-loading"><Spinner size="lg" color="primary" /><span>正在连接监控服务…</span></div>
  return <div className="app-shell">
    <aside className={`app-sider ${mobileOpen ? 'open' : ''}`}>
      <div className="brand"><span className="brand-mark"><Gauge size={18} /></span><div><strong>CANNJudge Watcher</strong><small>Leaderboard console</small></div><button className="mobile-close" onClick={() => setMobileOpen(false)} aria-label="关闭菜单"><X size={17} /></button></div>
      <nav className="side-nav">{nav.map(item => { const Icon = item.icon; return <button key={item.key} className={view === item.key ? 'active' : ''} onClick={() => go(item.key)}><Icon size={17} strokeWidth={1.8} /><span>{item.label}</span>{item.key === 'alerts' && contestAlertCount > 0 && <b>{contestAlertCount}</b>}</button> })}</nav>
      <div className="side-foot"><button className={view === 'settings' ? 'active' : ''} onClick={() => go('settings')}><Settings2 size={17} /><span>管理设置</span></button><small>公开榜单监测 · {contests.length} 场赛事</small></div>
    </aside>
    {mobileOpen && <button className="mobile-overlay" onClick={() => setMobileOpen(false)} aria-label="关闭导航" />}
    <section className="app-main">
      <header className="app-header"><div className="heading-wrap"><Button isIconOnly variant="light" className="mobile-menu" onPress={() => setMobileOpen(true)} aria-label="打开菜单"><Menu size={19} /></Button><div><h1>{pageTitle}</h1><p>{contest?.title || 'CANNJudge 公开赛事'}</p></div></div><div className="header-tools"><Select aria-label="选择赛事" size="sm" className="contest-select" selectedKeys={contestId ? new Set([contestId]) : new Set()} onSelectionChange={keys => { const next = Array.from(keys)[0]; if (next) setContestId(String(next)) }}>{contests.map(c => <SelectItem key={c.id}>{c.title}</SelectItem>)}</Select><Chip size="sm" color={sourceTone} variant="flat" startContent={<span className={`status-dot ${sourceTone === 'warning' ? 'warn' : sourceTone === 'primary' ? 'running' : ''}`} />}>{sourceState}</Chip><span className="header-time">{fmt(latestRun?.finished_at || latestRun?.started_at || summary.last_finished)}</span><Button isIconOnly size="sm" variant="light" onPress={() => void loadBase()} aria-label="刷新数据"><RefreshCw size={16} /></Button></div></header>
      <main className="app-content"><div className="mobile-tabs"><Tabs aria-label="页面导航" selectedKey={view} onSelectionChange={key => go(String(key) as View)}><Tab key="ranking" title="榜单" /><Tab key="overview" title="概览" /><Tab key="history" title="趋势" /><Tab key="alerts" title="异常" /><Tab key="polls" title="采集" /></Tabs></div>{view === 'ranking' && <RankingView contestId={contestId} problems={problems} problemId={problemId} onProblemChange={setProblemId} onTeamSelect={team => { setSelectedTeam(team); go('history') }} />}{view === 'overview' && <OverviewView summary={summary} contestAlertCount={contestAlertCount} contestId={contestId} problems={problems} onProblem={id => { setProblemId(id); go('ranking') }} />}{view === 'history' && <HistoryView contestId={contestId} problemId={problemId} problems={problems} teamName={selectedTeam} />}{view === 'alerts' && <AlertsView contestId={contestId} />}{view === 'polls' && <PollsView />}{view === 'settings' && <SettingsView contests={contests} onReload={() => void loadBase()} />}</main>
    </section>
  </div>
}

function StatCard({ label, value, hint, icon: Icon }: { label: string; value: string | number; hint: string; icon: typeof Users }) { return <Card shadow="none" className="stat-card"><CardBody><div className="stat-label"><span>{label}</span><Icon size={16} /></div><strong>{value}</strong><small>{hint}</small></CardBody></Card> }
function Toolbar({ children, note }: { children: ReactNode; note?: string }) { return <div className="toolbar">{children}{note && <span className="toolbar-note">{note}</span>}</div> }
function Empty({ text }: { text: string }) { return <div className="empty"><CircleHelp size={18} /><span>{text}</span></div> }
function LoadingRows() { return <div className="panel-loading"><Spinner color="primary" /><span>正在加载…</span></div> }
function Status({ value }: { value?: string }) { return <Chip size="sm" color={statusColor(value)} variant="flat">{statusLabel(value)}</Chip> }

function RankingView({ contestId, problems, problemId, onProblemChange, onTeamSelect }: { contestId: string; problems: Problem[]; problemId: string; onProblemChange: (id: string) => void; onTeamSelect: (team: string) => void }) {
  const [rows, setRows] = useState<Ranking[]>([]); const [bestScores, setBestScores] = useState<Record<string, number>>({}); const [query, setQuery] = useState(''); const [status, setStatus] = useState(''); const [loading, setLoading] = useState(false)
  const load = useCallback(async () => { if (!contestId || !problemId) return; setLoading(true); try { const [result, history] = await Promise.all([api.rankings(contestId, problemId, { status }), api.history(contestId, problemId, new Date(0).toISOString())]); const best: Record<string, number> = {}; history.items.forEach(item => { if (!item.team_key || item.score == null) return; best[item.team_key] = Math.max(best[item.team_key] ?? Number.NEGATIVE_INFINITY, Number(item.score)) }); result.items.forEach(item => { if (item.team_key && item.score != null) best[item.team_key] = Math.max(best[item.team_key] ?? Number.NEGATIVE_INFINITY, Number(item.score)) }); setRows(result.items); setBestScores(best) } finally { setLoading(false) } }, [contestId, problemId, status])
  useEffect(() => { void load() }, [load])
  const filtered = rows.filter(row => !query || `${row.team_name} ${row.user_nickname} ${row.submitter_nickname}`.toLowerCase().includes(query.toLowerCase()))
  const chartRows = filtered.slice(0, 15); const chart = useMemo(() => ({ tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } }, legend: { top: 0, textStyle: { color: '#667085' } }, grid: { left: 142, right: 24, top: 38, bottom: 22 }, xAxis: { type: 'value', min: 0, name: '分数', nameTextStyle: { color: '#7b8790' }, axisLabel: { color: '#7b8790' }, splitLine: { lineStyle: { color: '#edf0f3' } } }, yAxis: { type: 'category', inverse: true, data: chartRows.map(r => r.team_name || '未命名队伍'), axisLabel: { color: '#53616b', width: 120, overflow: 'truncate' }, axisTick: { show: false } }, series: [{ name: '最新分数', type: 'bar', data: chartRows.map(r => r.score || 0), itemStyle: { color: '#006fee', borderRadius: [0, 5, 5, 0] }, barMaxWidth: 16 }, { name: '历史最佳', type: 'bar', data: chartRows.map(r => bestScores[r.team_key || ''] ?? r.score ?? 0), itemStyle: { color: '#9ebff5', borderRadius: [0, 5, 5, 0] }, barMaxWidth: 16 }] }), [bestScores, chartRows])
  return <div className="panel-stack"><div className="stat-grid"><StatCard label="当前榜单" value={rows.length} hint="支队伍" icon={Users} /><StatCard label="通过队伍" value={rows.filter(r => r.status === 'Pass').length} hint="当前题目" icon={Check} /><StatCard label="最高分" value={score(rows[0]?.score)} hint="最新成绩" icon={Gauge} /><StatCard label="最近更新" value={fmt(rows[0]?.updated_at || rows[0]?.observed_at)} hint="采样时间" icon={Clock3} /></div><Card shadow="none" className="content-card data-card ranking-card"><Toolbar note={`${filtered.length} 条 · ${fmt(rows[0]?.updated_at || rows[0]?.observed_at)}`}><Select aria-label="选择题目" size="sm" className="topic-select" selectedKeys={problemId ? new Set([problemId]) : new Set()} onSelectionChange={keys => { const next = Array.from(keys)[0]; if (next) onProblemChange(String(next)) }}>{problems.map(p => <SelectItem key={p.id}>{p.title}</SelectItem>)}</Select><Select aria-label="筛选状态" size="sm" className="status-select" selectedKeys={new Set([status])} onSelectionChange={keys => setStatus(String(Array.from(keys)[0] || ''))}><SelectItem key="">全部状态</SelectItem><SelectItem key="Pass">通过</SelectItem><SelectItem key="CompileError">编译错误</SelectItem><SelectItem key="WrongAnswer">答案错误</SelectItem></Select><Input aria-label="搜索队伍" size="sm" className="search-input" placeholder="搜索队伍或提交者" startContent={<Search size={15} />} value={query} onValueChange={setQuery} /><Button size="sm" variant="flat" startContent={<RefreshCw size={14} />} onPress={() => void load()} isLoading={loading}>刷新</Button></Toolbar>{filtered.length > 0 && <section className="chart-section"><div className="section-head"><div><h3>最新分数与历史最佳</h3><p>历史最佳为采集系统观测到的该队伍最高分数</p></div><Chip size="sm" variant="flat">Top {Math.min(15, filtered.length)}</Chip></div><ReactECharts option={chart} style={{ height: Math.max(300, chartRows.length * 28 + 74) }} /></section>}<Table aria-label="最新榜单" removeWrapper className="data-table"><TableHeader><TableColumn>排名</TableColumn><TableColumn>队伍 / 提交者</TableColumn><TableColumn>最新分数</TableColumn><TableColumn>历史最佳</TableColumn><TableColumn>变化</TableColumn><TableColumn>状态</TableColumn><TableColumn>测试点</TableColumn><TableColumn>最后提交</TableColumn></TableHeader><TableBody emptyContent={<Empty text="没有匹配的在榜队伍" />} items={filtered}>{row => { const best = bestScores[row.team_key || ''] ?? row.score; const delta = row.score == null || best == null ? null : row.score - best; return <TableRow key={`${row.team_key}-${row.rank}`}><TableCell><span className="rank">#{row.rank ?? '—'}</span></TableCell><TableCell><button className="team-link" onClick={() => onTeamSelect(row.team_name || '')}><strong>{row.team_name || '未命名队伍'}</strong><small>{row.user_nickname || row.submitter_nickname || '—'}</small></button></TableCell><TableCell><strong className="score-value">{score(row.score)}</strong></TableCell><TableCell><strong className="best-score">{score(best)}</strong></TableCell><TableCell><span className={delta != null && delta < 0 ? 'score-gap negative' : 'score-gap'}>{delta == null || Math.abs(delta) < .005 ? '最佳' : `${delta > 0 ? '+' : ''}${delta.toFixed(2)}`}</span></TableCell><TableCell><Status value={row.status} /></TableCell><TableCell>{row.result?.length ?? '—'}</TableCell><TableCell>{fmt(row.create_time || row.updated_at || row.observed_at)}</TableCell></TableRow> }}</TableBody></Table></Card></div>
}

function OverviewView({ summary, contestAlertCount, contestId, problems, onProblem }: { summary: Summary; contestAlertCount: number; contestId: string; problems: Problem[]; onProblem: (id: string) => void }) {
  const [items, setItems] = useState<OverviewItem[]>([]); const [loading, setLoading] = useState(true)
  useEffect(() => { if (!contestId || !problems.length) { setItems([]); setLoading(false); return } setLoading(true); Promise.all(problems.map(async problem => { const [result, history] = await Promise.all([api.rankings(contestId, problem.id), api.history(contestId, problem.id, rangeStart(7))]); return { problem, rows: result.items, events: history.items.length, history: history.items } })).then(setItems).finally(() => setLoading(false)) }, [contestId, problems])
  const chart = useMemo(() => ({ tooltip: { trigger: 'axis' }, legend: { top: 0, textStyle: { color: '#667085' } }, grid: { left: 42, right: 18, top: 34, bottom: 34 }, xAxis: { type: 'category', data: items.map(i => i.problem.title.slice(0, 10)), axisLabel: { color: '#7b8790' } }, yAxis: { type: 'value', splitLine: { lineStyle: { color: '#edf0f3' } } }, series: [{ name: '在榜队伍', type: 'bar', data: items.map(i => i.rows.length), itemStyle: { color: '#006fee', borderRadius: [5, 5, 0, 0] } }, { name: '通过队伍', type: 'bar', data: items.map(i => i.rows.filter(r => r.status === 'Pass').length), itemStyle: { color: '#17c964', borderRadius: [5, 5, 0, 0] } }] }), [items])
  const activity = useMemo(() => {
    const buckets = new Map<number, { changes: number; deletes: number }>()
    items.forEach(item => item.history.forEach(event => {
      if (!event.observed_at) return
      const time = new Date(event.observed_at).getTime()
      if (!Number.isFinite(time)) return
      const bucket = Math.floor(time / 3600000) * 3600000
      const current = buckets.get(bucket) || { changes: 0, deletes: 0 }
      current.changes += 1
      if (event.event_type === 'DELETE') current.deletes += 1
      buckets.set(bucket, current)
    }))
    return Array.from(buckets.entries()).sort(([a], [b]) => a - b).map(([timestamp, values]) => ({ timestamp, ...values }))
  }, [items])
  const activityChart = useMemo(() => {
    const labels = activity.map(point => new Date(point.timestamp).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }))
    return { tooltip: { trigger: 'axis' }, legend: { top: 0, textStyle: { color: '#667085' } }, grid: { left: 42, right: 18, top: 34, bottom: 42 }, xAxis: { type: 'category', data: labels, axisLabel: { color: '#7b8790', hideOverlap: true } }, yAxis: { type: 'value', minInterval: 1, name: '事件数', nameTextStyle: { color: '#7b8790' }, axisLabel: { color: '#7b8790' }, splitLine: { lineStyle: { color: '#edf0f3' } } }, series: [{ name: '榜单变动', type: 'line', smooth: true, showSymbol: false, data: activity.map(point => point.changes), itemStyle: { color: '#006fee' }, lineStyle: { color: '#006fee', width: 2 }, areaStyle: { color: 'rgba(0, 111, 238, .12)' } }, { name: '离榜/删除', type: 'bar', data: activity.map(point => point.deletes), itemStyle: { color: '#f5a524', borderRadius: [4, 4, 0, 0] }, barMaxWidth: 18 }] }
  }, [activity])
  const totalChanges = activity.reduce((sum, point) => sum + point.changes, 0)
  return <div className="panel-stack"><div className="stat-grid"><StatCard label="在榜记录" value={items.reduce((sum, i) => sum + i.rows.length, 0)} hint="当前赛事" icon={Table2} /><StatCard label="独立队伍" value={new Set(items.flatMap(i => i.rows.map(r => r.team_key))).size} hint="当前赛事" icon={Users} /><StatCard label="开放告警" value={contestAlertCount} hint="当前赛事" icon={AlertCircle} /><StatCard label="采集间隔" value={`${Math.round((summary.latestPoll?.[0]?.finished_at ? 120 : 120) / 60)} 分钟`} hint="默认周期" icon={Clock3} /></div><Card shadow="none" className="content-card activity-card"><CardHeader><div><h2>榜单活跃度</h2><p>最近 7 天按小时统计榜单变化事件，反映榜单变动强度</p></div><Chip size="sm" variant="flat">{totalChanges} 次变动</Chip></CardHeader><CardBody>{loading ? <LoadingRows /> : activity.length ? <ReactECharts option={activityChart} style={{ height: 280 }} /> : <Empty text="最近 7 天暂无榜单变动" />}</CardBody></Card><div className="overview-grid"><Card shadow="none" className="content-card chart-card"><CardHeader><div><h2>赛题分布</h2><p>当前榜单队伍与通过队伍</p></div></CardHeader><CardBody>{loading ? <LoadingRows /> : <ReactECharts option={chart} style={{ height: 340 }} />}</CardBody></Card><Card shadow="none" className="content-card data-card"><CardHeader><div><h2>赛题状态</h2><p>点击题目进入最新榜单</p></div></CardHeader><Table aria-label="赛题状态" removeWrapper className="data-table compact-table"><TableHeader><TableColumn>赛题</TableColumn><TableColumn>在榜</TableColumn><TableColumn>通过</TableColumn><TableColumn>变化事件</TableColumn><TableColumn>异常</TableColumn></TableHeader><TableBody emptyContent={<Empty text="暂无赛题数据" />} items={items}>{item => <TableRow key={item.problem.id}><TableCell><button className="topic-link" onClick={() => onProblem(item.problem.id)}>{item.problem.title}</button></TableCell><TableCell>{item.rows.length}</TableCell><TableCell>{item.rows.filter(r => r.status === 'Pass').length}</TableCell><TableCell>{item.events}</TableCell><TableCell>{item.rows.some(r => r.status !== 'Pass') ? <Chip size="sm" color="warning" variant="flat">需关注</Chip> : '—'}</TableCell></TableRow>}</TableBody></Table></Card></div></div>
}

function HistoryView({ contestId, problemId, problems, teamName }: { contestId: string; problemId: string; problems: Problem[]; teamName: string }) {
  const [days, setDays] = useState('7'); const [history, setHistory] = useState<HistoryPoint[]>([]); const [loading, setLoading] = useState(false)
  useEffect(() => { if (!teamName || !contestId || !problemId) { setHistory([]); return } setLoading(true); api.history(contestId, problemId, rangeStart(Number(days))).then(data => setHistory(data.items.filter(row => row.team_name === teamName))).finally(() => setLoading(false)) }, [contestId, problemId, teamName, days])
  const chart = useMemo(() => ({ tooltip: { trigger: 'axis' }, legend: { top: 0, textStyle: { color: '#667085' } }, grid: { left: 48, right: 50, top: 36, bottom: 36 }, xAxis: { type: 'time' }, yAxis: [{ type: 'value', name: '分数' }, { type: 'value', name: '排名', inverse: true, min: 1 }], series: [{ name: '分数', type: 'line', smooth: true, showSymbol: false, data: history.filter(p => p.score != null).map(p => [p.observed_at, Number(p.score)]), itemStyle: { color: '#006fee' }, areaStyle: { opacity: .08 } }, { name: '排名', type: 'line', yAxisIndex: 1, smooth: true, showSymbol: false, data: history.filter(p => p.rank != null).map(p => [p.observed_at, Number(p.rank)]), itemStyle: { color: '#9353d3' } }] }), [history])
  const caseRows = useMemo(() => {
    const cases = new Map<string, { caseId: string; latest?: number; best?: number; previous?: number; observedAt?: string; rows: Array<{ observedAt?: string; value?: number; best?: number; previous?: number }> }>()
    history.forEach(point => (point.result || []).forEach((item, index) => {
      const key = caseKey(item, index); const value = timeValue(item.time); const current = cases.get(key) || { caseId: key, rows: [] }
      const previous = current.latest; const nextValue = value ?? undefined; const best = nextValue == null ? current.best : Math.min(current.best ?? Number.POSITIVE_INFINITY, nextValue)
      current.latest = nextValue ?? current.latest; current.best = best; current.previous = previous; current.observedAt = point.observed_at; current.rows.push({ observedAt: point.observed_at, value: nextValue, best, previous }); cases.set(key, current)
    }))
    return Array.from(cases.values()).sort((a, b) => a.caseId.localeCompare(b.caseId))
  }, [history])
  const caseIds = useMemo(() => caseRows.map(item => item.caseId), [caseRows])
  const observationColumns = useMemo(() => [{ key: 'observedAt', label: '观测时间' }, ...caseIds.map(caseId => ({ key: caseId, label: caseId }))], [caseIds])
  const observationRows = useMemo(() => {
    type Observation = { observedAt?: string; values: Map<string, number | undefined> }
    type CaseObservation = { value?: number; best?: number; previous?: number }
    type ObservationRow = { observedAt?: string; cases: Record<string, CaseObservation> }
    const grouped = new Map<string, Observation>()
    history.forEach(point => {
      const groupKey = point.observed_at || `unknown-${grouped.size}`
      const row = grouped.get(groupKey) || { observedAt: point.observed_at, values: new Map<string, number | undefined>() }
      ;(point.result || []).forEach((item, index) => row.values.set(caseKey(item, index), timeValue(item.time) ?? undefined))
      grouped.set(groupKey, row)
    })
    const bestByCase = new Map<string, number>()
    const previousByCase = new Map<string, number>()
    return Array.from(grouped.values())
      .sort((a, b) => new Date(a.observedAt || 0).getTime() - new Date(b.observedAt || 0).getTime())
      .map<ObservationRow>(row => {
        const cases: Record<string, CaseObservation> = {}
        caseIds.forEach(caseId => {
          const value = row.values.get(caseId)
          const previous = previousByCase.get(caseId)
          if (value != null) bestByCase.set(caseId, Math.min(bestByCase.get(caseId) ?? Number.POSITIVE_INFINITY, value))
          cases[caseId] = { value, best: bestByCase.get(caseId), previous }
          if (value != null) previousByCase.set(caseId, value)
        })
        return { observedAt: row.observedAt, cases }
      })
  }, [caseIds, history])
  if (!teamName) return <Card shadow="none" className="content-card empty-card"><Empty text="请先从最新榜单选择队伍" /></Card>
  const problem = problems.find(p => p.id === problemId); const latest = history.at(-1); const best = Math.max(...history.map(h => Number(h.score || 0)), 0)
  return <div className="panel-stack"><Card shadow="none" className="content-card history-card"><Toolbar><div className="history-title"><strong>{teamName}</strong><span>{problem?.title || '当前题目'}</span></div><Select aria-label="趋势时间范围" size="sm" className="range-select" selectedKeys={new Set([days])} onSelectionChange={keys => setDays(String(Array.from(keys)[0] || '7'))}><SelectItem key="1">最近 24 小时</SelectItem><SelectItem key="7">最近 7 天</SelectItem><SelectItem key="30">最近 30 天</SelectItem></Select></Toolbar>{loading ? <LoadingRows /> : history.length ? <ReactECharts option={chart} style={{ height: 430 }} /> : <Empty text="该时间范围内暂无历史观测" />}</Card><div className="history-summary"><StatCard label="最新分数" value={score(latest?.score)} hint="当前采样" icon={Gauge} /><StatCard label="历史最佳" value={score(best)} hint="历史观测" icon={Check} /><StatCard label="变化事件" value={history.length} hint="无损历史" icon={BarChart3} /></div><Card shadow="none" className="content-card case-card"><CardHeader><div><h2>测试点完整历史</h2><p>每行是一次观测时间点，横向展示所有测试点；时间从早到晚排列</p></div><Chip size="sm" variant="flat">{caseRows.length} 个 case</Chip></CardHeader><CardBody><div className="case-grid">{caseRows.map(item => <div className="case-tile" key={item.caseId}><div className="case-tile-head"><strong>{item.caseId}</strong><Chip size="sm" color="success" variant="flat">最佳 {score(item.best)} μs</Chip></div><div className="case-tile-values"><span>最新<strong>{score(item.latest)} μs</strong></span><span className={changeClass(item.latest, item.previous)}>较上次<strong>{changeText(item.latest, item.previous)}</strong></span></div></div>)}</div><Divider /><Table aria-label="测试点按观测时间的完整历史" removeWrapper className="data-table history-table case-history-table"><TableHeader columns={observationColumns}>{column => <TableColumn key={column.key}>{column.label}</TableColumn>}</TableHeader><TableBody emptyContent={<Empty text="暂无测试点历史" />} items={observationRows}>{row => <TableRow key={row.observedAt || 'unknown'}>{columnKey => { const key = String(columnKey); if (key === 'observedAt') return <TableCell>{fmt(row.observedAt)}</TableCell>; const observation = row.cases[key]; return <TableCell><div className="case-history-cell"><strong>{score(observation?.value)} μs</strong><small>最佳 {score(observation?.best)} · <span className={changeClass(observation?.value, observation?.previous)}>{changeText(observation?.value, observation?.previous)}</span></small></div></TableCell> }}</TableRow>}</TableBody></Table></CardBody></Card></div>
}

function AlertsView({ contestId }: { contestId: string }) {
  const [alerts, setAlerts] = useState<Alert[]>([]); const [severityFilter, setSeverityFilter] = useState('all'); const [loading, setLoading] = useState(true)
  const load = useCallback(() => { setLoading(true); api.alerts({ contestId: contestId || undefined }).then(setAlerts).finally(() => setLoading(false)) }, [contestId])
  useEffect(() => { void load() }, [load])
  const visible = alerts.filter(alert => severityFilter === 'all' || (severityFilter === 'high' ? ['HIGH', 'ERROR'].includes(alert.severity) : !['HIGH', 'ERROR'].includes(alert.severity)))
  const high = alerts.filter(alert => ['HIGH', 'ERROR'].includes(alert.severity)).length; const info = alerts.filter(alert => !['HIGH', 'ERROR'].includes(alert.severity)).length; const latest = alerts[0]
  return <div className="panel-stack"><div className="alert-overview"><Card shadow="none" className="risk-card risk-danger"><CardBody><span>高风险信号</span><strong>{high}</strong><small>需要优先查看证据</small></CardBody></Card><Card shadow="none" className="risk-card risk-warning"><CardBody><span>关注信号</span><strong>{info}</strong><small>仅表示数据变化</small></CardBody></Card><Card shadow="none" className="risk-card risk-neutral"><CardBody><span>最新信号</span><strong>{latest ? signalLabel(latest.ruleCode) : '—'}</strong><small>{fmt(latest?.createdAt)}</small></CardBody></Card></div><Card shadow="none" className="content-card data-card"><Toolbar note="异常信号保留原始证据，不作违规定性"><div className="alert-summary"><ShieldCheck size={16} /><strong>{visible.length} 条原始变化信号</strong></div><Select aria-label="信号级别" size="sm" className="range-select" selectedKeys={new Set([severityFilter])} onSelectionChange={keys => setSeverityFilter(String(Array.from(keys)[0] || 'all'))}><SelectItem key="all">全部级别</SelectItem><SelectItem key="high">高风险</SelectItem><SelectItem key="watch">关注</SelectItem></Select><Button size="sm" variant="flat" startContent={<RefreshCw size={14} />} onPress={() => void load()} isLoading={loading}>刷新</Button></Toolbar><Table aria-label="异常信号" removeWrapper className="data-table alerts-table"><TableHeader><TableColumn>时间</TableColumn><TableColumn>变化类型</TableColumn><TableColumn>严重度</TableColumn><TableColumn>证据</TableColumn><TableColumn>来源</TableColumn></TableHeader><TableBody emptyContent={<Empty text="暂无异常信号" />} items={visible}>{alert => <TableRow key={alert.id}><TableCell>{fmt(alert.createdAt)}</TableCell><TableCell><div className="signal-cell"><Chip size="sm" color={alertColor(alert.severity)} variant="flat">{signalLabel(alert.ruleCode)}</Chip><strong>{alert.title}</strong></div></TableCell><TableCell><Chip size="sm" color={alertColor(alert.severity)} variant="flat">{alert.severity || 'INFO'}</Chip></TableCell><TableCell><div className="evidence-cell"><strong>{alert.message}</strong>{alert.evidence && <small>{Object.entries(alert.evidence).map(([key, value]) => `${key}: ${String(value)}`).join(' · ')}</small>}</div></TableCell><TableCell>{alert.contestId ? 'CANNJudge 采集器' : '系统监控'}</TableCell></TableRow>}</TableBody></Table></Card></div>
}

function PollsView() {
  const [runs, setRuns] = useState<PollRun[]>([]); const [loading, setLoading] = useState(true)
  useEffect(() => { api.polls().then(setRuns).finally(() => setLoading(false)) }, [])
  return <Card shadow="none" className="content-card data-card"><Toolbar note={`${runs.length} 条最近采集记录`}><div className="alert-summary"><Clock3 size={16} /><strong>采集运行</strong></div></Toolbar>{loading ? <LoadingRows /> : <Table aria-label="采集运行" removeWrapper className="data-table polls-table"><TableHeader><TableColumn>状态</TableColumn><TableColumn>开始</TableColumn><TableColumn>完成</TableColumn><TableColumn>赛事</TableColumn><TableColumn>行数</TableColumn><TableColumn>变化</TableColumn><TableColumn>错误</TableColumn></TableHeader><TableBody emptyContent={<Empty text="暂无采集记录" />} items={runs}>{run => <TableRow key={run.id}><TableCell><Status value={run.status} /></TableCell><TableCell>{fmt(run.started_at)}</TableCell><TableCell>{fmt(run.finished_at)}</TableCell><TableCell>{run.contests_seen ?? '—'}</TableCell><TableCell>{run.rows_seen ?? '—'}</TableCell><TableCell>{run.changed_rows ?? '—'}</TableCell><TableCell>{run.error_message || '—'}</TableCell></TableRow>}</TableBody></Table>}</Card>
}

function SettingsView({ contests, onReload }: { contests: Contest[]; onReload: () => void }) {
  const [authenticated, setAuthenticated] = useState(false); const [username, setUsername] = useState(''); const [password, setPassword] = useState(''); const [showPassword, setShowPassword] = useState(false); const [message, setMessage] = useState(''); const [settings, setSettings] = useState<Record<string, string>>({}); const [busy, setBusy] = useState(false)
  useEffect(() => { api.me().then(data => { setAuthenticated(data.authenticated); if (data.authenticated) api.settings().then(setSettings) }) }, [])
  const login = async () => { setMessage(''); setBusy(true); try { await api.login(username, password); setAuthenticated(true); setMessage('登录成功'); setSettings(await api.settings()) } catch (e) { setMessage((e as Error).message) } finally { setBusy(false) } }
  const toggle = async (contest: Contest) => { const token = (await api.csrf()).token; await api.monitor(contest.id, !contest.monitoringEnabled, contest.pollIntervalSeconds, token); onReload() }
  const runNow = async () => { const token = (await api.csrf()).token; await api.runPoll(token); setMessage('已加入采集队列') }
  if (!authenticated) return <div className="auth-stage"><Card shadow="none" className="content-card auth-card"><CardBody><div className="auth-brand"><span className="auth-icon"><LockKeyhole size={19} strokeWidth={2.1} /></span><div><strong>CANNJudge Watcher</strong><span>管理员控制台</span></div></div><div className="auth-intro"><div className="eyebrow">欢迎回来</div><h2>登录管理控制台</h2><p>管理赛事监控、采集策略和站内告警。</p></div><form className="auth-form" onSubmit={(event: FormEvent<HTMLFormElement>) => { event.preventDefault(); void login() }}><Input label="用户名" placeholder="请输入用户名" variant="bordered" isRequired value={username} onValueChange={setUsername} autoComplete="username" /><Input label="密码" placeholder="请输入密码" variant="bordered" isRequired type={showPassword ? 'text' : 'password'} value={password} onValueChange={setPassword} autoComplete="current-password" endContent={<Button type="button" isIconOnly size="sm" variant="light" className="password-toggle" onPress={() => setShowPassword(value => !value)} aria-label={showPassword ? '隐藏密码' : '显示密码'}>{showPassword ? <EyeOff size={17} /> : <Eye size={17} />}</Button>} /><Button type="submit" color="primary" size="lg" endContent={!busy && <ArrowRight size={17} />} isLoading={busy}>登录</Button>{message && <span className={`form-message ${message === '登录成功' ? 'success' : 'error'}`} role="alert">{message}</span>}</form><div className="auth-footnote"><ShieldCheck size={14} /><span>使用安全会话 Cookie · 公开榜单无需登录</span></div></CardBody></Card></div>
  return <div className="panel-stack"><Card shadow="none" className="content-card"><CardHeader><div><h2>运行控制</h2><p>全局采集策略和人工触发</p></div></CardHeader><CardBody><div className="settings-actions"><Button color="primary" startContent={<RefreshCw size={15} />} onPress={() => void runNow()}>立即采集</Button><Button variant="flat" startContent={<LogOut size={15} />} onPress={async () => { const token = (await api.csrf()).token; await api.logoutWithToken(token); setAuthenticated(false) }}>退出登录</Button>{message && <span className="form-message">{message}</span>}</div><Divider /><div className="setting-fields"><Input label="默认采集间隔（秒）" type="number" value={settings.default_poll_interval_seconds || '120'} onValueChange={value => setSettings(prev => ({ ...prev, default_poll_interval_seconds: value }))} /><Input label="告警冷却时间（分钟）" type="number" value={settings.alert_cooldown_minutes || '30'} onValueChange={value => setSettings(prev => ({ ...prev, alert_cooldown_minutes: value }))} /><Button variant="flat" onPress={async () => { const token = (await api.csrf()).token; await api.updateSettings(settings, token); setMessage('设置已保存') }}>保存全局设置</Button></div></CardBody></Card><Card shadow="none" className="content-card data-card"><CardHeader><div><h2>赛事监控</h2><p>停用后不会参与自动轮询，历史数据仍会保留。</p></div></CardHeader><Table aria-label="赛事监控设置" removeWrapper className="data-table"><TableHeader><TableColumn>赛事</TableColumn><TableColumn>状态</TableColumn><TableColumn>间隔</TableColumn><TableColumn>源状态</TableColumn><TableColumn>开关</TableColumn></TableHeader><TableBody items={contests}>{contest => <TableRow key={contest.id}><TableCell><strong>{contest.title}</strong></TableCell><TableCell><Chip size="sm" color={contest.status === 'ACTIVE' ? 'success' : 'default'} variant="flat">{contest.status === 'ACTIVE' ? '进行中' : '已停用'}</Chip></TableCell><TableCell>{Math.round(contest.pollIntervalSeconds / 60)} 分钟</TableCell><TableCell>{contest.sourceStatus || '—'}</TableCell><TableCell><Button size="sm" variant={contest.monitoringEnabled ? 'flat' : 'bordered'} onPress={() => void toggle(contest)}>{contest.monitoringEnabled ? '监控中' : '已停用'}</Button></TableCell></TableRow>}</TableBody></Table></Card></div>
}
