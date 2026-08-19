"use client";

import { useMemo, type ReactNode } from "react";
import { useLocale, useTranslations } from "next-intl";

import { Badge } from "@/components/ui/badge";
import type {
  BrandCorrection,
  CorrectionBatchFailure,
  CorrectionDecision,
} from "@/lib/services/brand-corrections";
import {
  applySubcategoryDelta,
  isSubcategoriesDelta,
  MAX_SUBCATEGORIES,
  type SubcategoriesDelta,
} from "@/lib/services/subcategories";
import { formatPriceRange } from "@/lib/brands/price-range";
import { PURCHASE_COLUMNS } from "@/lib/brands/purchase-channels";
import {
  categoryLabel,
  isKnownSubcategoryTerm,
  subcategoryDisplayLabel,
  L1_CATEGORIES,
} from "@/lib/taxonomy/ontology";
import {
  formatReviewDate,
  ReviewDecisionPanel,
  ReviewQueueDrawer,
  ReviewQueuePagination,
  ReviewQueueTable,
  ReviewQueueToolbar,
  type ReviewBulkAction,
  type ReviewColumn,
  type ReviewFilter,
  useQueueAction,
  useReviewQueue,
} from "./queue";

/**
 * Exactly the fields this queue renders — the page projects rows down to this
 * shape so visitor hashes and review metadata never reach the client bundle.
 */
export type CorrectionQueueItem = Pick<
  BrandCorrection,
  | "id"
  | "brandName"
  | "field"
  | "currentValue"
  | "proposedValue"
  | "stale"
  | "createdAt"
>;

type ReviewAction = (
  id: string,
  decision: CorrectionDecision,
  notes: string,
) => Promise<{ error?: string } | undefined>;

type BulkReviewAction = (
  ids: string[],
  decision: CorrectionDecision,
  notes: string,
) => Promise<{ failures: CorrectionBatchFailure[] } | { error: string }>;

type SubcategoryDeltaState = {
  delta: SubcategoriesDelta;
  projectedSubcategories: string[];
  exceedsCap: boolean;
};

/**
 * Purchase and social fields both store a plain URL string. The service layer's
 * own link-field guard is module-private, so the queue keeps its own list —
 * an explicit enumeration fails loudly when `CorrectionField` gains a member,
 * where prefix matching would silently swallow it.
 */
const LINK_FIELDS: readonly CorrectionQueueItem["field"][] = [
  ...PURCHASE_COLUMNS,
  "social_instagram",
  "social_threads",
  "social_facebook",
];

