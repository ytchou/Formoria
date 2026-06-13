"use client";

import { useActionState, useState } from "react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { saveDraftAction, updateBrandAction } from "../actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ImageUploadField } from "@/components/forms/image-upload-field";
import { DynamicArrayField } from "@/components/forms/dynamic-array-field";
import { ProductPhotosField } from "@/components/forms/product-photos-field";
import type { Brand, TaxonomyTag } from "@/lib/types";

type BrandEditFormProps = {
  brand: Brand;
  regionTags?: TaxonomyTag[];
  valueTags?: TaxonomyTag[];
};

export function BrandEditForm({
  brand,
  regionTags = [],
  valueTags = [],
}: BrandEditFormProps) {
  const currentRegion =
    brand.tags?.find((tag) => tag.category === "region")?.slug ?? "";
  const currentValueTags =
    brand.tags
      ?.filter((tag) => tag.category === "value")
      .map((tag) => tag.slug) ?? [];
  const [selectedValues, setSelectedValues] = useState(currentValueTags);
  const orderedRegionTags = [
    ...regionTags.filter((tag) => tag.slug === "nationwide"),
    ...regionTags.filter((tag) => tag.slug !== "nationwide"),
  ];
  const [publishState, publishFormAction, publishPending] = useActionState(
    updateBrandAction,
    undefined
  );
  const [draftState, draftFormAction, draftPending] = useActionState(
    saveDraftAction,
    undefined
  );
  const t = useTranslations("dashboard.edit");
  const pendingEditsT = useTranslations("admin.pendingEdits");
  const fieldErrors = {
    ...publishState?.fieldErrors,
    ...draftState?.fieldErrors,
  };
  const error = publishState?.error ?? draftState?.error;
  const showSubmittedForReviewNotice =
    publishState?.success === true &&
    publishState.message === "brandEditSubmittedForReview";

  return (
    <div className="space-y-10">
      {error && (
        <div className="rounded-lg bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {error}
        </div>
      )}

      <form className="space-y-10">
        <input type="hidden" name="brandSlug" value={brand.slug} />

        {/* Basic Info */}
        <section id="basic-info" className="space-y-4">
          <h2 className="font-heading text-base font-bold text-foreground border-b border-border pb-2">
            {t("sectionBasicInfo")}
          </h2>

          <div className="space-y-2">
            <Label htmlFor="name">{t("fieldBrandName")}</Label>
            <Input
              id="name"
              name="name"
              defaultValue={brand.name}
              required
            />
            {fieldErrors.name && (
              <p className="text-xs text-destructive">{fieldErrors.name}</p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="description">{t("fieldDescription")}</Label>
            <textarea
              id="description"
              name="description"
              className="flex min-h-[120px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              defaultValue={brand.description ?? ""}
            />
            {fieldErrors.description && (
              <p className="text-xs text-destructive">
                {fieldErrors.description}
              </p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="brandHighlights">{t("fieldBrandHighlights")}</Label>
            <textarea
              id="brandHighlights"
              name="brandHighlights"
              maxLength={300}
              className="flex min-h-[120px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              defaultValue={brand.brandHighlights ?? ""}
            />
            <p className="text-xs text-muted-foreground">{t("fieldHighlightsHint")}</p>
            {fieldErrors.brandHighlights && (
              <p className="text-xs text-destructive">
                {fieldErrors.brandHighlights}
              </p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="foundingYear">{t("fieldFoundingYear")}</Label>
            <Input
              id="foundingYear"
              name="foundingYear"
              type="number"
              min={1900}
              max={new Date().getFullYear()}
              defaultValue={brand.foundingYear ?? ""}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="region">{t("fieldRegion")}</Label>
            <p className="text-xs text-muted-foreground">
              {t("fieldRegionHint")}
            </p>
            <select
              id="region"
              name="region"
              defaultValue={currentRegion}
              className="h-11 w-full rounded-lg border border-border bg-white px-3 text-sm"
            >
              <option value="" disabled>
                {t("fieldRegionPlaceholder")}
              </option>
              {orderedRegionTags.map((tag) => (
                <option key={tag.id} value={tag.slug}>
                  {tag.nameZh} ({tag.name})
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between gap-3">
              <Label>{t("fieldValueTags")}</Label>
              <span
                className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                  selectedValues.length > 0
                    ? "bg-[#2F5D50] text-white"
                    : "bg-[#E5E0D8] text-foreground"
                }`}
              >
                {selectedValues.length} / 3
              </span>
            </div>
            <p className="text-xs text-muted-foreground">
              {t("fieldValueTagsHint")}
            </p>
            <input
              type="hidden"
              name="valueTags"
              value={JSON.stringify(selectedValues)}
            />
            <div className="flex flex-col gap-0.5">
              {valueTags.map((tag) => {
                const checked = selectedValues.includes(tag.slug);
                const disabled = selectedValues.length >= 3 && !checked;

                return (
                  <label
                    key={tag.id}
                    className={`flex items-center gap-2 rounded-md px-2 py-1.5 text-sm text-foreground ${
                      disabled ? "pointer-events-none opacity-50" : ""
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={(event) => {
                        if (event.target.checked) {
                          if (selectedValues.length >= 3) return;
                          setSelectedValues([...selectedValues, tag.slug]);
                          return;
                        }

                        setSelectedValues(
                          selectedValues.filter((value) => value !== tag.slug)
                        );
                      }}
                      className="h-4 w-4 rounded border-border text-[#2F5D50] focus:ring-[#2F5D50]"
                    />
                    <span>
                      {tag.nameZh} ({tag.name})
                    </span>
                  </label>
                );
              })}
            </div>
          </div>
        </section>

        {/* Media */}
        <section id="media" className="space-y-4">
          <h2 className="font-heading text-base font-bold text-foreground border-b border-border pb-2">
            {t("sectionMedia")}
          </h2>

          <ImageUploadField
            name="logoUrl"
            label="Logo"
            brandId={brand.id}
            currentUrl={brand.logoUrl}
          />

          <ImageUploadField
            name="heroImageUrl"
            label="Hero Image"
            brandId={brand.id}
            currentUrl={brand.heroImageUrl}
          />

          <div className="space-y-2">
            <Label htmlFor="productPhotos">{t("fieldProductPhotos")}</Label>
            <ProductPhotosField
              name="productPhotos"
              brandId={brand.id}
              defaultPhotos={brand.productPhotos ?? []}
            />
          </div>
        </section>

        {/* Links */}
        <section id="links" className="space-y-4">
          <h2 className="font-heading text-base font-bold text-foreground border-b border-border pb-2">
            {t("sectionLinks")}
          </h2>

          <div className="space-y-2">
            <Label htmlFor="websiteUrl">{t("fieldOfficialWebsite")}</Label>
            <Input
              id="websiteUrl"
              name="websiteUrl"
              type="url"
              placeholder="https://yourbrand.com"
              defaultValue={brand.socialLinks.officialWebsite ?? ""}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="instagram">Instagram</Label>
            <Input
              id="instagram"
              name="instagram"
              placeholder="@yourbrand"
              defaultValue={brand.socialLinks.instagram ?? ""}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="threads">Threads</Label>
            <Input
              id="threads"
              name="threads"
              placeholder="@yourbrand"
              defaultValue={brand.socialLinks.threads ?? ""}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="facebook">Facebook</Label>
            <Input
              id="facebook"
              name="facebook"
              placeholder="https://facebook.com/yourbrand"
              defaultValue={brand.socialLinks.facebook ?? ""}
            />
          </div>

          <div className="space-y-2">
            <Label>{t("fieldPurchaseLinks")}</Label>
            <DynamicArrayField
              initialItems={brand.purchaseLinks}
              createItem={() => ({ platform: "", url: "", label: "" })}
              addLabel={t("addPurchaseLink")}
              renderItem={(item, index, onRemove) => (
                <div key={index} className="flex items-center gap-2">
                  <Input
                    name={`purchaseLinks[${index}].platform`}
                    placeholder={t("fieldPlatformPlaceholder")}
                    defaultValue={(item as { platform: string }).platform}
                    className="w-32"
                  />
                  <Input
                    name={`purchaseLinks[${index}].url`}
                    placeholder={t("fieldUrlPlaceholder")}
                    defaultValue={(item as { url: string }).url}
                  />
                  <Input
                    name={`purchaseLinks[${index}].label`}
                    placeholder={t("fieldLabelPlaceholder")}
                    defaultValue={(item as { label?: string }).label ?? ""}
                    className="w-32"
                  />
                  <Button type="button" variant="ghost" size="sm" onClick={onRemove}>
                    {t("removeItem")}
                  </Button>
                </div>
              )}
            />
          </div>
        </section>

        {/* Locations */}
        <section id="locations" className="space-y-4">
          <h2 className="font-heading text-base font-bold text-foreground border-b border-border pb-2">
            {t("sectionLocations")}
          </h2>

          <DynamicArrayField
            initialItems={brand.retailLocations}
            createItem={() => ({ name: "", address: "" })}
            addLabel={t("addRetailLocation")}
            renderItem={(item, index, onRemove) => (
              <div key={index} className="flex items-center gap-2">
                <Input
                  name={`retailLocations[${index}].name`}
                  placeholder={t("fieldStoreName")}
                  defaultValue={(item as { name: string }).name}
                />
                <Input
                  name={`retailLocations[${index}].address`}
                  placeholder={t("fieldAddress")}
                  defaultValue={(item as { address: string }).address}
                />
                <Button type="button" variant="ghost" size="sm" onClick={onRemove}>
                  {t("removeItem")}
                </Button>
              </div>
            )}
          />
        </section>

        {showSubmittedForReviewNotice && (
          <div className="rounded-lg border border-[var(--verified-green)] bg-[var(--verified-green-bg)] px-4 py-3 text-sm font-medium text-[var(--verified-green)]">
            {pendingEditsT("brandEditSubmittedForReview")}
          </div>
        )}

        <div className="flex flex-wrap items-center gap-4">
          <Button
            type="submit"
            formAction={publishFormAction}
            disabled={publishPending}
          >
            {publishPending ? t("saving") : t("save")}
          </Button>
          <Button
            type="submit"
            variant="outline"
            formAction={draftFormAction}
            disabled={draftPending}
          >
            {draftPending ? t("savingDraft") : t("saveDraft")}
          </Button>
          <Link href={`/dashboard?tab=${brand.slug}`}>
            <Button type="button" variant="outline">
              {t("cancel")}
            </Button>
          </Link>
          <Link
            href={`/brands/${brand.slug}`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-sm font-medium text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          >
            {t("viewAsVisitor")}
          </Link>
        </div>
      </form>
    </div>
  );
}
