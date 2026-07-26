"use client";

import { useId, useState, useTransition, type FormEvent } from "react";
import { useLocale, useTranslations } from "next-intl";
import { toast } from "sonner";

import { submitCorrectionAction } from "@/lib/actions/brand-corrections";
import { trackCorrectionSubmitted } from "@/lib/analytics";
import type { CorrectionField } from "@/lib/services/brand-corrections";
import { MAX_PRODUCT_TAGS } from "@/lib/services/product-tags";
import {
  categoryLabel,
  PRODUCT_SUBCATEGORIES,
  PRODUCT_TYPE_CATEGORIES,
  subcategoryLabel,
} from "@/lib/taxonomy/ontology";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import {
  Sheet,
  SheetContent,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { SubmitButton } from "@/components/ui/submit-button";

const PRICE_OPTIONS = [
  { value: "1", prefix: "$", labelKey: "fieldPriceRangeBudget" },
  { value: "2", prefix: "$$", labelKey: "fieldPriceRangeMidRange" },
  { value: "3", prefix: "$$$", labelKey: "fieldPriceRangePremium" },
] as const;

const CORRECTION_ERROR_KEYS = {
  invalid_brand: "errors.invalid_brand",
  invalid_value: "errors.invalid_value",
  too_many_tags: "errors.too_many_tags",
  unchanged: "errors.unchanged",
  already_submitted: "errors.already_submitted",
  rate_limited: "errors.rate_limited",
  unavailable: "errors.unavailable",
} as const;

export type CorrectionSheetValue = number | string | string[] | null;

export type CorrectionSheetProps = {
  brandId: string;
  brandSlug: string;
  field: CorrectionField;
  currentValue: CorrectionSheetValue;
  categorySlug?: string;
};

function initialSelection(
  field: CorrectionField,
  currentValue: CorrectionSheetValue,
): string {
  if (field === "price_range" && typeof currentValue === "number") {
    return String(currentValue);
  }
  if (field === "product_type" && typeof currentValue === "string") {
    return currentValue;
  }
  return "";
}

function initialTagSelection(currentValue: CorrectionSheetValue): string[] {
  return Array.isArray(currentValue) ? currentValue : [];
}

function sameTagSet(left: string[], right: string[]): boolean {
  if (left.length !== right.length) return false;
  const rightSet = new Set(right);
  return left.every((tag) => rightSet.has(tag));
}

function buildTagDelta(initialTags: string[], selectedTags: string[]) {
  const initialSet = new Set(initialTags);
  const selectedSet = new Set(selectedTags);

  return {
    add: selectedTags.filter((tag) => !initialSet.has(tag)),
    remove: initialTags.filter((tag) => !selectedSet.has(tag)),
  };
}

export function CorrectionSheet({
  brandId,
  brandSlug,
  field,
  currentValue,
  categorySlug,
}: CorrectionSheetProps) {
  const locale = useLocale();
  const tBrandDetail = useTranslations("brandDetail");
  const tEdit = useTranslations("dashboard.edit");
  const tCorrection = useTranslations("brandDetail.correction");
  const selectId = useId();
  const originalSelection = initialSelection(field, currentValue);
  const [initialTags] = useState(() => initialTagSelection(currentValue));
  const [selectedTags, setSelectedTags] = useState(initialTags);
  const selectionKey = `${field}:${originalSelection}`;
  const [selectionState, setSelectionState] = useState({
    key: selectionKey,
    value: originalSelection,
  });
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const selection =
    selectionState.key === selectionKey
      ? selectionState.value
      : originalSelection;

  const isSupportedField = field === "price_range" || field === "product_type";
  const hasChanged =
    field === "product_tags"
      ? !sameTagSet(initialTags, selectedTags)
      : isSupportedField && selection !== "" && selection !== originalSelection;
  const productTagsCategory = PRODUCT_TYPE_CATEGORIES.find(
    (category) => category.slug === categorySlug,
  );
  const productTagsCategoryLabel = productTagsCategory
    ? categoryLabel(productTagsCategory, locale)
    : categorySlug ?? "";
  const productSubcategories = PRODUCT_SUBCATEGORIES.filter(
    (subcategory) => subcategory.category === categorySlug,
  );
  const placeholderOption = originalSelection === "" && (
    <option value="" disabled>
      {tCorrection("selectPlaceholder")}
    </option>
  );
  const title =
    field === "product_tags"
      ? tCorrection("productTagsTitle")
      : field === "product_type"
        ? tEdit("fieldCategory")
        : tEdit("fieldPriceRange");
  const fieldLabel =
    field === "product_type"
      ? tBrandDetail("label.category")
      : field === "price_range"
        ? tBrandDetail("label.priceRange")
        : tBrandDetail("label.productCategories");

  function toggleTag(tag: string, checked: boolean) {
    setSelectedTags((current) => {
      if (!checked) return current.filter((item) => item !== tag);
      if (current.includes(tag) || current.length >= MAX_PRODUCT_TAGS) {
        return current;
      }
      return [...current, tag];
    });
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!hasChanged || isPending) return;

    const proposedValue =
      field === "price_range"
        ? Number(selection)
        : field === "product_type"
          ? selection
          : buildTagDelta(initialTags, selectedTags);
    startTransition(async () => {
      try {
        const result = await submitCorrectionAction({
          brandId,
          field,
          proposedValue,
        });

        if (result.ok) {
          trackCorrectionSubmitted(brandId, brandSlug, field);
          toast.success(tCorrection("success"));
          setOpen(false);
          return;
        }

        toast.error(tCorrection(CORRECTION_ERROR_KEYS[result.error]));
      } catch {
        toast.error(tCorrection(CORRECTION_ERROR_KEYS.unavailable));
      }
    });
  }

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger
        render={
          <Button
            type="button"
            variant="ghost"
            size="compact"
            aria-label={tCorrection("triggerLabel", { field: fieldLabel })}
            className="min-h-12 type-metadata text-muted-foreground focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-primary"
          />
        }
      >
        {tCorrection("trigger")}
      </SheetTrigger>
      <SheetContent
        side="bottom"
        className="max-h-dvh overflow-y-auto border-border bg-card shadow-none sm:mx-auto sm:max-w-xl"
      >
        <SheetHeader className="border-b border-border bg-card pr-16">
          <SheetTitle>{title}</SheetTitle>
          {field === "product_tags" && (
            <p className="type-caption">
              {tCorrection("productTagsSubtitle", {
                category: productTagsCategoryLabel,
              })}
            </p>
          )}
        </SheetHeader>

        <form className="flex flex-col" onSubmit={handleSubmit}>
          {field === "price_range" && (
            <div className="space-y-2 p-4">
              <Label htmlFor={selectId}>{title}</Label>
              <NativeSelect
                id={selectId}
                aria-label={title}
                value={selection}
                onChange={(event) =>
                  setSelectionState({
                    key: selectionKey,
                    value: event.target.value,
                  })
                }
                className="bg-card focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-primary"
              >
                {placeholderOption}
                {PRICE_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.prefix} · {tEdit(option.labelKey)}
                  </option>
                ))}
              </NativeSelect>
            </div>
          )}

          {field === "product_type" && (
            <div className="space-y-2 p-4">
              <Label htmlFor={selectId}>{title}</Label>
              <NativeSelect
                id={selectId}
                aria-label={title}
                value={selection}
                onChange={(event) =>
                  setSelectionState({
                    key: selectionKey,
                    value: event.target.value,
                  })
                }
                className="bg-card focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-primary"
              >
                {placeholderOption}
                {PRODUCT_TYPE_CATEGORIES.map((item) => (
                  <option key={item.slug} value={item.slug}>
                    {categoryLabel(item, locale)}
                  </option>
                ))}
              </NativeSelect>
            </div>
          )}

          {field === "product_tags" && (
            <div className="space-y-3 p-4">
              <div className="flex items-center justify-end">
                <span className="type-caption tabular-nums" aria-live="polite">
                  {tCorrection("productTagsSelected", {
                    count: selectedTags.length,
                  })}
                </span>
              </div>
              {selectedTags.length >= MAX_PRODUCT_TAGS && (
                <p className="rounded-md bg-secondary px-3 py-2 type-caption">
                  {tCorrection("productTagsLimit")}
                </p>
              )}
              <div className="max-h-72 overflow-y-auto rounded-md border border-border bg-card">
                {productSubcategories.map((subcategory) => {
                  const label = subcategoryLabel(subcategory, locale);
                  const checked = selectedTags.includes(subcategory.nameZh);
                  const disabled =
                    !checked && selectedTags.length >= MAX_PRODUCT_TAGS;

                  return (
                    <Label
                      key={subcategory.slug}
                      className="min-h-12 border-b border-border px-3 py-3 last:border-b-0"
                    >
                      <Checkbox
                        checked={checked}
                        disabled={disabled}
                        onCheckedChange={(value) =>
                          toggleTag(subcategory.nameZh, value)
                        }
                        className="size-5 shrink-0 focus-visible:ring-2 focus-visible:ring-primary"
                        data-ph-no-autocapture
                      />
                      <span>{label}</span>
                    </Label>
                  );
                })}
              </div>
            </div>
          )}

          <SheetFooter className="gap-3 border-t border-border bg-card sm:flex-row sm:items-center sm:justify-between">
            <p className="type-caption sm:max-w-xs">
              {tCorrection("description")}
            </p>
            <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row">
              <Button
                type="button"
                variant="secondary"
                onClick={() => setOpen(false)}
                className="focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-primary sm:w-auto"
              >
                {tEdit("cancel")}
              </Button>
              <SubmitButton
                isSubmitting={isPending}
                idleLabel={tCorrection("submit")}
                submittingLabel={tCorrection("submitting")}
                disabled={!hasChanged || isPending}
                className="focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-primary sm:w-auto"
                data-ph-no-autocapture
              />
            </div>
          </SheetFooter>
        </form>
      </SheetContent>
    </Sheet>
  );
}
