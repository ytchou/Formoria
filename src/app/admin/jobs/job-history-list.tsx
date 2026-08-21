import Link from "next/link";
import { ExternalLink } from "lucide-react";
import { useTranslations } from "next-intl";
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
import { routes } from "@/lib/routes";

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
  const t = useTranslations("admin.jobs");
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
            {t("actions.railwayLogs")}
          </a>
        </div>
      ) : null}

      <div className="overflow-x-auto rounded-[3px] border border-rule bg-surface">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("history.table.created")}</TableHead>
              <TableHead>{t("history.table.started")}</TableHead>
              <TableHead>{t("history.table.trigger")}</TableHead>
              <TableHead>{t("history.table.attempt")}</TableHead>
              <TableHead>{t("history.table.status")}</TableHead>
              <TableHead>{t("history.table.progress")}</TableHead>
              <TableHead>{t("history.table.outcome")}</TableHead>
              <TableHead>{t("history.table.duration")}</TableHead>
              <TableHead>{t("history.table.actions")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {initialJobs.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={9}
                  className="py-8 text-center text-ink-muted"
                >
                  {t("history.empty")}
                </TableCell>
              </TableRow>
            ) : (
              initialJobs.map((job) => (
                <TableRow key={job.id}>
                  <TableCell>
                    <Link
                      href={routes.admin.job(job.id)}
                      className="font-medium text-accent underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                    >
                      {formatJobDate(job.created_at)}
                    </Link>
                  </TableCell>
                  <TableCell>{formatJobDate(job.started_at)}</TableCell>
                  <TableCell>{jobTriggerLabel(job.trigger)}</TableCell>
                  <TableCell>{job.attempt}</TableCell>
                  <TableCell>
                    <JobStatusBadge job={job} />
                  </TableCell>
                  <TableCell>{formatProgress(job)}</TableCell>
                  <TableCell
                    className={
                      job.failed_count > 0 ? "font-medium text-danger" : ""
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
        <nav
          aria-label={t("history.pagination")}
          className="flex justify-between gap-3"
        >
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
      href={routes.admin.jobs({ cursor, direction })}
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
