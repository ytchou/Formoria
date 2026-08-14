"use client";

import { useMemo, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useTranslations } from "next-intl";

import {
  promoteCuratedProductAction,
  retireCuratedProductAction,
} from "@/app/admin/curated-products/actions";
import { ConfirmDialog } from "@/components/admin/confirm-dialog";
import { DetailSection } from "@/components/admin/detail-section";
import {
  formatReviewDate,
  ReviewDecisionPanel,
  ReviewQueueDrawer,
  ReviewQueuePagination,
  ReviewQueueTable,
  ReviewQueueToolbar,
  reviewStatusVariant,
  useQueueAction,
  useReviewQueue,
  type ReviewBulkAction,
  type ReviewColumn,
  type ReviewFilter,
  type ReviewTab,
} from "@/components/admin/queue";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { curatedProductPromoteBlockers } from "@/lib/curated-products/promote-gate";
import type { AdminCuratedProduct } from "@/lib/services/curated-products";
import {
  CuratedProductEditor,
  PromoteGateReadout,
  type BrandOption,
} from "./curated-product-editor";

export type CuratedProductTab =
  "candidate" | "needs_review" | "published" | "retired";

const TAB_ORDER: CuratedProductTab[] = [
  "candidate",
  "needs_review",
  "published",
  "retired",
];

/**
 * Lifecycle → the status vocabulary `reviewStatusVariant` reads. `candidate`
 * and `published` are not words that helper knows, so they are translated here
 * rather than by widening a table six other queues share.
 */
const LIFECYCLE_STATUS: Record<string, string> = {
  candidate: "pending",
  needs_review: "needs_review",
  published: "approved",
  retired: "rejected",
};

const getProductId = (product: AdminCuratedProduct) => product.id;

function isPromotable(product: AdminCuratedProduct): boolean {
  return curatedProductPromoteBlockers(product, product.sources).length === 0;
}

