'use client'

import { Fragment, useEffect, useState, useTransition } from 'react'
import Link from 'next/link'
import {
  listCurationJobsAction,
  type CurationJob,
} from '@/app/admin/operations/actions'
import { FIELD_LABELS } from '@/lib/constants/field-labels'
import type { BrandOutcome, PhaseResult } from '@/lib/types/curation'
import { PhaseBadges } from './phase-badges'
import { Badge } from '@/components/ui/badge'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import type { Json } from '@/lib/supabase/database.types'

type JobProgress = {
  processed: number
  total: number
  skipped: number
  failed: number
}

type JobResult = JobProgress & {
  changed: number
  brandOutcomes?: BrandOutcome[]
  errors?: Array<{ slug: string; error: string }>
}

function isRecord(v: Json | null | undefined): v is Record<string, Json | undefined> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function readNum(v: Json | undefined): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0
}

function readString(v: Json | undefined): string | null {
  return typeof v === 'string' ? v : null
}

function readStringArray(v: Json | undefined): string[] {
  return Array.isArray(v) ? v.filter((item): item is string => typeof item === 'string') : []
}

function asProgress(json: Json | null): JobProgress | null {
  if (!isRecord(json)) return null

  return {
    processed: readNum(json.processed),
    total: readNum(json.total),
    skipped: readNum(json.skipped),
    failed: readNum(json.failed),
  }
}

function asBrandOutcomes(v: Json | undefined): BrandOutcome[] | undefined {
  if (!Array.isArray(v)) return undefined

  return v.flatMap((item) => {
    if (!isRecord(item)) return []

    const slug = readString(item.slug)
    const name = readString(item.name)
    const status = readString(item.status)
    const changedFields = readStringArray(item.changedFields)
    const phaseResults = asPhaseResults(item.phaseResults)
    const error = readString(item.error) ?? undefined

    if (
      !slug ||
      !name ||
      (status !== 'succeeded' && status !== 'changed' && status !== 'skipped' && status !== 'failed')
    ) {
      return []
    }

    const normalizedStatus = status === 'changed' ? 'succeeded' : status
    return [{ slug, name, status: normalizedStatus, changedFields, phaseResults, error }]
  })
}

function asPhaseResults(v: Json | undefined): PhaseResult[] | undefined {
  if (!Array.isArray(v)) return undefined

  return v.flatMap((item) => {
    if (!isRecord(item)) return []

    const phase = readString(item.phase)
    const status = readString(item.status)
    const changedFields = readStringArray(item.changedFields)
    const durationMs = item.durationMs
    const error = readString(item.error) ?? undefined
    const detail = readString(item.detail) ?? undefined

    if (
      !phase ||
      (status !== 'succeeded' && status !== 'skipped' && status !== 'failed') ||
      !Array.isArray(item.changedFields) ||
      typeof durationMs !== 'number' ||
      !Number.isFinite(durationMs)
    ) {
      return []
    }

    return [{ phase, status, changedFields, durationMs, error, detail }]
  })
}

function asErrors(v: Json | undefined): Array<{ slug: string; error: string }> | undefined {
  if (!Array.isArray(v)) return undefined

  return v.flatMap((item) => {
    if (!isRecord(item)) return []

    const slug = readString(item.slug) ?? ''
    const error = readString(item.error)

    return error ? [{ slug, error }] : []
  })
}

function asResult(json: Json | null): JobResult | null {
  if (!isRecord(json)) return null

  return {
    processed: readNum(json.processed),
    total: readNum(json.total),
    skipped: readNum(json.skipped),
    failed: readNum(json.failed),
    changed: readNum(json.changed),
    brandOutcomes: asBrandOutcomes(json.brandOutcomes),
    errors: asErrors(json.errors),
  }
}

