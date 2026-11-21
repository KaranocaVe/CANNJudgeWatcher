import { ArrowUpRight, X } from 'lucide-react'
import { useEffect, useRef } from 'react'
import {
  caseDeltaClass,
  caseDeltaText,
  caseVersionLabel,
  teamLabel,
  timeValue,
} from '../domain'
import { formatMetric, statusLabel } from '../format'
import type { CaseBestSummary, Ranking } from '../types'
import { Button, Status, Timestamp } from '../ui'

export type IndexedRanking = {
  row: Ranking
  current: Map<string, NonNullable<Ranking['result']>[number]>
  previous: Map<string, NonNullable<Ranking['result']>[number]>
  search: string
}

export function nameOf(row: Ranking) {
  return teamLabel(row.team_name || row.user_nickname || row.submitter_nickname)
}

export function CaseReading({
  item,
}: {
  item?: NonNullable<Ranking['result']>[number]
}) {
  const time = timeValue(item?.time)
  return (
    <>
      {time != null ? (
        <>
          {formatMetric(time)} <span className="unit">μs</span>
        </>
      ) : item ? (
        statusLabel(item.status)
      ) : (
        '—'
      )}
    </>
  )
}

export default function RankingEvidence({
  indexed,
  cases,
  bests,
  selectedCase,
  allVersions,
  onClose,
  onProfile,
}: {
  indexed: IndexedRanking
  cases: string[]
  bests: CaseBestSummary
  selectedCase: string
  allVersions: boolean
  onClose: () => void
  onProfile: () => void
}) {
  const dialog = useRef<HTMLDialogElement>(null)
  const { row, current, previous } = indexed
  useEffect(() => {
    const node = dialog.current
    node?.showModal()
    return () => node?.close()
  }, [])
  return (
    <dialog
      className="case-drawer"
      ref={dialog}
      aria-labelledby="team-detail"
      onCancel={onClose}
    >
      <div className="drawer-head">
        <div>
          <div className="drawer-kicker">
            <span>{row.rank == null ? '未排名' : `#${row.rank}`}</span>
            <Status value={row.status} />
          </div>
          <h2 id="team-detail">{nameOf(row)}</h2>
          {row.submitter_nickname && row.submitter_nickname !== nameOf(row) && (
            <p>{row.submitter_nickname}</p>
          )}
        </div>
        <Button onClick={onClose} aria-label="关闭测试点详情">
          <X size={19} />
        </Button>
      </div>
      <div className="drawer-body">
        <div className="drawer-meta">
          <div>
            <span>最近提交</span>
            <Timestamp
              value={row.create_time || row.updated_at || row.observed_at}
            />
          </div>
          <div>
            <span>性能记录</span>
            <strong>{row.record_count ?? '—'}</strong>
          </div>
          {(row.user_id || row.user_nickname) && (
            <Button trailing={<ArrowUpRight size={15} />} onClick={onProfile}>
              用户历史
            </Button>
          )}
        </div>
        <h3>测试点成绩</h3>
        {cases.length ? (
          <ul className="case-readings">
            {cases.map((id, index) => {
              const item = current.get(id)
              const before = previous.get(id)
              const best = row.team_key
                ? bests.teams[row.team_key]?.[id]
                : undefined
              const globalBest = bests.global[id]
              return (
                <li key={id} data-selected={id === selectedCase}>
                  <div className="reading-main">
                    <span>
                      用例 {index + 1}
                      {allVersions && caseVersionLabel(id) && (
                        <small> · {caseVersionLabel(id)}</small>
                      )}
                    </span>
                    <strong>
                      <CaseReading item={item} />
                    </strong>
                  </div>
                  {item?.status &&
                    item.status !== 'Pass' &&
                    timeValue(item.time) != null && (
                      <span>{statusLabel(item.status)}</span>
                    )}
                  <div className="reading-bests">
                    <span>
                      队伍最佳{' '}
                      <b>{best == null ? '—' : `${formatMetric(best)} μs`}</b>
                    </span>
                    <span>
                      全场最佳{' '}
                      <b>
                        {globalBest == null
                          ? '—'
                          : `${formatMetric(globalBest)} μs`}
                      </b>
                    </span>
                  </div>
                  {item && (
                    <span className={caseDeltaClass(item, before)}>
                      {caseDeltaText(item, before)}
                    </span>
                  )}
                </li>
              )
            })}
          </ul>
        ) : (
          <p>这条榜单记录没有测试点成绩。</p>
        )}
      </div>
    </dialog>
  )
}
