"use client";

import { useMemo, useState, type ReactNode } from "react";
import { useTranslations } from "next-intl";

import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import type {
  OriginEvidence,
  EvidenceBatchFailure,
  OriginEvidenceDecision,
  OriginEvidenceStatus,
} from "@/lib/services/origin-evidence";
import {
  formatReviewDate,
  ReviewDecisionPanel,
  ReviewQueueDrawer,
  ReviewQueuePagination,
  ReviewQueueTable,
  ReviewQueueToolbar,
  reviewStatusVariant,
  type ReviewBulkAction,
  type ReviewColumn,
  type ReviewFilter,
  type ReviewTab,
  useQueueAction,
  useReviewQueue,
} from "./queue";

type TabValue = "all" | OriginEvidenceStatus;

type ReviewAction = (
  id: string,
  decision: OriginEvidenceDecision,
  notes: string,
  tierAction?: "strip_declaration",
) => Promise<{ error?: string } | undefined>;

type BulkReviewAction = (
  ids: string[],
  decision: OriginEvidenceDecision,
  notes: string,
) => Promise<{ failures: EvidenceBatchFailure[] } | { error: string }>;

const TAB_VALUES: TabValue[] = ["all", "pending", "approved", "rejected"];

export function EvidenceQueue({
  evidence,
  reviewAction,
  bulkReviewAction,
}: {
  evidence: OriginEvidence[];
  reviewAction?: ReviewAction;
  bulkReviewAction?: BulkReviewAction;
}) {
  const t = useTranslations("admin.evidence");
  const queueT = useTranslations("admin.queue");
  const queueAction = useQueueAction();
  const [stripDeclaration, setStripDeclaration] = useState(false);

  const tabs = useMemo<ReviewTab<OriginEvidence>[]>(
    () =>
      TAB_VALUES.map((value) => ({
        value,
        label: t(`tabs.${value}`),
        match: (item) => value === "all" || item.status === value,
      })),
    [t],
  );

  const filters = useMemo<ReviewFilter<OriginEvidence>[]>(
    () => [
      {
        id: "search",
        kind: "search",
        label: queueT("search"),
        placeholder: queueT("searchPlaceholder"),
        predicate: (item, value) => {
          const query =
            typeof value === "string" ? value.trim().toLocaleLowerCase() : "";
          if (!query) return true;

          return [item.brandName ?? "", item.productName ?? ""].some(
            (candidate) => candidate.toLocaleLowerCase().includes(query),
          );
        },
      },
    ],
    [queueT],
  );

  const queue = useReviewQueue({
    items: evidence,
    getId: (item) => item.id,
    tabs,
    filters,
    initialTab: "pending",
    isSelectable: (item) => item.status === "pending",
  });

  function getRowName(item: OriginEvidence): string {
    return item.brandName ?? t("unknownBrand");
  }

  function canStripDeclaration(item: OriginEvidence): boolean {
    return item.brandMitStatus === "declared" && item.stance === "contradicts";
  }

  function renderPhotos(item: OriginEvidence): ReactNode {
    if (!item.photos.some((photo) => photo.signedUrl)) return null;

    return (
      <div>
        <p className="type-metadata">{t("fields.photos")}</p>
        <div className="mt-2 flex flex-wrap gap-3">
          {item.photos.map((photo, index) =>
            photo.signedUrl ? (
              <a
                key={photo.path}
                href={photo.signedUrl}
                target="_blank"
                rel="noreferrer noopener"
                className="rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                {/* eslint-disable-next-line @next/next/no-img-element -- Private signed evidence URLs are short-lived review thumbnails. */}
                <img
                  src={photo.signedUrl}
                  alt={t("photoAlt", { index: index + 1 })}
                  className="h-20 w-20 rounded-md border border-border object-cover"
                />
              </a>
            ) : null,
          )}
        </div>
      </div>
    );
  }

  const columns: ReviewColumn<OriginEvidence>[] = [
    {
      id: "brand",
      header: t("table.brand"),
      cell: (item) => getRowName(item),
      cellClassName: "font-medium",
    },
    {
      id: "stance",
      header: t("table.stance"),
      cell: (item) => t(`stances.${item.stance}`),
      cellClassName: "min-w-56 whitespace-normal",
    },
    {
      id: "product",
      header: t("table.product"),
      cell: (item) => item.productName ?? t("notProvided"),
    },
    {
      id: "date",
      header: t("table.date"),
      cell: (item) => formatReviewDate(item.createdAt),
    },
    {
      id: "status",
      header: t("table.status"),
      cell: (item) => (
        <Badge variant={reviewStatusVariant(item.status)}>
          {t(`tabs.${item.status}`)}
        </Badge>
      ),
    },
  ];

  function runSingle(
    item: OriginEvidence,
    decision: OriginEvidenceDecision,
    notes: string,
  ) {
    if (decision === "approved" && stripDeclaration && !notes.trim()) {
      queueAction.setError(t("errors.notesRequired"));
      return;
    }

    const tierAction =
      decision === "approved" &&
      item.brandMitStatus === "declared" &&
      item.stance === "contradicts" &&
      stripDeclaration
        ? "strip_declaration"
        : undefined;

    void queueAction.run(
      [item.id],
      async () => {
        try {
          const result = await reviewAction?.(
            item.id,
            decision,
            notes,
            tierAction,
          );
          return result?.error ? { error: t("errors.generic") } : undefined;
        } catch {
          return { error: t("errors.generic") };
        }
      },
      {
        onResult: (result) => {
          if (result.ok) {
            queue.setOpenId(null);
          }
        },
      },
    );
  }

  function runBulk(items: OriginEvidence[], decision: OriginEvidenceDecision) {
    const ids = items.map((item) => item.id);
    queueAction.runBulk(
      ids,
      async () => {
        try {
          const result = await bulkReviewAction?.(ids, decision, "");
          if (!result) return undefined;
          if ("error" in result || result.failures.length > 0) {
            return { error: t("errors.generic") };
          }
          return undefined;
        } catch {
          return { error: t("errors.generic") };
        }
      },
      {
        onResult: (result) => {
          if (result.ok) queue.clearSelection();
        },
      },
    );
  }

  function openItem(item: OriginEvidence) {
    queueAction.clearError();
    setStripDeclaration(false);
    queue.toggleOpen(item.id);
  }

  const bulkActions: ReviewBulkAction<OriginEvidence>[] = [
    {
      id: "approve",
      label: (count) => t("bulkApprove", { count }),
      pending: queueAction.isPending,
      onRun: (items) => runBulk(items, "approved"),
    },
    {
      id: "reject",
      label: (count) => t("bulkReject", { count }),
      variant: "secondary",
      pending: queueAction.isPending,
      onRun: (items) => runBulk(items, "rejected"),
    },
  ];

  const openItemValue =
    evidence.find((item) => item.id === queue.openId) ?? null;

  return (
    <div className="space-y-4">
      <ReviewQueueToolbar queue={queue} />

      <ReviewQueueTable
        queue={queue}
        columns={columns}
        emptyMessage={t("noEvidence")}
        getRowName={getRowName}
        selectAllLabel={queueT("selectAll")}
        bulkActions={bulkActions}
        onRowActivate={openItem}
        isRowPending={(item) => queueAction.isRowPending(item.id)}
        // The drawer's decision panel already renders the action error while it
        // is open; surfacing it here too would emit two role="alert" nodes.
        error={openItemValue === null ? queueAction.error : null}
        disclosureControlsId={(item) => `evidence-details-${item.id}`}
        disclosureLabel={(item, expanded) =>
          queueT(expanded ? "hideDetails" : "showDetails", {
            name: getRowName(item),
          })
        }
      />

      <ReviewQueuePagination queue={queue} />

      <ReviewQueueDrawer
        item={openItemValue}
        open={openItemValue !== null}
        onClose={() => {
          queue.setOpenId(null);
          setStripDeclaration(false);
        }}
        title={(item) => getRowName(item)}
        metadata={(item) => (
          <p className="type-metadata">
            {t(`stances.${item.stance}`)} · {formatReviewDate(item.createdAt)}
          </p>
        )}
        bodyId={(item) => `evidence-details-${item.id}`}
        footer={
          openItemValue?.status === "pending"
            ? (item) => (
                <div className="space-y-4 pt-5">
                  {canStripDeclaration(item) ? (
                    <Label className="min-h-12 cursor-pointer gap-3 type-body">
                      <Checkbox
                        checked={stripDeclaration}
                        onCheckedChange={setStripDeclaration}
                        disabled={queueAction.isRowPending(item.id)}
                      />
                      <span>{t("stripDeclaration")}</span>
                    </Label>
                  ) : null}
                  <ReviewDecisionPanel
                    onApprove={(notes) => runSingle(item, "approved", notes)}
                    onReject={(notes) => runSingle(item, "rejected", notes)}
                    approveLabel={t("actions.approve")}
                    rejectLabel={t("actions.reject")}
                    notesPolicy="requiredOnReject"
                    notesLabel={t("fields.reviewerNotes")}
                    notesPlaceholder={t("reviewerNotesPlaceholder")}
                    isPending={queueAction.isRowPending(item.id)}
                    error={queueAction.error}
                  />
                </div>
              )
            : undefined
        }
      >
        {(item) => (
          <div className="space-y-6">
            <dl className="grid gap-4 sm:grid-cols-2">
              <div>
                <dt className="type-metadata">{t("fields.stance")}</dt>
                <dd className="mt-1 type-body">
                  {t(`stances.${item.stance}`)}
                </dd>
              </div>
              <div>
                <dt className="type-metadata">{t("fields.product")}</dt>
                <dd className="mt-1 type-body">
                  {item.productName ?? t("notProvided")}
                </dd>
              </div>
              <div>
                <dt className="type-metadata">{t("fields.sourceType")}</dt>
                <dd className="mt-1 type-body">
                  {t(`sourceTypes.${item.sourceType}`)}
                </dd>
              </div>
              <div className="sm:col-span-2">
                <dt className="type-metadata">{t("fields.notes")}</dt>
                <dd className="mt-1 whitespace-pre-wrap type-body">
                  {item.notes}
                </dd>
              </div>
            </dl>

            {renderPhotos(item)}

            {item.reviewerNotes ? (
              <div>
                <p className="type-metadata">{t("fields.reviewerNotes")}</p>
                <p className="mt-1 whitespace-pre-wrap type-body">
                  {item.reviewerNotes}
                </p>
              </div>
            ) : null}
          </div>
        )}
      </ReviewQueueDrawer>
    </div>
  );
}
