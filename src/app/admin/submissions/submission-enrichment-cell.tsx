"use client";

import Link from "next/link";
import type { useTranslations } from "next-intl";

import { Badge } from "@/components/ui/badge";
import { isSubmissionEnrichmentFailure } from "@/lib/services/submission-review-stage";
import type { ReviewSubmission } from "./submissions-review-list";
import { routes } from "@/lib/routes";

type SubmissionsT = ReturnType<typeof useTranslations<"admin.submissions">>;

export function renderEnrichment(submission: ReviewSubmission, t: SubmissionsT) {
  const enrichment = enrichmentLabel(submission, t);

  return (
    <>
      <div className="flex items-center gap-2">
        <Badge variant={enrichment.variant}>{enrichment.label}</Badge>
        {submission.latestCurationJobId && (
          <Link
            className="type-nav font-semibold text-accent underline-offset-4 hover:underline"
            href={routes.admin.job(submission.latestCurationJobId)}
          >
            {t("viewJob")}
          </Link>
        )}
      </div>
      {submission.latestCurationError && (
        <p className="mt-1 max-w-72 type-metadata text-muted-foreground">
          {submission.latestCurationError}
        </p>
      )}
      {submission.reviewCompleteness.missingFields.length > 0 && (
        <p className="mt-1 type-metadata text-warning">
          {`${t("missingRequired")}: ${submission.reviewCompleteness.missingFields
            .map((field) => t(`missingFields.${field}`))
            .join(", ")}`}
        </p>
      )}
      {/* Advisory only — approving is still allowed. The slug is deduped, so a
          duplicate approves cleanly and silently creates a second brand page. */}
      {submission.duplicateWarning && (
        <p className="mt-1 type-metadata text-warning">
          {submission.duplicateWarning.liveBrand
            ? t("duplicateWarning.liveBrand", {
                name: submission.duplicateWarning.liveBrand.name,
              })
            : t("duplicateWarning.pendingOnly", {
                count: submission.duplicateWarning.pendingSiblings,
              })}
        </p>
      )}
    </>
  );
}

function enrichmentLabel(
  submission: ReviewSubmission,
  t: SubmissionsT,
): {
  label: string;
  variant: "verified" | "secondary" | "destructive" | "warning";
} {
  if (submission.reviewStage === "enriching") {
    return {
      label:
        submission.latestCurationTargetStatus === "running"
          ? t("enrichmentStatus.running")
          : t("enrichmentStatus.queued"),
      variant: "secondary",
    };
  }
  if (
    isSubmissionEnrichmentFailure({
      targetStatus: submission.latestCurationTargetStatus,
      jobStatus: submission.latestCurationJobStatus,
      dispatchStatus: submission.latestCurationDispatchStatus,
    })
  ) {
    return { label: t("enrichmentStatus.failed"), variant: "destructive" };
  }
  if (submission.latestCurationTargetStatus === "skipped") {
    return { label: t("enrichmentStatus.skipped"), variant: "secondary" };
  }
  return submission.reviewCompleteness.complete
    ? { label: t("enrichmentStatus.complete"), variant: "verified" }
    : { label: t("enrichmentStatus.partial"), variant: "warning" };
}
