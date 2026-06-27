import { ExternalLink } from 'lucide-react'
import type { CurationJob } from '@/app/admin/operations/actions'
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

type JobSummary = {
  success: number
  failed: number
}

function isRecord(v: Json | null | undefined): v is Record<string, Json | undefined> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function readNum(v: Json | undefined): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0
}

function asSummary(json: Json | null): JobSummary | null {
  if (!isRecord(json)) return null
  const hasSummaryCount =
    typeof json.success === 'number' ||
    typeof json.failed === 'number'

  if (!hasSummaryCount) return null

  return {
    success: readNum(json.success),
    failed: readNum(json.failed),
  }
}

function formatSummary(result: Json | null): string {
  const summary = asSummary(result)

  if (!summary) return '-'

  return `${summary.success} success, ${summary.failed} failed`
}

function formatDuration(startedAt: string | null, completedAt: string | null) {
  if (!startedAt || !completedAt) return '-'

  const endMs = new Date(completedAt).getTime()
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
    running: { label: '執行中', className: 'bg-[#F5F4F1] text-[#7C7570]' },
    completed: { label: '已完成', className: 'bg-[#EAF3E8] text-[#2D5A27]' },
    failed: { label: '失敗', className: 'bg-[#FDF3EC] text-[#D94F3D]' },
  }

  return <Badge className={config[status].className}>{config[status].label}</Badge>
}

export function JobHistoryList({
  initialJobs,
  railwayLogsUrl,
}: {
  initialJobs: CurationJob[]
  railwayLogsUrl?: string
}) {
  return (
    <div className="space-y-3">
      {railwayLogsUrl && (
        <div className="flex justify-end">
          <a
            href={railwayLogsUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-2 rounded-md border border-[#E5E0D8] bg-white px-3 py-2 text-sm font-medium text-[#1C1C1C] shadow-sm transition-colors hover:bg-[#FAF8F3] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
          >
            <ExternalLink className="h-4 w-4" aria-hidden="true" />
            View Railway Logs
          </a>
        </div>
      )}

      <div className="overflow-hidden rounded-lg border border-[#E5E0D8] bg-white">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>建立時間</TableHead>
              <TableHead>類型</TableHead>
              <TableHead>狀態</TableHead>
              <TableHead>摘要</TableHead>
              <TableHead>耗時</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {initialJobs.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="py-8 text-center text-[#7C7570]">
                  目前沒有任何工作紀錄。
                </TableCell>
              </TableRow>
            ) : (
              initialJobs.map((job) => (
                <TableRow key={job.id} className="hover:bg-muted/50">
                  <TableCell>{formatDate(job.created_at)}</TableCell>
                  <TableCell>{operationLabel(job.operation, job.dry_run)}</TableCell>
                  <TableCell>
                    <JobStatusBadge status={job.status} />
                  </TableCell>
                  <TableCell className="text-muted-foreground">{formatSummary(job.result)}</TableCell>
                  <TableCell>{formatDuration(job.started_at, job.completed_at)}</TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  )
}
