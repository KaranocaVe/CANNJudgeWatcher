import { useEffect, useMemo, useState } from 'react'
import { ArrowLeft, BarChart3, Check, Table2 } from 'lucide-react'
import {
  Button,
  Panel,
  PanelBody,
  PanelHeader,
  DataTable,
  PagedRows,
  Chip,
  SelectField,
  Empty,
  Toolbar,
  LoadingRows,
  StatCard,
} from '../ui'
import { fmt, formatMetric, rangeStart, statusLabel } from '../format'
import {
  timeValue,
  caseVersionLabel,
  caseKey,
  changeText,
  changeClass,
} from '../domain'
import type { CaseBestSummary, HistoryPoint } from '../types'
import { api } from '../api'
import { isAbortError } from '../useResource'
import { Chart, type ChartOption } from '../chart'

export default function HistoryView({
  contestId,
  problemId,
  problemTitle,
  teamKey,
  teamName,
  contestTitle,
  onBack,
}: {
  contestId: string
  problemId: string
  problemTitle: string
  teamKey: string
  teamName: string
  contestTitle: string
  onBack: () => void
}) {
  const [days, setDays] = useState('all')
  const [history, setHistory] = useState<HistoryPoint[]>([])
  const [caseBests, setCaseBests] = useState<CaseBestSummary>({
    global: {},
    teams: {},
  })
  const [loading, setLoading] = useState(false)
  const [loadError, setLoadError] = useState('')
  useEffect(() => {
    if (!teamKey || !contestId || !problemId) {
      setHistory([])
      setCaseBests({ global: {}, teams: {} })
      setLoadError('')
      return
    }
    const controller = new AbortController()
    setLoading(true)
    setLoadError('')
    const from =
      days === 'all' ? '1970-01-01T00:00:00.000Z' : rangeStart(Number(days))
    api
      .history(contestId, problemId, from, undefined, {
        teamKey,
        signal: controller.signal,
      })
      .then((data) => {
        if (!controller.signal.aborted) {
          setHistory(data.items)
          setCaseBests(data.caseBests || { global: {}, teams: {} })
        }
      })
      .catch((error) => {
        if (!isAbortError(error) && !controller.signal.aborted)
          setLoadError((error as Error).message || '加载队伍历史失败')
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false)
      })
    return () => controller.abort()
  }, [contestId, problemId, teamKey, days])
  const chart = useMemo<ChartOption>(
    () => ({
      tooltip: { trigger: 'axis' },
      grid: { left: 56, right: 28, top: 36, bottom: 36 },
      xAxis: { type: 'time' },
      yAxis: {
        type: 'value',
        name: '官方名次',
        inverse: true,
        min: 1,
        minInterval: 1,
      },
      series: [
        {
          name: '官方名次',
          type: 'line',
          smooth: true,
          showSymbol: false,
          data: history
            .filter((p) => p.rank != null)
            .map((p) => [p.observed_at, Number(p.rank)]),
          itemStyle: { color: '#006fee' },
          lineStyle: { width: 2 },
          areaStyle: { color: 'rgba(0, 111, 238, .08)' },
        },
      ],
    }),
    [history],
  )
  const caseIds = useMemo(() => {
    const ids: string[] = []
    const seen = new Set<string>()
    history.forEach((point) =>
      (point.result || []).forEach((item, index) => {
        const caseId = caseKey(item, index)
        if (!seen.has(caseId)) {
          seen.add(caseId)
          ids.push(caseId)
        }
      }),
    )
    return ids
  }, [history])
  const observationColumns = useMemo(() => {
    const personalBests = caseBests.teams[teamKey] || {}
    return [
      { key: 'observedAt', label: '观测时间' },
      ...caseIds.map((caseId, index) => ({
        key: caseId,
        label: (
          <div className="case-history-header" title={caseId}>
            <strong>用例 {index + 1}</strong>
            {caseVersionLabel(caseId) && (
              <small className="case-version">
                版本 {caseVersionLabel(caseId)}
              </small>
            )}
            <span>个人 {formatMetric(personalBests[caseId])} μs</span>
            <span>全局 {formatMetric(caseBests.global[caseId])} μs</span>
          </div>
        ),
      })),
    ]
  }, [caseBests, caseIds, teamKey])
  const observationRows = useMemo(() => {
    type Observation = {
      observedAt?: string
      values: Map<string, { value?: number; status?: string }>
    }
    type CaseObservation = {
      value?: number
      status?: string
      previous?: number
    }
    type ObservationRow = {
      observedAt?: string
      cases: Record<string, CaseObservation>
    }
    const grouped = new Map<string, Observation>()
    history.forEach((point) => {
      const groupKey = point.observed_at || `unknown-${grouped.size}`
      const row: Observation = grouped.get(groupKey) || {
        observedAt: point.observed_at,
        values: new Map<string, { value?: number; status?: string }>(),
      }
      ;(point.result || []).forEach((item, index) =>
        row.values.set(caseKey(item, index), {
          value: timeValue(item.time) ?? undefined,
          status: item.status,
        }),
      )
      grouped.set(groupKey, row)
    })
    const previousByCase = new Map<string, number | undefined>()
    return Array.from(grouped.values())
      .sort(
        (a, b) =>
          new Date(a.observedAt || 0).getTime() -
          new Date(b.observedAt || 0).getTime(),
      )
      .map<ObservationRow>((row) => {
        const cases: Record<string, CaseObservation> = {}
        caseIds.forEach((caseId) => {
          const observation = row.values.get(caseId)
          const value = observation?.value
          const previous = previousByCase.get(caseId)
          cases[caseId] = { value, status: observation?.status, previous }
          previousByCase.set(caseId, value)
        })
        return { observedAt: row.observedAt, cases }
      })
  }, [caseIds, history])
  const performanceChart = useMemo<ChartOption>(() => {
    const baseline = new Map<string, number>()
    history.forEach((point) =>
      (point.result || []).forEach((item, index) => {
        const value = timeValue(item.time)
        const id = caseKey(item, index)
        if (value != null && !baseline.has(id)) baseline.set(id, value)
      }),
    )
    const data = history.flatMap((point) => {
      const byCase = new Map(
        (point.result || []).map((item, index) => [caseKey(item, index), item]),
      )
      const ratios = caseIds.map((id) => {
        const item = byCase.get(id)
        const value = timeValue(item?.time)
        const initial = baseline.get(id)
        return value != null && initial != null ? initial / value : null
      })
      const validRatios = ratios.filter(
        (value): value is number => value != null,
      )
      if (
        !point.observed_at ||
        !ratios.length ||
        validRatios.length !== ratios.length
      )
        return []
      const index =
        Math.exp(
          validRatios.reduce((sum, value) => sum + Math.log(value), 0) /
            validRatios.length,
        ) * 100
      return [[point.observed_at, Number(index.toFixed(2))]]
    })
    return {
      tooltip: {
        trigger: 'axis',
        valueFormatter: (value) => `${Number(value).toFixed(2)} 指数`,
      },
      grid: { left: 56, right: 28, top: 36, bottom: 36 },
      xAxis: { type: 'time' },
      yAxis: {
        type: 'value',
        name: '性能指数',
        axisLabel: { formatter: '{value}' },
        splitLine: { lineStyle: { color: '#edf0f3' } },
      },
      series: [
        {
          name: '归一化性能',
          type: 'line',
          smooth: true,
          showSymbol: false,
          data,
          itemStyle: { color: '#17c964' },
          lineStyle: { color: '#17c964', width: 2 },
          areaStyle: { color: 'rgba(23, 201, 100, .13)' },
          markLine: {
            symbol: 'none',
            label: { formatter: '基线 100' },
            lineStyle: { color: '#aab5bf', type: 'dashed' },
            data: [{ yAxis: 100 }],
          },
        },
      ],
    }
  }, [caseIds, history])
  if (!teamName)
    return (
      <Panel className="content-card empty-card">
        <Empty text="请先从最新榜单选择队伍" />
      </Panel>
    )
  const latest = history.at(-1)
  const bestRank = history.reduce<number | undefined>(
    (best, item) =>
      item.rank == null ? best : Math.min(best ?? item.rank, item.rank),
    undefined,
  )
  return (
    <div className="panel-stack">
      <Panel className="content-card history-card">
        <Toolbar note={loadError || undefined}>
          <Button leading={<ArrowLeft size={14} />} onClick={onBack}>
            返回用户详情
          </Button>
          <div className="history-title">
            <strong>{teamName}</strong>
            <span>
              {contestTitle} · {problemTitle}
            </span>
          </div>
          <SelectField
            aria-label="趋势时间范围"
            className="range-select"
            value={days}
            onChange={(event) => setDays(event.target.value)}
          >
            <option value="all">全部记录</option>
            <option value="1">最近 24 小时</option>
            <option value="7">最近 7 天</option>
            <option value="30">最近 30 天</option>
          </SelectField>
        </Toolbar>
        {loading ? (
          <LoadingRows />
        ) : history.length ? (
          <Chart option={chart} height={360} />
        ) : (
          <Empty text={loadError || '该时间范围内暂无历史观测'} />
        )}
      </Panel>
      <Panel className="content-card history-card">
        <PanelHeader>
          <div>
            <h2>归一化性能趋势</h2>
          </div>
        </PanelHeader>
        <PanelBody>
          {loading ? (
            <LoadingRows />
          ) : history.length && caseIds.length ? (
            <Chart option={performanceChart} height={280} />
          ) : (
            <Empty text={loadError || '暂无可归一的性能观测'} />
          )}
        </PanelBody>
      </Panel>
      <div className="history-summary">
        <StatCard
          label="当前官方名次"
          value={latest?.rank == null ? '—' : `#${latest.rank}`}
          hint="最近一次观测"
          icon={Table2}
        />
        <StatCard
          label="历史最高名次"
          value={bestRank == null ? '—' : `#${bestRank}`}
          hint="仅按官方名次"
          icon={Check}
        />
        <StatCard
          label="变化事件"
          value={history.length}
          hint="无损历史"
          icon={BarChart3}
        />
      </div>
      <Panel className="content-card case-card">
        <PanelHeader>
          <div>
            <h2>测试点完整历史</h2>
          </div>
          <Chip>{caseIds.length} 个 case</Chip>
        </PanelHeader>
        <PanelBody>
          {observationRows.length ? (
            <PagedRows key={days} items={observationRows} size={25}>
              {(visible) => (
                <DataTable
                  aria-label="逐测试点历史"
                  className="case-history-table"
                >
                  <thead>
                    <tr>
                      {observationColumns.map((column) => (
                        <th key={column.key} scope="col">
                          {column.label}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {visible.map((row) => (
                      <tr key={row.observedAt}>
                        <th scope="row">{fmt(row.observedAt)}</th>
                        {caseIds.map((key) => {
                          const observation = row.cases[key]
                          return (
                            <td key={key}>
                              <div className="case-history-cell">
                                <strong>
                                  {observation?.value == null
                                    ? observation
                                      ? statusLabel(observation.status)
                                      : '—'
                                    : `${formatMetric(observation.value)} μs${observation.status && observation.status !== 'Pass' ? ` · ${statusLabel(observation.status)}` : ''}`}
                                </strong>
                                {observation && (
                                  <small
                                    className={changeClass(
                                      observation.value,
                                      observation.previous,
                                    )}
                                  >
                                    较上次{' '}
                                    {changeText(
                                      observation.value,
                                      observation.previous,
                                    )}
                                  </small>
                                )}
                              </div>
                            </td>
                          )
                        })}
                      </tr>
                    ))}
                  </tbody>
                </DataTable>
              )}
            </PagedRows>
          ) : (
            <Empty text={loadError || '暂无测试点历史'} />
          )}
        </PanelBody>
      </Panel>
    </div>
  )
}
