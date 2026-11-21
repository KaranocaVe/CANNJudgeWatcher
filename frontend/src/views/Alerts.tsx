import { useCallback, useEffect, useRef, useState } from 'react'
import { ChevronRight, RefreshCw, ShieldCheck } from 'lucide-react'
import {
  Button,
  Panel,
  PanelBody,
  Chip,
  SelectField,
  DataTable,
  Empty,
  Toolbar,
} from '../ui'
import { alertColor, fmt } from '../format'
import { signalLabel } from '../domain'
import type { Alert } from '../types'
import { api } from '../api'
import { isAbortError } from '../useResource'

export default function AlertsView({
  contestId,
  onOpenAlert,
}: {
  contestId: string
  onOpenAlert: (alert: Alert) => void
}) {
  const [alerts, setAlerts] = useState<Alert[]>([])
  const [severityFilter, setSeverityFilter] = useState('all')
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const requestRef = useRef<AbortController | null>(null)
  const load = useCallback(async () => {
    requestRef.current?.abort()
    const controller = new AbortController()
    requestRef.current = controller
    setLoading(true)
    setLoadError('')
    try {
      const next = await api.alerts(
        { contestId: contestId || undefined },
        controller.signal,
      )
      if (!controller.signal.aborted) setAlerts(next)
    } catch (error) {
      if (!isAbortError(error) && !controller.signal.aborted)
        setLoadError((error as Error).message || '加载异常信号失败')
    } finally {
      if (requestRef.current === controller) setLoading(false)
    }
  }, [contestId])
  useEffect(() => {
    void load()
    return () => requestRef.current?.abort()
  }, [load])
  const visible = alerts.filter(
    (alert) =>
      severityFilter === 'all' ||
      (severityFilter === 'high'
        ? ['HIGH', 'ERROR'].includes(alert.severity)
        : !['HIGH', 'ERROR'].includes(alert.severity)),
  )
  const acknowledge = async (alert: Alert) => {
    try {
      const token = (await api.csrf()).token
      await api.acknowledge(alert.id, token)
      setAlerts((current) =>
        current.map((item) =>
          item.id === alert.id
            ? { ...item, acknowledgedAt: new Date().toISOString() }
            : item,
        ),
      )
    } catch (error) {
      setLoadError((error as Error).message || '确认告警失败')
    }
  }
  const high = alerts.filter((alert) =>
    ['HIGH', 'ERROR'].includes(alert.severity),
  ).length
  const info = alerts.filter(
    (alert) => !['HIGH', 'ERROR'].includes(alert.severity),
  ).length
  const latest = alerts[0]
  return (
    <div className="panel-stack">
      <div className="alert-overview">
        <Panel className="risk-card risk-danger">
          <PanelBody>
            <span>高风险信号</span>
            <strong>{high}</strong>
            <small>需要优先查看证据</small>
          </PanelBody>
        </Panel>
        <Panel className="risk-card risk-warning">
          <PanelBody>
            <span>关注信号</span>
            <strong>{info}</strong>
            <small>仅表示数据变化</small>
          </PanelBody>
        </Panel>
        <Panel className="risk-card risk-neutral">
          <PanelBody>
            <span>最新信号</span>
            <strong>{latest ? signalLabel(latest.ruleCode) : '—'}</strong>
            <small>{fmt(latest?.createdAt)}</small>
          </PanelBody>
        </Panel>
      </div>
      <Panel className="content-card data-card">
        <Toolbar note={loadError || '异常信号保留原始证据，不作违规定性'}>
          <div className="alert-summary">
            <ShieldCheck size={16} />
            <strong>{visible.length} 条原始变化信号</strong>
          </div>
          <SelectField
            aria-label="信号级别"
            className="range-select"
            value={severityFilter}
            onChange={(event) => setSeverityFilter(event.target.value)}
          >
            <option value="all">全部级别</option>
            <option value="high">高风险</option>
            <option value="watch">关注</option>
          </SelectField>
          <Button
            leading={<RefreshCw size={14} />}
            onClick={() => void load()}
            busy={loading}
          >
            刷新
          </Button>
        </Toolbar>
        <DataTable aria-label="异常信号" className="data-table alerts-table">
          <thead>
            <tr>
              <th scope="col">时间</th>
              <th scope="col">变化类型</th>
              <th scope="col">严重度</th>
              <th scope="col">证据</th>
              <th scope="col">来源</th>
              <th scope="col">操作</th>
            </tr>
          </thead>
          <tbody>
            {!visible.length && (
              <tr>
                <td colSpan={6}>
                  <Empty text={loadError || '暂无异常信号'} />
                </td>
              </tr>
            )}
            {visible.map((alert) => (
              <tr key={alert.id}>
                <td>{fmt(alert.createdAt)}</td>
                <td>
                  <button
                    type="button"
                    className="signal-link"
                    onClick={() => onOpenAlert(alert)}
                    title={
                      alert.problemId
                        ? '打开对应题目榜单'
                        : alert.contestId
                          ? '打开赛事概览'
                          : '打开采集运行'
                    }
                  >
                    <Chip color={alertColor(alert.severity)}>
                      {signalLabel(alert.ruleCode)}
                    </Chip>
                    <strong>{alert.title}</strong>
                    <ChevronRight size={15} />
                  </button>
                </td>
                <td>
                  <Chip color={alertColor(alert.severity)}>
                    {alert.severity || 'INFO'}
                  </Chip>
                </td>
                <td>
                  <div className="evidence-cell">
                    <strong>{alert.message}</strong>
                    {alert.evidence && (
                      <small>
                        {Object.entries(alert.evidence)
                          .map(([key, value]) => `${key}: ${String(value)}`)
                          .join(' · ')}
                      </small>
                    )}
                  </div>
                </td>
                <td>{alert.contestId ? 'CANNJudge 采集器' : '系统监控'}</td>
                <td>
                  {alert.acknowledgedAt ? (
                    '已确认'
                  ) : (
                    <Button onClick={() => void acknowledge(alert)}>
                      确认
                    </Button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </DataTable>
      </Panel>
    </div>
  )
}
