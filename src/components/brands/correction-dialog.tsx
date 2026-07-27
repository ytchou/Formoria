"use client";

import { useId, useState, useTransition, type FormEvent } from "react";
import { useLocale, useTranslations } from "next-intl";
import { X } from "lucide-react";
import { toast } from "sonner";

import { submitCorrectionAction } from "@/lib/actions/brand-corrections";
import { trackCorrectionSubmitted } from "@/lib/analytics";
import { PRICE_RANGE_TIERS } from "@/lib/brands/price-range";
import type { CorrectionField } from "@/lib/services/brand-corrections";
import { MAX_PRODUCT_TAGS, sameTagSet } from "@/lib/services/product-tags";
import {
  categoryLabel,
  matchSubcategory,
  PRODUCT_SUBCATEGORIES,
  PRODUCT_TYPE_CATEGORIES,
  subcategoryLabel,
} from "@/lib/taxonomy/ontology";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { SubmitButton } from "@/components/ui/submit-button";

const CORRECTION_ERROR_KEYS = {
  invalid_brand: "errors.invalid_brand",
  invalid_value: "errors.invalid_value",
  too_many_tags: "errors.too_many_tags",
  unchanged: "errors.unchanged",
  already_submitted: "errors.already_submitted",
  rate_limited: "errors.rate_limited",
  unavailable: "errors.unavailable",
} as const;

export type CorrectionDialogValue = number | string | string[] | null;

export type CorrectionDialogProps = {
  brandId: string;
  brandSlug: string;
  productType: string | null;
  priceRange: number | null;
  productTags: string[];
};

function initialSelection(
  field: CorrectionField | "",
  currentValue: CorrectionDialogValue,
): string {
  if (field === "price_range" && typeof currentValue === "number") {
    return String(currentValue);
  }
  if (field === "product_type" && typeof currentValue === "string") {
    return currentValue;
  }
  return "";
}

function initialTagSelection(currentValue: CorrectionDialogValue): string[] {
  return Array.isArray(currentValue) ? currentValue : [];
}

function buildTagDelta(initialTags: string[], selectedTags: string[]) {
  const initialSet = new Set(initialTags);
  const selectedSet = new Set(selectedTags);

  return {
    add: selectedTags.filter((tag) => !initialSet.has(tag)),
    remove: initialTags.filter((tag) => !selectedSet.has(tag)),
  };
}

