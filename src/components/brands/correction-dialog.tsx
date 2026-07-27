"use client";

import {
  useEffect,
  useId,
  useRef,
  useState,
  useTransition,
  type FormEvent,
  type ReactNode,
} from "react";
import { useLocale, useTranslations } from "next-intl";
import { Plus, RotateCcw, X } from "lucide-react";
import { toast } from "sonner";

import { submitCorrectionAction } from "@/lib/actions/brand-corrections";
import { trackCorrectionSubmitted } from "@/lib/analytics";
import { PRICE_RANGE_TIERS } from "@/lib/brands/price-range";
import type { CorrectionField } from "@/lib/services/brand-corrections";
import {
  MAX_PRODUCT_TAGS,
  resolveProductTagInput,
  sameTagSet,
} from "@/lib/services/product-tags";
import {
  categoryLabel,
  matchSubcategory,
  PRODUCT_SUBCATEGORIES,
  PRODUCT_TYPE_CATEGORIES,
  subcategoryLabel,
} from "@/lib/taxonomy/ontology";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { ToggleChip } from "@/components/ui/toggle-chip";
import { Typography } from "@/components/ui/typography";
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

export type CorrectionDialogProps = {
  brandId: string;
  brandSlug: string;
  productType: string | null;
  priceRange: number | null;
  productTags: string[];
};

