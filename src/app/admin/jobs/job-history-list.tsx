import Link from "next/link";
import { ExternalLink } from "lucide-react";
import type {
  CurationJob,
  CurationJobCounts,
  CurationJobView,
} from "@/lib/services/curation-jobs";
import { buttonVariants } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { JobAutoRefresh } from "./job-auto-refresh";
import {
  formatJobDate,
  formatJobDuration,
  jobTriggerLabel,
  JobStatusBadge,
} from "./job-display";
import { DispatchJobButton } from "./dispatch-job-button";

function formatProgress(job: CurationJob): string {
  const complete = job.succeeded_count + job.skipped_count + job.failed_count;
  return `${complete} / ${job.target_total}`;
}

function formatOutcome(job: CurationJob): string {
  return `${job.succeeded_count} 成功、${job.skipped_count} 略過、${job.failed_count} 失敗`;
}

export function JobHistoryList({
  initialJobs,
  counts = { attention: 0, active: 0, history: initialJobs.length },
  view = "attention",
  railwayLogsUrl,
}: {
  initialJobs: CurationJob[];
  counts?: CurationJobCounts;
  view?: CurationJobView;
  railwayLogsUrl?: string;
}) {
  const hasActiveJob = initialJobs.some(
    (job) => job.status === "pending" || job.status === "running",
  );

  return (
    <div className="space-y-3">
      <JobAutoRefresh active={hasActiveJob} />
      <nav aria-label="資料工作篩選" className="flex flex-wrap gap-2">
        <JobViewLink
          view={view}
          value="attention"
          label={`需要處理 (${counts.attention})`}
        />
        <JobViewLink
          view={view}
          value="active"
          label={`執行中 (${counts.active})`}
        />
        <JobViewLink
          view={view}
          value="history"
          label={`歷史 (${counts.history})`}
        />
      </nav>
      {railwayLogsUrl ? (
        <div className="flex justify-end">
          <a
            href={railwayLogsUrl}
            target="_blank"
            rel="noreferrer"
            className={buttonVariants({
              variant: "secondary",
              size: "large",
              className: "min-h-12",
            })}
          >
            <ExternalLink aria-hidden="true" />
            Railway 原始紀錄
          </a>
        </div>
      ) : null}

      <div className="overflow-x-auto rounded-xl border border-border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>建立時間</TableHead>
              <TableHead>觸發來源</TableHead>
              <TableHead>嘗試</TableHead>
              <TableHead>狀態</TableHead>
              <TableHead>進度</TableHead>
              <TableHead>結果</TableHead>
              <TableHead>耗時</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {initialJobs.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={7}
                  className="py-8 text-center text-muted-foreground"
                >
                  此檢視目前沒有資料工作。
                </TableCell>
              </TableRow>
            ) : (
              initialJobs.map((job) => (
                <TableRow key={job.id}>
                  <TableCell>
                    <Link
                      href={`/admin/jobs/${job.id}`}
                      className="font-medium text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      {formatJobDate(job.created_at)}
                    </Link>
                  </TableCell>
                  <TableCell>{jobTriggerLabel(job.trigger)}</TableCell>
                  <TableCell>{job.attempt}</TableCell>
                  <TableCell>
                    <JobStatusBadge job={job} />
                    {job.status === "pending" &&
                    job.dispatch_status === "failed" ? (
                      <div className="mt-2">
                        <DispatchJobButton
                          jobId={job.id}
                          label="Retry dispatch"
                          retry
                        />
                      </div>
                    ) : null}
                  </TableCell>
                  <TableCell>{formatProgress(job)}</TableCell>
                  <TableCell
                    className={
                      job.failed_count > 0 ? "font-medium text-destructive" : ""
                    }
                  >
                    {formatOutcome(job)}
                  </TableCell>
                  <TableCell>
                    {formatJobDuration(job.started_at, job.completed_at)}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

function JobViewLink({
  view,
  value,
  label,
}: {
  view: CurationJobView;
  value: CurationJobView;
  label: string;
}) {
  return (
    <Link
      href={`/admin/jobs?view=${value}`}
      aria-current={view === value ? "page" : undefined}
      className={buttonVariants({
        variant: view === value ? "primary" : "secondary",
        size: "default",
        className: "min-h-12",
      })}
    >
      {label}
    </Link>
  );
}
