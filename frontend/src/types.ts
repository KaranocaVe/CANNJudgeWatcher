export type Contest = {
  id: string
  slug: string
  title: string
  description?: string
  startTime?: string
  endTime?: string
  sourceOngoing?: boolean
  sourceStatus?: string
  status: string
  monitoringEnabled: boolean
  manualOverride?: boolean
  pollIntervalSeconds: number
  lastSeenAt?: string
  lastPollAt?: string
  problemCount: number
}

export type Problem = { id: string; contestId: string; slug: string; title: string; difficulty?: number; tags?: string[] }
export type Ranking = {
  contest_id?: string; problem_id?: string; team_key?: string; team_name?: string; user_nickname?: string
  submitter_nickname?: string; rank?: number; status?: string; create_time?: string
  result?: Array<{ time?: number; status?: string; testcaseId?: string; precisionRatio?: number }>
  previous_result?: Array<{ time?: number; status?: string; testcaseId?: string; precisionRatio?: number }>
  observed_at?: string; updated_at?: string; previousRank?: number
}
export type CaseBestSummary = { global: Record<string, number>; teams: Record<string, Record<string, number>> }
export type RankingResponse = { items: Ranking[]; caseBests: CaseBestSummary }
export type ContestOverview = {
  problems: Record<string, { rowCount: number; passCount: number; eventCount: number }>
  activity: Array<{ observed_at: string; changes: number; deletes: number }>
}
export type HistoryPoint = Ranking & { event_type?: string; evidence?: Record<string, unknown> }
export type ProblemStats = { observed_at?: string; attempt_count?: number; pass_user_count?: number; pass_count?: number; wrong_count?: number; fail_count?: number; submission_count?: number }
export type PollRun = { id: number; started_at?: string; finished_at?: string; status: 'RUNNING' | 'SUCCESS' | 'FAILED'; contests_seen?: number; rows_seen?: number; changed_rows?: number; response_hash?: string; error_message?: string }
export type Alert = { id: number; createdAt: string; acknowledgedAt?: string; ruleCode: string; severity: string; contestId?: string; problemId?: string; teamKey?: string; title: string; message: string; evidence?: Record<string, unknown> }
export type Summary = { successful?: number; failed?: number; last_finished?: string; activeContests?: number; openAlerts?: number; latestPoll?: PollRun[] }
