import type { Alert, Contest, ContestOverview, HistoryResponse, PollRun, Problem, ProblemStats, RankingResponse, Summary } from './types'

type Params = Record<string, string | number | boolean | undefined>

async function request<T>(path: string, options: RequestInit = {}, params?: Params): Promise<T> {
  const url = new URL(path, window.location.origin)
  Object.entries(params ?? {}).forEach(([key, value]) => { if (value !== undefined && value !== '') url.searchParams.set(key, String(value)) })
  const response = await fetch(url, { credentials: 'same-origin', ...options, headers: { 'Content-Type': 'application/json', ...(options.headers || {}) } })
  if (!response.ok) {
    const body = await response.json().catch(() => null)
    throw new Error(body?.message || `请求失败（${response.status}）`)
  }
  if (response.status === 204) return undefined as T
  return response.json() as Promise<T>
}

export const api = {
  summary: (signal?: AbortSignal) => request<Summary>('/api/dashboard/summary', { signal }),
  contests: (signal?: AbortSignal) => request<Contest[]>('/api/contests', { signal }),
  contest: (id: string, signal?: AbortSignal) => request<{ contest: Contest; problems: Problem[] }>(`/api/contests/${id}`, { signal }),
  rankings: (contestId: string, problemId: string, params: Params = {}, signal?: AbortSignal) => request<RankingResponse>('/api/rankings', { signal }, { contestId, problemId, limit: 1000, ...params }),
  history: (contestId: string, problemId: string, from?: string, to?: string, options: { teamKey?: string; signal?: AbortSignal } = {}) => request<HistoryResponse>('/api/history', { signal: options.signal }, { contestId, problemId, from, to, teamKey: options.teamKey }),
  contestOverview: (contestId: string, signal?: AbortSignal) => request<ContestOverview>('/api/dashboard/contest-overview', { signal }, { contestId }),
  stats: (contestId: string, problemId: string, from?: string, to?: string) => request<{ items: ProblemStats[] }>('/api/problem-stats', {}, { contestId, problemId, from, to }),
  alerts: (params: Params = {}, signal?: AbortSignal) => request<Alert[]>('/api/alerts', { signal }, { limit: 200, ...params }),
  polls: (signal?: AbortSignal) => request<PollRun[]>('/api/polls', { signal }),
  health: () => request<Record<string, unknown>>('/api/source/health'),
  me: () => request<{ authenticated: boolean; username?: string }>('/api/auth/me'),
  csrf: () => request<{ token: string }>('/api/auth/csrf'),
  login: (username: string, password: string) => request('/api/auth/login', { method: 'POST', body: JSON.stringify({ username, password }) }),
  logoutWithToken: (token: string) => request('/api/auth/logout', { method: 'POST', headers: { 'X-XSRF-TOKEN': token } }),
  settings: () => request<Record<string, string>>('/api/settings'),
  updateSettings: (values: Record<string, string>, token: string) => request<Record<string, string>>('/api/settings', { method: 'PUT', headers: { 'X-XSRF-TOKEN': token }, body: JSON.stringify(values) }),
  monitor: (contestId: string, enabled: boolean, seconds: number, token: string) => request(`/api/contests/${contestId}/monitoring`, { method: 'PUT', headers: { 'X-XSRF-TOKEN': token }, body: JSON.stringify({ enabled, pollIntervalSeconds: seconds }) }),
  runPoll: (token: string) => request<{ accepted: boolean }>('/api/polls/run', { method: 'POST', headers: { 'X-XSRF-TOKEN': token } }),
  acknowledge: (id: number, token: string) => request(`/api/alerts/${id}/acknowledge`, { method: 'POST', headers: { 'X-XSRF-TOKEN': token } }),
}
