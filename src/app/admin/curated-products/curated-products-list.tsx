"use client";

import { useMemo, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useTranslations } from "next-intl";

import { retireCuratedProductAction } from "@/app/admin/curated-products/actions";
import { ConfirmDialog } from "@/components/admin/confirm-dialog";
import { DetailSection } from "@/components/admin/detail-section";
import {
  formatReviewDate,
  ReviewQueueDrawer,
  ReviewQueuePagination,
  ReviewQueueTable,
  ReviewQueueToolbar,
  useQueueAction,
  useReviewQueue,
  type ReviewColumn,
  type ReviewFilter,
  type ReviewTab,
} from "@/components/admin/queue";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { AdminCuratedProduct } from "@/lib/services/curated-products";
import {
  CuratedProductEditor,
  type BrandOption,
  type TrailOption,
} from "./curated-product-editor";

export type CuratedProductTab = "visible" | "hidden";

const TAB_ORDER: CuratedProductTab[] = ["visible", "hidden"];

const getProductId = (product: AdminCuratedProduct) => product.id;

export function CuratedProductsList({
  products,
  brands,
  initialTab = "visible",
  initialBrandSlug = null,
  trailOptions = [],
}: {
  products: AdminCuratedProduct[];
  brands: BrandOption[];
  initialTab?: CuratedProductTab;
  initialBrandSlug?: string | null;
  trailOptions?: TrailOption[];
}): React.JSX.Element {
  const t = useTranslations("admin.curatedProducts");
  const router = useRouter();
  const pathname = usePathname();
  const queueAction = useQueueAction();
  const [retireTarget, setRetireTarget] = useState<AdminCuratedProduct | null>(
    null,
  );
  const [creating, setCreating] = useState(false);
  const [brandScope, setBrandScope] = useState<string | null>(initialBrandSlug);

  const tabs = useMemo<ReviewTab<AdminCuratedProduct>[]>(
    () =>
      TAB_ORDER.map((tab) => ({
        value: tab,
        label: t(`tabs.${tab}`),
        match: (product) => product.visible === (tab === "visible"),
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
        // No `defaultValue` here. `defaultValue` is the NEUTRAL value of a
        // filter (compare `proposedBy: "all"`), not its initial value:
        // `useReviewQueue` seeds the value from it and `isEmptyFilterValue`
        // then treats a value equal to it as unset, so seeding the brand slug
        // here showed the slug in the box while the predicate never ran.
        // `?brand=<slug>` scopes the queue through `brandScope` instead.
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
          ].some((field) => field?.toLocaleLowerCase().includes(query));
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
    [t],
  );

  // `?brand=<slug>` scopes the whole queue — table, tab counts, and the create
  // form's brand — and the toolbar shows a Clear control, so the scope is
  // visible and reversible without navigating.
  const scopedProducts = useMemo(
    () =>
      brandScope
        ? products.filter((product) => product.brandSlug === brandScope)
        : products,
    [brandScope, products],
  );

  const scopedBrand = useMemo(
    () => brands.find((brand) => brand.slug === brandScope) ?? null,
    [brandScope, brands],
  );

  const queue = useReviewQueue<AdminCuratedProduct>({
    items: scopedProducts,
    getId: getProductId,
    tabs,
    filters,
    initialTab,
    // No selection predicate is passed: the queue has no bulk action left, so
    // the selection column is not rendered at all.
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
      id: "visible",
      header: t("table.visible"),
      cell: (product) => (
        <Badge variant={product.visible ? "success" : "secondary"}>
          {t(product.visible ? "visibleYes" : "visibleNo")}
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

  return (
    <div>
      <div className="mb-4 flex justify-end">
        <Button
          type="button"
          variant="secondary"
          size="large"
          aria-expanded={creating}
          onClick={() => setCreating((current) => !current)}
        >
          {creating ? t("closeNewProduct") : t("newProduct")}
        </Button>
      </div>

      {creating ? (
        <div className="mb-6 rounded-[3px] border border-rule p-4">
          <DetailSection
            title={t("newProduct")}
            editLabel={t("editor.edit")}
            saveLabel={t("editor.save")}
            cancelLabel={t("editor.cancel")}
          >
            <CuratedProductEditor
              mode="create"
              brands={brands}
              // Follows the `?brand=` deep link, so "New product" cannot land
              // on the alphabetically-first brand and then be filtered out of
              // the scoped view. An unknown slug falls back to `brands[0]`.
              defaultBrandId={scopedBrand?.id ?? null}
              trailOptions={trailOptions}
              onSaved={() => {
                setCreating(false);
                router.refresh();
              }}
            />
          </DetailSection>
        </div>
      ) : null}

      {scopedBrand || brandScope ? (
        <div className="mb-4 flex flex-wrap items-center gap-3">
          <p className="type-body-sm">
            {t("brandScope", { brand: scopedBrand?.name ?? brandScope ?? "" })}
          </p>
          <Button
            type="button"
            variant="secondary"
            size="large"
            onClick={() => {
              setBrandScope(null);
              queue.resetView();
              router.replace(`${pathname}?stage=${queue.activeTab}`);
            }}
          >
            {t("clearBrandScope")}
          </Button>
        </div>
      ) : null}

      <ReviewQueueToolbar queue={queue} />

      <div className="mt-4">
        <ReviewQueueTable
          queue={queue}
          columns={columns}
          emptyMessage={t("notFound")}
          getRowName={(product) => product.nameZh}
          onRowActivate={(product) => {
            queueAction.clearError();
            queue.toggleOpen(product.id);
          }}
          isRowPending={(product) => queueAction.isRowPending(product.id)}
          rowClassName={() => "hover:bg-surface"}
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
          // Retire is the only decision left in the drawer — visibility itself
          // is edited in the form above — so the two-button decision panel has
          // nothing to put on its approve side.
          <div className="space-y-3 pt-5">
            {queueAction.error ? (
              <p className="type-metadata text-danger" role="alert">
                {queueAction.error}
              </p>
            ) : null}
            {/* The label names its exact scope: never a bare "Reject". */}
            <Button
              type="button"
              variant="destructive"
              disabled={queueAction.isRowPending(product.id)}
              onClick={() => setRetireTarget(product)}
            >
              {t("retire")}
            </Button>
          </div>
        )}
      >
        {(product) => (
          <DetailSection
            // `updatedAt` is part of the key on purpose: the editor snapshots
            // server fields into `useState`, so a stable key would let React
            // reuse the instance after `router.refresh()` and keep showing the
            // pre-save values (a normalized L2 slug, a re-stamped
            // source_checked_at, a trimmed name) — and re-post them next save.
            key={`${product.id}:${product.updatedAt}`}
            title={t("editor.title")}
            editLabel={t("editor.edit")}
            saveLabel={t("editor.save")}
            cancelLabel={t("editor.cancel")}
          >
            <CuratedProductEditor
              mode="edit"
              product={product}
              brands={brands}
              trailOptions={trailOptions}
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
