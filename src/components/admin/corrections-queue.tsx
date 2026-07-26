"use client";

import { Fragment, useState, useTransition, type ReactNode } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { formatPriceRange } from "@/lib/brands/price-range";
import type {
  BrandCorrection,
  CorrectionDecision,
} from "@/lib/services/brand-corrections";
import {
  applyTagDelta,
  isProductTagsDelta,
  MAX_PRODUCT_TAGS,
  type ProductTagsDelta,
} from "@/lib/services/product-tags";
import {
  categoryLabel,
  PRODUCT_TYPE_CATEGORIES,
} from "@/lib/taxonomy/ontology";

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

type TagDeltaState = {
  delta: ProductTagsDelta;
  projectedTags: string[];
  exceedsCap: boolean;
};

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function currentValue(correction: CorrectionQueueItem): unknown {
  return correction.currentValue;
}

function tagDeltaState(correction: CorrectionQueueItem): TagDeltaState | null {
  if (
    correction.field !== "product_tags" ||
    !isProductTagsDelta(correction.proposedValue)
  ) {
    return null;
  }

  const currentTags = stringArray(currentValue(correction));
  const projectedTags = applyTagDelta(currentTags, correction.proposedValue);

  return {
    delta: correction.proposedValue,
    projectedTags,
    exceedsCap: projectedTags.length > MAX_PRODUCT_TAGS,
  };
}

function tagBadges(tags: string[], emptyLabel: string): ReactNode {
  if (tags.length === 0) {
    return (
      <span className="type-field-value text-muted-foreground">
        {emptyLabel}
      </span>
    );
  }

  return (
    <div className="flex flex-wrap gap-2">
      {tags.map((tag, index) => (
        <Badge key={`${tag}-${index}`} variant="secondary">
          {tag}
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

  if (field === "product_type" && typeof value === "string") {
    const category = PRODUCT_TYPE_CATEGORIES.find(
      (item) => item.slug === value,
    );
    return category ? categoryLabel(category, locale) : unavailableLabel;
  }

  return unavailableLabel;
}

function formatDate(date: string, locale: string): string {
  return new Intl.DateTimeFormat(locale, {
    year: "numeric",
    month: "short",
    day: "numeric",
    timeZone: "Asia/Taipei",
  }).format(new Date(date));
}

export function CorrectionsQueue({
  corrections,
  reviewAction,
}: {
  corrections: CorrectionQueueItem[];
  reviewAction?: ReviewAction;
}) {
  const t = useTranslations("admin.corrections");
  const locale = useLocale();
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [reviewerNotes, setReviewerNotes] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleRowClick(id: string) {
    setExpandedId((current) => (current === id ? null : id));
    setReviewerNotes("");
    setError(null);
  }

  function renderCurrentValue(item: CorrectionQueueItem): ReactNode {
    const value = currentValue(item);
    if (item.field === "product_tags") {
      return tagBadges(stringArray(value), t("notAvailable"));
    }

    return (
      <span className="type-field-value">
        {scalarValue(item.field, value, locale, t("notAvailable"))}
      </span>
    );
  }

  function renderProposedValue(item: CorrectionQueueItem): ReactNode {
    const delta = tagDeltaState(item);
    if (delta) {
      return (
        <div className="space-y-2">
          <div className="flex flex-wrap gap-2">
            {delta.delta.add.map((tag, index) => (
              <Badge key={`add-${tag}-${index}`} variant="secondary">
                +{tag}
              </Badge>
            ))}
            {delta.delta.remove.map((tag, index) => (
              <Badge
                key={`remove-${tag}-${index}`}
                variant="secondary"
                className="line-through"
              >
                −{tag}
              </Badge>
            ))}
          </div>
          <div className="space-y-1">
            <p className="type-metadata">{t("tagDelta.projected")}</p>
            {tagBadges(delta.projectedTags, t("notAvailable"))}
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

  function handleReview(
    item: CorrectionQueueItem,
    decision: CorrectionDecision,
  ) {
    const notes = reviewerNotes.trim();

    startTransition(async () => {
      setError(null);
      try {
        const result = await reviewAction?.(item.id, decision, notes);
        if (result?.error) {
          setError(t("errors.generic"));
          return;
        }
        setReviewerNotes("");
      } catch {
        setError(t("errors.generic"));
      }
    });
  }

  if (corrections.length === 0) {
    return <p className="type-empty-body mt-4">{t("empty")}</p>;
  }

  return (
    <div className="mt-4 overflow-hidden rounded-lg border border-border bg-card">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t("table.brand")}</TableHead>
            <TableHead>{t("table.field")}</TableHead>
            <TableHead>{t("table.current")}</TableHead>
            <TableHead>{t("table.proposed")}</TableHead>
            <TableHead>{t("table.date")}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {corrections.map((item) => {
            const delta = tagDeltaState(item);
            const expanded = expandedId === item.id;

            return (
              <Fragment key={item.id}>
                <TableRow
                  aria-expanded={expanded}
                  className="cursor-pointer hover:bg-secondary"
                  onClick={() => handleRowClick(item.id)}
                >
                  <TableCell className="font-medium">
                    {item.brandName ?? t("unknownBrand")}
                  </TableCell>
                  <TableCell>{t(`fields.${item.field}`)}</TableCell>
                  <TableCell>{renderCurrentValue(item)}</TableCell>
                  <TableCell className="min-w-64 whitespace-normal">
                    <div className="space-y-2">
                      {renderProposedValue(item)}
                      <div className="flex flex-wrap gap-2">
                        {item.stale && (
                          <Badge variant="secondary">{t("stale")}</Badge>
                        )}
                        {delta?.exceedsCap && (
                          <Badge variant="secondary">{t("tooManyTags")}</Badge>
                        )}
                      </div>
                    </div>
                  </TableCell>
                  <TableCell>{formatDate(item.createdAt, locale)}</TableCell>
                </TableRow>

                {expanded && (
                  <TableRow>
                    <TableCell
                      colSpan={5}
                      className="whitespace-normal bg-secondary p-6"
                    >
                      <div className="space-y-5">
                        <dl className="grid gap-4 sm:grid-cols-2">
                          <div>
                            <dt className="type-metadata">
                              {t("table.current")}
                            </dt>
                            <dd className="mt-1">{renderCurrentValue(item)}</dd>
                          </div>
                          <div>
                            <dt className="type-metadata">
                              {t("table.proposed")}
                            </dt>
                            <dd className="mt-1">
                              {renderProposedValue(item)}
                            </dd>
                          </div>
                        </dl>

                        {error && (
                          <p className="type-error" role="alert">
                            {error}
                          </p>
                        )}

                        <div
                          className="max-w-xl space-y-3"
                          onClick={(event) => event.stopPropagation()}
                        >
                          <Textarea
                            aria-label={t("reviewerNotes")}
                            placeholder={t("reviewerNotesPlaceholder")}
                            value={reviewerNotes}
                            onChange={(event) => {
                              setReviewerNotes(event.target.value);
                              setError(null);
                            }}
                            disabled={isPending}
                          />

                          <div className="flex flex-wrap gap-3">
                            <Button
                              onClick={() => handleReview(item, "approved")}
                              disabled={isPending || Boolean(delta?.exceedsCap)}
                            >
                              {t("actions.approve")}
                            </Button>
                            <Button
                              variant="secondary"
                              onClick={() => handleReview(item, "rejected")}
                              disabled={isPending}
                            >
                              {t("actions.reject")}
                            </Button>
                          </div>
                        </div>
                      </div>
                    </TableCell>
                  </TableRow>
                )}
              </Fragment>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
