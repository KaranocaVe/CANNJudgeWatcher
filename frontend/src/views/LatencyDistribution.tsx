import { useMemo } from 'react'
import { formatMetric } from '../format'
import { SelectField } from '../ui'

export default function LatencyDistribution({
  values,
  cases,
  selected,
  onSelect,
}: {
  values: number[]
  cases: Array<{ id: string; label: string }>
  selected: string
  onSelect: (id: string) => void
}) {
  const series = useMemo(() => {
    if (!values.length) return null
    const sorted = values.slice().sort((a, b) => a - b)
    const minimum = sorted[0]
    const maximum = sorted[sorted.length - 1]
    const position = (sorted.length - 1) / 2
    const median =
      (sorted[Math.floor(position)] + sorted[Math.ceil(position)]) / 2
    const left = Math.log10(minimum)
    const span = Math.log10(maximum) - left
    const buckets = Array<number>(24).fill(0)
    sorted.forEach((value) => {
      const index =
        span > 0
          ? Math.min(23, Math.floor(((Math.log10(value) - left) / span) * 24))
          : 11
      buckets[index]++
    })
    return {
      minimum,
      maximum,
      median,
      buckets,
      span,
      left,
      peak: Math.max(...buckets),
    }
  }, [values])

  return (
    <section className="latency-panel" aria-labelledby="latency-title">
      <header>
        <div>
          <h2 id="latency-title">延迟分布</h2>
          <p>{values.length} 条通过记录</p>
        </div>
        {cases.length > 0 && (
          <SelectField
            aria-label="选择分布测试点"
            value={selected}
            onChange={(event) => onSelect(event.target.value)}
          >
            {cases.map((item) => (
              <option key={item.id} value={item.id}>
                {item.label}
              </option>
            ))}
          </SelectField>
        )}
      </header>
      {series ? (
        <>
          <div
            className="histogram"
            role="img"
            aria-label={`对数轴直方图，最小值 ${formatMetric(series.minimum)} 微秒，中位数 ${formatMetric(series.median)} 微秒，最大值 ${formatMetric(series.maximum)} 微秒`}
          >
            {series.buckets.map((count, index) => {
              const from = 10 ** (series.left + (index * series.span) / 24)
              const to = 10 ** (series.left + ((index + 1) * series.span) / 24)
              return (
                <div
                  key={index}
                  className="histogram-bin"
                  title={
                    count
                      ? `${formatMetric(from)}–${formatMetric(to)} μs · ${count} 支队伍`
                      : undefined
                  }
                >
                  <i
                    style={{
                      height: `${count ? Math.max(4, (100 * count) / series.peak) : 0}%`,
                    }}
                  />
                </div>
              )
            })}
          </div>
          <div className="histogram-axis">
            <span>{formatMetric(series.minimum)} μs</span>
            <span>{series.span ? '对数轴' : '单一耗时'}</span>
            <span>{formatMetric(series.maximum)} μs</span>
          </div>
          <div className="latency-median">
            <span>中位数</span>
            <strong>
              {formatMetric(series.median)} <small>μs</small>
            </strong>
          </div>
        </>
      ) : (
        <div className="latency-empty">暂无通过的测试点耗时</div>
      )}
    </section>
  )
}
