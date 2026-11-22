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
  contest_id?: string; problem_id?: string; team_key?: string; team_name?: string; user_id?: string; user_nickname?: string
  submitter_nickname?: string; rank?: number; status?: string; create_time?: string
  result?: Array<{ time?: number; status?: string; testcaseId?: string; caseSetId?: string; precisionRatio?: number }>
  previous_result?: Array<{ time?: number; status?: string; testcaseId?: string; caseSetId?: string; precisionRatio?: number }>
  observed_at?: string; updated_at?: string; previous_rank?: number; record_count?: number
}
export type CaseBestSummary = { global: Record<string, number>; teams: Record<string, Record<string, number>> }
export type SamplingGap = { from: string; to: string; source: "COLLECTOR" | "PROBLEM" }
export type SamplingSnapshot = { sampledAt?: string | null; status: "ENDED" | "UPCOMING" | "PAUSED" | "UNOBSERVED" | "STALE" | "RECENT"; verified: boolean }
export type RankingResponse = { sampling?: SamplingSnapshot; items: Ranking[]; caseBests: CaseBestSummary; activeCaseSetId?: string | null }
export type HistoryResponse = { gaps?: SamplingGap[]; items: HistoryPoint[]; caseBests?: CaseBestSummary }
export type ContestOverview = {
  from?: string; to?: string; gaps?: SamplingGap[]; sampling?: SamplingSnapshot
  openAlerts?: number
  problems: Record<string, { rowCount: number; passCount: number; eventCount: number }>
  activity: Array<{ observed_at: string; changes: number; deletes: number; improvements?: number; regressions?: number }>
}
export type HistoryPoint = Ranking & { event_type?: string; evidence?: Record<string, unknown> }
export type UserPerformanceItem = {
  contest_id: string; contest_title: string; contest_status?: string; problem_id: string; problem_title: string
  team_key?: string; team_name?: string; user_id?: string; user_nickname?: string; rank?: number; best_rank?: number
  status?: string; observed_at?: string; first_observed_at?: string; event_count?: number
}
export type UserDirectoryItem = { user_key: string; user_id?: string; user_nickname?: string; contest_count: number; problem_count: number; event_count: number; latest_observed_at?: string }
export type UserPerformanceResponse = { userId?: string; userNickname?: string; items: UserPerformanceItem[] }
export type ProblemStats = { observed_at?: string; attempt_count?: number; pass_user_count?: number; pass_count?: number; wrong_count?: number; fail_count?: number; submission_count?: number }
export type PollRun = { id: number; started_at?: string; finished_at?: string; status: 'RUNNING' | 'SUCCESS' | 'FAILED' | 'INTERRUPTED'; contests_seen?: number; contests_polled?: number | null; rows_seen?: number; changed_rows?: number; response_hash?: string; error_message?: string }
export type Alert = { id: number; createdAt: string; acknowledgedAt?: string; ruleCode: string; severity: string; contestId?: string; problemId?: string; teamKey?: string; title: string; message: string; evidence?: Record<string, unknown> }
export type Summary = { collectorLate?: boolean; successful?: number; failed?: number; last_finished?: string; activeContests?: number; openAlerts?: number; latestPoll?: PollRun[] }

export type SelectedUser = { id?: string; nickname?: string; name: string }
export type SelectedPerformance = { contestId: string; contestTitle: string; problemId: string; problemTitle: string; teamKey: string; teamName: string }

export type ParticipationFilters = {
  minimumContests: number
  minimumSubmissions: number
  topN: number
  mode: 'rank' | 'awards'
  agentOnly: boolean
}
export type ParticipationStatus = "ACTIVE" | "ENDED" | "UPCOMING" | "UNKNOWN"
export type ParticipationContest = {
  id: string
  title: string
  sourceUrl: string | null
  endedAt: string | null
  origin: "PUBLIC" | "WATCHER"
  status: ParticipationStatus
  organization: "INDIVIDUAL" | "TEAM" | "UNKNOWN"
  observedParticipants: number
  totalSubmissions?: number | null
  rankAccess: "PUBLIC" | "HIDDEN" | "HISTORICAL"
  summarySampledAt?: string | null
  participants: number
  awardsSource?: string | null
  sampledAt?: string | null
}
export type ParticipationEntry = {
  contestId: string
  title: string
  sourceUrl: string | null
  submissions: number
  rank: number | null
  submissionSource: "OFFICIAL" | "WATCHER"
  rankSource: "INDIVIDUAL" | "TEAM" | null
  status: ParticipationStatus
  finalRank: boolean
  rankUnavailable?: 'HIDDEN' | 'HISTORICAL' | 'UNSYNCED' | 'MULTIPLE_TEAMS' | 'MISSING_TEAM' | 'TEAM_NOT_LISTED' | 'NOT_LISTED' | null
  observedProblemRank?: { problemTitle: string; rank: number; team: boolean } | null
  participants: number
  award?: boolean | null
  awardSource?: string | null
  agentSource?: string | null
  observedSubmissions?: number | null
}
export type ParticipationItem = {
  userId: string
  nickname: string
  contestCount: number
  stageCount: number
  rankKnown: number
  lowerBound: boolean
  submissions: number
  topFinishes: number
  awardWins: number
  awardKnown: number
  agentEvidenceCount: number
  score: number
  entries: ParticipationEntry[]
}
export type ParticipationResponse = {
  refreshedAt?: string | null
  eligibleContests: number
  coveredContests: number
  observedContests: number
  userCoveredContests: number
  totalSubmissionsContests: number
  awardCoveredContests: number
  items: ParticipationItem[]
  contests: ParticipationContest[]
}
