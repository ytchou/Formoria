"use client";

import { useMemo, useState, useTransition } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import {
  approveSubmissionAction,
  approveSubmissionsAction,
  rejectSubmissionAction,
  rejectSubmissionsAction,
} from "@/app/admin/actions";
import { dropNeedsDataSubmissionsAction } from "@/app/admin/submissions/actions";
import { JobAutoRefresh } from "@/app/admin/jobs/job-auto-refresh";
import { startCurationJobAction } from "@/app/admin/operations/actions";
import { ConfirmDialog } from "@/components/admin/confirm-dialog";
import {
  ReviewDecisionPanel,
  ReviewQueueDrawer,
  ReviewQueuePagination,
  ReviewQueueTable,
  ReviewQueueToolbar,
  useQueueAction,
  useReviewQueue,
  type ReviewBulkAction,
  type ReviewColumn,
  type ReviewFilter,
  type ReviewTab,
} from "@/components/admin/queue";
import { SubmissionStatusBadge } from "@/components/admin/status-badge";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import {
  CURATION_STEPS,
  CURATION_STEP_ORDER,
  type CurationStep,
} from "@/lib/constants/enrich-phases";
import {
  isoDateInTimeZone,
  isDateInRange,
  type IsoDateRange,
} from "@/lib/date-range";
import type { DenialReason } from "@/lib/types";
import { DENIAL_REASONS } from "@/lib/types";
import type { BrandSubmissionForReview } from "@/lib/services/submissions";
import { renderEnrichment } from "./submission-enrichment-cell";
import { SubmissionReviewDetails } from "./submission-review-details";

export type TabValue =
  | "all"
  | "needs_data"
  | "enriching"
  | "skipped"
  | "ready"
  | "approved"
  | "rejected";

export type ReviewSubmission = BrandSubmissionForReview & {
  brandSlug?: string | null;
};

const TAB_ORDER: TabValue[] = [
  "needs_data",
  "enriching",
  "ready",
  "skipped",
  "approved",
  "rejected",
  "all",
];
const BULK_DENIAL_REASONS = DENIAL_REASONS.filter(
  (reason) => reason !== "other" && reason !== "admin_reject",
);
const GENERATED_GUEST_EMAIL_SUFFIX = "@guest.formoria.invalid";

const getSubmissionId = (submission: ReviewSubmission) => submission.id;

