"use client";

import { useActionState, useState } from "react";
import { useTranslations } from "next-intl";
import { Plus, Trash2 } from "lucide-react";
import { Link } from "@/i18n/navigation";
import { saveDraftAction, updateBrandAction } from "../actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ImageUploadField } from "@/components/forms/image-upload-field";
import { DynamicArrayField } from "@/components/forms/dynamic-array-field";
import { ProductPhotosField } from "@/components/forms/product-photos-field";
import type { Brand, OtherUrl } from "@/lib/types";

type BrandEditFormProps = {
  brand: Brand;
};

export function BrandEditForm({ brand }: BrandEditFormProps) {
  const [socialInstagram, setSocialInstagram] = useState(brand.socialInstagram ?? "");
  const [socialThreads, setSocialThreads] = useState(brand.socialThreads ?? "");
  const [socialFacebook, setSocialFacebook] = useState(brand.socialFacebook ?? "");
  const [purchaseWebsite, setPurchaseWebsite] = useState(brand.purchaseWebsite ?? "");
  const [purchasePinkoi, setPurchasePinkoi] = useState(brand.purchasePinkoi ?? "");
  const [purchaseShopee, setPurchaseShopee] = useState(brand.purchaseShopee ?? "");
  const [otherUrls, setOtherUrls] = useState<OtherUrl[]>(brand.otherUrls ?? []);
  const [publishState, publishFormAction, publishPending] = useActionState(
    updateBrandAction,
    undefined
  );
  const [draftState, draftFormAction, draftPending] = useActionState(
    saveDraftAction,
    undefined
  );
  const t = useTranslations("dashboard.edit");
  const tx = (key: string, fallback: string) => (t.has(key) ? t(key) : fallback);
  const pendingEditsT = useTranslations("admin.pendingEdits");
  const fieldErrors = {
    ...publishState?.fieldErrors,
    ...draftState?.fieldErrors,
  };
  const error = publishState?.error ?? draftState?.error;
  const showSubmittedForReviewNotice =
    publishState?.success === true &&
    publishState.message === "brandEditSubmittedForReview";
  const addOtherUrl = () => {
    setOtherUrls((links) => (
      links.length >= 3 ? links : [...links, { label: "", url: "" }]
    ));
  };
  const updateOtherUrl = (index: number, key: keyof OtherUrl, value: string) => {
    setOtherUrls((links) =>
      links.map((link, linkIndex) =>
        linkIndex === index ? { ...link, [key]: value } : link
      )
    );
  };
  const removeOtherUrl = (index: number) => {
    setOtherUrls((links) => links.filter((_, linkIndex) => linkIndex !== index));
  };

  return (
    <div className="space-y-10">
      {error && (
        <div className="rounded-lg border border-border bg-background px-4 py-3 text-sm font-semibold text-foreground">
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
              <p className="text-xs font-semibold text-foreground">{fieldErrors.name}</p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="description">{t("fieldDescription")}</Label>
            <textarea
              id="description"
              name="description"
              className="flex min-h-[120px] w-full rounded-lg border border-border bg-background px-3 py-2 text-sm placeholder:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              defaultValue={brand.description ?? ""}
            />
            {fieldErrors.description && (
              <p className="text-xs font-semibold text-foreground">
                {fieldErrors.description}
              </p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="priceRange">{tx("fieldPriceRange", "Price Range")}</Label>
            <select
              id="priceRange"
              name="priceRange"
              className="flex h-10 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              defaultValue={brand.priceRange ?? ""}
            >
              <option value="">{tx("fieldPriceRangeUnset", "Unset")}</option>
              <option value="1">$</option>
              <option value="2">$$</option>
              <option value="3">$$$</option>
            </select>
            {fieldErrors.priceRange && (
              <p className="text-xs font-semibold text-foreground">
                {fieldErrors.priceRange}
              </p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="productTags">{tx("fieldProductTags", "Product Tags")}</Label>
            <Input
              id="productTags"
              name="productTags"
              placeholder={tx(
                "fieldProductTagsPlaceholder",
                "Comma-separated specific product types"
              )}
              defaultValue={brand.productTags.join(", ")}
            />
            {fieldErrors.productTags && (
              <p className="text-xs font-semibold text-foreground">
                {fieldErrors.productTags}
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

        </section>

        {/* Media */}
        <section id="media" className="space-y-4">
          <h2 className="font-heading text-base font-bold text-foreground border-b border-border pb-2">
            {t("sectionMedia")}
          </h2>

          <ImageUploadField
            name="heroImageUrl"
            label={t("fieldHeroImage")}
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

          <div className="space-y-4 rounded-lg border border-border bg-background p-4">
            <div className="inline-flex min-h-12 items-center rounded-lg bg-primary px-4 text-[11px] font-semibold uppercase tracking-wide text-primary-foreground">
              {tx("socialLinksLabel", "Social links")}
            </div>
            <div className="grid gap-3">
              <div className="grid gap-1.5 sm:grid-cols-[140px_1fr] sm:items-center">
                <Label htmlFor="socialInstagram" className="text-sm font-semibold text-foreground">
                  {t("fieldInstagram")}
                </Label>
                <Input
                  id="socialInstagram"
                  name="socialInstagram"
                  placeholder="@yourbrand"
                  value={socialInstagram}
                  onChange={(event) => setSocialInstagram(event.target.value.replace(/^@+/, ""))}
                  className="h-12 bg-background focus-visible:ring-2 focus-visible:ring-ring"
                />
              </div>
              <div className="grid gap-1.5 sm:grid-cols-[140px_1fr] sm:items-center">
                <Label htmlFor="socialThreads" className="text-sm font-semibold text-foreground">
                  {t("fieldThreads")}
                </Label>
                <Input
                  id="socialThreads"
                  name="socialThreads"
                  placeholder="@yourbrand"
                  value={socialThreads}
                  onChange={(event) => setSocialThreads(event.target.value.replace(/^@+/, ""))}
                  className="h-12 bg-background focus-visible:ring-2 focus-visible:ring-ring"
                />
              </div>
              <div className="grid gap-1.5 sm:grid-cols-[140px_1fr] sm:items-center">
                <Label htmlFor="socialFacebook" className="text-sm font-semibold text-foreground">
                  {t("fieldFacebook")}
                </Label>
                <Input
                  id="socialFacebook"
                  name="socialFacebook"
                  type="url"
                  placeholder="https://facebook.com/yourbrand"
                  value={socialFacebook}
                  onChange={(event) => setSocialFacebook(event.target.value)}
                  className="h-12 bg-background focus-visible:ring-2 focus-visible:ring-ring"
                />
              </div>
            </div>
          </div>

          <div className="space-y-4 rounded-lg border border-border bg-background p-4">
            <div className="inline-flex min-h-12 items-center rounded-lg bg-cta px-4 text-[11px] font-semibold uppercase tracking-wide text-cta-foreground">
              {t("fieldPurchaseLinks")}
            </div>
            <div className="grid gap-3">
              <div className="grid gap-1.5 sm:grid-cols-[140px_1fr] sm:items-center">
                <Label htmlFor="purchaseWebsite" className="text-sm font-semibold text-foreground">
                  {t("fieldOfficialWebsite")}
                </Label>
                <Input
                  id="purchaseWebsite"
                  name="purchaseWebsite"
                  type="url"
                  placeholder="https://yourbrand.com"
                  value={purchaseWebsite}
                  onChange={(event) => setPurchaseWebsite(event.target.value)}
                  className="h-12 bg-background focus-visible:ring-2 focus-visible:ring-ring"
                />
              </div>
              <div className="grid gap-1.5 sm:grid-cols-[140px_1fr] sm:items-center">
                <Label htmlFor="purchasePinkoi" className="text-sm font-semibold text-foreground">
                  Pinkoi
                </Label>
                <Input
                  id="purchasePinkoi"
                  name="purchasePinkoi"
                  type="url"
                  placeholder="https://pinkoi.com/..."
                  value={purchasePinkoi}
                  onChange={(event) => setPurchasePinkoi(event.target.value)}
                  className="h-12 bg-background focus-visible:ring-2 focus-visible:ring-ring"
                />
              </div>
              <div className="grid gap-1.5 sm:grid-cols-[140px_1fr] sm:items-center">
                <Label htmlFor="purchaseShopee" className="text-sm font-semibold text-foreground">
                  {tx("fieldShopee", "Shopee")}
                </Label>
                <Input
                  id="purchaseShopee"
                  name="purchaseShopee"
                  type="url"
                  placeholder="https://shopee.tw/..."
                  value={purchaseShopee}
                  onChange={(event) => setPurchaseShopee(event.target.value)}
                  className="h-12 bg-background focus-visible:ring-2 focus-visible:ring-ring"
                />
              </div>
            </div>
          </div>

          <div className="space-y-4 rounded-lg border border-border bg-background p-4">
            <div className="text-[11px] font-semibold uppercase tracking-wide text-foreground">
              {tx("fieldOtherLinks", "Other links")}
            </div>
            <div className="space-y-3">
              {otherUrls.map((link, index) => (
                <div key={index} className="grid gap-2 sm:grid-cols-[minmax(0,0.45fr)_minmax(0,1fr)_48px]">
                  <Input
                    name={`otherUrls[${index}].label`}
                    placeholder={t("fieldLabelPlaceholder")}
                    value={link.label}
                    onChange={(event) => updateOtherUrl(index, "label", event.target.value)}
                    className="h-12 bg-background focus-visible:ring-2 focus-visible:ring-ring"
                  />
                  <Input
                    name={`otherUrls[${index}].url`}
                    type="url"
                    placeholder={t("fieldUrlPlaceholder")}
                    value={link.url}
                    onChange={(event) => updateOtherUrl(index, "url", event.target.value)}
                    className="h-12 bg-background focus-visible:ring-2 focus-visible:ring-ring"
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label={t("removeItem")}
                    onClick={() => removeOtherUrl(index)}
                    className="h-12 w-12 text-foreground hover:bg-secondary focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              ))}
            </div>
            {otherUrls.length < 3 && (
              <Button
                type="button"
                variant="ghost"
                onClick={addOtherUrl}
                className="h-12 px-3 text-foreground hover:bg-secondary focus-visible:ring-2 focus-visible:ring-ring"
              >
                <Plus className="h-4 w-4" />
                {tx("addLink", "+ Add link")}
              </Button>
            )}
          </div>

          <div className="hidden" aria-hidden="true">
            <input type="hidden" name="websiteUrl" value={purchaseWebsite} />
            <input type="hidden" name="instagram" value={socialInstagram} />
            <input type="hidden" name="threads" value={socialThreads} />
            <input type="hidden" name="facebook" value={socialFacebook} />
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
            className="h-12"
          >
            {publishPending ? t("saving") : t("save")}
          </Button>
          <Button
            type="submit"
            variant="outline"
            formAction={draftFormAction}
            disabled={draftPending}
            className="h-12"
          >
            {draftPending ? t("savingDraft") : t("saveDraft")}
          </Button>
          <Link href={`/dashboard?tab=${brand.slug}`}>
            <Button type="button" variant="outline" className="h-12">
              {t("cancel")}
            </Button>
          </Link>
          <Link
            href={`/brands/${brand.slug}`}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex min-h-12 items-center text-sm font-semibold text-foreground underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {t("viewAsVisitor")}
          </Link>
        </div>
      </form>
    </div>
  );
}
