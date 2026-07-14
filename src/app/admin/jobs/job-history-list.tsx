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
import { DismissJobButton } from "./dismiss-job-button";

function formatProgress(job: CurationJob): string {
  const complete = job.succeeded_count + job.skipped_count + job.failed_count;
  return `${complete} / ${job.target_total}`;
}

function formatOutcome(job: CurationJob): string {
  return `${job.succeeded_count} ok, ${job.skipped_count} skipped, ${job.failed_count} failed`;
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
      <nav aria-label="Filter data jobs" className="flex flex-wrap gap-2">
        <JobViewLink
          view={view}
          value="attention"
          label={`Needs Attention (${counts.attention})`}
        />
        <JobViewLink
          view={view}
          value="active"
          label={`Active (${counts.active})`}
        />
        <JobViewLink
          view={view}
          value="history"
          label={`History (${counts.history})`}
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
            Railway Logs
          </a>
        </div>
      ) : null}

      <div className="overflow-x-auto rounded-xl border border-border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Created</TableHead>
              <TableHead>Trigger</TableHead>
              <TableHead>Attempt</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Progress</TableHead>
              <TableHead>Outcome</TableHead>
              <TableHead>Duration</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {initialJobs.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={7}
                  className="py-8 text-center text-muted-foreground"
                >
                  No data jobs in this view.
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
                      <div className="mt-2 flex gap-2">
                        <DispatchJobButton
                          jobId={job.id}
                          label="Retry dispatch"
                          retry
                        />
                        <DismissJobButton jobId={job.id} />
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
