"use client";

import { useRef, useState, type ReactNode } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Controller, useFormContext, useWatch } from "react-hook-form";
import { DashboardFormField } from "./dashboard-form-field";
import {
  StandardFormSection,
  StandardFormStack,
} from "@/components/forms/form-layout";
import { SubcategoryField } from "@/components/forms/subcategory-field";
import { RequiredFieldsHint } from "@/components/forms/required-fields-hint";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { TAIWAN_CITIES } from "@/lib/constants/taiwan-cities";
import type { BrandWizardCommonValues } from "@/lib/schemas/brand-wizard";
import { L1_CATEGORIES } from "@/lib/taxonomy/ontology";
import { slugifyRomanizedName } from "@/lib/brands/slug";
import { cn } from "@/lib/utils";
import { routes } from "@/lib/routes";

type RequiredBasicField =
  "name" | "categorySlug" | "description" | "subcategories";

type BasicFieldName = RequiredBasicField | "mitStory";

export function BrandBasicInfoSection({
  subcategorySuggestions = [],
  requiredFields = {},
  afterRomanizedName,
  suggestName,
  currentSlug,
}: {
  subcategorySuggestions?: string[];
  requiredFields?: Partial<Record<RequiredBasicField, boolean>>;
  afterRomanizedName?: ReactNode;
  suggestName?: (name: string) => Promise<{
    changed: boolean;
    suggestion?: string | null;
  }>;
  currentSlug?: string;
}) {
  const form = useFormContext<BrandWizardCommonValues>();
  const locale = useLocale();
  const t = useTranslations("dashboard.edit");
  const tSubmit = useTranslations("submit");
  const tCities = useTranslations("cities");
  const [nameSuggestion, setNameSuggestion] = useState<string | null>(null);
  const nameBlurRequestRef = useRef(0);
  const nameRegistration = form.register("name");
  const romanizedName = useWatch({
    control: form.control,
    name: "romanizedName",
  });
  // Only orders the picker's offer set — every L1 is still offered, because a
  // brand's products span L1s even though the brand carries one.
  const watchedCategorySlug = useWatch({
    control: form.control,
    name: "categorySlug",
  });
  const isExistingBrand = Boolean(currentSlug);
  const previewSlug = slugifyRomanizedName(romanizedName) || currentSlug || "";
  const tx = (key: string, fallback: string) =>
    t.has(key) ? t(key) : fallback;
  const fieldError = (field: BasicFieldName) => {
    const error = form.formState.errors[field];
    if (!error) return undefined;
    return typeof error.message === "string"
      ? error.message
      : t("requiredFieldError");
  };
  const handleNameBlur = async () => {
    const name = form.getValues("name")?.trim();
    if (!name || !suggestName) return;
    const requestId = ++nameBlurRequestRef.current;
    try {
      const result = await suggestName(name);
      if (requestId !== nameBlurRequestRef.current) return;
      setNameSuggestion(
        result.changed && result.suggestion ? result.suggestion : null,
      );
    } catch {
      if (requestId === nameBlurRequestRef.current) setNameSuggestion(null);
    }
  };
  return (
    <StandardFormSection id="basic-info">
      <StandardFormStack>
        <h2 className="type-card-title">{t("wizardStepBasicInfo")}</h2>
        <RequiredFieldsHint />

        <DashboardFormField
          id="name"
          fieldName="name"
          label={t("fieldBrandName")}
          required={Boolean(requiredFields.name)}
          error={fieldError("name")}
          errorId="name-error"
        >
          <Input
            id="name"
            aria-required={Boolean(requiredFields.name)}
            aria-invalid={Boolean(form.formState.errors.name)}
            aria-describedby={
              form.formState.errors.name ? "name-error" : undefined
            }
            className="min-h-12 bg-surface"
            {...nameRegistration}
            onBlur={(event) => {
              nameRegistration.onBlur(event);
              void handleNameBlur();
            }}
            onChange={(event) => {
              setNameSuggestion(null);
              nameRegistration.onChange(event);
            }}
          />
          {nameSuggestion ? (
            <div className="flex items-center justify-between gap-3 rounded-surface border border-rule bg-surface p-3 type-body-sm text-ink-soft">
              <span>
                {tSubmit("ownerForm.suggestedName")}{" "}
                <strong>{nameSuggestion}</strong>
              </span>
              <Button
                type="button"
                variant="secondary"
                onClick={() => {
                  form.setValue("name", nameSuggestion, {
                    shouldDirty: true,
                    shouldValidate: true,
                  });
                  setNameSuggestion(null);
                }}
              >
                {tSubmit("ownerForm.applySuggestion")}
              </Button>
            </div>
          ) : null}
        </DashboardFormField>

        <DashboardFormField
          id="romanizedName"
          fieldName="romanizedName"
          label={tSubmit("ownerForm.romanizedNameLabel")}
          description={tSubmit("ownerForm.romanizedNameHint")}
          error={form.formState.errors.romanizedName?.message}
          errorId="romanizedName-error"
        >
          <Input
            id="romanizedName"
            autoComplete="off"
            readOnly={isExistingBrand}
            placeholder={tSubmit("ownerForm.romanizedNamePlaceholder")}
            aria-invalid={Boolean(form.formState.errors.romanizedName)}
            aria-describedby={
              form.formState.errors.romanizedName
                ? "romanizedName-error"
                : undefined
            }
            className={cn(
              "min-h-12",
              isExistingBrand ? "bg-surface text-ink-muted" : "bg-surface",
            )}
            {...form.register("romanizedName")}
          />
          {isExistingBrand && (
            <p className="type-body-sm mt-1">{t("slugChangeBlocked")}</p>
          )}
        </DashboardFormField>

        <DashboardFormField
          id="brand-url-preview"
          label={tSubmit("ownerForm.urlPreviewLabel")}
          description={tSubmit("ownerForm.urlPreviewHint")}
        >
          <Input
            id="brand-url-preview"
            readOnly
            value={previewSlug ? routes.brand(previewSlug) : ""}
            className="min-h-12 bg-surface text-ink-muted"
          />
        </DashboardFormField>

        {afterRomanizedName}

        <DashboardFormField
          id="categorySlug"
          fieldName="categorySlug"
          label={t("fieldCategory")}
          description={tx(
            "fieldCategoryHint",
            "Used for navigation, search, and filtering",
          )}
          required={Boolean(requiredFields.categorySlug)}
          error={fieldError("categorySlug")}
          errorId="categorySlug-error"
        >
          <NativeSelect
            id="categorySlug"
            aria-required={Boolean(requiredFields.categorySlug)}
            aria-invalid={Boolean(form.formState.errors.categorySlug)}
            aria-describedby={
              form.formState.errors.categorySlug
                ? "categorySlug-error"
                : undefined
            }
            className="min-h-12 w-full bg-surface"
            {...form.register("categorySlug", {
              setValueAs: (value) => (value === "" ? undefined : value),
            })}
          >
            <option value="">{t("fieldCategory")}</option>
            {L1_CATEGORIES.map((category) => (
              <option key={category.slug} value={category.slug}>
                {category.nameZh} ({category.name})
              </option>
            ))}
          </NativeSelect>
        </DashboardFormField>

        <DashboardFormField
          id="description"
          fieldName="description"
          label={t("fieldDescription")}
          description={tx(
            "fieldDescriptionHint",
            "Public description shown on the brand page",
          )}
          required={Boolean(requiredFields.description)}
          error={fieldError("description")}
          errorId="description-error"
        >
          <Textarea
            id="description"
            aria-required={Boolean(requiredFields.description)}
            aria-invalid={Boolean(form.formState.errors.description)}
            aria-describedby={
              form.formState.errors.description
                ? "description-error"
                : undefined
            }
            className="min-h-28 bg-surface"
            {...form.register("description")}
          />
        </DashboardFormField>

        <DashboardFormField
          id="foundingYear"
          fieldName="foundingYear"
          label={t("fieldFoundingYear")}
          description={tx("fieldFoundingYearHint", "Shown on the brand page")}
        >
          <Input
            id="foundingYear"
            type="number"
            min={1900}
            max={new Date().getFullYear()}
            className="min-h-12 bg-surface"
            {...form.register("foundingYear")}
          />
        </DashboardFormField>

        <DashboardFormField
          id="mitStory"
          fieldName="mitStory"
          label={t("mitStoryLabel")}
          description={tx(
            "mitStoryHint",
            "Shown on the brand page if provided",
          )}
          error={fieldError("mitStory")}
          errorId="mitStory-error"
        >
          <Textarea
            id="mitStory"
            rows={5}
            placeholder={t("mitStoryPlaceholder")}
            aria-invalid={Boolean(form.formState.errors.mitStory)}
            aria-describedby={
              form.formState.errors.mitStory ? "mitStory-error" : undefined
            }
            className="min-h-28 bg-surface"
            {...form.register("mitStory")}
          />
        </DashboardFormField>

        <DashboardFormField
          id="subcategories"
          fieldName="subcategories"
          label={tx("fieldSubcategories", "Product subcategories")}
          description={tx("subcategoriesMax", "Up to 5 product subcategories")}
          required={Boolean(requiredFields.subcategories)}
          error={fieldError("subcategories")}
          errorId="subcategories-error"
        >
          <div
            aria-required={Boolean(requiredFields.subcategories)}
            aria-invalid={Boolean(form.formState.errors.subcategories)}
            aria-describedby={
              form.formState.errors.subcategories
                ? "subcategories-error"
                : undefined
            }
          >
            <Controller
              control={form.control}
              name="subcategories"
              render={({ field }) => (
                <SubcategoryField
                  value={field.value ?? []}
                  onChange={field.onChange}
                  suggestions={subcategorySuggestions}
                  categorySlug={watchedCategorySlug ?? null}
                  locale={locale}
                  labels={{
                    search: tx("fieldSubcategories", "Product subcategories"),
                    searchHint: tx(
                      "subcategoriesSearchHint",
                      "Type to filter, then pick a subcategory below.",
                    ),
                    selected: tx(
                      "subcategoriesSelectedHeading",
                      "Selected (tap to remove)",
                    ),
                    options: tx(
                      "subcategoriesOptionsHeading",
                      "Subcategories you can add",
                    ),
                    limit: tx(
                      "subcategoriesMax",
                      "Up to 5 subcategories.",
                    ),
                    rejected: tx(
                      "subcategoriesRejected",
                      "That term is not in the subcategory list. Pick the closest one below.",
                    ),
                    empty: tx(
                      "subcategoriesEmpty",
                      "No subcategory matches that search. Try another word.",
                    ),
                  }}
                />
              )}
            />
          </div>
        </DashboardFormField>

        <DashboardFormField
          id="city"
          fieldName="city"
          label={t("city")}
          description={tx(
            "cityHint",
            "Your brand will be shown on the map if provided",
          )}
        >
          <NativeSelect
            id="city"
            className="min-h-12 w-full bg-surface"
            {...form.register("city", {
              setValueAs: (value) => (value === "" ? undefined : value),
            })}
          >
            <option value="">{t("cityPlaceholder")}</option>
            {TAIWAN_CITIES.map((city) => (
              <option key={city.slug} value={city.slug}>
                {tCities(city.slug)}
              </option>
            ))}
          </NativeSelect>
        </DashboardFormField>

      </StandardFormStack>
    </StandardFormSection>
  );
}
