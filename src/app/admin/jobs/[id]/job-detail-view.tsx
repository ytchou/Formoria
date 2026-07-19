import Link from "next/link";
import { ExternalLink } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { DataCard, InfoField, SurfaceCard } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { Json } from "@/lib/supabase/database.types";
import type {
  CurationJobDetail,
  CurationJobTarget,
  CurationTargetStatus,
} from "@/lib/services/curation-jobs";
import { JobAutoRefresh } from "../job-auto-refresh";
import {
  formatJobDate,
  formatJobDuration,
  jobTriggerLabel,
  JobStatusBadge,
  TargetStatusBadge,
  targetStatusLabel,
} from "../job-display";
import { RerunJobButton } from "./rerun-job-button";
import { DispatchJobButton } from "../dispatch-job-button";
import { CancelJobButton } from "../cancel-job-button";

type PhaseResult = {
  phase: string;
  status: "succeeded" | "skipped" | "failed";
  changedFields: string[];
  durationMs: number;
  error?: string;
  detail?: string;
};

const filters: Array<{ value: "all" | CurationTargetStatus; label: string }> = [
  { value: "all", label: "All" },
  { value: "pending", label: "Pending" },
  { value: "running", label: "Running" },
  { value: "succeeded", label: "Succeeded" },
  { value: "skipped", label: "Skipped" },
  { value: "failed", label: "Failed" },
  { value: "cancelled", label: "Cancelled" },
];