export function CuratedProductsList({
  products,
  brands,
  initialTab = "candidate",
  initialBrandSlug = null,
}: {
  products: AdminCuratedProduct[];
  brands: BrandOption[];
  initialTab?: CuratedProductTab;
  initialBrandSlug?: string | null;
}): React.JSX.Element {
  const t = useTranslations("admin.curatedProducts");
  const router = useRouter();
  const pathname = usePathname();
  const queueAction = useQueueAction();
  const [retireTarget, setRetireTarget] = useState<AdminCuratedProduct | null>(
    null,
  );
  const [creating, setCreating] = useState(false);

  const tabs = useMemo<ReviewTab<AdminCuratedProduct>[]>(
    () =>
      TAB_ORDER.map((tab) => ({
        value: tab,
        label: t(`tabs.${tab === "needs_review" ? "needsReview" : tab}`),
        match: (product) => product.lifecycle === tab,
      })),
    [t],
  );

  const filters = useMemo<ReviewFilter<AdminCuratedProduct>[]>(
    () => [
      {
        id: "search",
        kind: "search",
        label: t("searchLabel"),
        placeholder: t("searchPlaceholder"),
        className: "xl:col-span-2",
        // Seeded from `?brand=<slug>`: the deep link from the brand list scopes
        // the queue without hiding the way back out of that scope.
        defaultValue: initialBrandSlug,
        predicate: (product, value) => {
          const query =
            typeof value === "string" ? value.trim().toLocaleLowerCase() : "";
          if (!query) return true;
          return [
            product.brandName,
            product.brandSlug,
            product.nameZh,
            product.nameEn,
            product.key,
          ].some((candidate) => candidate?.toLocaleLowerCase().includes(query));
        },
      },
      {
        id: "proposedBy",
        kind: "select",
        label: t("proposedByFilter.label"),
        defaultValue: "all",
        options: [
          { value: "all", label: t("proposedByFilter.all") },
          { value: "admin", label: t("proposedBy.admin") },
          { value: "generated", label: t("proposedBy.generated") },
          { value: "owner", label: t("proposedBy.owner") },
        ],
        predicate: (product, value) => product.proposedBy === value,
      },
    ],
    [t, initialBrandSlug],
  );

  const queue = useReviewQueue<AdminCuratedProduct>({
    items: products,
    getId: getProductId,
    tabs,
    filters,
    initialTab,
    isSelectable: (product) =>
      product.lifecycle === "candidate" || product.lifecycle === "needs_review",
    // A promoted row un-hides itself the moment the incoming props say the
    // server caught up, so the Published tab never undercounts.
    releaseHidden: (product) =>
      product.lifecycle !== "candidate" && product.lifecycle !== "needs_review",
    onTabChange: (value) => router.replace(`${pathname}?stage=${value}`),
    onViewReset: () => {
      setRetireTarget(null);
      queueAction.clearError();
    },
  });

  const openProduct =
    products.find((product) => product.id === queue.openId) ?? null;

  const columns: ReviewColumn<AdminCuratedProduct>[] = [
    {
      id: "brand",
      header: t("table.brand"),
      cell: (product) => (
        <span className="block truncate">{product.brandName}</span>
      ),
      cellClassName: "max-w-[200px]",
    },
    {
      id: "product",
      header: t("table.product"),
      cell: (product) => (
        <span className="block truncate">{product.nameZh}</span>
      ),
      cellClassName: "max-w-[240px] font-medium",
    },
    {
      id: "lifecycle",
      header: t("table.lifecycle"),
      cell: (product) => (
        <Badge
          variant={reviewStatusVariant(
            LIFECYCLE_STATUS[product.lifecycle] ?? product.lifecycle,
          )}
        >
          {t(`lifecycle.${product.lifecycle}`)}
        </Badge>
      ),
    },
    {
      id: "proposedBy",
      header: t("table.proposedBy"),
      cell: (product) => t(`proposedBy.${product.proposedBy}`),
    },
    {
      id: "linkState",
      header: t("table.linkState"),
      cell: (product) => t(`linkState.${product.linkState}`),
    },
    {
      id: "updated",
      header: t("table.updated"),
      cell: (product) => formatReviewDate(product.updatedAt),
    },
  ];

  function bulkPromote(items: AdminCuratedProduct[]) {
    const eligible = items.filter(isPromotable);
    if (eligible.length === 0) return;

    const ids = eligible.map(getProductId);
    queueAction.runBulk(ids, async () => {
      const results = await Promise.all(
        ids.map(async (id) => ({
          id,
          result: await promoteCuratedProductAction(id),
        })),
      );
      const failed = results.filter((entry) => entry.result?.error);
      const succeeded = results
        .filter((entry) => !entry.result?.error)
        .map((entry) => entry.id);
      // No router.refresh(): revalidatePath pushes fresh props, and the hidden
      // latch keeps promoted rows out of the tab until they arrive.
      queue.hideIds(succeeded);
      queue.setSelectedIds(new Set(failed.map((entry) => entry.id)));

      const first = failed.at(0);
      if (!first) return undefined;
      const product = eligible.find((item) => item.id === first.id);
      return {
        error: `${product?.nameZh ?? first.id}: ${first.result?.error ?? ""}`,
      };
    });
  }

  function promoteOne(product: AdminCuratedProduct) {
    void queueAction.run(
      [product.id],
      async () => {
        const result = await promoteCuratedProductAction(product.id);
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

  function retireOne(product: AdminCuratedProduct) {
    void queueAction.run(
      [product.id],
      async () => {
        const result = await retireCuratedProductAction(product.id);
        return result?.error ? { error: result.error } : undefined;
      },
      {
        onResult: (result) => {
          setRetireTarget(null);
          if (!result.ok) return;
          queue.setOpenId(null);
          router.refresh();
        },
      },
    );
  }

  const bulkActions: ReviewBulkAction<AdminCuratedProduct>[] = [
    {
      id: "promote",
      label: (count) => t("promoteSelected", { count }),
      variant: "primary",
      visibleOn: (activeTab) =>
        activeTab === "candidate" || activeTab === "needs_review",
      eligible: isPromotable,
      pending: queueAction.isPending,
      onRun: bulkPromote,
    },
  ];

  return (
    <div>
      <div className="mb-4 flex justify-end">
        <Button
          type="button"
          variant="secondary"
          className="min-h-12"
          aria-expanded={creating}
          onClick={() => setCreating((current) => !current)}
        >
          {creating ? t("closeNewProduct") : t("newProduct")}
        </Button>
      </div>

      {creating ? (
        <div className="mb-6 rounded-lg border border-border p-4">
          <DetailSection
            title={t("newProduct")}
            editLabel={t("editor.edit")}
            saveLabel={t("editor.save")}
            cancelLabel={t("editor.cancel")}
          >
            <CuratedProductEditor
              mode="create"
              brands={brands}
              onSaved={() => {
                setCreating(false);
                router.refresh();
              }}
            />
          </DetailSection>
        </div>
      ) : null}

      <ReviewQueueToolbar queue={queue} />

      <div className="mt-4">
        <ReviewQueueTable
          queue={queue}
          columns={columns}
          emptyMessage={t("notFound")}
          getRowName={(product) => product.nameZh}
          selectAllLabel={t("selectVisible")}
          bulkActions={bulkActions}
          onRowActivate={(product) => {
            queueAction.clearError();
            queue.toggleOpen(product.id);
          }}
          isRowPending={(product) => queueAction.isRowPending(product.id)}
          rowClassName={() => "hover:bg-secondary"}
          // The drawer's decision panel renders the action error while it is
          // open; surfacing it here too would emit two role="alert" nodes.
          error={openProduct === null ? queueAction.error : null}
          disclosureLabel={(product, expanded) =>
            t(expanded ? "collapseProduct" : "expandProduct", {
              name: product.nameZh,
            })
          }
        />
      </div>

      <ReviewQueuePagination queue={queue} />

      <ReviewQueueDrawer
        item={openProduct}
        open={openProduct !== null}
        onClose={() => queue.setOpenId(null)}
        title={(product) => product.nameZh}
        metadata={(product) => (
          <p className="type-metadata">
            {`${product.brandName} · ${formatReviewDate(product.updatedAt)}`}
          </p>
        )}
        footer={(product) => (
          <div className="pt-5">
            <ReviewDecisionPanel
              onApprove={() => promoteOne(product)}
              onReject={() => setRetireTarget(product)}
              // The labels name their exact scope: never "Approve"/"Reject".
              approveLabel={t("promote")}
              rejectLabel={t("retire")}
              notesPolicy="none"
              eligible={isPromotable(product)}
              // The gate readout IS the blocker explanation, so a disabled
              // Promote button always says which condition is missing.
              blocker={
                <PromoteGateReadout
                  product={product}
                  sources={product.sources}
                />
              }
              isPending={queueAction.isRowPending(product.id)}
              error={queueAction.error}
            />
          </div>
        )}
      >
        {(product) => (
          <DetailSection
            key={product.id}
            title={t("editor.title")}
            editLabel={t("editor.edit")}
            saveLabel={t("editor.save")}
            cancelLabel={t("editor.cancel")}
          >
            <CuratedProductEditor
              mode="edit"
              product={product}
              brands={brands}
              onSaved={() => router.refresh()}
            />
          </DetailSection>
        )}
      </ReviewQueueDrawer>

      <ConfirmDialog
        open={retireTarget !== null}
        onOpenChange={(open) => {
          if (!open) setRetireTarget(null);
        }}
        title={t("retireTitle")}
        description={t("retireDescription", {
          name: retireTarget?.nameZh ?? "",
        })}
        onConfirm={() => {
          if (retireTarget) retireOne(retireTarget);
        }}
        confirmLabel={t("retire")}
        variant="destructive"
        isPending={
          retireTarget ? queueAction.isRowPending(retireTarget.id) : false
        }
      />
    </div>
  );
}
