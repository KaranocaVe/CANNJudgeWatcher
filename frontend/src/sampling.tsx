import { fmtFull } from './format'
import type { SamplingGap, SamplingSnapshot } from './types'
import { Timestamp } from './ui'

export function SamplingNotice({ snapshot }: { snapshot?: SamplingSnapshot }) {
  if (!snapshot) return null
  const labels = {
    STALE: '采集已超时，当前显示最后一次榜单快照',
    UNOBSERVED: '尚无成功采集的快照',
    PAUSED: '监控已暂停',
    ENDED: '赛事已结束',
    UPCOMING: '赛事尚未开始',
    RECENT: snapshot.verified ? '榜单采样' : '赛事最近采集',
  }
  return (
    <p
      className="sampling-notice"
      data-warning={
        snapshot.status === 'STALE' || snapshot.status === 'UNOBSERVED'
      }
      role="status"
    >
      <strong>{labels[snapshot.status]}</strong>
      {snapshot.sampledAt && (
        <span>
          {' '}
          · <Timestamp value={snapshot.sampledAt} />
        </span>
      )}
    </p>
  )
}

export function SamplingGaps({
  gaps,
  scope = '采集缺口',
}: {
  gaps: SamplingGap[]
  scope?: string
}) {
  if (!gaps.length) return null
  return (
    <details className="sampling-gaps">
      <summary>
        {scope} · {gaps.length} 段
      </summary>
      <ul>
        {gaps.map((gap) => (
          <li key={gap.from + gap.to}>
            <time dateTime={gap.from}>{fmtFull(gap.from)}</time> 至{' '}
            <time dateTime={gap.to}>{fmtFull(gap.to)}</time>
            <span>
              {' '}
              · {gap.source === 'PROBLEM' ? '赛题采样记录' : '全站运行日志推断'}
            </span>
          </li>
        ))}
      </ul>
    </details>
  )
}

type Point = [string | number, number | null]

export function breakAtGaps(points: Point[], gaps: SamplingGap[]): Point[] {
  const result: Point[] = []
  let nextGap = 0
  for (const point of points) {
    const timestamp = new Date(point[0]).getTime()
    while (nextGap < gaps.length && Date.parse(gaps[nextGap].to) <= timestamp) {
      const gap = gaps[nextGap++]
      const middle = (Date.parse(gap.from) + Date.parse(gap.to)) / 2
      const previous = result.at(-1)
      if (previous && new Date(previous[0]).getTime() < middle)
        result.push([middle, null])
    }
    result.push(point)
  }
  return result
}

export function gapArea(gaps: SamplingGap[]) {
  return {
    silent: true,
    itemStyle: { color: 'rgba(162, 112, 37, .16)' },
    label: { show: false },
    data: gaps.map(
      (gap) =>
        [{ xAxis: gap.from }, { xAxis: gap.to }] as [
          { xAxis: string },
          { xAxis: string },
        ],
    ),
  }
}