function formatDuration(startedAt: string | null, completedAt: string | null) {
  if (!startedAt) return '-'

  const endMs = completedAt ? new Date(completedAt).getTime() : Date.now()
  const startMs = new Date(startedAt).getTime()

  if (!Number.isFinite(endMs) || !Number.isFinite(startMs) || endMs < startMs) {
    return '-'
  }

  const seconds = Math.round((endMs - startMs) / 1000)
  if (seconds < 60) return `${seconds} 秒`

  return `${Math.floor(seconds / 60)} 分 ${seconds % 60} 秒`
}

function formatDate(dateStr: string | null) {
  if (!dateStr) return '-'

  return new Date(dateStr).toLocaleString('zh-TW', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function operationLabel(op: string, dryRun: boolean) {
  const label = op === 'enrich' ? '資料抓取' : op
  return dryRun ? `${label} (預覽)` : label
}

function JobStatusBadge({ status }: { status: CurationJob['status'] }) {
  const config: Record<CurationJob['status'], { label: string; className: string }> = {
    pending: { label: '待處理', className: 'bg-[#F5F4F1] text-[#7C7570]' },
    running: { label: '執行中', className: 'bg-blue-50 text-blue-700 animate-pulse' },
    completed: { label: '已完成', className: 'bg-[#EAF3E8] text-[#2D5A27]' },
    failed: { label: '失敗', className: 'bg-[#FDF3EC] text-[#D94F3D]' },
  }

  return <Badge className={config[status].className}>{config[status].label}</Badge>
}

function OutcomeBadge({ status }: { status: BrandOutcome['status'] }) {
  const config: Record<BrandOutcome['status'], { label: string; className: string }> = {
    succeeded: { label: '成功', className: 'bg-[#EAF3E8] text-[#2D5A27]' },
    skipped: { label: '略過', className: 'bg-[#F5F4F1] text-[#7C7570]' },
    failed: { label: '失敗', className: 'bg-[#FDF3EC] text-[#D94F3D]' },
  }

  return <Badge className={config[status].className}>{config[status].label}</Badge>
}

function ProgressBar({ progress }: { progress: JobProgress }) {
  const width = progress.total > 0
    ? Math.min(100, Math.round((progress.processed / progress.total) * 100))
    : 0

  return (
    <div className="space-y-2">
      <div className="h-2 overflow-hidden rounded-full bg-muted">
        <div className="h-full rounded-full bg-[#E06B3F] transition-all" style={{ width: `${width}%` }} />
      </div>
      <div className="text-xs text-muted-foreground">
        {progress.processed}/{progress.total} 已處理
      </div>
    </div>
  )
}

function ResultSummary({
  result,
  progress,
}: {
  result: JobResult | null
  progress: JobProgress | null
}) {
  const changed = result?.changed ?? 0
  const skipped = result?.skipped ?? progress?.skipped ?? 0
  const failed = result?.failed ?? progress?.failed ?? 0

  return (
    <span>
      {changed} 成功 · {skipped} 略過 ·{' '}
      <span className={failed > 0 ? 'text-destructive' : undefined}>{failed} 失敗</span>
    </span>
  )
}

function formatChangedFields(fields: string[] | undefined): string {
  if (!fields || fields.length === 0) return '-'
  return fields.map((f) => FIELD_LABELS[f] ?? f).join(', ')
}

function BrandOutcomesTable({ outcomes }: { outcomes: BrandOutcome[] }) {
  return (
    <div className="rounded-lg border bg-white">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>品牌</TableHead>
            <TableHead>狀態</TableHead>
            <TableHead>階段</TableHead>
            <TableHead>變更</TableHead>
            <TableHead>錯誤</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {outcomes.map((outcome) => (
            <TableRow key={`${outcome.slug}-${outcome.status}`} className="hover:bg-[#F5F4F1]">
              <TableCell className="font-medium">
                <Link href={`/brands/${outcome.slug}`} className="underline-offset-2 hover:underline">
                  {outcome.name}
                </Link>
                <div className="text-xs text-muted-foreground">{outcome.slug}</div>
              </TableCell>
              <TableCell>
                <OutcomeBadge status={outcome.status} />
              </TableCell>
              <TableCell>
                <PhaseBadges phaseResults={outcome.phaseResults} />
              </TableCell>
              <TableCell className="text-sm text-muted-foreground">
                {formatChangedFields(outcome.changedFields)}
              </TableCell>
              <TableCell className="max-w-xl text-sm text-muted-foreground">
                {outcome.error ?? '-'}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}


function ExpandedJobDetails({
  job,
  result,
  progress,
}: {
  job: CurationJob
  result: JobResult | null
  progress: JobProgress | null
}) {
  const outcomes = result?.brandOutcomes ?? []

  return (
    <div className="space-y-4">
      {(job.status === 'pending' || job.status === 'running') && progress && (
        <div>
          <h2 className="text-sm font-semibold text-foreground">進度</h2>
          <div className="mt-3 rounded-md border bg-background p-4">
            <ProgressBar progress={progress} />
          </div>
        </div>
      )}

      {outcomes.length > 0 ? (
        <BrandOutcomesTable outcomes={outcomes} />
      ) : (
        <p className="text-sm text-muted-foreground">無品牌結果</p>
      )}
    </div>
  )
}

export function JobHistoryList({ initialJobs }: { initialJobs: CurationJob[] }) {
  const [jobs, setJobs] = useState<CurationJob[]>(initialJobs)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [isRefreshing, startTransition] = useTransition()
  const hasActiveJobs = jobs.some((job) => job.status === 'pending' || job.status === 'running')

  useEffect(() => {
    if (!hasActiveJobs) return

    const intervalId = window.setInterval(() => {
      startTransition(async () => {
        const result = await listCurationJobsAction()
        if ('jobs' in result) {
          setJobs(result.jobs)
        }
      })
    }, 3000)

    return () => window.clearInterval(intervalId)
  }, [hasActiveJobs])

  return (
    <div className="space-y-3">
      {isRefreshing && (
        <div className="text-xs text-muted-foreground">更新中...</div>
      )}

      <div className="overflow-hidden rounded-lg border bg-white">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>狀態</TableHead>
              <TableHead>類型</TableHead>
              <TableHead>品牌數</TableHead>
              <TableHead>結果</TableHead>
              <TableHead>執行者</TableHead>
              <TableHead>時間</TableHead>
              <TableHead>耗時</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {jobs.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} className="py-8 text-center text-[#7C7570]">
                  目前沒有任何工作紀錄。
                </TableCell>
              </TableRow>
            ) : (
              jobs.map((job) => {
                const result = asResult(job.result)
                const progress = asProgress(job.progress)
                const rowProgress = result ?? progress

                return (
                  <Fragment key={job.id}>
                    <TableRow
                      className="cursor-pointer hover:bg-muted/50"
                      onClick={() => setExpandedId((prev) => (prev === job.id ? null : job.id))}
                    >
                      <TableCell>
                        <JobStatusBadge status={job.status} />
                      </TableCell>
                      <TableCell>{operationLabel(job.operation, job.dry_run)}</TableCell>
                      <TableCell>{rowProgress?.total ?? '-'}</TableCell>
                      <TableCell>
                        <ResultSummary result={result} progress={progress} />
                      </TableCell>
                      <TableCell className="max-w-[180px] truncate">{job.started_by}</TableCell>
                      <TableCell>{formatDate(job.created_at)}</TableCell>
                      <TableCell>{formatDuration(job.started_at, job.completed_at)}</TableCell>
                    </TableRow>

                    {expandedId === job.id && (
                      <TableRow key={`${job.id}-expanded`}>
                        <TableCell colSpan={7} className="bg-muted/30 p-4">
                          <ExpandedJobDetails job={job} result={result} progress={progress} />
                        </TableCell>
                      </TableRow>
                    )}
                  </Fragment>
                )
              })
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  )
}
