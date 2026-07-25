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
import {
  applyTagDelta,
  type BrandCorrection,
  type CorrectionDecision,
  type ProductTagsDelta,
} from "@/lib/services/brand-corrections";
import { MAX_PRODUCT_TAGS } from "@/lib/services/product-tags";
import {
  categoryLabel,
  PRODUCT_TYPE_CATEGORIES,
} from "@/lib/taxonomy/ontology";

type ReviewAction = (
  id: string,
  decision: CorrectionDecision,
  notes: string,
) => Promise<{ error?: string } | undefined>;

type CorrectionWithCurrentValue = BrandCorrection & {
  currentValue?: unknown;
};

type TagDeltaState = {
  delta: ProductTagsDelta;
  projectedTags: string[];
  exceedsCap: boolean;
};

function isTagDelta(value: unknown): value is ProductTagsDelta {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }

  const record = value as Record<string, unknown>;
  return (
    Array.isArray(record.add) &&
    record.add.every((tag) => typeof tag === "string") &&
    Array.isArray(record.remove) &&
    record.remove.every((tag) => typeof tag === "string")
  );
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function currentValue(correction: BrandCorrection): unknown {
  const enriched = correction as CorrectionWithCurrentValue;
  return enriched.currentValue !== undefined
    ? enriched.currentValue
    : correction.previousValue;
}

function tagDeltaState(correction: BrandCorrection): TagDeltaState | null {
  if (
    correction.field !== "product_tags" ||
    !isTagDelta(correction.proposedValue)
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
  field: BrandCorrection["field"],
  value: unknown,
  locale: string,
  unavailableLabel: string,
): string {
  if (field === "price_range") {
    return typeof value === "number" && Number.isInteger(value) && value > 0
      ? "$".repeat(value)
      : unavailableLabel;
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
  }).format(new Date(date));
}

export function CorrectionsQueue({
  corrections,
  reviewAction,
}: {
  corrections: BrandCorrection[];
  reviewAction?: ReviewAction;
}) {
  const t = useTranslations("admin.corrections");
  const locale = useLocale();
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [reviewerNotes, setReviewerNotes] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const pendingCorrections = corrections.filter(
    (item) => item.status === "pending",
  );

  function handleRowClick(id: string) {
    setExpandedId((current) => (current === id ? null : id));
    setReviewerNotes("");
    setError(null);
  }

  function renderCurrentValue(item: BrandCorrection): ReactNode {
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

  function renderProposedValue(item: BrandCorrection): ReactNode {
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

  function handleReview(item: BrandCorrection, decision: CorrectionDecision) {
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

  if (pendingCorrections.length === 0) {
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
          {pendingCorrections.map((item) => {
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
