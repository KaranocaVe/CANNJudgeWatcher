export const fmt = (value?: string | number | null, options?: Intl.DateTimeFormatOptions) => {
  if (value == null || value === '') return '—'
  if (typeof value === 'number') return value.toLocaleString('zh-CN', { maximumFractionDigits: 2 })
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString('zh-CN', { hour12: false, ...options })
}
export const dateOnly = (value?: string) => fmt(value, { month: 'short', day: 'numeric' })
export const score = (value?: number | null) => value == null ? '—' : value.toLocaleString('zh-CN', { maximumFractionDigits: 2 })
export const statusLabel = (status?: string) => ({ Pass: '通过', SUCCESS: '成功', FAILED: '失败', RUNNING: '采集中', CompileError: '编译错误', WrongAnswer: '答案错误', RuntimeError: '运行错误' } as Record<string, string>)[status || ''] || status || '未知'
export const statusColor = (status?: string): 'success' | 'danger' | 'warning' | 'primary' | 'default' => status === 'Pass' || status === 'SUCCESS' ? 'success' : status === 'FAILED' || status === 'CompileError' || status === 'WrongAnswer' || status === 'RuntimeError' ? 'danger' : status === 'RUNNING' ? 'primary' : 'warning'
export const alertColor = (severity?: string): 'danger' | 'warning' | 'primary' | 'default' => severity === 'HIGH' || severity === 'ERROR' ? 'danger' : severity === 'WARN' || severity === 'WARNING' ? 'warning' : severity === 'INFO' ? 'primary' : 'default'
export const rangeStart = (days: number) => new Date(Date.now() - days * 86400000).toISOString()
