import { useEffect, useMemo, useState } from 'react'
import { Clock3 } from 'lucide-react'
import { Panel, Chip, DataTable, Empty, Toolbar, LoadingRows } from '../ui'
import { fmt } from '../format'
import type { PollRun } from '../types'
import { api } from '../api'
import { isAbortError } from '../useResource'

type PollOutcomeKey =
  'idle' | 'unchanged' | 'changed' | 'empty' | 'failed' | 'unknown' | 'running'
type PollOutcome = {
  key: PollOutcomeKey
  label: string
  color: 'default' | 'primary' | 'success' | 'warning' | 'danger'
  detail: string
}

function pollOutcome(run: PollRun): PollOutcome {
  if (run.status === 'FAILED')
    return {
      key: 'failed',
      label: '采集失败',
      color: 'danger',
      detail:
        run.contests_polled == null
          ? '本轮采集场数未记录'
          : '已尝试 ' + run.contests_polled + ' 场后中断',
    }
  if (run.status === 'RUNNING')
    return {
      key: 'running',
      label: '运行中',
      color: 'primary',
      detail: '本轮统计尚未完成',
    }
  if (run.contests_polled == null) {
    if ((run.changed_rows ?? 0) > 0)
      return {
        key: 'changed',
        label: '历史有变更',
        color: 'success',
        detail: '旧记录未保存实际采集场数',
      }
    if ((run.rows_seen ?? 0) > 0)
      return {
        key: 'unchanged',
        label: '历史采集无变化',
        color: 'default',
        detail: '扫描到榜单行；旧记录未保存实际采集场数',
      }
    return {
      key: 'unknown',
      label: '历史范围待判定',
      color: 'warning',
      detail: '旧记录无法区分未到期与空榜单',
    }
  }
  if (run.contests_polled === 0)
    return {
      key: 'idle',
      label: '无赛事实际采集',
      color: 'default',
      detail: '本轮没有满足采集条件的赛事',
    }
  if ((run.rows_seen ?? 0) === 0)
    return {
      key: 'empty',
      label: '已采集 · 0 行',
      color: 'warning',
      detail: '实际采集 ' + run.contests_polled + ' 场，未返回榜单行',
    }
  if ((run.changed_rows ?? 0) > 0)
    return {
      key: 'changed',
      label: '已采集 · 有变更',
      color: 'success',
      detail: '本轮检测到榜单变化',
    }
  return {
    key: 'unchanged',
    label: '已采集 · 无变化',
    color: 'default',
    detail: '榜单已扫描，但与上次相比无变化',
  }
}

function pollDuration(run: PollRun) {
  if (!run.started_at || !run.finished_at) return '—'
  const seconds =
    (Date.parse(run.finished_at) - Date.parse(run.started_at)) / 1000
  if (!Number.isFinite(seconds) || seconds < 0) return '—'
  if (seconds < 60) return seconds.toFixed(1) + ' 秒'
  const total = Math.round(seconds)
  return Math.floor(total / 60) + ' 分 ' + (total % 60) + ' 秒'
}

export default function PollsView() {
  const [runs, setRuns] = useState<PollRun[]>([])
  const [loading, setLoading] = useState(true)
  useEffect(() => {
    const controller = new AbortController()
    api
      .polls(controller.signal)
      .then((runs) => {
        if (!controller.signal.aborted) setRuns(runs)
      })
      .catch((error) => {
        if (!isAbortError(error)) console.warn('加载采集运行失败', error)
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false)
      })
    return () => controller.abort()
  }, [])
  const counts = useMemo(() => {
    const result: Record<PollOutcomeKey, number> = {
      idle: 0,
      unchanged: 0,
      changed: 0,
      empty: 0,
      failed: 0,
      unknown: 0,
      running: 0,
    }
    runs.forEach((run) => {
      result[pollOutcome(run).key] += 1
    })
    return result
  }, [runs])
  return (
    <Panel className="content-card data-card">
      <Toolbar
        note={
          '最近 ' +
          runs.length +
          ' 条记录 · 旧记录待判定 ' +
          counts.unknown +
          ' 条'
        }
      >
        <div className="alert-summary">
          <Clock3 size={16} />
          <strong>采集运行</strong>
        </div>
      </Toolbar>
      <div className="poll-run-summary">
        <Chip color="default">无赛事实际采集 {counts.idle}</Chip>
        <Chip color="default">已采集无变化 {counts.unchanged}</Chip>
        <Chip color="warning">采集但无榜单行 {counts.empty}</Chip>
        <Chip color="success">有变更 {counts.changed}</Chip>
        <Chip color="danger">失败 {counts.failed}</Chip>
        <Chip color="primary">运行中 {counts.running}</Chip>
      </div>
      {loading ? (
        <LoadingRows />
      ) : (
        <DataTable aria-label="采集运行" className="data-table polls-table">
          <thead>
            <tr>
              <th scope="col">本轮结果</th>
              <th scope="col">开始</th>
              <th scope="col">完成</th>
              <th scope="col">耗时</th>
              <th scope="col">赛事（发现 / 采集）</th>
              <th scope="col">榜单行</th>
              <th scope="col">变更行</th>
              <th scope="col">错误</th>
            </tr>
          </thead>
          <tbody>
            {!runs.length && (
              <tr>
                <td colSpan={8}>
                  <Empty text="暂无采集记录" />
                </td>
              </tr>
            )}
            {runs.map((run) => {
              const outcome = pollOutcome(run)
              return (
                <tr key={run.id}>
                  <td>
                    <div className="poll-run-result">
                      <Chip color={outcome.color}>{outcome.label}</Chip>
                      <small>{outcome.detail}</small>
                    </div>
                  </td>
                  <td>{fmt(run.started_at)}</td>
                  <td>{fmt(run.finished_at)}</td>
                  <td>{pollDuration(run)}</td>
                  <td>
                    {run.contests_seen ?? '—'} / {run.contests_polled ?? '—'}
                  </td>
                  <td>{run.rows_seen ?? '—'}</td>
                  <td>{run.changed_rows ?? '—'}</td>
                  <td>{run.error_message || '—'}</td>
                </tr>
              )
            })}
          </tbody>
        </DataTable>
      )}
    </Panel>
  )
}
