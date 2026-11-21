import { formatMetric } from '../format'
import type { Ranking } from '../types'

type CaseResult = NonNullable<Ranking['result']>[number]

export function passedTime(item?: CaseResult) {
  return item?.status === 'Pass' &&
    item.time != null &&
    Number.isFinite(item.time) &&
    item.time > 0
    ? item.time
    : null
}

export function latencyScale(values: number[]) {
  if (!values.length) return null
  const low = Math.floor(Math.log10(Math.min(...values)))
  const high = Math.max(low + 1, Math.ceil(Math.log10(Math.max(...values))))
  const step = Math.ceil((high - low) / 4)
  const ticks = Array.from(
    { length: Math.ceil((high - low) / step) },
    (_, i) => low + i * step,
  )
  ticks.push(high)
  return {
    ticks: ticks.map((exponent) => ({
      label:
        exponent < -2
          ? (10 ** exponent).toExponential()
          : formatMetric(10 ** exponent),
      position: ((exponent - low) / (high - low)) * 100,
    })),
    position: (value: number) =>
      ((Math.log10(value) - low) / (high - low)) * 100,
  }
}

export type LatencyScale = NonNullable<ReturnType<typeof latencyScale>>

export function LatencyAxis({ scale }: { scale: LatencyScale }) {
  return (
    <div
      className="latency-axis"
      data-ticks={scale.ticks.map((tick) => tick.label).join(',')}
    >
      {scale.ticks.map(({ label, position }) => (
        <span key={label} style={{ left: `${position}%` }}>
          {label}
        </span>
      ))}
    </div>
  )
}

export function LatencyMarks({
  scale,
  current,
  previous,
  selected = false,
  reference = false,
}: {
  scale: LatencyScale
  current: number | null
  previous?: number | null
  selected?: boolean
  reference?: boolean
}) {
  const here = current == null ? null : scale.position(current)
  const before = previous == null ? null : scale.position(previous)
  return (
    <div
      className="latency-marks"
      aria-hidden="true"
      data-selected={selected}
      data-reference={reference}
    >
      {scale.ticks.map((tick) => (
        <span
          className="latency-rule"
          key={tick.label}
          style={{ left: `${tick.position}%` }}
        />
      ))}
      {here != null && before != null && (
        <span
          className="latency-change"
          style={{
            left: `${Math.min(here, before)}%`,
            width: `${Math.abs(here - before)}%`,
          }}
        />
      )}
      {before != null && (
        <span
          className="latency-point latency-previous"
          style={{ left: `${before}%` }}
        />
      )}
      {here != null && (
        <span className="latency-point" style={{ left: `${here}%` }} />
      )}
    </div>
  )
}
