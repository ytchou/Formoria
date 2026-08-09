"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";

import { ConfirmDialog } from "@/components/admin/confirm-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import type { BrandReport } from "@/lib/services/reports";
import {
  formatReviewDate,
  ReviewDecisionPanel,
  ReviewQueueDrawer,
  ReviewQueuePagination,
  ReviewQueueTable,
  ReviewQueueToolbar,
  reviewStatusVariant,
  type ReviewColumn,
  type ReviewFilter,
  useQueueAction,
  useReviewQueue,
} from "./queue";

type ReviewAction = (
  id: string,
  decision: "reviewed" | "dismissed",
  notes?: string,
) => Promise<{ error?: string } | undefined>;

type RevokeAction = (
  brandId: string,
  reason: string,
) => Promise<{ error?: string } | undefined>;

export function ReportsTable({
  reports,
  reviewAction,
  revokeAction,
}: {
  reports: BrandReport[];
  reviewAction?: ReviewAction;
  revokeAction?: RevokeAction;
}) {
  const t = useTranslations("admin.reports");
  const queueT = useTranslations("admin.queue");
  const queueAction = useQueueAction();
  const [revokeReason, setRevokeReason] = useState("");
  const [isRevokeDialogOpen, setIsRevokeDialogOpen] = useState(false);

  const filters = useMemo<ReviewFilter<BrandReport>[]>(
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

          return [item.brandName ?? "", t(`reasons.${item.reason}`)].some(
            (candidate) => candidate.toLocaleLowerCase().includes(query),
          );
        },
      },
    ],
    [queueT, t],
  );

  const queue = useReviewQueue({
    items: reports,
    getId: (item) => item.id,
    filters,
  });

  function getRowName(item: BrandReport): string {
    return item.brandName ?? t("unknownBrand");
  }

  function runDecision(
    item: BrandReport,
    decision: "reviewed" | "dismissed",
    notes: string,
  ) {
    void queueAction.run(
      [item.id],
      async () => {
        try {
          const result = await reviewAction?.(item.id, decision, notes);
          return result?.error ? { error: t("errors.generic") } : undefined;
        } catch {
          return { error: t("errors.generic") };
        }
      },
      {
        onResult: (result) => {
          if (result.ok) queue.setOpenId(null);
        },
      },
    );
  }

  function runRevoke(item: BrandReport) {
    const reason = revokeReason.trim();
    if (!reason) return;

    void queueAction.run(
      [item.id],
      async () => {
        try {
          const result = await revokeAction?.(item.brandId, reason);
          return result?.error ? { error: t("errors.generic") } : undefined;
        } catch {
          return { error: t("errors.generic") };
        }
      },
      {
        onResult: (result) => {
          if (result.ok) {
            setIsRevokeDialogOpen(false);
            setRevokeReason("");
          }
        },
      },
    );
  }

  function openItem(item: BrandReport) {
    queueAction.clearError();
    setRevokeReason("");
    setIsRevokeDialogOpen(false);
    queue.toggleOpen(item.id);
  }

  const columns: ReviewColumn<BrandReport>[] = [
    {
      id: "brand",
      header: t("table.brand"),
      cell: (item) => (
        <Link
          href={`/brands/${item.brandSlug}`}
          className="underline"
          onClick={(event) => event.stopPropagation()}
        >
          {getRowName(item)}
        </Link>
      ),
      cellClassName: "font-medium",
    },
    {
      id: "reason",
      header: t("table.reason"),
      cell: (item) => t(`reasons.${item.reason}`),
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
          {t(`statuses.${item.status}`)}
        </Badge>
      ),
    },
  ];

  const openItemValue =
    reports.find((item) => item.id === queue.openId) ?? null;

  return (
    <div className="space-y-4">
      <ReviewQueueToolbar queue={queue} />

      <ReviewQueueTable
        queue={queue}
        columns={columns}
        emptyMessage={t("empty")}
        getRowName={getRowName}
        onRowActivate={openItem}
        // The drawer's decision panel already renders the action error while it
        // is open; surfacing it here too would emit two role="alert" nodes.
        error={openItemValue === null ? queueAction.error : null}
        disclosureControlsId={(item) => `report-details-${item.id}`}
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
          setRevokeReason("");
          setIsRevokeDialogOpen(false);
        }}
        title={(item) => getRowName(item)}
        metadata={(item) => (
          <p className="type-metadata">
            {t(`reasons.${item.reason}`)} · {formatReviewDate(item.createdAt)}
          </p>
        )}
        bodyId={(item) => `report-details-${item.id}`}
        footer={(item) => (
          <div className="space-y-5 pt-5">
            {/* The shared shell is intentionally generic; reports map its approve/reject slots to domain actions. */}
            <ReviewDecisionPanel
              onApprove={(notes) => runDecision(item, "reviewed", notes)}
              onReject={(notes) => runDecision(item, "dismissed", notes)}
              approveLabel={t("actions.markReviewed")}
              rejectLabel={t("actions.dismiss")}
              notesPolicy="optional"
              notesLabel={t("reviewerNotes")}
              notesPlaceholder={t("reviewerNotesPlaceholder")}
              // Row-scoped, not the bulk transition flag: `run` only touches
              // the pending-id set, so `isPending` never flips for a
              // single-row decision and a double-click fired a second review
              // of the same id.
              isPending={queueAction.isRowPending(item.id)}
              error={queueAction.error}
            />

            {item.reason === "ownership_dispute" && item.brandHasOwner ? (
              <>
                <Separator />
                <div className="space-y-3">
                  <div className="space-y-2">
                    <Label htmlFor={`revoke-reason-${item.id}`}>
                      {t("revoke.reasonLabel")}
                    </Label>
                    <Textarea
                      id={`revoke-reason-${item.id}`}
                      value={revokeReason}
                      onChange={(event) => setRevokeReason(event.target.value)}
                    />
                  </div>
                  <Button
                    type="button"
                    variant="destructive"
                    disabled={
                      !revokeReason.trim() || queueAction.isRowPending(item.id)
                    }
                    onClick={() => setIsRevokeDialogOpen(true)}
                  >
                    {t("revoke.trigger")}
                  </Button>
                </div>
                <ConfirmDialog
                  open={isRevokeDialogOpen}
                  onOpenChange={setIsRevokeDialogOpen}
                  title={t("revoke.confirmTitle")}
                  description={t("revoke.confirmDescription", {
                    brand: item.brandName ?? t("unknownBrand"),
                  })}
                  confirmLabel={t("revoke.confirmLabel")}
                  variant="destructive"
                  isPending={queueAction.isRowPending(item.id)}
                  onConfirm={() => runRevoke(item)}
                />
              </>
            ) : null}
          </div>
        )}
      >
        {(item) => (
          <div className="space-y-5">
            {item.notes ? (
              <div>
                <p className="type-metadata">{t("notes")}</p>
                <p className="mt-1 whitespace-pre-wrap text-sm">{item.notes}</p>
              </div>
            ) : null}

            {item.reason === "ownership_dispute" ||
            item.reason === "removal_request" ? (
              <dl>
                <div>
                  <dt className="type-metadata">{t("reporterEmail")}</dt>
                  <dd className="mt-1 type-field-value">
                    {item.reporterEmail ?? t("unavailable")}
                  </dd>
                </div>
              </dl>
            ) : null}
          </div>
        )}
      </ReviewQueueDrawer>
    </div>
  );
}
