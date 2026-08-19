"use client";

import { useId, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { ChevronLeft, ChevronRight, Star, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { ImageUploader } from "@/components/upload/ImageUploader";
import type { ImageUploadMetadata } from "@/components/upload/useImageUpload";
import { DetailSection } from "@/components/admin/detail-section";
import { SubcategoryPicker } from "@/components/forms/subcategory-picker";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { ToggleChip } from "@/components/ui/toggle-chip";
import { getCategoryLabel } from "@/lib/brands/category-label";
import { brandImageFill } from "@/lib/images/focal";
import {
  L1_CATEGORIES,
  L2_SUBCATEGORIES,
  MATERIALS,
  materialBySlug,
  subcategoryBySlug,
  subcategoryDisplayLabel,
} from "@/lib/taxonomy/ontology";
import type { OtherUrl } from "@/lib/types";
import type { CuratedProductProposal } from "@/lib/types/enriched-data";
import {
  diffCuratedProductProposals,
  type CuratedProductProposalState,
  type ExistingCuratedProduct,
} from "@/lib/services/curated-products/proposal-diff";
import type {
  SaveSubmissionReviewInput,
  SubmissionReviewData,
  SubmissionReviewImage,
} from "@/lib/services/submissions";
import { deriveSubcategoriesEn } from "@/lib/services/subcategories";
import { cn } from "@/lib/utils";
import { MAX_BRAND_ACTIVE_IMAGES } from "@/lib/constants/brand-images";
import {
  PURCHASE_CHANNELS,
  type PurchaseChannelCamelField,
  type PurchaseChannelKey,
} from "@/lib/brands/purchase-channels";

const EMPTY_SELECT_VALUE = "__none";

/**
 * Admin-only labels for the purchase link editors. Marketplace names are brand
 * names, so they stay literal; only `website` has a translated label, keyed
 * under the `admin.review` namespace this component already reads.
 *
 * `website` is also the one channel whose value is NOT stored under its camel
 * field in the review draft: the submission pipeline carries it as
 * `websiteUrl`, and `purchaseWebsite` is derived from it on save. Every read
 * and write below therefore special-cases `channel.key === "website"`.
 */
const PURCHASE_DISPLAY_LABELS = {
  website: "links.official",
  pinkoi: "Pinkoi",
  shopee: "Shopee",
  myship: "MyShip",
} satisfies Record<PurchaseChannelKey, string>;

type EditableSection =
  | "content"
  | "reputation"
  | "catalog"
  | "products"
  | "links"
  | "evidence"
  | "images";

/**
 * Message-key suffixes for the proposal states. The diff's own values are
 * kebab-case because they are a service contract; the catalogue is camelCase
 * because every other key in it is, so the mapping is written down once here
 * rather than being derived by a string transform nobody can grep for.
 */
const PRODUCT_STATE_KEYS = {
  new: "new",
  matched: "matched",
  "previously-rejected": "previouslyRejected",
} satisfies Record<CuratedProductProposalState, string>;

type Props = {
  entityId: string;
  reviewData: SubmissionReviewData;
  reviewImages: SubmissionReviewImage[];
  canEdit: boolean;
  /**
   * The brand's existing curated products, used only to classify the proposals
   * riding this review (DEV-1469). Empty is the honest default for a brand-new
   * submission — there is no brand yet, so nothing can have been rejected.
   */
  existingProducts?: ExistingCuratedProduct[];
  missingFields?: string[];
  uploadEndpoint: string;
  uploadPath: string;
  canRemovePersistedImages?: boolean;
  onSaveReview: (
    input: SaveSubmissionReviewInput,
  ) => Promise<{ error: string } | undefined>;
  onCleanupDraftImages: (
    imageIds: string[],
  ) => Promise<{ error: string } | undefined>;
};

export function ReviewDetailsEditor({
  entityId,
  reviewData,
  reviewImages,
  canEdit,
  existingProducts = [],
  missingFields = [],
  uploadEndpoint,
  uploadPath,
  canRemovePersistedImages = false,
  onSaveReview,
  onCleanupDraftImages,
}: Props) {
  const t = useTranslations("admin.submissions");
  const locale = useLocale();
  const router = useRouter();
  const [editingSection, setEditingSection] = useState<EditableSection | null>(
    null,
  );
  const [language, setLanguage] = useState<"mandarin" | "english">("mandarin");
  const [draft, setDraft] = useState<SubmissionReviewData>(reviewData);
  const [draftImages, setDraftImages] = useState<SubmissionReviewImage[]>(
    activeImages(reviewImages),
  );
  const [uploadedDraftIds, setUploadedDraftIds] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const missingLabels = missingFields.map((field) =>
    t(`missingFields.${field}`),
  );

  const data = reviewData;
  const purchaseLinks = compactLinks([
    ...PURCHASE_CHANNELS.map(
      (channel) =>
        [
          channel.key === "website"
            ? t(PURCHASE_DISPLAY_LABELS[channel.key])
            : PURCHASE_DISPLAY_LABELS[channel.key],
          channel.key === "website" ? data.websiteUrl : data[channel.camel],
        ] as [string, string | null],
    ),
  ]);
  const socialLinks = compactLinks([
    ["Instagram", data.socialInstagram],
    ["Threads", data.socialThreads],
    ["Facebook", data.socialFacebook],
  ]);
  const evidence = displayStrings(data.mitEvidence);
  // Classified on load, from the SERVER copy of the proposals: a state is what
  // the brand's catalog already knows, so it must not shift while the reviewer
  // retypes a name. The diff is pure and runs over at most a handful of rows.
  const productDiffs = diffCuratedProductProposals(
    data.products ?? [],
    existingProducts,
  );
  const productStates = new Map(
    productDiffs.map((diff) => [diff.proposal.key, diff.state]),
  );
  /**
   * A proposal the brand already holds — published or rejected — starts
   * unticked, which is the whole point of the diff: re-approving a rejection
   * would insert it a second time under a suffixed key.
   */
  const defaultKeptProductKeys = productDiffs
    .filter((diff) => diff.state === "new")
    .map((diff) => diff.proposal.key);
  const keptProductKeys = data.keptProductKeys ?? defaultKeptProductKeys;
  const gallery = activeImages(reviewImages);
  const reputation = parseReputationSummary(data.reputationSummary);
  const hasEnglishNarrative = Boolean(
    nonEmptyString(data.descriptionEn) ||
    nonEmptyString(data.blurbEn) ||
    reputation.textEn,
  );
  const narrative =
    language === "english"
      ? {
          description: data.descriptionEn,
          blurb: data.blurbEn,
          reputation: reputation.textEn ?? reputation.text,
        }
      : {
          description: data.description,
          blurb: data.blurb,
          reputation: reputation.text,
        };

  function update<K extends keyof SubmissionReviewData>(
    key: K,
    value: SubmissionReviewData[K],
  ) {
    setDraft((current) => ({ ...current, [key]: value }));
  }

  function handleUpload(url: string, metadata?: ImageUploadMetadata) {
    if (!isReviewImageMetadata(metadata)) {
      setError(t("errors.invalidUploadResponse"));
      return;
    }
    if (draftImages.length >= MAX_BRAND_ACTIVE_IMAGES) {
      setError(t("errors.imageLimit"));
      return;
    }

    const image = metadata as unknown as SubmissionReviewImage;
    setDraftImages((current) => [
      ...current,
      { ...image, sortOrder: current.length },
    ]);
    setUploadedDraftIds((current) => [...current, image.id]);
    if (draftImages.length === 0) {
      update("heroImageUrl", url);
    }
  }

  function removeImage(imageId: string) {
    setDraftImages((current) =>
      reorderImages(current.filter((image) => image.id !== imageId)),
    );
  }

  function moveImage(imageId: string, offset: -1 | 1) {
    setDraftImages((current) => {
      const index = current.findIndex((image) => image.id === imageId);
      const nextIndex = index + offset;
      if (index < 0 || nextIndex < 0 || nextIndex >= current.length) {
        return current;
      }
      const next = [...current];
      [next[index], next[nextIndex]] = [next[nextIndex]!, next[index]!];
      return reorderImages(next);
    });
  }

  function setHero(imageId: string) {
    const hero = draftImages.find((image) => image.id === imageId);
    if (!hero) return;
    update("heroImageUrl", hero.url);
    setDraftImages(
      reorderImages([
        hero,
        ...draftImages.filter((image) => image.id !== imageId),
      ]),
    );
  }

  function startEditing(section: EditableSection) {
    // THE COMPUTED TICK SET IS NEVER SEEDED INTO THE DRAFT. It used to be, so
    // that a save right after opening recorded what was shown — but the baseline
    // carries no `keptProductKeys`, so an UNEDITED save wrote a phantom tick set
    // to `review_overrides.kept_product_keys`. After a phase re-run `products`
    // then comes from the fresh `enriched_data` while the stored keys still name
    // the old proposals, and because the column is defined, `materialize` skips
    // its "every new proposal is kept" default and files every fresh proposal as
    // `visible=false` rejection memory for a decision nobody made. A real tick
    // still persists: `setKept` rebuilds the full list from the displayed
    // default, so the first click writes the whole set.
    setDraft(reviewData);
    setDraftImages(activeImages(reviewImages));
    setUploadedDraftIds([]);
    setError(null);
    setEditingSection(section);
  }

  function handleSave() {
    const orderedImages = reorderImages(draftImages);
    const hero = orderedImages[0] ?? null;
    const purchaseFields = Object.fromEntries(
      PURCHASE_CHANNELS.map((channel) => [
        channel.camel,
        channel.key === "website" ? draft.websiteUrl : draft[channel.camel],
      ]),
    ) as Pick<SubmissionReviewData, PurchaseChannelCamelField>;
    const input: SaveSubmissionReviewInput = {
      ...draft,
      heroImageUrl: hero?.url ?? null,
      ...purchaseFields,
      images: orderedImages.map((image, index) => ({
        id: image.id,
        sortOrder: index,
      })),
    };

    startTransition(async () => {
      setError(null);
      const result = await onSaveReview(input);
      if (result?.error) {
        setError(result.error);
        return;
      }
      setEditingSection(null);
      setUploadedDraftIds([]);
      toast.success(t("saved"));
      router.refresh();
    });
  }

  function handleCancel() {
    startTransition(async () => {
      setError(null);
      if (uploadedDraftIds.length > 0) {
        const result = await onCleanupDraftImages(uploadedDraftIds);
        if (result?.error) {
          setError(result.error);
          return;
        }
      }
      setDraft(reviewData);
      setDraftImages(activeImages(reviewImages));
      setUploadedDraftIds([]);
      setEditingSection(null);
    });
  }

  return (
    <section
      id={entityId}
      aria-label={t("reviewDetails")}
      className="space-y-6"
    >
      {missingLabels.length > 0 && (
        <div className="rounded-md border border-destructive/30 bg-destructive/5 p-4">
          <p className="type-body-sm font-medium text-ink">{t("missingRequired")}</p>
          <ul className="mt-2 list-disc space-y-1 pl-5 type-body-sm">
            {missingLabels.map((label) => (
              <li key={label}>{label}</li>
            ))}
          </ul>
        </div>
      )}

      <Tabs
        value={language}
        onValueChange={(value) => setLanguage(value as "mandarin" | "english")}
      >
        <TabsList aria-label={t("details.languageTabs.label")}>
          <TabsTrigger value="mandarin">
            {t("details.languageTabs.mandarin")}
          </TabsTrigger>
          <TabsTrigger value="english" disabled={!hasEnglishNarrative}>
            {t("details.languageTabs.english")}
          </TabsTrigger>
        </TabsList>
      </Tabs>

      <div className="grid gap-8 xl:grid-cols-[minmax(0,1fr)_minmax(320px,0.65fr)]">
        <div className="space-y-7">
          <InlineEditSection
            title={t("details.content")}
            canEdit={canEdit}
            editing={editingSection === "content"}
            onEdit={() => startEditing("content")}
            onSave={handleSave}
            onCancel={handleCancel}
            isPending={isPending}
            error={error}
          >
            {editingSection === "content" ? (
              <ContentEditor draft={draft} onUpdate={update} />
            ) : (
              <div className="space-y-5">
                <ValueBlock
                  label={t("fields.description")}
                  value={narrative.description}
                />
                <ValueBlock
                  label={t("details.blurb")}
                  value={narrative.blurb}
                />
              </div>
            )}
          </InlineEditSection>

          <InlineEditSection
            title={t("details.reputation")}
            canEdit={canEdit}
            editing={editingSection === "reputation"}
            onEdit={() => startEditing("reputation")}
            onSave={handleSave}
            onCancel={handleCancel}
            isPending={isPending}
            error={error}
          >
            {editingSection === "reputation" ? (
              <ReputationEditor draft={draft} onUpdate={update} />
            ) : (
              <ReputationReadOnly
                summary={narrative.reputation}
                sources={reputation.sources}
              />
            )}
          </InlineEditSection>

          <InlineEditSection
            title={t("details.catalog")}
            canEdit={canEdit}
            editing={editingSection === "catalog"}
            onEdit={() => startEditing("catalog")}
            onSave={handleSave}
            onCancel={handleCancel}
            isPending={isPending}
            error={error}
          >
            {editingSection === "catalog" ? (
              <CatalogEditor draft={draft} onUpdate={update} />
            ) : (
              <div className="space-y-3">
                <dl className="grid gap-4 sm:grid-cols-2">
                  <Definition
                    label={t("fields.categorySlug")}
                    value={
                      data.categorySlug
                        ? (getCategoryLabel(data.categorySlug) ??
                          data.categorySlug)
                        : null
                    }
                  />
                  <Definition
                    label={t("details.priceRange")}
                    value={data.priceRange ? "$".repeat(data.priceRange) : null}
                  />
                  <Definition label={t("details.city")} value={data.city} />
                  <Definition
                    label={t("details.foundingYear")}
                    value={data.foundingYear?.toString() ?? null}
                  />
                </dl>
                {data.subcategories.length > 0 && (
                  <div className="flex flex-wrap gap-2">
                    {/*
                      Stored values are slugs since DEV-1510, so they need a
                      locale to render. `/admin` is English-pinned — `proxy.ts`
                      sets ADMIN_DEFAULT_LOCALE, and the admin layout mounts
                      `getMessages({ locale: "en" })` — so the real locale is
                      read exactly as the corrections queue reads it. Pinning
                      zh-TW here made one slug show two names across two admin
                      screens.
                    */}
                    {data.subcategories.map((tag) => (
                      <Badge key={tag} variant="secondary">
                        {subcategoryDisplayLabel(tag, locale)}
                      </Badge>
                    ))}
                  </div>
                )}
              </div>
            )}
          </InlineEditSection>

          {/*
            Rendered only when a run actually proposed something. The same
            editor serves the brand detail page, where there are no proposals at
            all, and an empty section there would read as a broken feature.
          */}
          {(data.products?.length ?? 0) > 0 && (
            <InlineEditSection
              title={t("details.products")}
              saveLabel={t("details.productEditor.save")}
              canEdit={canEdit}
              editing={editingSection === "products"}
              onEdit={() => startEditing("products")}
              onSave={handleSave}
              onCancel={handleCancel}
              isPending={isPending}
              error={error}
            >
              {editingSection === "products" ? (
                <ProductProposalsEditor
                  proposals={draft.products ?? []}
                  keptKeys={draft.keptProductKeys ?? keptProductKeys}
                  states={productStates}
                  onProposalsChange={(products) => update("products", products)}
                  onKeptKeysChange={(keys) => update("keptProductKeys", keys)}
                />
              ) : (
                <ProductProposalsReadOnly
                  proposals={data.products ?? []}
                  keptKeys={keptProductKeys}
                  states={productStates}
                />
              )}
            </InlineEditSection>
          )}

          <InlineEditSection
            title={t("details.links")}
            canEdit={canEdit}
            editing={editingSection === "links"}
            onEdit={() => startEditing("links")}
            onSave={handleSave}
            onCancel={handleCancel}
            isPending={isPending}
            error={error}
          >
            {editingSection === "links" ? (
              <LinksEditor draft={draft} onUpdate={update} />
            ) : (
              <div className="space-y-4">
                {purchaseLinks.length > 0 && (
                  <LinkList
                    title={t("fields.purchaseLinks")}
                    links={purchaseLinks}
                  />
                )}
                {socialLinks.length > 0 && (
                  <LinkList
                    title={t("fields.socialLinks")}
                    links={socialLinks}
                  />
                )}
                {data.otherUrls.length > 0 && (
                  <LinkList
                    title={t("details.otherLinks")}
                    links={data.otherUrls.map((link) => [
                      link.label || link.url,
                      link.url,
                    ])}
                  />
                )}
              </div>
            )}
          </InlineEditSection>

          <InlineEditSection
            title={t("details.mitEvidence")}
            canEdit={canEdit}
            editing={editingSection === "evidence"}
            onEdit={() => startEditing("evidence")}
            onSave={handleSave}
            onCancel={handleCancel}
            isPending={isPending}
            error={error}
          >
            {editingSection === "evidence" ? (
              <StringListEditor
                value={data.mitEvidence}
                onChange={(lines) => update("mitEvidence", lines)}
              />
            ) : (
              <StringListReadOnly values={evidence} />
            )}
          </InlineEditSection>
        </div>

        <InlineEditSection
          title={t("fields.heroImages")}
          canEdit={canEdit}
          editing={editingSection === "images"}
          onEdit={() => startEditing("images")}
          onSave={handleSave}
          onCancel={handleCancel}
          isPending={isPending}
          error={error}
        >
          {editingSection === "images" ? (
            <div className="space-y-4">
              <div className="grid gap-3 sm:grid-cols-2">
                {draftImages.map((image, index) => {
                  // The SAME helper the public surfaces use, including the
                  // focal `object-position` these previews used to omit. A
                  // moderation preview that frames an image differently from
                  // production is worse than no preview: it approves a crop
                  // nobody will ever see. `logoPlate` stays, because unlike the
                  // public cards there is no container behind this image.
                  const fill = brandImageFill(image, {
                    inset: "p-6",
                    logoPlate: "bg-muted",
                  });
                  return (
                    <div
                      key={image.id}
                      className="overflow-hidden rounded-md border bg-card"
                    >
                      <div className="relative">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={image.url}
                          alt={image.altZh ?? t("imageAlt", { n: index + 1 })}
                          className={cn("aspect-media w-full", fill.className)}
                          // Assigned, never spread — `undefined` is meaningful here.
                          style={fill.style}
                        />
                        <Button
                          shape="pill"
                          variant={index === 0 ? "primary" : "secondary"}
                          className="absolute left-2 top-2 h-12 w-12 p-0 shadow-sm"
                          onClick={() => setHero(image.id)}
                          aria-label={t("setHero", { n: index + 1 })}
                        >
                          <Star className="size-4" aria-hidden="true" />
                        </Button>
                      </div>
                      <div className="grid grid-cols-3 gap-1 border-t p-2">
                        <Button
                          shape="square"
                          size="icon"
                          variant="ghost"
                          className="h-12 w-full"
                          onClick={() => moveImage(image.id, -1)}
                          disabled={index === 0}
                          aria-label={t("moveLeft", { n: index + 1 })}
                        >
                          <ChevronLeft className="size-4" aria-hidden="true" />
                        </Button>
                        <Button
                          shape="square"
                          size="icon"
                          variant="ghost"
                          className="h-12 w-full"
                          onClick={() => moveImage(image.id, 1)}
                          disabled={index === draftImages.length - 1}
                          aria-label={t("moveRight", { n: index + 1 })}
                        >
                          <ChevronRight className="size-4" aria-hidden="true" />
                        </Button>
                        <Button
                          shape="square"
                          size="icon"
                          className="h-12 w-full"
                          variant="ghost"
                          onClick={() => removeImage(image.id)}
                          disabled={
                            !canRemovePersistedImages &&
                            image.originBrandImageId !== null &&
                            (image.source === "owner" || image.source === "admin")
                          }
                          aria-label={t("removeImage", { n: index + 1 })}
                        >
                          <Trash2 className="size-4" aria-hidden="true" />
                        </Button>
                      </div>
                    </div>
                  );
                })}
              </div>
              {draftImages.length < MAX_BRAND_ACTIVE_IMAGES && (
                <ImageUploader
                  mode="multi"
                  bucket="brand-images"
                  path={uploadPath}
                  value={[]}
                  maxFiles={MAX_BRAND_ACTIVE_IMAGES - draftImages.length}
                  uploadEndpoint={uploadEndpoint}
                  onUpload={handleUpload}
                />
              )}
            </div>
          ) : (
            <>
              {gallery.length > 0 ? (
                <div className="grid grid-cols-2 gap-3">
                  {gallery.map((image, index) => {
                    // Same helper, same reasoning as the draft grid above.
                    const fill = brandImageFill(image, {
                      inset: "p-6",
                      logoPlate: "bg-muted",
                    });
                    return (
                      <figure
                        key={image.id}
                        className={index === 0 ? "col-span-2" : undefined}
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={image.url}
                          alt={image.altZh ?? t("imageAlt", { n: index + 1 })}
                          className={cn(
                            "aspect-media w-full rounded-md border",
                            fill.className,
                          )}
                          // Assigned, never spread — `undefined` is meaningful here.
                          style={fill.style}
                        />
                        {index === 0 && (
                          <figcaption className="mt-1 type-metadata">
                            {t("fields.mainImage")}
                          </figcaption>
                        )}
                      </figure>
                    );
                  })}
                </div>
              ) : (
                <p className="type-body-sm">{t("fields.noImages")}</p>
              )}
            </>
          )}
        </InlineEditSection>
      </div>
    </section>
  );
}

function InlineEditSection({
  title,
  canEdit = false,
  editing = false,
  onEdit,
  onSave,
  onCancel,
  isPending = false,
  error = null,
  saveLabel,
  children,
}: {
  title: string;
  canEdit?: boolean;
  editing?: boolean;
  onEdit?: () => void;
  onSave?: () => void;
  onCancel?: () => void;
  isPending?: boolean;
  error?: string | null;
  /**
   * Overrides the generic "Save" for a section whose save does something the
   * word alone does not describe. Undefined keeps the shared label.
   */
  saveLabel?: string;
  children: React.ReactNode;
}) {
  const t = useTranslations("admin.submissions");
  return (
    <DetailSection
      title={title}
      canEdit={canEdit}
      editing={editing}
      onEdit={onEdit}
      onSave={onSave}
      onCancel={onCancel}
      isPending={isPending}
      error={error}
      editLabel={t("edit")}
      saveLabel={saveLabel ?? t("save")}
      cancelLabel={t("cancel")}
    >
      {children}
    </DetailSection>
  );
}

function ContentEditor({
  draft,
  onUpdate,
}: {
  draft: SubmissionReviewData;
  onUpdate: <K extends keyof SubmissionReviewData>(
    key: K,
    value: SubmissionReviewData[K],
  ) => void;
}) {
  const t = useTranslations("admin.submissions");
  return (
    <div className="space-y-3">
      <Field label={t("details.brandName")}>
        <Input
          value={draft.name}
          onChange={(event) => onUpdate("name", event.target.value)}
        />
      </Field>
      <div className="grid gap-4 lg:grid-cols-2">
        <Field label={t("details.chineseDescription")}>
          <Textarea
            value={draft.description ?? ""}
            onChange={(event) =>
              onUpdate("description", emptyToNull(event.target.value))
            }
          />
        </Field>
        <Field label={t("details.englishDescription")}>
          <Textarea
            value={draft.descriptionEn ?? ""}
            onChange={(event) =>
              onUpdate("descriptionEn", emptyToNull(event.target.value))
            }
          />
        </Field>
        <Field label={t("details.chineseBlurb")}>
          <Textarea
            value={draft.blurb ?? ""}
            onChange={(event) =>
              onUpdate("blurb", emptyToNull(event.target.value))
            }
          />
        </Field>
        <Field label={t("details.englishBlurb")}>
          <Textarea
            value={draft.blurbEn ?? ""}
            onChange={(event) =>
              onUpdate("blurbEn", emptyToNull(event.target.value))
            }
          />
        </Field>
      </div>
    </div>
  );
}

function CatalogEditor({
  draft,
  onUpdate,
}: {
  draft: SubmissionReviewData;
  onUpdate: <K extends keyof SubmissionReviewData>(
    key: K,
    value: SubmissionReviewData[K],
  ) => void;
}) {
  const t = useTranslations("admin.submissions");
  const locale = useLocale();
  return (
    <div className="space-y-3">
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <Field label={t("fields.categorySlug")}>
          <Select
            value={draft.categorySlug ?? EMPTY_SELECT_VALUE}
            onValueChange={(value) =>
              onUpdate(
                "categorySlug",
                value === EMPTY_SELECT_VALUE ? null : value,
              )
            }
          >
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={EMPTY_SELECT_VALUE}>{t("notSet")}</SelectItem>
              {L1_CATEGORIES.map((category) => (
                <SelectItem key={category.slug} value={category.slug}>
                  {category.nameZh} ({category.name})
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <Field label={t("details.priceRange")}>
          <Select
            value={draft.priceRange?.toString() ?? EMPTY_SELECT_VALUE}
            onValueChange={(value) =>
              onUpdate(
                "priceRange",
                value === EMPTY_SELECT_VALUE ? null : Number(value),
              )
            }
          >
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={EMPTY_SELECT_VALUE}>{t("notSet")}</SelectItem>
              {[1, 2, 3].map((value) => (
                <SelectItem key={value} value={value.toString()}>
                  {" "}
                  {"$".repeat(value)}{" "}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <Field label={t("details.city")}>
          <Input
            value={draft.city ?? ""}
            onChange={(event) =>
              onUpdate("city", emptyToNull(event.target.value))
            }
          />
        </Field>
        <Field label={t("details.foundingYear")}>
          <Input
            type="number"
            value={draft.foundingYear ?? ""}
            onChange={(event) =>
              onUpdate(
                "foundingYear",
                event.target.value ? Number(event.target.value) : null,
              )
            }
          />
        </Field>
      </div>
      {/*
        Was a comma-separated free-text field where admins typed 中文. It is now
        the same closed picker the owner wizard and the correction dialog use:
        one vocabulary, one component, and a rejected term is logged instead of
        being typed straight into the column.
      */}
      <SubcategoryPicker
        value={draft.subcategories}
        onChange={(next) => {
          onUpdate("subcategories", next);
          onUpdate("subcategoriesEn", deriveSubcategoriesEn(next));
        }}
        surface="admin-review"
        // The route's own locale, which `/admin` pins to English. The queue
        // beside this editor renders the same slugs through `useLocale`, and
        // two labels for one slug is how an admin reads a mismatch as a data
        // problem.
        locale={locale}
        priorityCategorySlug={draft.categorySlug}
        labels={{
          search: t("details.subcategories"),
          searchHint: t("details.subcategoriesSearchHint"),
          selected: t("details.subcategoriesSelectedHeading"),
          options: t("details.subcategoriesOptionsHeading"),
          limit: t("details.subcategoriesLimit"),
          rejected: t("details.subcategoriesRejected"),
          empty: t("details.subcategoriesEmpty"),
        }}
      />
    </div>
  );
}

type ProductProposalStates = Map<string, CuratedProductProposalState>;

/**
 * What the run proposed, and what the review decided about it. Read-only view:
 * it renders the SERVER copy, like every other section here, so a
 * `router.refresh()` after a save is what updates it.
 */
function ProductProposalsReadOnly({
  proposals,
  keptKeys,
  states,
}: {
  proposals: CuratedProductProposal[];
  keptKeys: string[];
  states: ProductProposalStates;
}) {
  const t = useTranslations("admin.submissions");

  return (
    <ul className="space-y-3">
      {proposals.map((proposal) => {
        // `enriched_data` is JSONB written by an enrichment phase, so a field
        // the type declares required can still be missing on a stored row. A
        // dereference that threw here would blank the whole review drawer and
        // block the approval, not just this row.
        const subcategories = proposal.subcategories ?? [];
        const material = proposal.material ?? [];

        return (
          <li
            key={proposal.key}
            className="space-y-3 rounded-md border border-border p-4"
          >
            <div className="flex flex-wrap items-center gap-2">
              <p className="type-body-sm font-medium text-ink">{proposalTitle(proposal)}</p>
              <ProposalStateBadges
                state={states.get(proposal.key) ?? "new"}
                kept={keptKeys.includes(proposal.key)}
              />
            </div>
            <dl className="grid gap-4 sm:grid-cols-2">
              <Definition
                label={t("details.productEditor.category")}
                value={getCategoryLabel(proposal.category) ?? proposal.category}
              />
            </dl>
            {(subcategories.length > 0 || material.length > 0) && (
              <div className="flex flex-wrap gap-2">
                {subcategories.map((slug) => (
                  <Badge key={`subcategory-${slug}`} variant="outline">
                    {subcategoryBySlug(slug)?.nameZh ?? slug}
                  </Badge>
                ))}
                {material.map((slug) => (
                  <Badge key={`material-${slug}`} variant="secondary">
                    {materialBySlug(slug)?.nameZh ?? slug}
                  </Badge>
                ))}
              </div>
            )}
            <p className="whitespace-pre-wrap type-body-sm text-ink-soft">
              {proposal.productDescriptionZh}
            </p>
            <ProposalSourceLinks proposal={proposal} />
          </li>
        );
      })}
    </ul>
  );
}

/**
 * Ticking is the job; retyping is the fallback. Every field is editable because
 * a proposal is a machine's reading of a product page, but the keep toggle is
 * what the reviewer is here for — so it leads each row and its label names the
 * product rather than saying "keep".
 *
 * Only the proposal payload is touched. Nothing here writes `enriched_data`:
 * edits ride `review_overrides` like every other section, and approval is what
 * turns a kept proposal into a `curated_products` row.
 */
function ProductProposalsEditor({
  proposals,
  keptKeys,
  states,
  onProposalsChange,
  onKeptKeysChange,
}: {
  proposals: CuratedProductProposal[];
  keptKeys: string[];
  states: ProductProposalStates;
  onProposalsChange: (proposals: CuratedProductProposal[]) => void;
  onKeptKeysChange: (keys: string[]) => void;
}) {
  const t = useTranslations("admin.submissions");
  const fieldId = useId();

  function patchProposal(
    index: number,
    patch: Partial<CuratedProductProposal>,
  ) {
    onProposalsChange(
      proposals.map((proposal, proposalIndex) =>
        proposalIndex === index ? { ...proposal, ...patch } : proposal,
      ),
    );
  }

  /** Rebuilt from the proposal order, so the saved set never depends on click order. */
  function setKept(key: string, kept: boolean) {
    onKeptKeysChange(
      proposals
        .filter((proposal) =>
          proposal.key === key ? kept : keptKeys.includes(proposal.key),
        )
        .map((proposal) => proposal.key),
    );
  }

  return (
    <div className="space-y-4">
      {proposals.map((proposal, index) => {
        const rowId = `${fieldId}-${index}`;
        // Same reason as the read-only view: a stored proposal can be missing a
        // field the type declares required.
        const subcategories = proposal.subcategories ?? [];
        const material = proposal.material ?? [];
        const subcategoryOptions = L2_SUBCATEGORIES.filter(
          (subcategory) => subcategory.category === proposal.category,
        );

        const state = states.get(proposal.key) ?? "new";
        // MATERIALIZATION IS CREATE-ONLY: approval inserts a row for a `new`
        // proposal and does nothing at all for one the brand already holds,
        // published or rejected. An enabled control on those rows asserts an
        // effect it cannot have — the tick and the retyped name were accepted,
        // saved, and then silently discarded at approval. Locking the row is the
        // honest reading of that rule, and the note below says so on screen
        // rather than only in a tooltip.
        const locked = state !== "new";

        return (
          <fieldset
            key={proposal.key}
            className="space-y-3 rounded-md border border-border p-4"
          >
            <legend className="type-metadata">
              {t("details.productEditor.item", { number: index + 1 })}
            </legend>
            <div className="flex flex-wrap items-center gap-2">
              {/*
                The box and its text share ONE 48x48 hit target, the treatment
                `brand-list` gives its row checkboxes: a 20x20 box beside a
                separate label is below the 44x44 minimum on touch.
              */}
              <Label
                htmlFor={`${rowId}-keep`}
                className="min-h-12 min-w-12 cursor-pointer py-3"
              >
                <Checkbox
                  id={`${rowId}-keep`}
                  className="size-5"
                  checked={keptKeys.includes(proposal.key)}
                  disabled={locked}
                  onCheckedChange={(checked) => setKept(proposal.key, checked)}
                />
                {t("details.productEditor.keep", { name: proposal.nameZh })}
              </Label>
              <ProposalStateBadges
                state={state}
                kept={keptKeys.includes(proposal.key)}
              />
            </div>
            {locked && (
              <p className="type-metadata">
                {t("details.productEditor.locked")}
              </p>
            )}
            <div className="grid gap-4 md:grid-cols-2">
              <Field label={t("details.productEditor.nameZh")}>
                <Input
                  value={proposal.nameZh ?? ""}
                  disabled={locked}
                  onChange={(event) =>
                    patchProposal(index, { nameZh: event.target.value })
                  }
                />
              </Field>
              <Field label={t("details.productEditor.nameEn")}>
                <Input
                  value={proposal.nameEn ?? ""}
                  disabled={locked}
                  onChange={(event) =>
                    patchProposal(index, {
                      nameEn: emptyToNull(event.target.value) ?? undefined,
                    })
                  }
                />
              </Field>
            </div>
            <Field label={t("details.productEditor.category")}>
              <NativeSelect
                value={proposal.category}
                disabled={locked}
                onChange={(event) =>
                  // A subcategory slug exists only inside one category, so a
                  // category change clears them rather than carrying dead tags
                  // into the new branch.
                  patchProposal(index, {
                    category: event.target.value,
                    subcategories: [],
                  })
                }
              >
                {L1_CATEGORIES.map((category) => (
                  <option key={category.slug} value={category.slug}>
                    {category.nameZh} ({category.name})
                  </option>
                ))}
              </NativeSelect>
            </Field>
            <fieldset className="space-y-2">
              <legend className="type-metadata">
                {t("details.productEditor.subcategories")}
              </legend>
              <div className="flex flex-wrap gap-2">
                {subcategoryOptions.map((subcategory) => (
                  <ToggleChip
                    key={subcategory.slug}
                    pressed={subcategories.includes(subcategory.slug)}
                    disabled={locked}
                    onPressedChange={(pressed) =>
                      patchProposal(index, {
                        subcategories: toggleSlug(
                          subcategories,
                          subcategory.slug,
                          pressed,
                        ),
                      })
                    }
                  >
                    {subcategory.nameZh}
                  </ToggleChip>
                ))}
              </div>
            </fieldset>
            <fieldset className="space-y-2">
              <legend className="type-metadata">
                {t("details.productEditor.material")}
              </legend>
              <div className="flex flex-wrap gap-2">
                {MATERIALS.map((option) => (
                  <ToggleChip
                    key={option.slug}
                    pressed={material.includes(option.slug)}
                    disabled={locked}
                    onPressedChange={(pressed) =>
                      patchProposal(index, {
                        material: toggleSlug(material, option.slug, pressed),
                      })
                    }
                  >
                    {option.nameZh}
                  </ToggleChip>
                ))}
              </div>
            </fieldset>
            <Field label={t("details.productEditor.officialUrl")}>
              <Input
                type="url"
                value={proposal.officialUrl ?? ""}
                disabled={locked}
                onChange={(event) =>
                  patchProposal(index, { officialUrl: event.target.value })
                }
              />
            </Field>
            <Field label={t("details.productEditor.description")}>
              <Textarea
                value={proposal.productDescriptionZh ?? ""}
                disabled={locked}
                onChange={(event) =>
                  patchProposal(index, {
                    productDescriptionZh: event.target.value,
                  })
                }
              />
            </Field>
            <p className="type-metadata">
              {t("details.productEditor.descriptionHint")}
            </p>
            <ProposalSourceLinks proposal={proposal} />
          </fieldset>
        );
      })}
    </div>
  );
}

function ProposalStateBadges({
  state,
  kept,
}: {
  state: CuratedProductProposalState;
  kept: boolean;
}) {
  const t = useTranslations("admin.submissions");

  return (
    <>
      <Badge variant={state === "previously-rejected" ? "warning" : "outline"}>
        {t(`details.productEditor.state.${PRODUCT_STATE_KEYS[state]}`)}
      </Badge>
      {/* The accent means one thing here: a change being proposed. */}
      <Badge variant={kept ? "default" : "declared"}>
        {kept
          ? t("details.productEditor.keeping")
          : t("details.productEditor.dropping")}
      </Badge>
    </>
  );
}

/**
 * The proposal's own page plus whatever it cites, deduplicated: a proposal
 * normally cites the page it was read from, and rendering that twice would say
 * there is more evidence than there is. Deliberately not a nested list — the
 * proposals are the list.
 */
function ProposalSourceLinks({
  proposal,
}: {
  proposal: CuratedProductProposal;
}) {
  const t = useTranslations("admin.submissions");
  const urls = [
    ...new Set(
      [
        proposal.officialUrl,
        ...(proposal.sources ?? []).map((source) => source.url),
      ]
        .map((url) => url?.trim())
        .filter((url): url is string => Boolean(url)),
    ),
  ];
  if (urls.length === 0) return null;

  return (
    <div className="space-y-1">
      <p className="type-metadata">{t("details.productEditor.sources")}</p>
      <div className="flex flex-col gap-1">
        {urls.map((url) => (
          <a
            key={url}
            className="type-nav font-semibold text-accent underline-offset-4 hover:underline break-all"
            href={url}
            target="_blank"
            rel="noreferrer"
          >
            {url}
          </a>
        ))}
      </div>
    </div>
  );
}

function proposalTitle(proposal: CuratedProductProposal): string {
  return proposal.nameEn
    ? `${proposal.nameZh} (${proposal.nameEn})`
    : proposal.nameZh;
}

/** Adds or removes one slug without duplicating it or reordering what is there. */
function toggleSlug(
  slugs: string[],
  slug: string,
  selected: boolean,
): string[] {
  if (!selected) return slugs.filter((value) => value !== slug);
  return slugs.includes(slug) ? slugs : [...slugs, slug];
}

function LinksEditor({
  draft,
  onUpdate,
}: {
  draft: SubmissionReviewData;
  onUpdate: <K extends keyof SubmissionReviewData>(
    key: K,
    value: SubmissionReviewData[K],
  ) => void;
}) {
  const t = useTranslations("admin.submissions");
  return (
    <div className="space-y-4">
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {PURCHASE_CHANNELS.map((channel) => (
          <UrlField
            key={channel.camel}
            label={
              channel.key === "website"
                ? t(PURCHASE_DISPLAY_LABELS[channel.key])
                : PURCHASE_DISPLAY_LABELS[channel.key]
            }
            value={
              channel.key === "website" ? draft.websiteUrl : draft[channel.camel]
            }
            onChange={(value) => {
              if (channel.key === "website") onUpdate("websiteUrl", value);
              else onUpdate(channel.camel, value);
            }}
          />
        ))}
        <UrlField
          label="Instagram"
          value={draft.socialInstagram}
          onChange={(value) => onUpdate("socialInstagram", value)}
        />
        <UrlField
          label="Threads"
          value={draft.socialThreads}
          onChange={(value) => onUpdate("socialThreads", value)}
        />
        <UrlField
          label="Facebook"
          value={draft.socialFacebook}
          onChange={(value) => onUpdate("socialFacebook", value)}
        />
      </div>
      <OtherUrlEditor
        links={draft.otherUrls}
        onChange={(links) => onUpdate("otherUrls", links)}
      />
    </div>
  );
}

function ReputationReadOnly({
  summary,
  sources,
}: {
  summary: string | null;
  sources: ReputationSource[];
}) {
  const t = useTranslations("admin.submissions");
  if (!summary && sources.length === 0)
    return <p className="type-body-sm">—</p>;

  return (
    <>
      {summary && <p className="whitespace-pre-wrap type-body-sm text-ink-soft">{summary}</p>}
      {sources.length > 0 && (
        <div className="space-y-1">
          <p className="type-metadata">{t("details.reputationSources")}</p>
          <ul className="flex flex-wrap gap-x-3 gap-y-1">
            {sources.map((source) => (
              <li key={source.href}>
                <a
                  className="type-nav font-semibold text-accent underline-offset-4 hover:underline"
                  href={source.href}
                  target="_blank"
                  rel="noreferrer"
                >
                  {source.label}
                </a>
              </li>
            ))}
          </ul>
        </div>
      )}
    </>
  );
}

function ReputationEditor({
  draft,
  onUpdate,
}: {
  draft: SubmissionReviewData;
  onUpdate: <K extends keyof SubmissionReviewData>(
    key: K,
    value: SubmissionReviewData[K],
  ) => void;
}) {
  const t = useTranslations("admin.submissions");
  const parsed = parseReputationSummary(draft.reputationSummary);
  const [textZh, setTextZh] = useState(parsed.text ?? "");
  const [textEn, setTextEn] = useState(parsed.textEn ?? "");
  const [sourcesText, setSourcesText] = useState(
    parsed.sources.map((s) => s.href).join("\n"),
  );

  function sync(nextZh: string, nextEn: string, nextSourcesText: string) {
    const sources = nextSourcesText
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .map((url) => ({ url }));
    onUpdate("reputationSummary", {
      text: nextZh.trim() || null,
      text_en: nextEn.trim() || null,
      sources,
    });
  }

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Field label={t("details.chineseContent")}>
        <Textarea
          value={textZh}
          onChange={(event) => {
            setTextZh(event.target.value);
            sync(event.target.value, textEn, sourcesText);
          }}
        />
      </Field>
      <Field label={t("details.englishContent")}>
        <Textarea
          value={textEn}
          onChange={(event) => {
            setTextEn(event.target.value);
            sync(textZh, event.target.value, sourcesText);
          }}
        />
      </Field>
      <Field label={t("details.reputationSources")}>
        <Textarea
          value={sourcesText}
          placeholder="https://..."
          onChange={(event) => {
            setSourcesText(event.target.value);
            sync(textZh, textEn, event.target.value);
          }}
        />
      </Field>
    </div>
  );
}

function ValueBlock({ label, value }: { label: string; value: string | null }) {
  if (!value) return null;
  return (
    <div>
      <p className="type-metadata">{label}</p>
      <p className="mt-1 whitespace-pre-wrap type-body-sm text-ink-soft">{value}</p>
    </div>
  );
}

function Definition({ label, value }: { label: string; value: string | null }) {
  return (
    <div>
      <dt className="type-metadata">{label}</dt>
      <dd className="mt-1 type-body-sm text-ink-soft">{value ?? "—"}</dd>
    </div>
  );
}

function LinkList({
  title,
  links,
}: {
  title: string;
  links: Array<[string, string]>;
}) {
  return (
    <div>
      <p className="font-semibold type-metadata">{title}</p>
      <ul className="mt-1 space-y-1">
        {links.map(([label, url]) => (
          <li key={`${label}-${url}`}>
            <a
              className="type-nav font-semibold text-accent underline-offset-4 hover:underline break-all"
              href={url}
              target="_blank"
              rel="noreferrer"
            >
              {label}
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}

function StringListReadOnly({ values }: { values: string[] }) {
  if (values.length === 0) return <p className="type-body-sm">—</p>;
  return (
    <ul className="list-disc space-y-1 pl-5 type-body-sm text-ink-soft">
      {values.map((value) => (
        <li key={value}>{value}</li>
      ))}
    </ul>
  );
}

function StringListEditor({
  value,
  onChange,
}: {
  value: unknown;
  onChange: (value: string[]) => void;
}) {
  const strings = displayStrings(value);
  const [text, setText] = useState(strings.join("\n"));

  return (
    <Textarea
      value={text}
      rows={Math.max(3, strings.length + 1)}
      onChange={(event) => {
        setText(event.target.value);
        const lines = event.target.value
          .split("\n")
          .map((line) => line.trim())
          .filter(Boolean);
        onChange(lines);
      }}
    />
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <Label className="block space-y-1.5">
      <span>{label}</span>
      {children}
    </Label>
  );
}

function UrlField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string | null;
  onChange: (value: string | null) => void;
}) {
  return (
    <Field label={label}>
      <Input
        type="url"
        value={value ?? ""}
        onChange={(event) => onChange(emptyToNull(event.target.value))}
      />
    </Field>
  );
}

function OtherUrlEditor({
  links,
  onChange,
}: {
  links: OtherUrl[];
  onChange: (links: OtherUrl[]) => void;
}) {
  const t = useTranslations("admin.submissions");
  return (
    <div className="space-y-2">
      {links.map((link, index) => (
        <div
          key={`${index}-${link.url}`}
          className="grid gap-2 sm:grid-cols-[180px_1fr_auto]"
        >
          <Input
            aria-label={`${t("fields.label")} ${index + 1}`}
            value={link.label}
            onChange={(event) =>
              onChange(
                links.map((item, itemIndex) =>
                  itemIndex === index
                    ? { ...item, label: event.target.value }
                    : item,
                ),
              )
            }
          />
          <Input
            aria-label={`${t("fields.url")} ${index + 1}`}
            type="url"
            value={link.url}
            onChange={(event) =>
              onChange(
                links.map((item, itemIndex) =>
                  itemIndex === index
                    ? { ...item, url: event.target.value }
                    : item,
                ),
              )
            }
          />
          <Button
            className="min-h-12"
            variant="secondary"
            onClick={() =>
              onChange(links.filter((_, itemIndex) => itemIndex !== index))
            }
          >
            {t("fields.remove")}
          </Button>
        </div>
      ))}
      <Button
        className="min-h-12"
        variant="secondary"
        onClick={() => onChange([...links, { label: "", url: "" }])}
      >
        {t("fields.addLink")}
      </Button>
    </div>
  );
}

function activeImages(images: SubmissionReviewImage[]) {
  return images
    .filter((image) => image.status === "active")
    .toSorted((a, b) => a.sortOrder - b.sortOrder);
}

function reorderImages(images: SubmissionReviewImage[]) {
  return images.map((image, index) => ({ ...image, sortOrder: index }));
}

function emptyToNull(value: string) {
  const trimmed = value.trim();
  return trimmed || null;
}

function compactLinks(
  links: Array<[string, string | null]>,
): Array<[string, string]> {
  return links.filter((link): link is [string, string] => Boolean(link[1]));
}

function displayStrings(value: unknown): string[] {
  if (typeof value === "string") return value.trim() ? [value.trim()] : [];
  if (typeof value === "number" || typeof value === "boolean")
    return [String(value)];
  if (Array.isArray(value)) return [...new Set(value.flatMap(displayStrings))];
  if (value && typeof value === "object")
    return [...new Set(Object.values(value).flatMap(displayStrings))];
  return [];
}

type ReputationSource = {
  href: string;
  label: string;
};

function parseReputationSummary(value: unknown): {
  text: string | null;
  textEn: string | null;
  sources: ReputationSource[];
} {
  if (!isRecord(value)) return { text: null, textEn: null, sources: [] };

  const seen = new Set<string>();
  const sources = Array.isArray(value.sources)
    ? value.sources.flatMap((source) => {
        if (!isRecord(source)) return [];
        const href = nonEmptyString(source.url);
        if (!href || seen.has(href)) return [];

        try {
          const url = new URL(href);
          if (
            (url.protocol !== "http:" && url.protocol !== "https:") ||
            !url.hostname ||
            url.username ||
            url.password
          ) {
            return [];
          }
          seen.add(href);
          return [
            {
              href,
              label: url.hostname.replace(/^www\./i, ""),
            },
          ];
        } catch {
          return [];
        }
      })
    : [];

  return {
    text: nonEmptyString(value.text),
    textEn: nonEmptyString(value.text_en) ?? nonEmptyString(value.textEn),
    sources,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function nonEmptyString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  return value.trim() || null;
}

function isReviewImageMetadata(metadata?: ImageUploadMetadata): boolean {
  return Boolean(
    metadata &&
    typeof metadata.id === "string" &&
    typeof metadata.submissionId === "string" &&
    typeof metadata.url === "string" &&
    metadata.status === "draft",
  );
}