export function SubmissionsReviewList({
  submissions,
  initialTab = "needs_data",
}: {
  submissions: ReviewSubmission[];
  initialTab?: TabValue;
}) {
  const t = useTranslations("admin.submissions");
  const denialReasonsT = useTranslations("admin.submissions.denialReasons");
  const router = useRouter();
  const pathname = usePathname();
  const queueAction = useQueueAction();
  const [bulkRejecting, setBulkRejecting] = useState(false);
  const [bulkRejectReason, setBulkRejectReason] = useState<DenialReason | "">(
    "",
  );
  const [dropDialogOpen, setDropDialogOpen] = useState(false);
  const [isEnriching, startEnrichTransition] = useTransition();
  const [isDropping, startDropTransition] = useTransition();

  const tabs = useMemo<ReviewTab<ReviewSubmission>[]>(
    () =>
      TAB_ORDER.map((tab) => ({
        value: tab,
        label: t(`tabs.${tabKey(tab)}`),
        match: (submission) => matchesTab(submission, tab),
      })),
    [t],
  );

  const filters = useMemo<ReviewFilter<ReviewSubmission>[]>(
    () => [
      {
        id: "search",
        kind: "search",
        label: t("searchLabel"),
        placeholder: t("searchPlaceholder"),
        className: "xl:col-span-2",
        predicate: (submission, value) => {
          const query =
            typeof value === "string" ? value.trim().toLocaleLowerCase() : "";
          if (!query) return true;

          return [
            submission.brandName,
            submission.reviewData.name,
            submission.submitterName,
            submission.submitterEmail,
            submission.reviewData.websiteUrl,
          ].some((candidate) => candidate?.toLocaleLowerCase().includes(query));
        },
      },
      {
        id: "enrichment",
        kind: "select",
        label: t("enrichmentFilter.label"),
        defaultValue: "all",
        // Completeness only exists after enrichment, so this filter is scoped
        // to the one tab where every row has been enriched.
        visibleOn: (activeTab) => activeTab === "ready",
        options: [
          { value: "all", label: t("enrichmentFilter.all") },
          { value: "complete", label: t("enrichmentFilter.complete") },
          { value: "incomplete", label: t("enrichmentFilter.incomplete") },
        ],
        predicate: (submission, value) =>
          value === "complete"
            ? submission.reviewCompleteness.complete
            : !submission.reviewCompleteness.complete,
      },
      {
        // Not gated on the ready tab: new vs refresh is meaningful at every
        // stage, unlike completeness which only exists after enrichment.
        id: "reviewKind",
        kind: "select",
        label: t("reviewKindFilter.label"),
        defaultValue: "all",
        options: [
          { value: "all", label: t("reviewKindFilter.all") },
          { value: "new", label: t("reviewKindFilter.new") },
          { value: "refresh", label: t("reviewKindFilter.refresh") },
        ],
        predicate: (submission, value) => submission.reviewKind === value,
      },
      {
        id: "submittedRange",
        kind: "dateRange",
        label: `${t("submittedDate.from")} / ${t("submittedDate.to")}`,
        placeholder: `${t("submittedDate.from")} – ${t("submittedDate.to")}`,
        predicate: (submission, value) =>
          isDateInRange(
            isoDateInTimeZone(submission.submittedAt, "Asia/Taipei"),
            value as IsoDateRange | null,
          ),
      },
    ],
    [t],
  );

  const queue = useReviewQueue<ReviewSubmission>({
    items: submissions,
    getId: getSubmissionId,
    tabs,
    filters,
    initialTab,
    isSelectable: (submission) => submission.status === "pending",
    // Optimistically hidden rows un-hide themselves as soon as the server-side
    // status catches up, so the Approved tab never undercounts.
    releaseHidden: (submission) => submission.status !== "pending",
    onTabChange: (value) => router.replace(`${pathname}?stage=${value}`),
    onViewReset: () => {
      setBulkRejecting(false);
      setBulkRejectReason("");
      setDropDialogOpen(false);
      queueAction.clearError();
    },
  });

  const openSubmission =
    submissions.find((submission) => submission.id === queue.openId) ?? null;

  const columns: ReviewColumn<ReviewSubmission>[] = [
    {
      id: "brand",
      header: t("table.brand"),
      cell: (submission) => (
        <span className="block truncate">{submission.reviewData.name}</span>
      ),
      cellClassName: "max-w-[240px] font-medium",
    },
    {
      id: "status",
      header: t("table.status"),
      cell: (submission) => (
        <SubmissionStatusBadge status={submission.status} />
      ),
    },
    {
      id: "submitter",
      header: t("table.submitter"),
      cell: (submission) => (
        <>
          <span className="block truncate">
            {submission.submitterName ||
              getSubmitterLabel(submission.submitterEmail, t("noSubmitter"))}
          </span>
          {submission.submitterName && (
            <span className="block truncate type-caption">
              {getSubmitterLabel(submission.submitterEmail, t("noSubmitter"))}
            </span>
          )}
        </>
      ),
      cellClassName: "max-w-[200px]",
    },
    {
      id: "date",
      header: t("table.date"),
      cell: (submission) => formatDate(submission.submittedAt),
    },
    {
      id: "reason",
      header: t("table.reason"),
      visibleOn: (activeTab) => activeTab === "skipped",
      cell: (submission) => (
        <p className="max-w-96 whitespace-normal text-sm text-muted-foreground">
          {submission.latestCurationError ?? t("noSkipReason")}
        </p>
      ),
    },
    {
      id: "enrichment",
      header: t("table.enrichment"),
      visibleOn: (activeTab) =>
        activeTab !== "needs_data" && activeTab !== "skipped",
      cell: (submission) => renderEnrichment(submission, t),
    },
  ];

  function bulkApprove(items: ReviewSubmission[]) {
    if (items.length === 0) return;
    if (!confirm(t("confirmBulkApprove", { count: items.length }))) return;

    const ids = items.map(getSubmissionId);
    queueAction.runBulk(ids, async () => {
      const result = await approveSubmissionsAction(ids);
      if ("error" in result) return { error: result.error };

      const failedIds = new Set(
        result.failures.map((failure) => failure.submissionId),
      );
      if (result.storageCleanupWarning) {
        toast.warning(t("storageCleanupWarning"));
      }
      // No router.refresh(): revalidatePath pushes fresh props, and the hidden
      // latch keeps approved rows out of the table until they arrive.
      queue.hideIds(ids.filter((id) => !failedIds.has(id)));
      queue.setSelectedIds(failedIds);

      const firstFailure = result.failures.at(0);
      if (firstFailure) {
        const submission = items.find(
          (item) => item.id === firstFailure.submissionId,
        );
        return {
          error: `${submission?.brandName ?? firstFailure.submissionId}: ${firstFailure.error}`,
        };
      }
      return undefined;
    });
  }

  function bulkReject(items: ReviewSubmission[]) {
    if (!bulkRejecting) {
      setBulkRejecting(true);
      return;
    }
    if (!bulkRejectReason || items.length === 0) return;

    const ids = items.map(getSubmissionId);
    const reason = bulkRejectReason;
    queueAction.runBulk(ids, async () => {
      const result = await rejectSubmissionsAction(ids, reason);
      if ("error" in result) return { error: result.error };

      const failedIds = new Set(
        result.failures.map((failure) => failure.submissionId),
      );
      queue.hideIds(ids.filter((id) => !failedIds.has(id)));
      queue.setSelectedIds(failedIds);
      setBulkRejecting(false);
      setBulkRejectReason("");

      const firstFailure = result.failures.at(0);
      if (firstFailure) {
        const submission = items.find(
          (item) => item.id === firstFailure.submissionId,
        );
        return {
          error: `${submission?.brandName ?? firstFailure.submissionId}: ${firstFailure.error}`,
        };
      }
      return undefined;
    });
  }

  function approveOne(submission: ReviewSubmission) {
    void queueAction.run(
      [submission.id],
      async () => {
        const result = await approveSubmissionAction(submission.id);
        if (result?.error) return { error: result.error };
        if (result?.storageCleanupWarning) {
          toast.warning(t("storageCleanupWarning"));
        }
        return undefined;
      },
      {
        onResult: (result) => {
          if (!result.ok) return;
          queue.setOpenId(null);
          router.refresh();
        },
      },
    );
  }

  function rejectOne(submission: ReviewSubmission) {
    if (!confirm(t("confirmReject"))) return;

    void queueAction.run(
      [submission.id],
      async () => {
        const result = await rejectSubmissionAction(
          submission.id,
          "admin_reject",
          "",
        );
        return result?.error ? { error: result.error } : undefined;
      },
      {
        onResult: (result) => {
          if (!result.ok) return;
          queue.setOpenId(null);
          router.refresh();
        },
      },
    );
  }

  function startCuration(items: ReviewSubmission[], steps?: [CurationStep]) {
    const ids = items.map(getSubmissionId);
    if (ids.length === 0) return;

    startEnrichTransition(async () => {
      const result = await startCurationJobAction(
        "enrich",
        steps ? { submissionIds: ids, steps } : { submissionIds: ids },
        false,
      );
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      if ("queued" in result) {
        const notify =
          result.dispatchStatus === "failed" ? toast.error : toast.info;
        notify(result.message, {
          action: {
            label: t("viewJob"),
            onClick: () => router.push(result.detailPath),
          },
        });
        queue.clearSelection();
        router.refresh();
      }
    });
  }

  function dropSelected() {
    const ids = queue.selectedVisible
      .filter((submission) => submission.reviewStage === "needs_data")
      .map(getSubmissionId);
    if (ids.length === 0) return;

    startDropTransition(async () => {
      queueAction.clearError();
      const result = await dropNeedsDataSubmissionsAction(ids);
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      queue.clearSelection();
      setDropDialogOpen(false);
      if (result.storageCleanupWarning) {
        toast.warning(t("dropStorageCleanupWarning"));
      }
      toast.success(t("dropSuccess", { count: result.deletedCount }));
      router.refresh();
    });
  }

  const isNeedsData = (submission: ReviewSubmission) =>
    submission.reviewStage === "needs_data";

  const bulkActions: ReviewBulkAction<ReviewSubmission>[] = [
    {
      id: "fetch",
      label: () => (isEnriching ? t("fetching") : t("fetchData")),
      visibleOn: (activeTab) => activeTab === "needs_data",
      eligible: isNeedsData,
      disabled: isEnriching || isDropping,
      onRun: (items) => startCuration(items),
    },
    {
      id: "drop",
      label: () => t("dropSelected"),
      variant: "destructive",
      visibleOn: (activeTab) => activeTab === "needs_data",
      eligible: isNeedsData,
      disabled: isEnriching || isDropping,
      onRun: () => setDropDialogOpen(true),
    },
    ...CURATION_STEP_ORDER.map<ReviewBulkAction<ReviewSubmission>>((step) => ({
      id: `curation-${step}`,
      label: (count) => t(`runStepCuration.${step}`, { count }),
      variant: "secondary",
      visibleOn: (activeTab) => activeTab === "ready",
      // The phases a step covers stay visible to the operator: failures and job
      // history are still reported per phase.
      title: CURATION_STEPS[step].join(", "),
      disabled: isEnriching,
      onRun: (items) => startCuration(items, [step]),
    })),
    {
      id: "approve",
      label: (count) => t("approveSelected", { count }),
      variant: "primary",
      visibleOn: (activeTab) => activeTab !== "needs_data",
      eligible: (submission) => submission.reviewCompleteness.complete,
      pending: queueAction.isPending,
      onRun: bulkApprove,
    },
    {
      id: "reject",
      label: (count) =>
        bulkRejecting
          ? t("confirmRejectSelected", { count })
          : t("rejectSelected", { count }),
      variant: "destructive",
      visibleOn: (activeTab) => activeTab !== "needs_data",
      pending: queueAction.isPending,
      disabled: bulkRejecting && !bulkRejectReason,
      onRun: bulkReject,
    },
  ];

  return (
    <div>
      <JobAutoRefresh
        active={submissions.some((item) => item.reviewStage === "enriching")}
      />

      <ReviewQueueToolbar queue={queue}>
        {queue.activeTab !== "needs_data" &&
        bulkRejecting &&
        queue.selectedVisible.length > 0 ? (
          <div className="max-w-sm space-y-2 rounded-md border bg-background p-3">
            <Label>{t("bulkRejectReason")}</Label>
            <NativeSelect
              aria-label={t("bulkRejectAriaLabel")}
              value={bulkRejectReason}
              onChange={(event) =>
                setBulkRejectReason(event.currentTarget.value as DenialReason)
              }
            >
              <option value="" disabled>
                {t("selectReason")}
              </option>
              {BULK_DENIAL_REASONS.map((reason) => (
                <option key={reason} value={reason}>
                  {denialReasonsT(reason)}
                </option>
              ))}
            </NativeSelect>
          </div>
        ) : null}
      </ReviewQueueToolbar>

      <div className="mt-4">
        <ReviewQueueTable
          queue={queue}
          columns={columns}
          emptyMessage={t("notFound")}
          getRowName={(submission) => submission.brandName}
          selectAllLabel={t("selectVisible")}
          bulkActions={bulkActions}
          onRowActivate={(submission) => {
            queueAction.clearError();
            queue.toggleOpen(submission.id);
          }}
          isRowPending={(submission) => queueAction.isRowPending(submission.id)}
          rowClassName={() => "hover:bg-secondary"}
          // The drawer's decision panel already renders the action error while
          // it is open; surfacing it here too would emit two role="alert" nodes.
          error={openSubmission === null ? queueAction.error : null}
          // `SubmissionReviewDetails` renders this id itself, so the drawer is
          // deliberately given no `bodyId` — two nodes would share it otherwise.
          disclosureControlsId={(submission) =>
            `submission-review-${submission.id}`
          }
          disclosureLabel={(submission, expanded) =>
            t(expanded ? "collapseReview" : "expandReview", {
              name: submission.brandName,
            })
          }
        />
      </div>

      <ReviewQueuePagination
        queue={queue}
        labels={{
          summary: ({ from, to, total }) =>
            t("pagination.summary", { from, to, total }),
          pageSize: t("pagination.pageSize"),
          previous: t("pagination.previous"),
          next: t("pagination.next"),
        }}
      />

      <ReviewQueueDrawer
        item={openSubmission}
        open={openSubmission !== null}
        onClose={() => queue.setOpenId(null)}
        title={(submission) =>
          submission.reviewData.name || submission.brandName || ""
        }
        metadata={(submission) => (
          <p className="type-metadata">{formatDate(submission.submittedAt)}</p>
        )}
        footer={(submission) =>
          submission.status === "pending" &&
          submission.reviewStage !== "needs_data" ? (
            <div className="pt-5">
              <ReviewDecisionPanel
                onApprove={() => approveOne(submission)}
                onReject={() => rejectOne(submission)}
                approveLabel={
                  submission.reviewKind === "refresh"
                    ? t("approveRefresh")
                    : t("approve")
                }
                rejectLabel={t("reject")}
                notesPolicy="none"
                // Submissions confirms rejection but NOT approval, and
                eligible={submission.reviewCompleteness.complete}
                isPending={queueAction.isRowPending(submission.id)}
                error={queueAction.error}
              />
            </div>
          ) : undefined
        }
      >
        {(submission) => (
          <SubmissionReviewDetails
            key={submission.id}
            submission={submission}
          />
        )}
      </ReviewQueueDrawer>

      <ConfirmDialog
        open={dropDialogOpen}
        onOpenChange={setDropDialogOpen}
        title={t("dropTitle")}
        description={t("dropDescription", {
          count: queue.selectedVisible.filter(
            (submission) => submission.reviewStage === "needs_data",
          ).length,
        })}
        onConfirm={dropSelected}
        confirmLabel={t("dropSelected")}
        variant="destructive"
        isPending={isDropping}
      />
    </div>
  );
}

function matchesTab(submission: ReviewSubmission, tab: TabValue) {
  if (tab === "all") return true;
  if (tab === "approved" || tab === "rejected")
    return submission.status === tab;
  return submission.reviewStage === tab;
}

function tabKey(tab: TabValue) {
  if (tab === "needs_data") return "needsData" as const;
  return tab;
}

function getSubmitterLabel(email: string, fallback: string) {
  return email.endsWith(GENERATED_GUEST_EMAIL_SUFFIX) ? fallback : email;
}

function formatDate(value: string) {
  return new Date(value).toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    timeZone: "Asia/Taipei",
  });
}