function isLinkField(field: CorrectionQueueItem["field"]): boolean {
  return LINK_FIELDS.includes(field);
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function subcategoryDeltaState(
  correction: CorrectionQueueItem,
): SubcategoryDeltaState | null {
  if (
    correction.field !== "subcategories" ||
    !isSubcategoriesDelta(correction.proposedValue)
  ) {
    return null;
  }

  const currentSubcategories = stringArray(correction.currentValue);
  const projectedSubcategories = applySubcategoryDelta(
    currentSubcategories,
    correction.proposedValue,
  );

  return {
    delta: correction.proposedValue,
    projectedSubcategories,
    exceedsCap: projectedSubcategories.length > MAX_SUBCATEGORIES,
  };
}

function subcategoryBadges(
  subcategories: string[],
  emptyLabel: string,
  locale: string,
): ReactNode {
  if (subcategories.length === 0) {
    return (
      <span className="type-field-value text-muted-foreground">
        {emptyLabel}
      </span>
    );
  }

  return (
    <div className="flex flex-wrap gap-2">
      {subcategories.map((subcategory, index) => (
        <Badge key={`${subcategory}-${index}`} variant="secondary">
          {subcategoryDisplayLabel(subcategory, locale)}
        </Badge>
      ))}
    </div>
  );
}

function scalarValue(
  field: CorrectionQueueItem["field"],
  value: unknown,
  locale: string,
  unavailableLabel: string,
): string {
  if (field === "price_range") {
    return formatPriceRange(value) ?? unavailableLabel;
  }

  if (field === "category" && typeof value === "string") {
    const category = L1_CATEGORIES.find(
      (item) => item.slug === value,
    );
    return category ? categoryLabel(category, locale) : unavailableLabel;
  }

  if (isLinkField(field) && typeof value === "string") {
    return value;
  }

  return unavailableLabel;
}

export function CorrectionsQueue({
  corrections,
  reviewAction,
  bulkReviewAction,
}: {
  corrections: CorrectionQueueItem[];
  reviewAction?: ReviewAction;
  bulkReviewAction?: BulkReviewAction;
}) {
  const t = useTranslations("admin.corrections");
  const queueT = useTranslations("admin.queue");
  const locale = useLocale();
  const queueAction = useQueueAction();

  const filters = useMemo<ReviewFilter<CorrectionQueueItem>[]>(
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

          return [
            item.brandName ?? "",
            t(`fields.${item.field}`),
          ].some((candidate) =>
            candidate.toLocaleLowerCase().includes(query),
          );
        },
      },
    ],
    [queueT, t],
  );

  const queue = useReviewQueue({
    items: corrections,
    getId: (item) => item.id,
    filters,
    // The page pre-filters to pending and the projection carries no status
    // field, so every projected row is selectable.
    isSelectable: () => true,
  });

  function renderCurrentValue(item: CorrectionQueueItem): ReactNode {
    const value = item.currentValue;
    if (item.field === "subcategories") {
      return subcategoryBadges(stringArray(value), t("notAvailable"), locale);
    }

    return (
      <span className="type-field-value">
        {scalarValue(item.field, value, locale, t("notAvailable"))}
      </span>
    );
  }

  function renderProposedValue(item: CorrectionQueueItem): ReactNode {
    const delta = subcategoryDeltaState(item);
    if (delta) {
      return (
        <div className="space-y-2">
          <div className="flex flex-wrap gap-2">
            {delta.delta.add.map((subcategory, index) => (
              <span
                key={`add-${subcategory}-${index}`}
                className="inline-flex items-center gap-1"
              >
                <Badge variant="secondary">
                  +{subcategoryDisplayLabel(subcategory, locale)}
                </Badge>
                {/*
                  Novel subcategories are display-only: they match no ?sub=
                  filter. Membership is asked on both bases — storage is slugs
                  since DEV-1510, and a label-only lookup flags every migrated
                  row as novel, which would bury the real gap signal.
                */}
                {!isKnownSubcategoryTerm(subcategory) && (
                  <Badge variant="warning" title={t("novelSubcategoryTitle")}>
                    {t("novelSubcategory")}
                  </Badge>
                )}
              </span>
            ))}
            {delta.delta.remove.map((subcategory, index) => (
              <Badge
                key={`remove-${subcategory}-${index}`}
                variant="secondary"
                className="line-through"
              >
                −{subcategoryDisplayLabel(subcategory, locale)}
              </Badge>
            ))}
          </div>
          <div className="space-y-1">
            <p className="type-metadata">{t("subcategoryDelta.projected")}</p>
            {subcategoryBadges(
              delta.projectedSubcategories,
              t("notAvailable"),
              locale,
            )}
          </div>
        </div>
      );
    }

    return (
      <span className="type-field-value">
        {scalarValue(item.field, item.proposedValue, locale, t("notAvailable"))}
      </span>
    );
  }

  function getRowName(item: CorrectionQueueItem): string {
    return item.brandName ?? t("unknownBrand");
  }

  const columns: ReviewColumn<CorrectionQueueItem>[] = [
    {
      id: "brand",
      header: t("table.brand"),
      cell: (item) => getRowName(item),
      cellClassName: "font-medium",
    },
    {
      id: "field",
      header: t("table.field"),
      cell: (item) => t(`fields.${item.field}`),
    },
    {
      id: "current",
      header: t("table.current"),
      cell: renderCurrentValue,
    },
    {
      id: "proposed",
      header: t("table.proposed"),
      cell: (item) => {
        const delta = subcategoryDeltaState(item);

        return (
          <div className="space-y-2">
            {renderProposedValue(item)}
            <div className="flex flex-wrap gap-2">
              {item.stale && <Badge variant="secondary">{t("stale")}</Badge>}
              {delta?.exceedsCap && (
                <Badge variant="secondary">{t("tooManySubcategories")}</Badge>
              )}
            </div>
          </div>
        );
      },
      cellClassName: "min-w-64 whitespace-normal",
    },
    {
      id: "date",
      header: t("table.date"),
      cell: (item) => formatReviewDate(item.createdAt),
    },
  ];

  function runSingle(
    item: CorrectionQueueItem,
    decision: CorrectionDecision,
    notes: string,
  ) {
    const ids = [item.id];
    void queueAction.run(
      ids,
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

  function runBulk(items: CorrectionQueueItem[], decision: CorrectionDecision) {
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

  function openItem(item: CorrectionQueueItem) {
    queueAction.clearError();
    queue.toggleOpen(item.id);
  }

  const bulkActions: ReviewBulkAction<CorrectionQueueItem>[] = [
    {
      id: "approve",
      label: (count) => t("bulkApprove", { count }),
      eligible: (item) => !subcategoryDeltaState(item)?.exceedsCap,
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
    corrections.find((item) => item.id === queue.openId) ?? null;

  return (
    <div className="space-y-4">
      <ReviewQueueToolbar queue={queue} />

      <ReviewQueueTable
        queue={queue}
        columns={columns}
        emptyMessage={t("empty")}
        getRowName={getRowName}
        selectAllLabel={queueT("selectAll")}
        bulkActions={bulkActions}
        onRowActivate={openItem}
        // The shell hands the ITEM to this predicate; the action hook tracks ids.
        isRowPending={(item) => queueAction.isRowPending(item.id)}
        // The drawer's decision panel already renders the action error while it
        // is open; surfacing it here too would emit two role="alert" nodes.
        error={openItemValue === null ? queueAction.error : null}
        disclosureControlsId={(item) => `correction-details-${item.id}`}
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
        onClose={() => queue.setOpenId(null)}
        title={(item) => getRowName(item)}
        metadata={(item) => (
          <p className="type-metadata">
            {t(`fields.${item.field}`)} · {formatReviewDate(item.createdAt)}
          </p>
        )}
        bodyId={(item) => `correction-details-${item.id}`}
        footer={(item) => (
          <div className="pt-5">
            <ReviewDecisionPanel
              onApprove={(notes) => runSingle(item, "approved", notes)}
              onReject={(notes) => runSingle(item, "rejected", notes)}
              approveLabel={t("actions.approve")}
              rejectLabel={t("actions.reject")}
              notesPolicy="optional"
              notesLabel={t("reviewerNotes")}
              notesPlaceholder={t("reviewerNotesPlaceholder")}
              // `blocker` is deliberately NOT passed: the cap message is stated
              // contextually in the body, right under the projected subcategory list,
              // so repeating it down here would duplicate it.
              eligible={!subcategoryDeltaState(item)?.exceedsCap}
              isPending={queueAction.isRowPending(item.id)}
              error={queueAction.error}
            />
          </div>
        )}
      >
        {(item) => {
          const delta = subcategoryDeltaState(item);
          const exceedsCap = delta?.exceedsCap ?? false;

          return (
            <div className="space-y-6">
              <dl className="grid gap-4 sm:grid-cols-2">
                <div>
                  <dt className="type-metadata">{t("table.current")}</dt>
                  <dd className="mt-1">{renderCurrentValue(item)}</dd>
                </div>
                <div>
                  <dt className="type-metadata">{t("table.proposed")}</dt>
                  <dd className="mt-1 space-y-2">
                    {renderProposedValue(item)}
                    {/* Stated contextually, right under the projected result —
                        the footer panel is deliberately given `eligible` only,
                        so this message is never duplicated down there. */}
                    {exceedsCap && delta ? (
                      <p className="type-error" role="alert">
                        {t("capBlocker", {
                          projected: delta.projectedSubcategories.length,
                          limit: MAX_SUBCATEGORIES,
                        })}
                      </p>
                    ) : null}
                  </dd>
                </div>
              </dl>
            </div>
          );
        }}
      </ReviewQueueDrawer>
    </div>
  );
}
