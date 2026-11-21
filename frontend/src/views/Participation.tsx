import { useEffect, useMemo, useState } from 'react'
import {
  ChevronDown,
  ChevronUp,
  CircleHelp,
  Filter,
  Medal,
  RefreshCw,
  Search,
  ShieldCheck,
  Users,
} from 'lucide-react'
import { Button, Chip, Empty, Input, LoadingRows, Panel, PanelBody, PanelHeader, SelectField, StatCard } from '../ui'
import { api } from '../api'
import { isAbortError } from '../useResource'
import type { ParticipationItem, ParticipationResponse, SelectedUser } from '../types'
import './participation.css'

type Mode = 'rank' | 'awards'

type Filters = {
  minimumContests: number
  minimumSubmissions: number
  topN: number
  mode: Mode
  agentOnly: boolean
}

const initialFilters: Filters = {
  minimumContests: 2,
  minimumSubmissions: 100,
  topN: 10,
  mode: 'rank',
  agentOnly: false,
}

const number = (value: number | undefined | null) =>
  value == null ? '—' : new Intl.NumberFormat('zh-CN').format(value)

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

  useEffect(() => {
    const controller = new AbortController()
    setLoading(true)
    setError('')
    api.participation(filters, controller.signal)
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
    return (data?.items || []).filter((item) =>
      !needle || `${item.nickname} ${item.userId}`.toLowerCase().includes(needle),
    )
  }, [data?.items, query])
  const maxSubmissions = Math.max(...(items.map((item) => item.submissions) || [1]), 1)
  const maxScore = Math.max(...(items.map((item) => Number(item.score) || 0) || [1]), 1)

  const apply = () => setFilters({ ...draft })
  const reset = () => {
    setDraft(initialFilters)
    setFilters(initialFilters)
  }

  return (
    <div className="panel-stack participation-page">
      <section className="participation-hero">
        <div>
          <span className="eyebrow">投入 × 结果</span>
          <h2>参赛投入与成绩</h2>
          <p>把公开赛事中的提交量、排名与可核验结果放在同一个尺度上阅读。</p>
        </div>
        <div className="participation-hero-mark" aria-hidden><Medal size={26} /></div>
      </section>

      <Panel className="participation-filters">
        <PanelHeader>
          <div><span className="section-kicker"><Filter size={14} />分析条件</span><h3>选择观察口径</h3></div>
          <Button onClick={reset}>恢复默认</Button>
        </PanelHeader>
        <PanelBody>
          <div className="participation-filter-grid">
            <label className="participation-control"><span>至少参赛场次</span><SelectField value={draft.minimumContests} onChange={(e) => setDraft({ ...draft, minimumContests: Number(e.target.value) })}><option value={1}>1 场</option><option value={2}>2 场</option><option value={3}>3 场</option><option value={5}>5 场</option></SelectField></label>
            <label className="participation-control"><span>至少提交次数</span><SelectField value={draft.minimumSubmissions} onChange={(e) => setDraft({ ...draft, minimumSubmissions: Number(e.target.value) })}><option value={0}>不限</option><option value={100}>100 次</option><option value={300}>300 次</option><option value={1000}>1,000 次</option></SelectField></label>
            <label className="participation-control"><span>Top N 阈值</span><SelectField value={draft.topN} onChange={(e) => setDraft({ ...draft, topN: Number(e.target.value) })}><option value={3}>Top 3</option><option value={5}>Top 5</option><option value={10}>Top 10</option><option value={20}>Top 20</option></SelectField></label>
            <label className="participation-control"><span>结果口径</span><SelectField value={draft.mode} onChange={(e) => setDraft({ ...draft, mode: e.target.value as Mode })}><option value="rank">Top N 排名</option><option value="awards">官方获奖</option></SelectField></label>
            <label className="participation-toggle"><input type="checkbox" checked={draft.agentOnly} onChange={(e) => setDraft({ ...draft, agentOnly: e.target.checked })} /><span>只看有代理证据的用户</span></label>
            <Button color="primary" onClick={apply}>应用条件</Button>
          </div>
        </PanelBody>
      </Panel>

      {loading && <LoadingRows />}
      {!loading && error && <Panel><PanelBody><div className="participation-unavailable"><CircleHelp size={20} /><div><strong>暂时无法提供这组分析</strong><p>{error}</p></div><Button leading={<RefreshCw size={15} />} onClick={() => setFilters({ ...filters })}>重试</Button></div></PanelBody></Panel>}
      {!loading && !error && data && <>
        <div className="stat-grid participation-stats">
          <StatCard label="符合条件用户" value={number(items.length)} hint="按当前筛选" icon={Users} />
          <StatCard label="覆盖赛事" value={number(data.coveredContests)} hint={`候选 ${number(data.eligibleContests)} 场`} icon={ShieldCheck} />
          <StatCard label={filters.mode === 'awards' ? '有官方结果赛事' : `Top ${filters.topN} 赛事`} value={number(filters.mode === 'awards' ? data.awardCoveredContests : data.coveredContests)} hint={filters.mode === 'awards' ? '仅统计可核验结果' : '公开榜单排名'} icon={Medal} />
        </div>
        <Panel className="participation-results">
          <PanelHeader><div><span className="section-kicker">比较表</span><h3>用户投入与结果</h3></div><Input aria-label="搜索用户" placeholder="搜索昵称或用户 ID" leading={<Search size={15} />} value={query} onValueChange={setQuery} /></PanelHeader>
          <PanelBody>
            {items.length === 0 ? <Empty text={query ? '没有匹配的用户' : '当前条件下没有可用记录'} /> : <div className="participation-list">{items.map((item) => <ParticipationRow key={item.userId || item.nickname} item={item} maxSubmissions={maxSubmissions} maxScore={maxScore} expanded={expanded === (item.userId || item.nickname)} onToggle={() => setExpanded(expanded === (item.userId || item.nickname) ? null : (item.userId || item.nickname))} onSelect={() => onSelectUser({ id: item.userId, nickname: item.nickname, name: item.nickname || item.userId })} mode={filters.mode} />)}</div>}
          </PanelBody>
        </Panel>
        <Panel className="participation-evidence"><PanelBody><div className="participation-note"><ShieldCheck size={17} /><span>官方获奖与 Top N 分开统计。代理证据来自公开来源，未发现证据的赛事不会被推断为代理。</span></div>{data.refreshedAt && <small>数据刷新于 {new Date(data.refreshedAt).toLocaleString('zh-CN')}</small>}</PanelBody></Panel>
      </>}
    </div>
  )
}

