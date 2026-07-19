import Link from "next/link";
import { ExternalLink } from "lucide-react";
import type { CurationJob } from "@/lib/services/curation-jobs";
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
import { CancelJobButton } from "./cancel-job-button";

function formatProgress(job: CurationJob): string {
  const complete =
    job.succeeded_count +
    job.skipped_count +
    job.failed_count +
    (job.cancelled_count ?? 0);
  return `${complete} / ${job.target_total}`;
}

function formatOutcome(job: CurationJob): string {
  const cancelled = job.cancelled_count ?? 0;
  return `${job.succeeded_count} ok, ${job.skipped_count} skipped, ${job.failed_count} failed${cancelled ? `, ${cancelled} cancelled` : ""}`;
}

export function JobHistoryList({
  initialJobs,
  nextCursor,
  previousCursor,
  railwayLogsUrl,
}: {
  initialJobs: CurationJob[];
  nextCursor?: string | null;
  previousCursor?: string | null;
  railwayLogsUrl?: string;
}) {
  const hasActiveJob = initialJobs.some(
    (job) => job.status === "pending" || job.status === "running",
  );

  return (
    <div className="space-y-3">
      <JobAutoRefresh active={hasActiveJob} />
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
              <TableHead>Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {initialJobs.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={8}
                  className="py-8 text-center text-muted-foreground"
                >
                  No data jobs yet.
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
                  <TableCell>
                    {job.status === "pending" || job.status === "running" ? (
                      <CancelJobButton jobId={job.id} />
                    ) : null}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
      {previousCursor || nextCursor ? (
        <nav aria-label="Data jobs pagination" className="flex justify-between gap-3">
          <CursorLink cursor={previousCursor} direction="previous" label="Newer" />
          <CursorLink cursor={nextCursor} direction="next" label="Older" />
        </nav>
      ) : null}
    </div>
  );
}

function CursorLink({
  cursor,
  direction,
  label,
}: {
  cursor?: string | null;
  direction: "next" | "previous";
  label: string;
}) {
  if (!cursor) return <span />;
  return (
    <Link
      href={`/admin/jobs?cursor=${encodeURIComponent(cursor)}&direction=${direction}`}
      className={buttonVariants({
        variant: "secondary",
        size: "default",
        className: "min-h-12",
      })}
    >
      {label}
    </Link>
  );
}