type SelectionState = {
  key: string;
  value: string;
  tags: string[];
  // Tags resolved through the free-text ("other") escape hatch that row 2 does
  // not already offer — kept so the chip stays visible after it is toggled off.
  extras: string[];
};

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
  const baseId = useId();
  const fieldSelectId = useId();
  const currentHeadingId = `${baseId}-current`;
  const optionsHeadingId = `${baseId}-options`;
  const otherInputId = `${baseId}-other`;
  const otherHintId = `${baseId}-other-hint`;
  const otherMessageId = `${baseId}-other-message`;
  const otherChipRef = useRef<HTMLButtonElement>(null);
  const otherInputRef = useRef<HTMLInputElement>(null);
  const addTagsGroupRef = useRef<HTMLDivElement>(null);
  // Starts empty so the dialog opens on the picker alone — no value control is
  // shown until the contributor says what they are correcting.
  const [field, setField] = useState<CorrectionField | "">("");
  // Listed in page order. product_tags needs a category to enumerate
  // subcategories from, so it is only offered once the brand has one.
  const availableFields: CorrectionField[] =
    productType != null
      ? ["product_type", "price_range", "product_tags"]
      : ["product_type", "price_range"];
  const originalSelection =
    field === "product_type"
      ? (productType ?? "")
      : field === "price_range" && priceRange != null
        ? String(priceRange)
        : "";
  // `brands.product_tags` is a bare text[] with no unique constraint, so a
  // legacy row can carry the same tag twice. De-duplicating once here keeps the
  // counter, the 5-tag cap and the row-1 chips reading the same list.
  const originalTags =
    field === "product_tags" ? Array.from(new Set(productTags)) : [];
  // Both branches share one reset key so a changed `currentValue` re-baselines
  // the scalar chips and the tag chips alike.
  const selectionKey = `${field}:${originalSelection}:${originalTags.join("\u0000")}`;
  const baseline: SelectionState = {
    key: selectionKey,
    value: originalSelection,
    tags: originalTags,
    extras: [],
  };
  const [selectionState, setSelectionState] = useState(baseline);
  const [open, setOpen] = useState(false);
  const [otherOpen, setOtherOpen] = useState(false);
  const [otherValue, setOtherValue] = useState("");
  const [otherMessage, setOtherMessage] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const active =
    selectionState.key === selectionKey ? selectionState : baseline;
  const selection = active.value;
  const selectedTags = active.tags;
  const extraTags = active.extras;
  const atTagLimit = selectedTags.length >= MAX_PRODUCT_TAGS;

  useEffect(() => {
    if (otherOpen) otherInputRef.current?.focus();
  }, [otherOpen]);

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
    : (productType ?? "");
  const productSubcategories = PRODUCT_SUBCATEGORIES.filter(
    (subcategory) => subcategory.category === productType,
  );
  // Stored tags are not guaranteed canonical: the owner edit path only trims
  // and de-dupes, so a brand can hold an alias of a subcategory. Comparing on a
  // canonical basis is what stops a visitor adding the canonical twin of a tag
  // the brand already carries.
  const canonicalTag = (tag: string) => matchSubcategory(tag)?.nameZh ?? tag;
  const currentTagSet = new Set(originalTags.map(canonicalTag));
  // Row 2 offers only what the brand does not already carry — row 1 owns the
  // rest, in-category or not.
  const offeredSubcategories = productSubcategories.filter(
    (subcategory) => !currentTagSet.has(subcategory.nameZh),
  );
  const offeredTagNames = new Set(
    offeredSubcategories.map((subcategory) => subcategory.nameZh),
  );
  const tagLabel = (tag: string) => {
    const subcategory = matchSubcategory(tag);
    return subcategory ? subcategoryLabel(subcategory, locale) : tag;
  };
  // Row 2 renders in one pass: the in-category subcategories the brand does not
  // hold, then anything the free-text escape hatch resolved that row 2 did not
  // offer.
  const addableTags = [
    ...offeredSubcategories.map((subcategory) => ({
      key: subcategory.slug,
      tag: subcategory.nameZh,
      label: subcategoryLabel(subcategory, locale),
    })),
    ...extraTags.map((tag) => ({ key: tag, tag, label: tagLabel(tag) })),
  ];
  const labelForField = (item: CorrectionField) =>
    item === "product_type"
      ? tBrandDetail("label.category")
      : item === "price_range"
        ? tBrandDetail("label.priceRange")
        : tBrandDetail("label.productCategories");
  // Only read inside the value branches, which never render while field is "".
  const fieldLabel = field === "" ? "" : labelForField(field);

  function resetOtherEntry() {
    setOtherOpen(false);
    setOtherValue("");
    setOtherMessage(null);
  }

  function handleOpenChange(next: boolean) {
    setOpen(next);
    resetOtherEntry();
    // Every open starts at the picker, not at whatever was picked last time.
    if (!next) setField("");
  }

  function updateSelection(update: (base: SelectionState) => SelectionState) {
    setSelectionState((current) =>
      update(current.key === selectionKey ? current : baseline),
    );
  }

  function selectScalar(value: string) {
    updateSelection((base) => ({
      ...base,
      key: selectionKey,
      // Re-clicking the chosen chip returns to the baseline, which re-disables
      // submit — row 2 never offers the current value to click back to.
      value: base.value === value ? "" : value,
    }));
  }

  function toggleTag(tag: string, checked: boolean) {
    updateSelection((base) => {
      if (!checked) {
        return {
          ...base,
          key: selectionKey,
          tags: base.tags.filter((item) => item !== tag),
        };
      }
      if (base.tags.includes(tag) || base.tags.length >= MAX_PRODUCT_TAGS) {
        return { ...base, key: selectionKey };
      }
      return { ...base, key: selectionKey, tags: [...base.tags, tag] };
    });
  }

  function appendExtraTag(tag: string) {
    updateSelection((base) => {
      if (base.tags.length >= MAX_PRODUCT_TAGS) {
        return { ...base, key: selectionKey };
      }
      return {
        key: selectionKey,
        value: base.value,
        tags: base.tags.includes(tag) ? base.tags : [...base.tags, tag],
        extras: base.extras.includes(tag) ? base.extras : [...base.extras, tag],
      };
    });
  }

  function closeOtherEntry(atLimitAfter = false) {
    resetOtherEntry();
    // The escape-hatch chip renders `disabled` at the cap. focus() here runs
    // before React commits that attribute, and a focused element that becomes
    // disabled drops focus to <body> — so when this confirmation fills the last
    // slot, focus goes to the row that now owns the selection instead.
    if (atLimitAfter) addTagsGroupRef.current?.focus();
    else otherChipRef.current?.focus();
  }

  function confirmOtherTag() {
    const result = resolveProductTagInput(otherValue);
    if (!result.ok) {
      setOtherMessage(
        result.reason === "length"
          ? tCorrection("errors.tagLength")
          : tCorrection("errors.tagBlocked"),
      );
      return;
    }
    if (currentTagSet.has(result.tag)) {
      setOtherMessage(tCorrection("otherTagDuplicate"));
      return;
    }
    const alreadySelected = selectedTags.includes(result.tag);
    // Disabling the escape-hatch chip at the cap does not unmount an entry
    // panel opened below the cap, so the cap has to be stated here too — both
    // add paths no-op silently and the tag would vanish without a word.
    if (!alreadySelected && atTagLimit) {
      setOtherMessage(tCorrection("productTagsLimit"));
      return;
    }
    if (offeredTagNames.has(result.tag)) {
      // Already on screen in row 2 — select it instead of adding a twin.
      toggleTag(result.tag, true);
    } else {
      appendExtraTag(result.tag);
    }
    const nextCount = alreadySelected
      ? selectedTags.length
      : selectedTags.length + 1;
    closeOtherEntry(nextCount >= MAX_PRODUCT_TAGS);
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
            extras: [],
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

  function scalarRows(
    currentLabel: string | null,
    options: { key: string; value: string; label: string }[],
  ): ReactNode {
    return (
      <div className="space-y-4 p-4">
        <div
          role="group"
          aria-labelledby={currentHeadingId}
          className="space-y-2"
        >
          <Typography id={currentHeadingId} variant="subsectionTitle">
            {tCorrection("currentHeading")}
          </Typography>
          <div className="flex flex-wrap gap-2">
            <Badge variant="secondary" className="h-8 px-3.5">
              {currentLabel ?? tCorrection("selectPlaceholder")}
            </Badge>
          </div>
        </div>

        {/*
          The visible heading says what the row is for ("change to"), which is
          what makes the dialog read as a diff. The accessible name stays the
          field label so the group is still addressable by the field it edits.
          aria-label rather than aria-labelledby: aria-labelledby wins
          precedence and would drag the visible copy back into the name.
        */}
        <div role="group" aria-label={fieldLabel} className="space-y-2">
          <Typography variant="subsectionTitle">
            {tCorrection("changeToHeading")}
          </Typography>
          <div className="flex flex-wrap gap-2">
            {options.map((option) => (
              <ToggleChip
                key={option.key}
                size="chip"
                pressed={selection === option.value}
                onPressedChange={() => selectScalar(option.value)}
                data-ph-no-autocapture
              >
                {option.label}
              </ToggleChip>
            ))}
          </div>
        </div>
      </div>
    );
  }

  const currentPriceTier = PRICE_RANGE_TIERS.find(
    (tier) => String(tier.value) === originalSelection,
  );
  const currentCategory = PRODUCT_TYPE_CATEGORIES.find(
    (item) => item.slug === originalSelection,
  );

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger
        render={
          <Button
            type="button"
            variant="ghost"
            size="compact"
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
                onChange={(event) => {
                  // Matching against the offered fields keeps the union honest
                  // without a cast; anything else falls back to the placeholder.
                  setField(
                    availableFields.find(
                      (item) => item === event.target.value,
                    ) ?? "",
                  );
                  resetOtherEntry();
                }}
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

            {field === "price_range" &&
              scalarRows(
                currentPriceTier
                  ? `${currentPriceTier.prefix} · ${tEdit(currentPriceTier.labelKey)}`
                  : null,
                PRICE_RANGE_TIERS.filter(
                  (tier) => String(tier.value) !== originalSelection,
                ).map((tier) => ({
                  key: String(tier.value),
                  value: String(tier.value),
                  label: `${tier.prefix} · ${tEdit(tier.labelKey)}`,
                })),
              )}

            {field === "product_type" &&
              scalarRows(
                currentCategory ? categoryLabel(currentCategory, locale) : null,
                PRODUCT_TYPE_CATEGORIES.filter(
                  (item) => item.slug !== originalSelection,
                ).map((item) => ({
                  key: item.slug,
                  value: item.slug,
                  label: categoryLabel(item, locale),
                })),
              )}

            {field === "product_tags" && (
              <div className="space-y-4 p-4">
                <div className="flex items-center justify-end">
                  <span
                    className="type-caption tabular-nums"
                    aria-live="polite"
                  >
                    {tCorrection("productTagsSelected", {
                      count: selectedTags.length,
                    })}
                  </span>
                </div>
                {atTagLimit && (
                  <p
                    className="rounded-md bg-secondary px-3 py-2 type-caption"
                    aria-live="polite"
                  >
                    {tCorrection("productTagsLimit")}
                  </p>
                )}

                <div
                  role="group"
                  aria-labelledby={currentHeadingId}
                  className="space-y-2"
                >
                  <Typography id={currentHeadingId} variant="subsectionTitle">
                    {tCorrection("currentTagsHeading")}
                  </Typography>
                  {originalTags.length === 0 ? (
                    <p className="type-caption">
                      {tCorrection("selectPlaceholder")}
                    </p>
                  ) : (
                    <div className="flex flex-wrap gap-2">
                      {originalTags.map((tag) => {
                        const kept = selectedTags.includes(tag);
                        const Icon = kept ? X : RotateCcw;

                        return (
                          <ToggleChip
                            key={tag}
                            size="chip"
                            tone="reference"
                            pressed={kept}
                            // Restoring a removed tag is an add, and adds no-op
                            // at the cap — without this the chip would be a
                            // dead control that never flips back.
                            disabled={!kept && atTagLimit}
                            onPressedChange={(next) => toggleTag(tag, next)}
                            data-ph-no-autocapture
                          >
                            {tagLabel(tag)}
                            <Icon aria-hidden="true" />
                          </ToggleChip>
                        );
                      })}
                    </div>
                  )}
                </div>

                <div
                  ref={addTagsGroupRef}
                  role="group"
                  // Programmatic focus target only — see closeOtherEntry.
                  tabIndex={-1}
                  aria-labelledby={optionsHeadingId}
                  className="space-y-2 outline-none"
                >
                  <Typography id={optionsHeadingId} variant="subsectionTitle">
                    {tCorrection("addTagsHeading")}
                  </Typography>
                  <div className="flex flex-wrap gap-2">
                    {addableTags.map((option) => {
                      const pressed = selectedTags.includes(option.tag);

                      return (
                        <ToggleChip
                          key={option.key}
                          size="chip"
                          pressed={pressed}
                          disabled={!pressed && atTagLimit}
                          onPressedChange={(next) =>
                            toggleTag(option.tag, next)
                          }
                          data-ph-no-autocapture
                        >
                          {option.label}
                        </ToggleChip>
                      );
                    })}
                    <Button
                      ref={otherChipRef}
                      type="button"
                      variant="secondary"
                      shape="pill"
                      size="chip"
                      disabled={atTagLimit}
                      aria-expanded={otherOpen}
                      onClick={() => {
                        setOtherMessage(null);
                        setOtherOpen(true);
                      }}
                      className="text-muted-foreground"
                      data-ph-no-autocapture
                    >
                      <Plus aria-hidden="true" />
                      {tCorrection("otherTagChip")}
                    </Button>
                  </div>

                  {otherOpen && (
                    <div className="space-y-2 rounded-lg border border-border p-3">
                      <Label htmlFor={otherInputId}>
                        {tCorrection("otherTagInputLabel")}
                      </Label>
                      <Input
                        id={otherInputId}
                        ref={otherInputRef}
                        value={otherValue}
                        aria-describedby={
                          otherMessage
                            ? `${otherHintId} ${otherMessageId}`
                            : otherHintId
                        }
                        aria-invalid={otherMessage ? true : undefined}
                        onChange={(event) => {
                          setOtherValue(event.target.value);
                          setOtherMessage(null);
                        }}
                        onKeyDown={(event) => {
                          if (event.key !== "Enter") return;
                          // The dialog form would otherwise submit the
                          // correction from inside the tag entry.
                          event.preventDefault();
                          confirmOtherTag();
                        }}
                        data-ph-no-autocapture
                      />
                      <p id={otherHintId} className="type-caption">
                        {tCorrection("otherTagHint")}
                      </p>
                      {otherMessage && (
                        <p
                          id={otherMessageId}
                          className="type-caption text-destructive"
                        >
                          {otherMessage}
                        </p>
                      )}
                      <div className="flex gap-2">
                        <Button
                          type="button"
                          onClick={confirmOtherTag}
                          className="focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-primary"
                          data-ph-no-autocapture
                        >
                          {tCorrection("otherTagConfirm")}
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          onClick={() => closeOtherEntry()}
                          className="focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-primary"
                        >
                          {tEdit("cancel")}
                        </Button>
                      </div>
                    </div>
                  )}
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
