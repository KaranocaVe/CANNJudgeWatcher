import { statusLabel } from './format'

export const signalLabel = (rule?: string) =>
  (
    ({
      SCORE_CHANGE: '分数变化',
      RANK_CHANGE: '名次变化',
      ROW_COUNT_CHANGE: '榜单规模变化',
      POLL_FAILURE: '采集失败',
      DATA_GAP: '数据断档',
    }) as Record<string, string>
  )[rule || ''] ||
  rule ||
  '变化信号'
export const teamLabel = (name?: string) =>
  (name || '未命名队伍').replace(/\s*的队伍\s*$/, '') || '未命名队伍'
export const timeValue = (value?: number) =>
  value == null || value <= 0 ? null : value
export const caseVersionLabel = (caseId: string) => {
  const separator = caseId.indexOf(':')
  return separator < 0 ? '' : caseId.slice(0, separator).slice(0, 8)
}
export const caseSetForKey = (caseId: string) => {
  const separator = caseId.indexOf(':')
  return separator < 0 ? '' : caseId.slice(0, separator)
}
export const caseKey = (
  item: { testcaseId?: string; caseSetId?: string },
  index: number,
) => {
  if (!item.testcaseId) return `case-${index + 1}`
  return item.caseSetId
    ? `${item.caseSetId}:${item.testcaseId}`
    : item.testcaseId
}
export const caseDeltaText = (
  current?: { time?: number; status?: string },
  previous?: { time?: number; status?: string },
) => {
  const currentTime = timeValue(current?.time)
  const previousTime = timeValue(previous?.time)
  if (!previous) return '首次观测'
  if (currentTime != null && previousTime != null) {
    const delta = currentTime - previousTime
    const performance =
      Math.abs(delta) < 0.005
        ? '未变化'
        : `${delta > 0 ? '↑ +' : '↓ '}${Math.abs(delta).toFixed(2)} μs`
    return current?.status === previous.status
      ? performance
      : `${performance} · ${statusLabel(previous.status)} → ${statusLabel(current?.status)}`
  }
  return current?.status === previous.status
    ? '未变化'
    : `${statusLabel(previous.status)} → ${statusLabel(current?.status)}`
}
export const caseDeltaClass = (
  current?: { time?: number; status?: string },
  previous?: { time?: number; status?: string },
) => {
  const currentTime = timeValue(current?.time)
  const previousTime = timeValue(previous?.time)
  if (!previous || (currentTime == null && previousTime == null))
    return current?.status === previous?.status
      ? 'metric-flat'
      : current?.status === 'Pass'
        ? 'metric-up'
        : previous?.status === 'Pass'
          ? 'metric-down'
          : 'metric-flat'
  return changeClass(currentTime, previousTime) || 'metric-flat'
}
export const changeText = (
  current?: number | null,
  previous?: number | null,
) => {
  if (current == null || previous == null) return '—'
  const delta = current - previous
  return Math.abs(delta) < 0.005
    ? '未变化'
    : `${delta > 0 ? '+' : ''}${delta.toFixed(2)} μs`
}
export const changeClass = (
  current?: number | null,
  previous?: number | null,
) =>
  current == null || previous == null
    ? ''
    : current > previous
      ? 'metric-down'
      : current < previous
        ? 'metric-up'
        : 'metric-flat'
