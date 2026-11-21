import { useEffect, useMemo, useState } from 'react'
import { AlertCircle, Clock3, Table2, Users } from 'lucide-react'
import {
  Panel,
  PanelBody,
  PanelHeader,
  Chip,
  DataTable,
  Empty,
  LoadingRows,
  StatCard,
} from '../ui'
import type { ContestOverview, Problem } from '../types'
import { api } from '../api'
import { isAbortError } from '../useResource'
import { Chart, type ChartOption } from '../chart'

type OverviewItem = {
  problem: Problem
  rowCount: number
  passCount: number
  events: number
}

export default function OverviewView({
  contestId,
  problems,
  pollIntervalSeconds,
  onProblem,
}: {
  contestId: string
  problems: Problem[]
  pollIntervalSeconds?: number
  onProblem: (id: string) => void
}) {
  const [overview, setOverview] = useState<ContestOverview>({
    problems: {},
    activity: [],
  })
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  useEffect(() => {
    if (!contestId || !problems.length) {
      setOverview({ problems: {}, activity: [] })
      setLoading(false)
      return
    }
    const controller = new AbortController()
    setLoading(true)
    setLoadError('')
    api
      .contestOverview(contestId, controller.signal)
      .then((data) => {
        if (!controller.signal.aborted) setOverview(data)
      })
      .catch((error) => {
        if (!isAbortError(error) && !controller.signal.aborted)
          setLoadError((error as Error).message || '加载赛事概览失败')
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false)
      })
    return () => controller.abort()
  }, [contestId, problems])
  const items = useMemo<OverviewItem[]>(
    () =>
      problems.map((problem) => {
        const counts = overview.problems[problem.id] || {
          rowCount: 0,
          passCount: 0,
          eventCount: 0,
        }
        return {
          problem,
          rowCount: counts.rowCount,
          passCount: counts.passCount,
          events: counts.eventCount,
        }
      }),
    [overview.problems, problems],
  )
  const chart = useMemo<ChartOption>(
    () => ({
      tooltip: { trigger: 'axis' },
      legend: { top: 0, textStyle: { color: '#667085' } },
      grid: { left: 42, right: 18, top: 34, bottom: 34 },
      xAxis: {
        type: 'category',
        data: items.map((i) => i.problem.title.slice(0, 10)),
        axisLabel: { color: '#7b8790' },
      },
      yAxis: { type: 'value', splitLine: { lineStyle: { color: '#edf0f3' } } },
      series: [
        {
          name: '在榜队伍',
          type: 'bar',
          data: items.map((i) => i.rowCount),
          itemStyle: { color: '#006fee', borderRadius: [5, 5, 0, 0] },
        },
        {
          name: '通过队伍',
          type: 'bar',
          data: items.map((i) => i.passCount),
          itemStyle: { color: '#17c964', borderRadius: [5, 5, 0, 0] },
        },
      ],
    }),
    [items],
  )
  const activity = useMemo(
    () =>
      overview.activity
        .map((point) => ({
          timestamp: new Date(point.observed_at).getTime(),
          changes: point.changes,
          deletes: point.deletes,
          improvements: point.improvements ?? 0,
          regressions: point.regressions ?? 0,
        }))
        .filter((point) => Number.isFinite(point.timestamp)),
    [overview.activity],
  )
  const activityChart = useMemo<ChartOption>(() => {
    const labels = activity.map((point) =>
      new Date(point.timestamp).toLocaleString('zh-CN', {
        month: 'numeric',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      }),
    )
    return {
      tooltip: { trigger: 'axis' },
      legend: { top: 0, textStyle: { color: '#667085' } },
      grid: { left: 42, right: 18, top: 34, bottom: 42 },
      xAxis: {
        type: 'category',
        data: labels,
        axisLabel: { color: '#7b8790', hideOverlap: true },
      },
      yAxis: {
        type: 'value',
        minInterval: 1,
        name: '性能变化记录',
        nameTextStyle: { color: '#7b8790' },
        axisLabel: { color: '#7b8790' },
        splitLine: { lineStyle: { color: '#edf0f3' } },
      },
      series: [
        {
          name: '性能变好',
          type: 'line',
          stack: 'performance',
          smooth: true,
          showSymbol: false,
          data: activity.map((point) => point.improvements),
          itemStyle: { color: '#17c964' },
          lineStyle: { color: '#17c964', width: 2 },
          areaStyle: { color: 'rgba(23, 201, 100, .20)' },
        },
        {
          name: '性能变差',
          type: 'line',
          stack: 'performance',
          smooth: true,
          showSymbol: false,
          data: activity.map((point) => point.regressions),
          itemStyle: { color: '#f31260' },
          lineStyle: { color: '#f31260', width: 2 },
          areaStyle: { color: 'rgba(243, 18, 96, .16)' },
        },
        {
          name: '离榜/删除',
          type: 'bar',
          data: activity.map((point) => point.deletes),
          itemStyle: { color: '#f5a524', borderRadius: [4, 4, 0, 0] },
          barMaxWidth: 18,
        },
      ],
    }
  }, [activity])
  const totalPerformanceChanges = activity.reduce(
    (sum, point) => sum + point.improvements + point.regressions,
    0,
  )
  return (
    <div className="panel-stack">
      <div className="stat-grid">
        <StatCard
          label="在榜记录"
          value={items.reduce((sum, i) => sum + i.rowCount, 0)}
          hint="当前赛事"
          icon={Table2}
        />
        <StatCard
          label="通过队伍"
          value={items.reduce((sum, i) => sum + i.passCount, 0)}
          hint="当前赛事"
          icon={Users}
        />
        <StatCard
          label="开放告警"
          value={overview.openAlerts ?? '—'}
          hint="当前赛事"
          icon={AlertCircle}
        />
        <StatCard
          label="采集间隔"
          value={`${Math.round((pollIntervalSeconds || 120) / 60)} 分钟`}
          hint="当前赛事"
          icon={Clock3}
        />
      </div>
      <Panel className="content-card activity-card">
        <PanelHeader>
          <div>
            <h2>榜单活跃度</h2>
          </div>
          <Chip>{totalPerformanceChanges} 次性能变化</Chip>
        </PanelHeader>
        <PanelBody>
          {loading ? (
            <LoadingRows />
          ) : loadError ? (
            <Empty text={loadError} />
          ) : activity.length ? (
            <Chart option={activityChart} height={280} />
          ) : (
            <Empty text="最近 7 天暂无榜单变动" />
          )}
        </PanelBody>
      </Panel>
      <div className="overview-grid">
        <Panel className="content-card chart-card">
          <PanelHeader>
            <div>
              <h2>赛题分布</h2>
            </div>
          </PanelHeader>
          <PanelBody>
            {loading ? (
              <LoadingRows />
            ) : loadError ? (
              <Empty text={loadError} />
            ) : (
              <Chart option={chart} height={340} />
            )}
          </PanelBody>
        </Panel>
        <Panel className="content-card data-card">
          <PanelHeader>
            <div>
              <h2>赛题状态</h2>
            </div>
          </PanelHeader>
          <DataTable aria-label="赛题状态" className="data-table compact-table">
            <thead>
              <tr>
                <th scope="col">赛题</th>
                <th scope="col">在榜</th>
                <th scope="col">通过</th>
                <th scope="col">变化事件</th>
              </tr>
            </thead>
            <tbody>
              {!items.length && (
                <tr>
                  <td colSpan={4}>
                    <Empty text={loadError || '暂无赛题数据'} />
                  </td>
                </tr>
              )}
              {items.map((item) => (
                <tr key={item.problem.id}>
                  <td>
                    <button
                      className="topic-link"
                      onClick={() => onProblem(item.problem.id)}
                    >
                      {item.problem.title}
                    </button>
                  </td>
                  <td>{item.rowCount}</td>
                  <td>{item.passCount}</td>
                  <td>{item.events}</td>
                </tr>
              ))}
            </tbody>
          </DataTable>
        </Panel>
      </div>
    </div>
  )
}
