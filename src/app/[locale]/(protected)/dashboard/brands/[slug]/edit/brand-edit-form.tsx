"use client";

import { useActionState, useState } from "react";
import { useTranslations } from "next-intl";
import { Trash2 } from "lucide-react";
import { Link } from "@/i18n/navigation";
import { saveDraftAction, updateBrandAction } from "../actions";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ImageUploadField } from "@/components/forms/image-upload-field";
import { DynamicArrayField } from "@/components/forms/dynamic-array-field";
import { ProductPhotosField } from "@/components/forms/product-photos-field";
import { ProductTagField } from "@/components/forms/product-tag-field";
import { Textarea } from "@/components/ui/textarea";
import type { OnboardingStepKey } from "@/lib/services/brand-onboarding";
import { TAIWAN_CITIES } from "@/lib/constants/taiwan-cities";
import { PRODUCT_TYPE_CATEGORIES } from "@/lib/taxonomy/ontology";
import type { Brand, CustomerVoice, OtherUrl } from "@/lib/types";

type BrandEditFormProps = {
  brand: Brand;
  onboardingStep?: OnboardingStepKey;
};

export function BrandEditForm({ brand, onboardingStep }: BrandEditFormProps) {
  const [socialInstagram, setSocialInstagram] = useState(brand.socialInstagram ?? "");
  const [socialThreads, setSocialThreads] = useState(brand.socialThreads ?? "");
  const [socialFacebook, setSocialFacebook] = useState(brand.socialFacebook ?? "");
  const [purchaseWebsite, setPurchaseWebsite] = useState(brand.purchaseWebsite ?? "");
  const [purchasePinkoi, setPurchasePinkoi] = useState(brand.purchasePinkoi ?? "");
  const [purchaseShopee, setPurchaseShopee] = useState(brand.purchaseShopee ?? "");
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
  const tCities = useTranslations("cities");
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
        <div className="rounded-lg border border-border bg-background px-4 py-3 text-sm font-semibold text-foreground">
          {error}
        </div>
      )}

      <form className="space-y-10">
        <input type="hidden" name="brandSlug" value={brand.slug} />
        {onboardingStep ? (
          <input type="hidden" name="onboardingStep" value={onboardingStep} />
        ) : null}

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
              className="flex min-h-[120px] w-full scroll-mt-8 rounded-lg border border-border bg-background px-3 py-2 text-sm placeholder:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              defaultValue={brand.description ?? ""}
            />
            {fieldErrors.description && (
              <p className="text-xs font-semibold text-foreground">
                {fieldErrors.description}
              </p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="productType">{t("fieldCategory")}</Label>
            <select
              id="productType"
              name="productType"
              className="flex h-10 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              defaultValue={brand.productType ?? ""}
            >
              <option value="">—</option>
              {PRODUCT_TYPE_CATEGORIES.map((category) => (
                <option key={category.slug} value={category.slug}>
                  {category.nameZh} ({category.name})
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="city">{t("city")}</Label>
            <select
              id="city"
              name="city"
              className="flex h-10 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              defaultValue={brand.city ?? ""}
            >
              <option value="">{t("cityPlaceholder")}</option>
              {TAIWAN_CITIES.map((city) => (
                <option key={city.slug} value={city.slug}>
                  {tCities(city.slug)}
                </option>
              ))}
            </select>
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

          <div id="product-tags" className="space-y-2 scroll-mt-8">
            <Label htmlFor="productTags">{tx("fieldProductTags", "Product Tags")}</Label>
            <ProductTagField
              initialTags={brand.productTags}
              inputLabel={tx("fieldProductTags", "Product Tags")}
              placeholder={tx(
                "fieldProductTagsPlaceholder",
                "Add a specific product type"
              )}
              removeLabel={tx("removeProductTag", "Remove tag")}
              maxLabel={tx("productTagsMax", "Up to 5 product tags")}
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
        <section id="media" className="space-y-4 scroll-mt-8">
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
        <section id="purchase" className="space-y-4 scroll-mt-8">
          <h2 className="font-heading text-base font-bold text-foreground border-b border-border pb-2">
            {t("sectionLinks")}
          </h2>

          <div id="social-proof" className="scroll-mt-8 space-y-4 rounded-lg border border-border bg-background p-4">
            <div className="inline-flex min-h-12 items-center rounded-lg bg-primary px-4 text-[11px] font-medium uppercase tracking-wide text-primary-foreground">
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
            <div className="inline-flex min-h-12 items-center rounded-lg bg-primary px-4 text-[11px] font-medium uppercase tracking-wide text-primary-foreground">
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
            <div className="text-[11px] font-medium uppercase tracking-wide text-foreground">
              {tx("fieldOtherLinks", "Other links")}
            </div>
            <DynamicArrayField<OtherUrl>
              initialItems={brand.otherUrls ?? []}
              createItem={() => ({ label: "", url: "" })}
              addLabel={tx("addLink", "+ Add link")}
              maxItems={3}
              renderItem={(item, index, onRemove) => (
                <div className="grid gap-2 sm:grid-cols-[minmax(0,0.45fr)_minmax(0,1fr)_48px]">
                  <Input
                    name={`otherUrls[${index}].label`}
                    placeholder={t("fieldLabelPlaceholder")}
                    defaultValue={item.label}
                    className="h-12 bg-background focus-visible:ring-2 focus-visible:ring-ring"
                  />
                  <Input
                    name={`otherUrls[${index}].url`}
                    type="url"
                    placeholder={t("fieldUrlPlaceholder")}
                    defaultValue={item.url}
                    className="h-12 bg-background focus-visible:ring-2 focus-visible:ring-ring"
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label={t("removeItem")}
                    onClick={onRemove}
                    className="h-12 w-12 text-foreground hover:bg-secondary focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              )}
            />
          </div>
        </section>

        {/* Customer Voices */}
        <section id="customer-voices" className="space-y-4">
          <h2 className="font-heading text-base font-bold text-foreground border-b border-border pb-2">
            {t("sectionCustomerVoices")}
          </h2>

          <div className="space-y-4 rounded-lg border border-border bg-background p-4">
            <div className="text-[11px] font-medium uppercase tracking-wide text-foreground">
              {t("customerVoicesLabel")}
            </div>
            <DynamicArrayField<CustomerVoice>
              initialItems={brand.customerVoices}
              createItem={() => ({ author: "", content: "", source: "" })}
              addLabel={t("addCustomerVoice")}
              maxItems={5}
              renderItem={(item, index, onRemove) => (
                <div className="grid gap-2 sm:grid-cols-[minmax(0,0.35fr)_minmax(0,1fr)_minmax(0,0.35fr)_48px]">
                  <Input
                    name={`customerVoices[${index}].author`}
                    placeholder={t("fieldCustomerVoiceAuthor")}
                    defaultValue={item.author}
                    className="h-12 bg-background focus-visible:ring-2 focus-visible:ring-ring"
                  />
                  <Input
                    name={`customerVoices[${index}].content`}
                    placeholder={t("fieldCustomerVoiceContent")}
                    defaultValue={item.content}
                    className="h-12 bg-background focus-visible:ring-2 focus-visible:ring-ring"
                  />
                  <Input
                    name={`customerVoices[${index}].source`}
                    placeholder={t("fieldCustomerVoiceSource")}
                    defaultValue={item.source ?? ""}
                    className="h-12 bg-background focus-visible:ring-2 focus-visible:ring-ring"
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label={t("removeItem")}
                    onClick={onRemove}
                    className="h-12 w-12 text-foreground hover:bg-secondary focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <Trash2 className="h-4 w-4" />
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

        {/* Enrichment Expansion */}
        <section id="enrichment-expansion" className="space-y-6">
          <h2 className="font-heading text-base font-bold text-foreground border-b border-border pb-2">
            Enrichment expansion
          </h2>

          <div className="space-y-4 rounded-lg border border-border bg-background p-4">
            <div className="text-[11px] font-medium uppercase tracking-wide text-foreground">
              Reputation
            </div>
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="reputationSummary">Summary</Label>
                <Textarea
                  id="reputationSummary"
                  name="reputationSummary"
                  defaultValue={brand.reputationSummary?.text ?? ""}
                  className="min-h-28 bg-background focus-visible:ring-2 focus-visible:ring-ring"
                />
              </div>
              <div className="space-y-2">
                <Label>Provenance sources</Label>
                <DynamicArrayField
                  initialItems={brand.reputationSummary?.sources ?? []}
                  createItem={() => ({ url: "", title: "", retrievedAt: "" })}
                  addLabel="+ Add source"
                  maxItems={5}
                  renderItem={(item, index, onRemove) => (
                    <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,0.9fr)_48px]">
                      <Input
                        name={`reputationSources[${index}].url`}
                        type="url"
                        placeholder="Source URL"
                        defaultValue={item.url}
                        className="h-12 bg-background focus-visible:ring-2 focus-visible:ring-ring"
                      />
                      <Input
                        name={`reputationSources[${index}].title`}
                        placeholder="Title"
                        defaultValue={item.title}
                        className="h-12 bg-background focus-visible:ring-2 focus-visible:ring-ring"
                      />
                      <Input
                        name={`reputationSources[${index}].retrievedAt`}
                        type="date"
                        placeholder="Retrieved date"
                        defaultValue={item.retrievedAt}
                        className="h-12 bg-background focus-visible:ring-2 focus-visible:ring-ring"
                      />
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        aria-label={t("removeItem")}
                        onClick={onRemove}
                        className="h-12 w-12 text-foreground hover:bg-secondary focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  )}
                />
              </div>
            </div>
          </div>

          <div className="space-y-4 rounded-lg border border-border bg-background p-4">
            <div className="text-[11px] font-medium uppercase tracking-wide text-foreground">
              Manufacturing
            </div>
            <div className="grid gap-4">
              <div className="grid gap-1.5 sm:grid-cols-[140px_1fr] sm:items-center">
                <Label htmlFor="factoryLocation" className="text-sm font-semibold text-foreground">
                  Factory location
                </Label>
                <Input
                  id="factoryLocation"
                  name="factoryLocation"
                  defaultValue={brand.manufacturing?.factoryLocation ?? ""}
                  className="h-12 bg-background focus-visible:ring-2 focus-visible:ring-ring"
                />
              </div>
              <div className="grid gap-1.5 sm:grid-cols-[140px_1fr] sm:items-center">
                <Label htmlFor="productionModel" className="text-sm font-semibold text-foreground">
                  Production model
                </Label>
                <Select name="productionModel" defaultValue={brand.manufacturing?.productionModel ?? ""}>
                  <SelectTrigger className="h-12 w-full bg-background focus-visible:ring-2 focus-visible:ring-ring">
                    <SelectValue placeholder="Select model" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="own">Own</SelectItem>
                    <SelectItem value="oem">OEM</SelectItem>
                    <SelectItem value="mixed">Mixed</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="mitStory" className="text-sm font-semibold text-foreground">
                  {t('mitStoryLabel')}
                </Label>
                <Textarea
                  id="mitStory"
                  name="mitStory"
                  defaultValue={brand.mitStory ?? ''}
                  placeholder={t('mitStoryPlaceholder')}
                  rows={5}
                  className="min-h-28 bg-background focus-visible:ring-2 focus-visible:ring-ring"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="manufacturingNotes" className="text-sm font-semibold text-foreground">
                  Notes
                </Label>
                <Textarea
                  id="manufacturingNotes"
                  name="manufacturingNotes"
                  defaultValue={brand.manufacturing?.notes ?? ""}
                  className="min-h-28 bg-background focus-visible:ring-2 focus-visible:ring-ring"
                />
              </div>
            </div>
          </div>

          <div className="space-y-4 rounded-lg border border-border bg-background p-4">
            <div className="text-[11px] font-medium uppercase tracking-wide text-foreground">
              Certifications
            </div>
            <DynamicArrayField
              initialItems={(brand.certifications ?? []).map((cert) => ({
                name: cert.name,
                issuer: cert.issuer ?? "",
                year: cert.year != null ? String(cert.year) : "",
                sourceUrl: cert.source?.url ?? "",
              }))}
              createItem={() => ({ name: "", issuer: "", year: "", sourceUrl: "" })}
              addLabel="+ Add certification"
              maxItems={10}
              renderItem={(item, index, onRemove) => (
                <div className="grid gap-2 rounded-lg border border-border p-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,0.8fr)_minmax(0,0.5fr)_minmax(0,1fr)_48px]">
                  <Input
                    name={`certifications[${index}].name`}
                    placeholder="Certification name"
                    defaultValue={item.name}
                    className="h-12 bg-background focus-visible:ring-2 focus-visible:ring-ring"
                  />
                  <Input
                    name={`certifications[${index}].issuer`}
                    placeholder="Issuer"
                    defaultValue={item.issuer ?? ""}
                    className="h-12 bg-background focus-visible:ring-2 focus-visible:ring-ring"
                  />
                  <Input
                    name={`certifications[${index}].year`}
                    type="number"
                    min={1900}
                    max={new Date().getFullYear()}
                    placeholder="Year"
                    defaultValue={item.year || undefined}
                    className="h-12 bg-background focus-visible:ring-2 focus-visible:ring-ring"
                  />
                  <Input
                    name={`certifications[${index}].sourceUrl`}
                    type="url"
                    placeholder="Source URL"
                    defaultValue={item.sourceUrl}
                    className="h-12 bg-background focus-visible:ring-2 focus-visible:ring-ring"
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label={t("removeItem")}
                    onClick={onRemove}
                    className="h-12 w-12 text-foreground hover:bg-secondary focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              )}
            />
          </div>

          <div className="space-y-4 rounded-lg border border-border bg-background p-4">
            <div className="text-[11px] font-medium uppercase tracking-wide text-foreground">
              Policies
            </div>
            <div className="grid gap-4">
              <div className="grid gap-1.5 sm:grid-cols-[140px_1fr] sm:items-center">
                <Label htmlFor="returnsPolicy" className="text-sm font-semibold text-foreground">
                  Returns policy
                </Label>
                <Input
                  id="returnsPolicy"
                  name="returnsPolicy"
                  defaultValue={brand.policies?.returns ?? ""}
                  className="h-12 bg-background focus-visible:ring-2 focus-visible:ring-ring"
                />
              </div>
              <div className="grid gap-1.5 sm:grid-cols-[140px_1fr] sm:items-center">
                <Label htmlFor="warranty" className="text-sm font-semibold text-foreground">
                  Warranty
                </Label>
                <Input
                  id="warranty"
                  name="warranty"
                  defaultValue={brand.policies?.warranty ?? ""}
                  className="h-12 bg-background focus-visible:ring-2 focus-visible:ring-ring"
                />
              </div>
              <div className="flex min-h-12 items-center gap-3">
                <Checkbox
                  id="shipsInternational"
                  name="shipsInternational"
                  defaultChecked={brand.policies?.shipsInternational ?? false}
                  className="accent-primary"
                />
                <Label htmlFor="shipsInternational" className="text-sm font-semibold text-foreground">
                  Ships international
                </Label>
              </div>
            </div>
          </div>
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
          <Link href={`/dashboard?brand=${brand.slug}`}>
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