function ParticipationRow({ item, maxSubmissions, maxScore, expanded, onToggle, onSelect, mode }: { item: ParticipationItem; maxSubmissions: number; maxScore: number; expanded: boolean; onToggle: () => void; onSelect: () => void; mode: Mode }) {
  return <article className={`participation-row ${expanded ? 'is-expanded' : ''}`}>
    <button className="participation-row-main" onClick={onToggle} aria-expanded={expanded}>
      <span className="participation-identity"><strong>{item.nickname || item.userId}</strong><small>{item.userId}</small></span>
      <span className="participation-metric"><span className="metric-label">提交</span><span className="metric-bar"><i style={{ width: `${(item.submissions / maxSubmissions) * 100}%` }} /></span><b>{number(item.submissions)}</b></span>
      <span className="participation-metric"><span className="metric-label">{mode === 'awards' ? '获奖' : `Top ${item.topFinishes}`}</span><b>{mode === 'awards' ? `${number(item.awardWins)}${item.awardKnown ? '' : ' · 数据有限'}` : number(item.topFinishes)}</b></span>
      <span className="participation-metric score-metric"><span className="metric-label">综合值</span><span className="metric-bar metric-bar-score"><i style={{ width: `${((Number(item.score) || 0) / maxScore) * 100}%` }} /></span><b>{number(item.score)}</b></span>
      <span className="participation-expand" aria-hidden>{expanded ? <ChevronUp size={17} /> : <ChevronDown size={17} />}</span>
    </button>
    {expanded && <div className="participation-detail"><div className="participation-detail-head"><span>赛事证据</span><button onClick={onSelect}>查看用户历史 <span aria-hidden>→</span></button></div><div className="participation-entries">{item.entries.map((entry) => <div className="participation-entry" key={entry.contestId}><span className="entry-title">{entry.sourceUrl ? <a href={entry.sourceUrl} target="_blank" rel="noreferrer">{entry.title}</a> : entry.title}</span><span>{number(entry.submissions)} 次提交</span><span>{entry.rank == null ? '排名未知' : `第 ${number(entry.rank)} 名 / ${number(entry.participants)}`}</span><span>{entry.award === true ? <Chip color="success">官方获奖</Chip> : entry.award === false ? <Chip>未获奖</Chip> : <Chip color="warning">结果未知</Chip>}</span><span>{entry.agentSource ? <Chip color="primary">代理证据</Chip> : <span className="muted">无代理证据</span>}</span></div>)}</div></div>}
  </article>
}
