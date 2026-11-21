import { useEffect, useState, type FormEvent } from 'react'
import {
  ArrowRight,
  Eye,
  EyeOff,
  LockKeyhole,
  LogOut,
  RefreshCw,
  ShieldCheck,
} from 'lucide-react'
import {
  Button,
  Panel,
  PanelBody,
  PanelHeader,
  Chip,
  Input,
  DataTable,
} from '../ui'
import type { Contest } from '../types'
import { api } from '../api'

export default function SettingsView({
  contests,
  onReload,
}: {
  contests: Contest[]
  onReload: () => void
}) {
  const [authenticated, setAuthenticated] = useState(false)
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [message, setMessage] = useState('')
  const [settings, setSettings] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    api.me().then((data) => {
      setAuthenticated(data.authenticated)
      if (data.authenticated) api.settings().then(setSettings)
    })
  }, [])
  const login = async () => {
    setMessage('')
    setBusy(true)
    try {
      await api.login(username, password)
      setAuthenticated(true)
      setMessage('登录成功')
      setSettings(await api.settings())
    } catch (e) {
      setMessage((e as Error).message)
    } finally {
      setBusy(false)
    }
  }
  const toggle = async (contest: Contest) => {
    try {
      const token = (await api.csrf()).token
      await api.monitor(
        contest.id,
        !contest.monitoringEnabled,
        contest.pollIntervalSeconds,
        token,
      )
      onReload()
    } catch (error) {
      setMessage((error as Error).message || '更新赛事监控失败')
    }
  }
  const runNow = async () => {
    try {
      const token = (await api.csrf()).token
      const result = await api.runPoll(token)
      setMessage(result.accepted ? '已加入采集队列' : '已有采集任务运行中')
    } catch (error) {
      setMessage((error as Error).message || '启动采集失败')
    }
  }
  if (!authenticated)
    return (
      <div className="auth-stage">
        <Panel className="content-card auth-card">
          <PanelBody>
            <div className="auth-brand">
              <span className="auth-icon">
                <LockKeyhole size={19} strokeWidth={2.1} />
              </span>
              <div>
                <strong>CANNJudge Watcher</strong>
                <span>管理员控制台</span>
              </div>
            </div>
            <div className="auth-intro">
              <h2>登录管理控制台</h2>
            </div>
            <form
              className="auth-form"
              onSubmit={(event: FormEvent<HTMLFormElement>) => {
                event.preventDefault()
                void login()
              }}
            >
              <Input
                label="用户名"
                placeholder="请输入用户名"
                required
                value={username}
                onValueChange={setUsername}
                autoComplete="username"
              />
              <Input
                label="密码"
                placeholder="请输入密码"
                name="password"
                required
                type={showPassword ? 'text' : 'password'}
                value={password}
                onValueChange={setPassword}
                autoComplete="current-password"
                trailing={
                  <Button
                    type="button"
                    className="password-toggle"
                    onClick={() => setShowPassword((value) => !value)}
                    aria-label={showPassword ? '隐藏密码' : '显示密码'}
                  >
                    {showPassword ? <EyeOff size={17} /> : <Eye size={17} />}
                  </Button>
                }
              />
              <Button
                type="submit"
                color="primary"
                trailing={!busy && <ArrowRight size={17} />}
                busy={busy}
              >
                登录
              </Button>
              {message && (
                <span
                  className={`form-message ${message === '登录成功' ? 'success' : 'error'}`}
                  role="alert"
                >
                  {message}
                </span>
              )}
            </form>
            <div className="auth-footnote">
              <ShieldCheck size={14} />
              <span>使用安全会话 Cookie · 公开榜单无需登录</span>
            </div>
          </PanelBody>
        </Panel>
      </div>
    )
  return (
    <div className="panel-stack">
      <Panel className="content-card">
        <PanelHeader>
          <div>
            <h2>运行控制</h2>
          </div>
        </PanelHeader>
        <PanelBody>
          <div className="settings-actions">
            <Button
              color="primary"
              leading={<RefreshCw size={15} />}
              onClick={() => void runNow()}
            >
              立即采集
            </Button>
            <Button
              leading={<LogOut size={15} />}
              onClick={async () => {
                try {
                  const token = (await api.csrf()).token
                  await api.logoutWithToken(token)
                  setAuthenticated(false)
                } catch (error) {
                  setMessage((error as Error).message || '退出登录失败')
                }
              }}
            >
              退出登录
            </Button>
            {message && <span className="form-message">{message}</span>}
          </div>
          <hr />
          <div className="setting-fields">
            <Input
              label="默认采集间隔（秒）"
              type="number"
              value={settings.default_poll_interval_seconds || '120'}
              onValueChange={(value) =>
                setSettings((prev) => ({
                  ...prev,
                  default_poll_interval_seconds: value,
                }))
              }
            />
            <Input
              label="告警冷却时间（分钟）"
              type="number"
              value={settings.alert_cooldown_minutes || '30'}
              onValueChange={(value) =>
                setSettings((prev) => ({
                  ...prev,
                  alert_cooldown_minutes: value,
                }))
              }
            />
            <Button
              onClick={async () => {
                try {
                  const token = (await api.csrf()).token
                  await api.updateSettings(settings, token)
                  setMessage('设置已保存')
                } catch (error) {
                  setMessage((error as Error).message || '保存设置失败')
                }
              }}
            >
              保存全局设置
            </Button>
          </div>
        </PanelBody>
      </Panel>
      <Panel className="content-card data-card">
        <PanelHeader>
          <div>
            <h2>赛事监控</h2>
          </div>
        </PanelHeader>
        <DataTable aria-label="赛事监控设置" className="data-table">
          <thead>
            <tr>
              <th scope="col">赛事</th>
              <th scope="col">状态</th>
              <th scope="col">间隔</th>
              <th scope="col">源状态</th>
              <th scope="col">开关</th>
            </tr>
          </thead>
          <tbody>
            {contests.map((contest) => (
              <tr key={contest.id}>
                <td>
                  <strong>{contest.title}</strong>
                </td>
                <td>
                  <Chip
                    color={contest.status === 'ACTIVE' ? 'success' : 'default'}
                  >
                    {contest.status === 'ACTIVE' ? '进行中' : '已停用'}
                  </Chip>
                </td>
                <td>{Math.round(contest.pollIntervalSeconds / 60)} 分钟</td>
                <td>{contest.sourceStatus || '—'}</td>
                <td>
                  <Button onClick={() => void toggle(contest)}>
                    {contest.monitoringEnabled ? '监控中' : '已停用'}
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </DataTable>
      </Panel>
    </div>
  )
}
