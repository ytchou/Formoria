import Link from "next/link";
import { ExternalLink } from "lucide-react";
import { useTranslations } from "next-intl";
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
import {
  AUDITED_PHASES,
  type AuditedPhaseName,
} from "@/lib/constants/enrich-phases";
import type {
  CurationJobDetail,
  CurationJobTarget,
  CurationTargetStatus,
} from "@/lib/services/curation-jobs";
import { parsePhaseResults } from "@/lib/services/phase-results";
import type { PhaseResult } from "@/lib/types/curation";
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
import { ResumeJobButton } from "../resume-job-button";
import { routes } from "@/lib/routes";

const phaseDescriptions = {
  clean: "Normalizes the submitted brand name.",
  detect:
    "Checks whether the entry is a real brand and validates its identity.",
  slugs: "Generates a stable URL slug from the validated brand name.",
  tags: "Classifies the brand's category and subcategories.",
  discover: "Searches the web for useful official sources and brand context.",
  links: "Extracts and verifies official website and social links.",
  images: "Finds and selects usable brand and product images.",
  classify_images: "Classifies candidate images by their role and quality.",
  facts: "Extracts the brand's category, tags, and listing verdict.",
  founding_facts: "Extracts source-cited founding city and year proposals.",
  founding_facts_verify:
    "Verifies each founding fact against its cited source text.",
  descriptions: "Writes the bilingual description and blurb.",
  stockists: "Stockist discovery from website evidence.",
  locations: "Retail location search (retired).",
  reputation:
    "Adds third-party reputation context — coverage, awards, ratings.",
  faq: "Writes the bilingual FAQ answers the brand's evidence supports.",
  products:
    "Proposes curated products from the brand's own site; a moderator ticks the keepers at approval.",
  names:
    "Arbitrates the competing brand names the other context phases proposed; the only phase that writes the brand name.",
  site_identity:
    "Adjudicates quarantined websites and links before they reach downstream enrichment.",
  classification:
    "Classifies the category on its own, when descriptions did not decide it.",
  "image-search": "Searches for candidate images before image selection.",
  persist: "Writes the accumulated patch back to the brand record.",
  acquire:
    "Runs the full acquisition agent: search, scrape, images, classify, quarantine, rank, hero, catalog.",
  acquisition:
    "Plans and recovers evidence acquisition per brand: which URLs to fetch, whether to render, what to fan out to.",
  product_embeddings:
    "Embeds curated product documents into vectors for situation search.",
  rerank:
    "LLM reranking pass over retrieved candidates to improve precision.",
  // Legacy: `reputation` was called `expansion` until 2026-08-03 and historical
  // jobs still store that phase string. It is the one entry here with no
  // constant behind it, because nothing writes it any more — only historical
  // rows carry it, and dropping it would render `undefined` on those pages.
  expansion: "Adds reputation context when it is not already available.",
} satisfies Record<AuditedPhaseName | "expansion" | "locations" | "reputation", string>;

