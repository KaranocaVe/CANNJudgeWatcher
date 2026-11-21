import { useEffect, useRef } from 'react'
import { init, use, type ComposeOption, type EChartsType } from 'echarts/core'
import {
  BarChart,
  LineChart,
  type BarSeriesOption,
  type LineSeriesOption,
} from 'echarts/charts'
import {
  GridComponent,
  LegendComponent,
  MarkLineComponent,
  TooltipComponent,
  type GridComponentOption,
  type LegendComponentOption,
  type MarkLineComponentOption,
  type TooltipComponentOption,
} from 'echarts/components'
import { CanvasRenderer } from 'echarts/renderers'

use([
  BarChart,
  LineChart,
  GridComponent,
  LegendComponent,
  MarkLineComponent,
  TooltipComponent,
  CanvasRenderer,
])

export type ChartOption = ComposeOption<
  | BarSeriesOption
  | LineSeriesOption
  | GridComponentOption
  | LegendComponentOption
  | MarkLineComponentOption
  | TooltipComponentOption
>

export function Chart({
  option,
  height,
  label = '趋势图',
}: {
  option: ChartOption
  height: number
  label?: string
}) {
  const element = useRef<HTMLDivElement>(null)
  const chart = useRef<EChartsType>(null)

  useEffect(() => {
    if (!element.current) return
    const instance = init(element.current)
    chart.current = instance
    const observer = new ResizeObserver(() => instance.resize())
    observer.observe(element.current)
    return () => {
      observer.disconnect()
      instance.dispose()
      chart.current = null
    }
  }, [])

  useEffect(() => {
    chart.current?.setOption(
      {
        ...option,
        animation: !window.matchMedia('(prefers-reduced-motion: reduce)')
          .matches,
      },
      { notMerge: true },
    )
  }, [option])

  return (
    <div
      className="chart"
      ref={element}
      style={{ height }}
      role="img"
      aria-label={label}
    />
  )
}
