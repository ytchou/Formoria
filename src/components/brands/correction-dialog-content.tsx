"use client";

import {
  useId,
  useState,
  useTransition,
  type FormEvent,
  type ReactNode,
} from "react";
import { useLocale, useTranslations } from "next-intl";

import { submitCorrectionAction } from "@/lib/actions/brand-corrections";
import { toast } from "sonner";

import { trackCorrectionSubmitted } from "@/lib/analytics";
import { PRICE_RANGE_TIERS } from "@/lib/brands/price-range";
import {
  onlineStoreMessageKey,
  ONLINE_STORE_COLUMNS,
  onlineStoreByColumn,
  type OnlineStoreColumn,
} from "@/lib/brands/online-stores";
import type { CorrectionField } from "@/lib/services/brand-corrections";
import {
  MAX_SUBCATEGORIES,
  sameSubcategorySet,
} from "@/lib/services/subcategories";
import { categoryLabel, L1_CATEGORIES } from "@/lib/taxonomy/ontology";
import { sanitizeHref, stripUrlQuery } from "@/lib/url";
import { SubcategoryPicker } from "@/components/forms/subcategory-picker";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { ChipRow, ToggleChip } from "@/components/ui/toggle-chip";
import { Typography } from "@/components/ui/typography";
import {
  DialogBody,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogForm,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { SubmitButton } from "@/components/ui/submit-button";

const CORRECTION_ERROR_KEYS = {
  invalid_brand: "errors.invalid_brand",
  invalid_value: "errors.invalid_value",
  too_many_subcategories: "errors.too_many_subcategories",
  unchanged: "errors.unchanged",
  already_submitted: "errors.already_submitted",
  rate_limited: "errors.rate_limited",
  unavailable: "errors.unavailable",
} as const;

/**
 * The three trigger modes. Declared here because every branch that reads it —
 * the offered field set, the value control — is in this half; the shell only
 * needs the name to key its trigger copy, and a type-only import is erased
 * before the bundler sees it, so it never pulls this chunk back in.
 */
export type CorrectionDialogMode = "brandInfo" | "purchaseLinks" | "socialLinks";

/** The message keys the shell picked for this mode, already narrowed. */
export type CorrectionDialogCopy = {
  title: string;
  fieldPickerLabel: string;
  fieldPickerPlaceholder: string;
};

export type CorrectionDialogContentProps = {
  brandId: string;
  brandSlug: string;
  mode: CorrectionDialogMode;
  copy: CorrectionDialogCopy;
  /**
   * Owned by the shell so its close handler can reset the picker without this
   * chunk having to be loaded — the same seam `report-dialog.tsx` uses for
   * `reportedField`.
   */
  field: CorrectionField | "";
  setField: (field: CorrectionField | "") => void;
  onOpenChange: (open: boolean) => void;
  categorySlug?: string | null;
  priceRange?: number | null;
  subcategories?: string[];
  purchaseLinks?: Record<OnlineStoreColumn, string | null>;
  socialInstagram?: string | null;
  socialThreads?: string | null;
  socialFacebook?: string | null;
};

type SelectionState = {
  key: string;
  value: string;
  /** Ontology slugs — the stored representation since DEV-1510. */
  subcategories: string[];
};

function buildSubcategoryDelta(initialSubcategories: string[], selectedSubcategories: string[]) {
  const initialSet = new Set(initialSubcategories);
  const selectedSet = new Set(selectedSubcategories);

  return {
    add: selectedSubcategories.filter((subcategory) => !initialSet.has(subcategory)),
    remove: initialSubcategories.filter((subcategory) => !selectedSet.has(subcategory)),
  };
}

// Split out of `correction-dialog.tsx` so the field picker, the chip rows and
// the whole L2 vocabulary only reach the browser once the trigger is primed.
export function CorrectionDialogContent({
  brandId,
  brandSlug,
  mode,
  copy,
  field,
  setField,
  onOpenChange,
  categorySlug = null,
  priceRange = null,
  subcategories = [],
  purchaseLinks = {} as Record<OnlineStoreColumn, string | null>,
  socialInstagram = null,
  socialThreads = null,
  socialFacebook = null,
}: CorrectionDialogContentProps) {
  const locale = useLocale();
  const tBrandDetail = useTranslations("brandDetail");
  const tEdit = useTranslations("dashboard.edit");
  const tCorrection = useTranslations("brandDetail.correction");
  const baseId = useId();
  const fieldSelectId = useId();
  const purchaseUrlInputId = useId();
  const currentHeadingId = `${baseId}-current`;
  const onlineStore = Object.hasOwn(onlineStoreByColumn, field)
    ? onlineStoreByColumn[field as OnlineStoreColumn]
    : undefined;
  const availableFields: CorrectionField[] =
    mode === "purchaseLinks"
      ? [...ONLINE_STORE_COLUMNS]
      : mode === "socialLinks"
        ? ["social_instagram", "social_threads", "social_facebook"]
        : categorySlug != null
          ? ["category", "price_range", "subcategories"]
          : ["category", "price_range"];
  // Every link field — purchase and social alike — is edited as a free-text URL
  // rather than a chip, so they share the baseline, diff and body branches.
  const isLinkField =
    onlineStore !== undefined ||
    field === "social_instagram" ||
    field === "social_threads" ||
    field === "social_facebook";
  const originalSelection =
    field === "category"
      ? (categorySlug ?? "")
      : field === "price_range" && priceRange != null
        ? String(priceRange)
        : onlineStore
          ? (purchaseLinks[onlineStore.column] ?? "")
          : field === "social_instagram"
            ? (socialInstagram ?? "")
            : field === "social_threads"
              ? (socialThreads ?? "")
              : field === "social_facebook"
                ? (socialFacebook ?? "")
                : "";
  // `brands.subcategories` is a bare text[] with no unique constraint, so a
  // legacy row can carry the same subcategory twice. De-duplicating once here keeps the
  // counter, the 5-subcategory cap and the row-1 chips reading the same list.
  const originalSubcategories =
    field === "subcategories" ? Array.from(new Set(subcategories)) : [];
  // Both branches share one reset key so a changed `currentValue` re-baselines
  // the scalar chips and the subcategory chips alike.
  const selectionKey = `${field}:${originalSelection}:${originalSubcategories.join("\u0000")}`;
  const baseline: SelectionState = {
    key: selectionKey,
    value: isLinkField ? "" : originalSelection,
    subcategories: originalSubcategories,
  };
  const [selectionState, setSelectionState] = useState(baseline);
  const [isPending, startTransition] = useTransition();
  const active =
    selectionState.key === selectionKey ? selectionState : baseline;
  const selection = active.value;
  const selectedSubcategories = active.subcategories;

  const hasChanged =
    field === ""
      ? false
      : field === "subcategories"
        ? !sameSubcategorySet(originalSubcategories, selectedSubcategories)
        : isLinkField
          ? selection.trim() !== "" &&
            sanitizeHref(selection) !== sanitizeHref(originalSelection)
          : selection !== "" && selection !== originalSelection;
  const labelForField = (item: CorrectionField) => {
    const channel = Object.hasOwn(onlineStoreByColumn, item)
      ? onlineStoreByColumn[item as OnlineStoreColumn]
      : undefined;
    if (channel) {
      return tBrandDetail(
        onlineStoreMessageKey(channel.messageKeys.brandDetailLink, "brandDetail"),
      );
    }
    return item === "category"
      ? tBrandDetail("label.category")
      : item === "price_range"
        ? tBrandDetail("label.priceRange")
        : item === "subcategories"
          ? tBrandDetail("label.subcategories")
          : item === "social_instagram"
            ? tBrandDetail("links.instagram")
            : item === "social_threads"
              ? tBrandDetail("links.threads")
              : tBrandDetail("links.facebook");
  };
  // Only read inside the value branches, which never render while field is "".
  const fieldLabel = field === "" ? "" : labelForField(field);

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

  function setSelectedSubcategories(next: string[]) {
    updateSelection((base) => ({
      ...base,
      key: selectionKey,
      subcategories: next,
    }));
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (field === "" || !hasChanged || isPending) return;

    const proposedValue =
      field === "price_range"
        ? Number(selection)
        : field !== "subcategories"
          ? selection
          : buildSubcategoryDelta(originalSubcategories, selectedSubcategories);
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
            value: isLinkField ? "" : originalSelection,
            subcategories: originalSubcategories,
          });
          onOpenChange(false);
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
          <ChipRow>
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
          </ChipRow>
        </div>
      </div>
    );
  }

  const currentPriceTier = PRICE_RANGE_TIERS.find(
    (tier) => String(tier.value) === originalSelection,
  );
  const currentCategory = L1_CATEGORIES.find(
    (item) => item.slug === originalSelection,
  );

  return (
    // The width is the shell's vocabulary. The 85dvh cap, the two-row grid and
    // the single scroll container all belong to `DialogContent` now — this call
    // site used to spell all three by hand, and was the prototype for them.
    <DialogContent size="form">
      <DialogHeader>
        <DialogTitle>{tCorrection(copy.title)}</DialogTitle>
        {field === "subcategories" && (
          <p className="type-metadata">{tCorrection("subcategoriesSubtitle")}</p>
        )}
      </DialogHeader>

      <DialogForm onSubmit={handleSubmit}>
        {/* `p-0`: every section below carries its own padding and its own rule,
            which is what makes the picker read as a band above the value. */}
        <DialogBody className="p-0">
          <div className="space-y-2 border-b border-rule p-4">
            <Label htmlFor={fieldSelectId}>
              {tCorrection(copy.fieldPickerLabel)}
            </Label>
            <NativeSelect
              id={fieldSelectId}
              aria-label={tCorrection(copy.fieldPickerLabel)}
              value={field}
              onChange={(event) => {
                // Matching against the offered fields keeps the union honest
                // without a cast; anything else falls back to the placeholder.
                setField(
                  availableFields.find((item) => item === event.target.value) ??
                    "",
                );
              }}
              className="bg-surface focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-accent"
            >
              {field === "" && (
                <option value="" disabled>
                  {tCorrection(copy.fieldPickerPlaceholder)}
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

          {field === "category" &&
            scalarRows(
              currentCategory ? categoryLabel(currentCategory, locale) : null,
              L1_CATEGORIES.filter(
                (item) => item.slug !== originalSelection,
              ).map((item) => ({
                key: item.slug,
                value: item.slug,
                label: categoryLabel(item, locale),
              })),
            )}

          {field === "subcategories" && (
            <div className="space-y-4 p-4">
              <div className="flex items-center justify-end">
                <span className="type-metadata tabular-nums" aria-live="polite">
                  {tCorrection("subcategoriesSelected", {
                    count: selectedSubcategories.length,
                  })}
                </span>
              </div>
              {/*
                One closed picker, shared with the owner wizard and admin
                review. The offer set is all 175 nodes, not the brand's own
                L1: a brand's products span L1s even though the brand carries
                one, and the read side stopped discarding those tags in
                DEV-1510. There is no free-text entry — a term the vocabulary
                does not know is refused and LOGGED, which is the only gap
                signal left once the escape hatch is gone.
              */}
              <SubcategoryPicker
                value={selectedSubcategories}
                baseline={originalSubcategories}
                onChange={setSelectedSubcategories}
                locale={locale}
                priorityCategorySlug={categorySlug}
                surface="correction-dialog"
                max={MAX_SUBCATEGORIES}
                labels={{
                  search: tCorrection("subcategorySearchLabel"),
                  searchHint: tCorrection("subcategorySearchHint"),
                  selected: tCorrection("currentSubcategoriesHeading"),
                  options: tCorrection("addSubcategoriesHeading"),
                  limit: tCorrection("subcategoriesLimit"),
                  rejected: tCorrection("subcategoryRejected"),
                  empty: tCorrection("subcategoryEmpty"),
                }}
              />
            </div>
          )}

          {isLinkField && (
            <div className="space-y-4 p-4">
              <div
                role="group"
                aria-labelledby={currentHeadingId}
                className="space-y-2"
              >
                <Typography id={currentHeadingId} variant="subsectionTitle">
                  {tCorrection("currentHeading")}
                </Typography>
                <p className="type-body-sm text-ink break-all">
                  {originalSelection || tCorrection("selectPlaceholder")}
                </p>
              </div>
              <div className="space-y-2">
                <Label htmlFor={purchaseUrlInputId}>
                  {tCorrection("purchaseUrlLabel")}
                </Label>
                <Input
                  id={purchaseUrlInputId}
                  type="url"
                  inputMode="url"
                  value={selection}
                  placeholder={tCorrection("purchaseUrlPlaceholder")}
                  onChange={(event) => {
                    updateSelection((base) => ({
                      ...base,
                      key: selectionKey,
                      value: event.target.value,
                    }));
                  }}
                  onBlur={() => {
                    // Same cleaning the submission flow offers on the website
                    // field — applied rather than suggested, so only the
                    // cleaned URL can reach the correction queue. Guarded on a
                    // non-empty result so a value that is nothing but a query
                    // string is left alone for validation to reject.
                    const cleaned = stripUrlQuery(selection);
                    if (cleaned === selection || cleaned === "") return;
                    updateSelection((base) => ({
                      ...base,
                      key: selectionKey,
                      value: cleaned,
                    }));
                  }}
                  autoComplete="url"
                  data-ph-no-autocapture
                />
              </div>
            </div>
          )}
        </DialogBody>

        <DialogFooter className="flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="type-metadata sm:max-w-xs">
            {tCorrection("description")}
          </p>
          <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row">
            <DialogClose
              render={
                <Button
                  type="button"
                  variant="secondary"
                  className="focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-accent sm:w-auto"
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
              className="focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-accent sm:w-auto"
              data-ph-no-autocapture
            />
          </div>
        </DialogFooter>
      </DialogForm>
    </DialogContent>
  );
}
