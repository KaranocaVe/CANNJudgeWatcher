type DateValue = string | number | null | undefined

const asDate = (value: DateValue) => {
  if (typeof value !== 'string') return null
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date
}

const clock = (date: Date) => date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false })
const sameDay = (left: Date, right: Date) => left.getFullYear() === right.getFullYear() && left.getMonth() === right.getMonth() && left.getDate() === right.getDate()

export const fmtFull = (value?: DateValue) => {
  if (value == null || value === '') return '—'
  if (typeof value === 'number') return value.toLocaleString('zh-CN', { maximumFractionDigits: 2 })
  const date = asDate(value)
  return date ? date.toLocaleString('zh-CN', { hour12: false }) : String(value)
}

export const fmt = (value?: DateValue, options?: Intl.DateTimeFormatOptions) => {
  if (value == null || value === '') return '—'
  if (typeof value === 'number') return value.toLocaleString('zh-CN', { maximumFractionDigits: 2 })
  const date = asDate(value)
  if (!date) return String(value)
  if (options) return date.toLocaleString('zh-CN', { hour12: false, ...options })

  const now = new Date()
  const elapsed = now.getTime() - date.getTime()
  if (elapsed >= -60_000 && elapsed < 45_000) return '刚刚'
  if (elapsed >= 45_000 && elapsed < 60 * 60_000) return `${Math.floor(elapsed / 60_000)} 分钟前`
  if (sameDay(date, now)) return clock(date)

  const yesterday = new Date(now); yesterday.setDate(now.getDate() - 1)
  if (sameDay(date, yesterday)) return `昨天 ${clock(date)}`
  if (date.getFullYear() === now.getFullYear()) return `${date.getMonth() + 1}月${date.getDate()}日 ${clock(date)}`
  return `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日 ${clock(date)}`
}
export const dateOnly = (value?: string) => fmt(value, { month: 'short', day: 'numeric' })
export const formatMetric = (value?: number | null) => value == null ? '—' : value.toLocaleString('zh-CN', { maximumFractionDigits: 2 })
export const statusLabel = (status?: string) => ({ Pass: '通过', SUCCESS: '成功', FAILED: '失败', RUNNING: '采集中', CompileError: '编译错误', WrongAnswer: '答案错误', RuntimeError: '运行错误' } as Record<string, string>)[status || ''] || status || '未知'
export const statusColor = (status?: string): 'success' | 'danger' | 'warning' | 'primary' | 'default' => status === 'Pass' || status === 'SUCCESS' ? 'success' : status === 'FAILED' || status === 'CompileError' || status === 'WrongAnswer' || status === 'RuntimeError' ? 'danger' : status === 'RUNNING' ? 'primary' : 'warning'
export const alertColor = (severity?: string): 'danger' | 'warning' | 'primary' | 'default' => severity === 'HIGH' || severity === 'ERROR' ? 'danger' : severity === 'WARN' || severity === 'WARNING' ? 'warning' : severity === 'INFO' ? 'primary' : 'default'
export const rangeStart = (days: number) => new Date(Date.now() - days * 86400000).toISOString()