const phaseDefinitions = [
  [
    "Preflight",
    "Checks whether the target still exists and is eligible to run.",
  ],
  ...AUDITED_PHASES.map(
    (phase) =>
      [
        phase.replaceAll("_", " ").replaceAll("-", " "),
        phaseDescriptions[phase],
      ] as const,
  ),
] as const;

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
  const t = useTranslations("admin.jobs");
  const { job, targets, parent, children } = detail;
  // The finalizer writes its verdict counts into the job result alongside the
  // enrichment summary. Absent on every job that ran before DEV-1702, and on
  // dry runs, which is why both fall back to 0 rather than rendering blank.
  const jobResult = (job.result ?? {}) as {
    noChannelRejected?: number;
    noChannelHidden?: number;
  };
  const visibleTargets =
    selectedStatus === "all"
      ? targets
      : targets.filter((target) => target.status === selectedStatus);
  const currentTarget = targets.find(
    (target) => target.target_id === job.current_target_id,
  );
  const active = job.status === "pending" || job.status === "running";
  const canRerunCompleted =
    job.status === "completed" &&
    (job.failed_count > 0 || job.skipped_count > 0);
  const completedRerunLabel =
    job.failed_count > 0 && job.skipped_count > 0
      ? "Rerun failed and skipped submissions"
      : job.failed_count > 0
        ? "Rerun failed submissions"
        : "Rerun skipped submissions";
  const canRerunUnfinished =
    (job.status === "failed" || job.status === "cancelled") &&
    targets.some(
      (target) =>
        target.status === "pending" ||
        target.status === "running" ||
        target.status === "failed" ||
        target.status === "cancelled",
    );
  /**
   * Resume is the narrow recovery path for a provider outage: it re-enqueues
   * only the failed/cancelled targets and only the phases that did not finish.
   * It is offered alongside "Rerun unfinished submissions" rather than instead
   * of it because rerun repeats the source job's whole phase scope — after the
   * 2026-08-02 OpenAI quota outage that would have re-paid Serper for 407
   * brands whose SERP results were already cached and replayable.
   */
  const resumableTargetCount = targets.filter(
    (target) => target.status === "failed" || target.status === "cancelled",
  ).length;
  const canResume =
    (job.status === "failed" || job.status === "cancelled") &&
    resumableTargetCount > 0;
  const canDispatch =
    job.status === "pending" && job.dispatch_status === "pending";

  return (
    <div className="space-y-6">
      <JobAutoRefresh active={active} />
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-2">
          <Link
            href={routes.admin.jobs()}
            className="inline-flex min-h-12 items-center type-body-sm font-medium text-accent underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            {t("actions.backToList")}
          </Link>
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="type-tool-heading">{t("detail.title")}</h1>
            <JobStatusBadge job={job} />
          </div>
          <p className="break-all type-metadata tabular-nums">{job.id}</p>
        </div>
        <div className="flex flex-wrap gap-3">
          {canDispatch ? (
            <DispatchJobButton jobId={job.id} label="Run this job now" />
          ) : null}
          {active ? <CancelJobButton jobId={job.id} /> : null}
          {canRerunCompleted ? (
            <RerunJobButton jobId={job.id} label={completedRerunLabel} />
          ) : null}
          {canRerunUnfinished ? (
            <RerunJobButton
              jobId={job.id}
              label="Rerun unfinished submissions"
            />
          ) : null}
          {canResume ? <ResumeJobButton jobId={job.id} /> : null}
          <Link
            href={`${routes.admin.job(job.id)}/runlog`}
            className={buttonVariants({
              variant: "secondary",
              size: "large",
            })}
          >
            {t("actions.runLog")}
          </Link>
          <a
            href={`${routes.admin.job(job.id)}/runlog?download=1`}
            className={buttonVariants({
              variant: "secondary",
              size: "large",
            })}
          >
            {t("actions.downloadHtml")}
          </a>
          {snapshotUrl ? (
            <a
              href={snapshotUrl}
              target="_blank"
              rel="noreferrer"
              className={buttonVariants({
                variant: "secondary",
                size: "large",
              })}
            >
              <ExternalLink aria-hidden="true" />
              {t("actions.snapshot")}
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
              })}
            >
              <ExternalLink aria-hidden="true" />
              {t("actions.railwayLogs")}
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
        <DataCard
          label="No-channel rejected"
          value={jobResult.noChannelRejected ?? 0}
        />
        <DataCard
          label="No-channel hidden"
          value={jobResult.noChannelHidden ?? 0}
        />
      </div>

      <SurfaceCard padding="lg">
        <h2 className="type-tool-heading">{t("detail.executionInfo")}</h2>
        <dl className="mt-5 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          <InfoField label="Trigger" value={jobTriggerLabel(job.trigger)} />
          <InfoField label="Attempt" value={job.attempt} />
          <InfoField
            label="Scheduled"
            value={formatJobDate(job.scheduled_for)}
          />
          <InfoField label="Created" value={formatJobDate(job.created_at)} />
          <InfoField label="Started" value={formatJobDate(job.started_at)} />
          <InfoField
            label="Completed"
            value={formatJobDate(job.completed_at)}
          />
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
                : job.status === "pending" &&
                    job.dispatch_status === "dispatched"
                  ? "Queued"
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
          <h2 className="type-tool-heading">{t("detail.retryLineage")}</h2>
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
          <h2 id="job-targets-heading" className="type-tool-heading">
            {t("detail.brandDetails")}
          </h2>
          <p className="mt-1 type-body-sm">
            {t("detail.brandDetailsDescription")}
          </p>
          <details className="mt-2">
            <summary className="flex min-h-12 cursor-pointer items-center font-medium text-accent underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent">
              {t("detail.phaseHelp")}
            </summary>
            <dl className="grid gap-x-6 gap-y-3 rounded-surface bg-surface/40 p-4 sm:grid-cols-2 lg:grid-cols-3">
              {phaseDefinitions.map(([phase, description]) => (
                <div key={phase}>
                  <dt className="type-body-sm font-medium text-ink capitalize">
                    {phase}
                  </dt>
                  <dd className="mt-1 type-body-sm">{description}</dd>
                </div>
              ))}
            </dl>
          </details>
        </div>
        <nav
          aria-label={t("detail.filterLabel")}
          className="flex flex-wrap gap-2"
        >
          {filters.map((filter) => {
            const selected = selectedStatus === filter.value;
            const href =
              filter.value === "all"
                ? routes.admin.job(job.id)
                : `${routes.admin.job(job.id)}?status=${filter.value}`;
            return (
              <Link
                key={filter.value}
                href={href}
                aria-current={selected ? "page" : undefined}
                className={buttonVariants({
                  variant: selected ? "primary" : "secondary",
                  size: "default",
                })}
              >
                {filter.label}
              </Link>
            );
          })}
        </nav>

        <SurfaceCard padding="none" className="overflow-x-auto">
          {visibleTargets.length === 0 ? (
            <p className="p-6 text-center text-ink-muted">
              {t("detail.empty")}
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("detail.table.brand")}</TableHead>
                  <TableHead>{t("detail.table.type")}</TableHead>
                  <TableHead>{t("detail.table.status")}</TableHead>
                  <TableHead>{t("detail.table.currentPhase")}</TableHead>
                  <TableHead>{t("detail.table.reason")}</TableHead>
                  <TableHead>{t("detail.table.duration")}</TableHead>
                  <TableHead>{t("detail.table.details")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {visibleTargets.map((target) => (
                  <TableRow key={target.id}>
                    <TableCell className="font-medium">
                      {target.brand_name}
                    </TableCell>
                    <TableCell>
                      {t(`targetType.${target.target_type}`)}
                    </TableCell>
                    <TableCell>
                      <TargetStatusBadge target={target} />
                    </TableCell>
                    <TableCell>{target.current_phase ?? "-"}</TableCell>
                    <TableCell className="max-w-80 whitespace-normal type-body-sm">
                      {targetReason(target)}
                    </TableCell>
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

function targetReason(target: CurationJobTarget): string {
  if (target.status === "pending" || target.status === "running") return "-";
  if (target.status === "succeeded") return "Completed successfully";

  const recordedReason = target.error?.trim();
  if (recordedReason) return recordedReason;

  const phases = parsePhaseResults(target.phase_results);
  const phaseReason = phases
    .toReversed()
    .find(
      (phase) =>
        Boolean(phase.error?.trim()) ||
        (phase.status === "skipped" && Boolean(phase.detail?.trim())),
    );
  if (phaseReason?.error) return phaseReason.error;
  if (phaseReason?.detail) return formatPhaseDetail(phaseReason);

  if (target.status === "cancelled") {
    return "The job was cancelled before this brand completed";
  }
  if (target.status === "skipped") {
    return "No changes were needed or no usable enrichment data was found";
  }
  return "No failure reason was recorded";
}

function LineageLink({ id, label }: { id: string; label: string }) {
  return (
    <Link
      href={routes.admin.job(id)}
      className={buttonVariants({
        variant: "secondary",
        size: "large",
      })}
    >
      {label}
    </Link>
  );
}

function TargetDetail({ target }: { target: CurationJobTarget }) {
  const t = useTranslations("admin.jobs");
  const phases = parsePhaseResults(target.phase_results);

  return (
    <details className="group min-w-72">
      <summary className="flex min-h-12 cursor-pointer list-none items-center font-medium text-accent underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent">
        {t("actions.viewDetails")}
      </summary>
      <div className="pb-4 pr-4">
        <dl className="grid gap-4 rounded-surface bg-surface/40 p-4 sm:grid-cols-2 lg:grid-cols-4">
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
          <h3 className="type-tool-heading">{t("detail.phaseLog")}</h3>
          {phases.length === 0 ? (
            <p className="type-body-sm">{t("detail.noPhaseRecords")}</p>
          ) : (
            <ol className="space-y-2">
              {phases.map((phase, index) => (
                <li
                  key={`${phase.phase}-${index}`}
                  className="rounded-surface border border-rule p-3"
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
                  <p className="mt-1 type-body-sm">
                    {formatMilliseconds(phase.durationMs)}
                    {phase.changedFields.length
                      ? ` · ${t("detail.changedFields", {
                          fields: phase.changedFields.join(", "),
                        })}`
                      : ""}
                  </p>
                  {phaseDescription(phase.phase) ? (
                    <p className="mt-2 type-body-sm">
                      {phaseDescription(phase.phase)}
                    </p>
                  ) : null}
                  {phase.detail ? (
                    <p className="mt-2 type-body-sm">
                      {formatPhaseDetail(phase)}
                    </p>
                  ) : null}
                  {phase.error ? (
                    <p className="mt-2 type-body-sm text-danger">
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

function phaseDescription(phase: string): string | null {
  if (phase === "detect") {
    return "Checks whether this entry is a real brand and may update its name, slug, or category.";
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
