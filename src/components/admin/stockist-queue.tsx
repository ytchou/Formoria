"use client";

import { useMemo } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";

import { reviewStockistAction } from "@/app/admin/actions";
import {
  formatReviewDate,
  ReviewDecisionPanel,
  ReviewQueueDrawer,
  ReviewQueuePagination,
  ReviewQueueTable,
  ReviewQueueToolbar,
  useQueueAction,
  useReviewQueue,
  type ReviewColumn,
  type ReviewFilter,
} from "@/components/admin/queue";
import { Badge } from "@/components/ui/badge";
import type { PendingStockist } from "@/lib/services/brand-channels";

const getStockistId = (stockist: PendingStockist) => stockist.id;

/**
 * The review queue for reader-submitted stockists.
 *
 * Built on the shared review-queue generics rather than on bare table
 * primitives: this is the fourth queue of its kind, and the three bespoke ones
 * that predate the generics are the reason keyboard behaviour, pending state,
 * and empty states drifted apart between admin surfaces.
 *
 * Approving is a publication, not a bookkeeping flip — the row goes live on the
 * brand page and in the city stockist directory — so the decision controls name
 * the exact thing they do rather than saying "Approve".
 */
export function StockistQueue({
  stockists,
}: {
  stockists: PendingStockist[];
}): React.JSX.Element {
  const t = useTranslations("admin.stockists");
  const router = useRouter();
  const queueAction = useQueueAction();

  const filters = useMemo<ReviewFilter<PendingStockist>[]>(
    () => [
      {
        id: "search",
        kind: "search",
        label: t("searchLabel"),
        placeholder: t("searchPlaceholder"),
        predicate: (stockist, value) => {
          const query =
            typeof value === "string" ? value.trim().toLocaleLowerCase() : "";
          if (!query) return true;
          return [
            stockist.brandName,
            stockist.brandSlug,
            stockist.name,
            stockist.regionLabel,
            stockist.address,
          ].some((field) => field?.toLocaleLowerCase().includes(query));
        },
      },
    ],
    [t],
  );

  const queue = useReviewQueue<PendingStockist>({
    items: stockists,
    getId: getStockistId,
    filters,
    onViewReset: () => queueAction.clearError(),
  });

  const openStockist =
    stockists.find((stockist) => stockist.id === queue.openId) ?? null;

  const columns: ReviewColumn<PendingStockist>[] = [
    {
      id: "brand",
      header: t("table.brand"),
      cell: (stockist) => (
        <span className="block truncate">{stockist.brandName}</span>
      ),
      cellClassName: "max-w-[200px]",
    },
    {
      id: "stockist",
      header: t("table.stockist"),
      cell: (stockist) => (
        <span className="block truncate">{stockist.name}</span>
      ),
      cellClassName: "max-w-[240px] font-medium",
    },
    {
      id: "format",
      header: t("table.format"),
      cell: (stockist) => (
        <Badge variant="secondary">{t(`format.${stockist.channelType}`)}</Badge>
      ),
    },
    {
      id: "region",
      header: t("table.region"),
      cell: (stockist) => stockist.regionLabel ?? t("notProvided"),
    },
    {
      id: "submitted",
      header: t("table.submitted"),
      cell: (stockist) => formatReviewDate(stockist.submittedAt),
    },
  ];

  function decide(
    stockist: PendingStockist,
    decision: "confirmed" | "rejected",
  ) {
    void queueAction.run(
      [stockist.id],
      async () => {
        const result = await reviewStockistAction(stockist.id, decision);
        return result?.error ? { error: result.error } : undefined;
      },
      {
        onResult: (result) => {
          if (!result.ok) return;
          // The decided row leaves the queue either way — approved or rejected,
          // it is no longer pending. Hidden first so the table does not show a
          // row the server has already moved on from.
          queue.hideIds([stockist.id]);
          queue.setOpenId(null);
          router.refresh();
        },
      },
    );
  }

  return (
    <div>
      <ReviewQueueToolbar queue={queue} />

      <div className="mt-4">
        <ReviewQueueTable
          queue={queue}
          columns={columns}
          // Two different empty states: nothing to review at all is good news,
          // while a search that matches nothing is a dead end the reviewer can
          // back out of.
          emptyMessage={stockists.length === 0 ? t("empty") : t("notFound")}
          getRowName={(stockist) => stockist.name}
          onRowActivate={(stockist) => {
            queueAction.clearError();
            queue.toggleOpen(stockist.id);
          }}
          isRowPending={(stockist) => queueAction.isRowPending(stockist.id)}
          rowClassName={() => "hover:bg-surface"}
          // The drawer renders the same error while it is open; showing it here
          // too would emit two role="alert" nodes for one failure.
          error={openStockist === null ? queueAction.error : null}
          disclosureLabel={(stockist, expanded) =>
            t(expanded ? "collapseStockist" : "expandStockist", {
              name: stockist.name,
            })
          }
        />
      </div>

      <ReviewQueuePagination queue={queue} />

      <ReviewQueueDrawer
        item={openStockist}
        open={openStockist !== null}
        onClose={() => queue.setOpenId(null)}
        title={(stockist) => stockist.name}
        metadata={(stockist) => (
          <p className="type-metadata">
            {`${stockist.brandName} · ${formatReviewDate(stockist.submittedAt)}`}
          </p>
        )}
        footer={(stockist) => (
          <div className="pt-5">
            <ReviewDecisionPanel
              notesPolicy="none"
              approveLabel={t("approve")}
              rejectLabel={t("reject")}
              isPending={queueAction.isRowPending(stockist.id)}
              error={queueAction.error}
              onApprove={() => decide(stockist, "confirmed")}
              onReject={() => decide(stockist, "rejected")}
            />
          </div>
        )}
      >
        {(stockist) => (
          <dl className="grid gap-3 py-4 sm:grid-cols-2">
            <div>
              <dt className="type-metadata">{t("fields.brand")}</dt>
              <dd className="type-body-sm">{stockist.brandName}</dd>
            </div>
            <div>
              <dt className="type-metadata">{t("fields.format")}</dt>
              <dd className="type-body-sm">
                {t(`format.${stockist.channelType}`)}
              </dd>
            </div>
            <div>
              <dt className="type-metadata">{t("fields.region")}</dt>
              <dd className="type-body-sm">
                {stockist.regionLabel ?? t("notProvided")}
              </dd>
            </div>
            <div>
              <dt className="type-metadata">{t("fields.address")}</dt>
              <dd className="type-body-sm">
                {stockist.address ?? t("notProvided")}
              </dd>
            </div>
            <div className="sm:col-span-2">
              <dt className="type-metadata">{t("fields.url")}</dt>
              <dd className="type-body-sm">
                {stockist.url ? (
                  <a
                    href={stockist.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="underline underline-offset-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                  >
                    {stockist.url}
                  </a>
                ) : (
                  t("notProvided")
                )}
              </dd>
            </div>
          </dl>
        )}
      </ReviewQueueDrawer>
    </div>
  );
}