export function JobDetailView({
  detail,
  selectedStatus,
  railwayLogsUrl,
  snapshotUrl,
}: {
  detail: CurationJobDetail;
  selectedStatus: "all" | CurationTargetStatus;
  railwayLogsUrl?: string;
  snapshotUrl?: string | null;
}) {
  const { job, targets, parent, children } = detail;
  const visibleTargets =
    selectedStatus === "all"
      ? targets
      : targets.filter((target) => target.status === selectedStatus);
  const currentTarget = targets.find(
    (target) => target.target_id === job.current_target_id,
  );
  const active = job.status === "pending" || job.status === "running";
  const canRerunFailures = job.status === "completed" && job.failed_count > 0;
  const canRerunUnfinished =
    (job.status === "failed" || job.status === "cancelled") &&
    targets.some(
      (target) =>
        target.status === "pending" ||
        target.status === "running" ||
        target.status === "failed" ||
        target.status === "cancelled",
    );
  const canDispatch = job.status === "pending" && job.dispatch_status !== "failed";

  return (
    <div className="space-y-6">
      <JobAutoRefresh active={active} />
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-2">
          <Link
            href="/admin/jobs"
            className="inline-flex min-h-12 items-center type-body-emphasis text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            ← Back to Data Jobs
          </Link>
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="type-section-title-large">Job Detail</h1>
            <JobStatusBadge job={job} />
          </div>
          <p className="break-all font-mono text-sm text-muted-foreground">
            {job.id}
          </p>
        </div>
        <div className="flex flex-wrap gap-3">
          {canDispatch ? (
            <DispatchJobButton jobId={job.id} label="Run now" />
          ) : null}
          {active ? <CancelJobButton jobId={job.id} /> : null}
          {canRerunFailures ? (
            <RerunJobButton jobId={job.id} label="Rerun failed submissions" />
          ) : null}
          {canRerunUnfinished ? (
            <RerunJobButton
              jobId={job.id}
              label="Rerun unfinished submissions"
            />
          ) : null}
          <Link
            href={`/admin/jobs/${job.id}/runlog`}
            className={buttonVariants({
              variant: "secondary",
              size: "large",
              className: "min-h-12",
            })}
          >
            Run Log
          </Link>
          <a
            href={`/admin/jobs/${job.id}/runlog?download=1`}
            className={buttonVariants({
              variant: "secondary",
              size: "large",
              className: "min-h-12",
            })}
          >
            Download HTML
          </a>
          {snapshotUrl ? (
            <a
              href={snapshotUrl}
              target="_blank"
              rel="noreferrer"
              className={buttonVariants({
                variant: "secondary",
                size: "large",
                className: "min-h-12",
              })}
            >
              <ExternalLink aria-hidden="true" />
              Snapshot
            </a>
          ) : null}
          {railwayLogsUrl ? (
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
          ) : null}
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <DataCard label="Total Targets" value={job.target_total} />
        <DataCard label="Succeeded" value={job.succeeded_count} />
        <DataCard label="Skipped" value={job.skipped_count} />
        <DataCard label="Failed" value={job.failed_count} />
        <DataCard label="Cancelled" value={job.cancelled_count ?? 0} />
      </div>

      <SurfaceCard padding="lg">
        <h2 className="type-card-title">Execution Info</h2>
        <dl className="mt-5 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          <InfoField label="Trigger" value={jobTriggerLabel(job.trigger)} />
          <InfoField label="Attempt" value={job.attempt} />
          <InfoField
            label="Scheduled"
            value={formatJobDate(job.scheduled_for)}
          />
          <InfoField label="Started" value={formatJobDate(job.started_at)} />
          <InfoField label="Completed" value={formatJobDate(job.completed_at)} />
          <InfoField
            label="Duration"
            value={formatJobDuration(job.started_at, job.completed_at)}
          />
          <InfoField label="Started by" value={job.started_by} />
          <InfoField
            label="Current brand"
            value={currentTarget?.brand_name ?? "-"}
          />
          <InfoField label="Current phase" value={job.current_phase ?? "-"} />
          <InfoField
            label="Dispatch status"
            value={
              job.dispatch_status === "failed"
                ? "Dispatch failed"
                : job.dispatch_status === "dispatched"
                  ? "Dispatched"
                  : "Pending dispatch"
            }
          />
          {job.dispatch_error ? (
            <InfoField label="Dispatch error" value={job.dispatch_error} wide />
          ) : null}
          {job.job_error ? (
            <InfoField label="Job error" value={job.job_error} wide />
          ) : null}
        </dl>
      </SurfaceCard>

      {parent || children.length > 0 ? (
        <SurfaceCard padding="lg">
          <h2 className="type-card-title">Retry Lineage</h2>
          <div className="mt-4 flex flex-wrap gap-3">
            {parent ? (
              <LineageLink
                id={parent.id}
                label={`Previous job (attempt ${parent.attempt})`}
              />
            ) : null}
            {children.map((child) => (
              <LineageLink
                key={child.id}
                id={child.id}
                label={`${jobTriggerLabel(child.trigger)} (attempt ${child.attempt})`}
              />
            ))}
          </div>
        </SurfaceCard>
      ) : null}

      <section className="space-y-4" aria-labelledby="job-targets-heading">
        <div>
          <h2 id="job-targets-heading" className="type-card-title">
            Brand Details
          </h2>
          <p className="mt-1 type-card-description">
            Phase results, changed fields, and error summary per brand.
          </p>
        </div>
        <nav aria-label="Filter brands by status" className="flex flex-wrap gap-2">
          {filters.map((filter) => {
            const selected = selectedStatus === filter.value;
            const href =
              filter.value === "all"
                ? `/admin/jobs/${job.id}`
                : `/admin/jobs/${job.id}?status=${filter.value}`;
            return (
              <Link
                key={filter.value}
                href={href}
                aria-current={selected ? "page" : undefined}
                className={buttonVariants({
                  variant: selected ? "primary" : "secondary",
                  size: "default",
                  className: "min-h-12",
                })}
              >
                {filter.label}
              </Link>
            );
          })}
        </nav>

        <SurfaceCard padding="none" className="overflow-x-auto">
          {visibleTargets.length === 0 ? (
            <p className="p-6 text-center text-muted-foreground">
              No brands match this filter.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Brand</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Current Phase</TableHead>
                  <TableHead>Duration</TableHead>
                  <TableHead>Details</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {visibleTargets.map((target) => (
                  <TableRow key={target.id}>
                    <TableCell className="font-medium">
                      {target.brand_name}
                    </TableCell>
                    <TableCell>
                      {target.target_type === "submission"
                        ? "Submission"
                        : "Brand"}
                    </TableCell>
                    <TableCell>
                      <TargetStatusBadge target={target} />
                    </TableCell>
                    <TableCell>{target.current_phase ?? "-"}</TableCell>
                    <TableCell>{formatTargetDuration(target)}</TableCell>
                    <TableCell>
                      <TargetDetail target={target} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </SurfaceCard>
      </section>
    </div>
  );
}

function LineageLink({ id, label }: { id: string; label: string }) {
  return (
    <Link
      href={`/admin/jobs/${id}`}
      className={buttonVariants({
        variant: "secondary",
        size: "large",
        className: "min-h-12",
      })}
    >
      {label}
    </Link>
  );
}

function TargetDetail({ target }: { target: CurationJobTarget }) {
  const phases = parsePhaseResults(target.phase_results);

  return (
    <details className="group min-w-72">
      <summary className="flex min-h-12 cursor-pointer list-none items-center font-medium text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
        View details
      </summary>
      <div className="pb-4 pr-4">
        <dl className="grid gap-4 rounded-lg bg-muted/40 p-4 sm:grid-cols-2 lg:grid-cols-4">
          <InfoField label="Slug" value={target.brand_slug ?? "-"} />
          <InfoField
            label="Changed fields"
            value={
              target.changed_fields.length
                ? target.changed_fields.join(", ")
                : "-"
            }
          />
          {target.error ? (
            <InfoField
              label={target.status === "skipped" ? "Skip reason" : "Error"}
              value={target.error}
              wide
            />
          ) : null}
        </dl>
        <div className="mt-4 space-y-2">
          <h3 className="type-body-emphasis">Phase log</h3>
          {phases.length === 0 ? (
            <p className="text-sm text-muted-foreground">No phase records yet.</p>
          ) : (
            <ol className="space-y-2">
              {phases.map((phase, index) => (
                <li
                  key={`${phase.phase}-${index}`}
                  className="rounded-lg border border-border p-3"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-medium">{phase.phase}</span>
                    <Badge
                      variant={
                        phase.status === "failed"
                          ? "destructive"
                          : phase.status === "succeeded"
                            ? "verified"
                            : "outline"
                      }
                    >
                      {targetStatusLabel(
                        phase.status === "succeeded"
                          ? "succeeded"
                          : phase.status,
                      )}
                    </Badge>
                  </div>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {formatMilliseconds(phase.durationMs)}
                    {phase.changedFields.length
                      ? ` · Changed: ${phase.changedFields.join(", ")}`
                      : ""}
                  </p>
                  {phaseDescription(phase.phase) ? (
                    <p className="mt-2 text-sm">
                      {phaseDescription(phase.phase)}
                    </p>
                  ) : null}
                  {phase.detail ? (
                    <p className="mt-2 text-sm">{formatPhaseDetail(phase)}</p>
                  ) : null}
                  {phase.error ? (
                    <p className="mt-2 text-sm text-destructive">
                      {phase.error}
                    </p>
                  ) : null}
                </li>
              ))}
            </ol>
          )}
        </div>
      </div>
    </details>
  );
}

function parsePhaseResults(value: Json): PhaseResult[] {
  if (!Array.isArray(value)) return [];

  return value.flatMap((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return [];
    if (typeof item.phase !== "string" || typeof item.status !== "string")
      return [];
    if (!["succeeded", "skipped", "failed"].includes(item.status)) return [];

    return [
      {
        phase: item.phase,
        status: item.status as PhaseResult["status"],
        changedFields: Array.isArray(item.changedFields)
          ? item.changedFields.filter(
              (field): field is string => typeof field === "string",
            )
          : [],
        durationMs: typeof item.durationMs === "number" ? item.durationMs : 0,
        ...(typeof item.error === "string" ? { error: item.error } : {}),
        ...(typeof item.detail === "string" ? { detail: item.detail } : {}),
      },
    ];
  });
}

function phaseDescription(phase: string): string | null {
  if (phase === "detect") {
    return "Checks whether this entry is a real brand and may update its name, slug, or product type.";
  }

  return null;
}

function formatPhaseDetail(phase: PhaseResult): string {
  if (
    phase.phase === "detect" &&
    phase.status === "skipped" &&
    phase.detail === "no detect result"
  ) {
    return "Skipped because the detection service returned no usable result for this brand. No detection fields were changed, and the job continued with the other phases.";
  }

  return phase.detail ?? "";
}

function formatTargetDuration(target: CurationJobTarget): string {
  if (target.duration_ms !== null)
    return formatMilliseconds(target.duration_ms);
  if (!target.started_at) return "-";
  const end = target.completed_at
    ? new Date(target.completed_at).getTime()
    : Date.now();
  const start = new Date(target.started_at).getTime();
  return Number.isFinite(end) && Number.isFinite(start) && end >= start
    ? formatMilliseconds(end - start)
    : "-";
}

function formatMilliseconds(durationMs: number): string {
  if (durationMs < 1_000) return `${Math.max(0, Math.round(durationMs))} ms`;
  return `${(durationMs / 1_000).toFixed(1)} s`;
}