export function CorrectionDialog({
  brandId,
  brandSlug,
  productType,
  priceRange,
  productTags,
}: CorrectionDialogProps) {
  const locale = useLocale();
  const tBrandDetail = useTranslations("brandDetail");
  const tEdit = useTranslations("dashboard.edit");
  const tCorrection = useTranslations("brandDetail.correction");
  const selectId = useId();
  const fieldSelectId = useId();
  // Starts empty so the dialog opens on the picker alone — no value control is
  // shown until the contributor says what they are correcting.
  const [field, setField] = useState<CorrectionField | "">("");
  // Listed in page order. product_tags needs a category to enumerate
  // subcategories from, so it is only offered once the brand has one.
  const availableFields: CorrectionField[] =
    productType != null
      ? ["product_type", "price_range", "product_tags"]
      : ["product_type", "price_range"];
  const currentValue: CorrectionDialogValue =
    field === "product_type"
      ? productType
      : field === "price_range"
        ? priceRange
        : field === "product_tags"
          ? productTags
          : null;
  const originalSelection = initialSelection(field, currentValue);
  const originalTags = initialTagSelection(currentValue);
  // Both branches share one reset key so a changed `currentValue` re-baselines
  // the scalar select and the tag checkboxes alike.
  const selectionKey = `${field}:${originalSelection}:${originalTags.join("\u0000")}`;
  const baseline = {
    key: selectionKey,
    value: originalSelection,
    tags: originalTags,
  };
  const [selectionState, setSelectionState] = useState(baseline);
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const active = selectionState.key === selectionKey ? selectionState : baseline;
  const selection = active.value;
  const selectedTags = active.tags;

  const hasChanged =
    field === ""
      ? false
      : field === "product_tags"
        ? !sameTagSet(originalTags, selectedTags)
        : selection !== "" && selection !== originalSelection;
  const productTagsCategory = PRODUCT_TYPE_CATEGORIES.find(
    (category) => category.slug === productType,
  );
  const productTagsCategoryLabel = productTagsCategory
    ? categoryLabel(productTagsCategory, locale)
    : productType ?? "";
  const productSubcategories = PRODUCT_SUBCATEGORIES.filter(
    (subcategory) => subcategory.category === productType,
  );
  const inCategoryTagNames = new Set(
    productSubcategories.map((subcategory) => subcategory.nameZh),
  );
  // Tags the brand already carries that live outside its current category —
  // they consume the cap, so they must stay visible and removable.
  const otherCategoryTags = Array.from(new Set(originalTags))
    .filter((tag) => !inCategoryTagNames.has(tag))
    .map((tag) => {
      const subcategory = matchSubcategory(tag);
      return {
        tag,
        label: subcategory ? subcategoryLabel(subcategory, locale) : tag,
      };
    });
  const placeholderOption = originalSelection === "" && (
    <option value="" disabled>
      {tCorrection("selectPlaceholder")}
    </option>
  );
  const labelForField = (item: CorrectionField) =>
    item === "product_type"
      ? tBrandDetail("label.category")
      : item === "price_range"
        ? tBrandDetail("label.priceRange")
        : tBrandDetail("label.productCategories");
  // Only read inside the value branches, which never render while field is "".
  const fieldLabel = field === "" ? "" : labelForField(field);

  function handleOpenChange(next: boolean) {
    setOpen(next);
    // Every open starts at the picker, not at whatever was picked last time.
    if (!next) setField("");
  }

  function toggleTag(tag: string, checked: boolean) {
    setSelectionState((current) => {
      const base = current.key === selectionKey ? current : baseline;
      if (!checked) {
        return {
          key: selectionKey,
          value: base.value,
          tags: base.tags.filter((item) => item !== tag),
        };
      }
      if (base.tags.includes(tag) || base.tags.length >= MAX_PRODUCT_TAGS) {
        return base;
      }
      return {
        key: selectionKey,
        value: base.value,
        tags: [...base.tags, tag],
      };
    });
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (field === "" || !hasChanged || isPending) return;

    const proposedValue =
      field === "price_range"
        ? Number(selection)
        : field === "product_type"
          ? selection
          : buildTagDelta(originalTags, selectedTags);
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
          // The correction is only pending — the brand still holds the old
          // value, so re-baseline instead of leaving the proposal on screen.
          setSelectionState({
            key: selectionKey,
            value: originalSelection,
            tags: originalTags,
          });
          handleOpenChange(false);
          return;
        }

        toast.error(tCorrection(CORRECTION_ERROR_KEYS[result.error]));
      } catch {
        toast.error(tCorrection(CORRECTION_ERROR_KEYS.unavailable));
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger
        render={
          <Button
            type="button"
            variant="ghost"
            size="compact"
            aria-label={tCorrection("title")}
            className="min-h-10 type-metadata text-muted-foreground focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-primary"
          />
        }
      >
        {tCorrection("trigger")}
      </DialogTrigger>
      <DialogContent
        showCloseButton={false}
        className="max-h-[calc(100dvh-2rem)] grid-rows-[auto_minmax(0,1fr)] gap-0 overflow-hidden p-0 sm:max-w-lg"
      >
        <DialogClose
          render={
            <Button
              variant="ghost"
              size="icon"
              className="absolute top-3 right-3 z-10 sm:top-4 sm:right-4"
              aria-label={tCorrection("close")}
            />
          }
        >
          <X className="size-4" aria-hidden="true" />
        </DialogClose>

        <DialogHeader className="gap-0.5 border-b border-border p-4 pr-14 sm:pr-16">
          <DialogTitle>{tCorrection("title")}</DialogTitle>
          {field === "product_tags" && (
            <p className="type-caption">
              {tCorrection("productTagsSubtitle", {
                category: productTagsCategoryLabel,
              })}
            </p>
          )}
        </DialogHeader>

        <form
          className="flex min-h-0 flex-col overflow-hidden"
          onSubmit={handleSubmit}
        >
          <div className="min-h-0 flex-1 overflow-y-auto">
            <div className="space-y-2 border-b border-border p-4">
              <Label htmlFor={fieldSelectId}>
                {tCorrection("fieldPickerLabel")}
              </Label>
              <NativeSelect
                id={fieldSelectId}
                aria-label={tCorrection("fieldPickerLabel")}
                value={field}
                onChange={(event) =>
                  // Matching against the offered fields keeps the union honest
                  // without a cast; anything else falls back to the placeholder.
                  setField(
                    availableFields.find(
                      (item) => item === event.target.value,
                    ) ?? "",
                  )
                }
                className="bg-card focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-primary"
              >
                {field === "" && (
                  <option value="" disabled>
                    {tCorrection("fieldPickerPlaceholder")}
                  </option>
                )}
                {availableFields.map((item) => (
                  <option key={item} value={item}>
                    {labelForField(item)}
                  </option>
                ))}
              </NativeSelect>
            </div>

            {field === "price_range" && (
              <div className="space-y-2 p-4">
                <Label htmlFor={selectId}>{fieldLabel}</Label>
                <NativeSelect
                  id={selectId}
                  aria-label={fieldLabel}
                  value={selection}
                  onChange={(event) =>
                    setSelectionState({
                      key: selectionKey,
                      value: event.target.value,
                      tags: selectedTags,
                    })
                  }
                  className="bg-card focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-primary"
                >
                  {placeholderOption}
                  {PRICE_RANGE_TIERS.map((tier) => (
                    <option key={tier.value} value={String(tier.value)}>
                      {tier.prefix} · {tEdit(tier.labelKey)}
                    </option>
                  ))}
                </NativeSelect>
              </div>
            )}

            {field === "product_type" && (
              <div className="space-y-2 p-4">
                <Label htmlFor={selectId}>{fieldLabel}</Label>
                <NativeSelect
                  id={selectId}
                  aria-label={fieldLabel}
                  value={selection}
                  onChange={(event) =>
                    setSelectionState({
                      key: selectionKey,
                      value: event.target.value,
                      tags: selectedTags,
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
                <div className="rounded-md border border-border bg-card">
                  {otherCategoryTags.length > 0 && (
                    <div className="border-b border-border bg-secondary">
                      <p className="px-3 pt-3 type-metadata">
                        {tCorrection("productTagsOtherCategory")}
                      </p>
                      {otherCategoryTags.map(({ tag, label }) => {
                        const checked = selectedTags.includes(tag);
                        const disabled =
                          !checked && selectedTags.length >= MAX_PRODUCT_TAGS;

                        return (
                          <Label key={tag} className="min-h-12 px-3 py-3">
                            <Checkbox
                              checked={checked}
                              disabled={disabled}
                              onCheckedChange={(value) => toggleTag(tag, value)}
                              className="size-5 shrink-0 focus-visible:ring-2 focus-visible:ring-primary"
                              data-ph-no-autocapture
                            />
                            <span>{label}</span>
                          </Label>
                        );
                      })}
                    </div>
                  )}
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
          </div>

          <DialogFooter className="mx-0 mb-0 flex-col gap-3 rounded-b-xl bg-background px-4 py-4 sm:flex-row sm:items-center sm:justify-between">
            <p className="type-caption sm:max-w-xs">
              {tCorrection("description")}
            </p>
            <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row">
              <DialogClose
                render={
                  <Button
                    type="button"
                    variant="secondary"
                    className="focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-primary sm:w-auto"
                  />
                }
              >
                {tEdit("cancel")}
              </DialogClose>
              <SubmitButton
                isSubmitting={isPending}
                idleLabel={tCorrection("submit")}
                submittingLabel={tCorrection("submitting")}
                disabled={!hasChanged || isPending}
                className="focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-primary sm:w-auto"
                data-ph-no-autocapture
              />
            </div>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
