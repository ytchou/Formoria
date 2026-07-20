"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { ChevronLeft, ChevronRight, Star, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { ImageUploader } from "@/components/upload/ImageUploader";
import type { ImageUploadMetadata } from "@/components/upload/useImageUpload";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { getProductTypeLabel } from "@/lib/brands/category-label";
import { PRODUCT_TYPE_CATEGORIES } from "@/lib/taxonomy/ontology";
import type { OtherUrl } from "@/lib/types";
import type {
  BrandSubmissionForReview,
  SaveSubmissionReviewInput,
  SubmissionReviewData,
  SubmissionReviewImage,
} from "@/lib/services/submissions";
import { deriveProductTagsEn } from "@/lib/services/product-tags";
import {
  cleanupSubmissionDraftImagesAction,
  saveSubmissionReviewAction,
} from "./actions";

const EMPTY_SELECT_VALUE = "__none";
const MAX_REVIEW_IMAGES = 7;

type EditableSection =
  | "content"
  | "reputation"
  | "catalog"
  | "links"
  | "evidence"
  | "locations"
  | "images";

type Props = {
  submission: BrandSubmissionForReview;
};

export function SubmissionReviewDetails({ submission }: Props) {
  const t = useTranslations("admin.submissions");
  const router = useRouter();
  const [editingSection, setEditingSection] = useState<EditableSection | null>(
    null,
  );
  const [language, setLanguage] = useState<"mandarin" | "english">("mandarin");
  const [draft, setDraft] = useState<SubmissionReviewData>(
    submission.reviewData,
  );
  const [draftImages, setDraftImages] = useState<SubmissionReviewImage[]>(
    activeImages(submission.reviewImages),
  );
  const [uploadedDraftIds, setUploadedDraftIds] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const canEdit = submission.status === "pending";
  const missingLabels = submission.reviewCompleteness.missingFields.map(
    (field) => t(`missingFields.${field}`),
  );

  const data = submission.reviewData;
  const purchaseLinks = compactLinks([
    [t("links.official"), data.websiteUrl],
    ["Pinkoi", data.purchasePinkoi],
    ["Shopee", data.purchaseShopee],
  ]);
  const socialLinks = compactLinks([
    ["Instagram", data.socialInstagram],
    ["Threads", data.socialThreads],
    ["Facebook", data.socialFacebook],
  ]);
  const evidence = displayStrings(data.mitEvidence);
  const locations = displayStrings(data.retailLocations);
  const gallery = activeImages(submission.reviewImages);
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
    if (draftImages.length >= MAX_REVIEW_IMAGES) {
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
    setDraft(submission.reviewData);
    setDraftImages(activeImages(submission.reviewImages));
    setUploadedDraftIds([]);
    setError(null);
    setEditingSection(section);
  }

  function handleSave() {
    const orderedImages = reorderImages(draftImages);
    const hero = orderedImages[0] ?? null;
    const input: SaveSubmissionReviewInput = {
      ...draft,
      heroImageUrl: hero?.url ?? null,
      purchaseWebsite: draft.websiteUrl,
      images: orderedImages.map((image, index) => ({
        id: image.id,
        isHero: index === 0,
        sortOrder: index,
      })),
    };

    startTransition(async () => {
      setError(null);
      const result = await saveSubmissionReviewAction(submission.id, input);
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
        const result = await cleanupSubmissionDraftImagesAction(
          submission.id,
          uploadedDraftIds,
        );
        if (result?.error) {
          setError(result.error);
          return;
        }
      }
      setDraft(submission.reviewData);
      setDraftImages(activeImages(submission.reviewImages));
      setUploadedDraftIds([]);
      setEditingSection(null);
    });
  }

  return (
    <section
      id={`submission-review-${submission.id}`}
      aria-label={t("reviewDetails")}
      className="space-y-6"
    >
      {submission.status === "pending" &&
        !submission.reviewCompleteness.complete && (
          <div className="rounded-md border border-destructive/30 bg-destructive/5 p-4">
            <p className="type-body-emphasis">{t("missingRequired")}</p>
            <ul className="mt-2 list-disc space-y-1 pl-5 type-card-description">
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

      {error && <p className="type-error">{error}</p>}

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
          >
            {editingSection === "catalog" ? (
              <CatalogEditor draft={draft} onUpdate={update} />
            ) : (
              <div className="space-y-3">
                <dl className="grid gap-4 sm:grid-cols-2">
                  <Definition
                    label={t("fields.productType")}
                    value={
                      data.productType
                        ? (getProductTypeLabel(data.productType) ??
                          data.productType)
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
                {data.productTags.length > 0 && (
                  <div className="flex flex-wrap gap-2">
                    {data.productTags.map((tag) => (
                      <Badge key={tag} variant="secondary">
                        {tag}
                      </Badge>
                    ))}
                  </div>
                )}
              </div>
            )}
          </InlineEditSection>

          <InlineEditSection
            title={t("details.links")}
            canEdit={canEdit}
            editing={editingSection === "links"}
            onEdit={() => startEditing("links")}
            onSave={handleSave}
            onCancel={handleCancel}
            isPending={isPending}
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

          <InlineEditSection
            title={t("details.locations")}
            canEdit={canEdit}
            editing={editingSection === "locations"}
            onEdit={() => startEditing("locations")}
            onSave={handleSave}
            onCancel={handleCancel}
            isPending={isPending}
          >
            {editingSection === "locations" ? (
              <StringListEditor
                value={data.retailLocations}
                onChange={(lines) => update("retailLocations", lines)}
              />
            ) : (
              <StringListReadOnly values={locations} />
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
        >
          {editingSection === "images" ? (
            <div className="space-y-4">
              <div className="grid gap-3 sm:grid-cols-2">
                {draftImages.map((image, index) => (
                  <div
                    key={image.id}
                    className="overflow-hidden rounded-md border bg-card"
                  >
                    <div className="relative">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={image.url}
                        alt={image.altZh ?? t("imageAlt", { n: index + 1 })}
                        className="aspect-[4/3] w-full object-cover"
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
                          image.originBrandImageId !== null &&
                          (image.source === "owner" || image.source === "admin")
                        }
                        aria-label={t("removeImage", { n: index + 1 })}
                      >
                        <Trash2 className="size-4" aria-hidden="true" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
              {draftImages.length < MAX_REVIEW_IMAGES && (
                <ImageUploader
                  mode="multi"
                  bucket="brand-images"
                  path={`submissions/${submission.id}`}
                  value={[]}
                  maxFiles={MAX_REVIEW_IMAGES - draftImages.length}
                  uploadEndpoint={`/api/admin/submissions/${submission.id}/images`}
                  onUpload={handleUpload}
                />
              )}
            </div>
          ) : (
            <>
              {gallery.length > 0 ? (
                <div className="grid grid-cols-2 gap-3">
                  {gallery.map((image, index) => (
                    <figure
                      key={image.id}
                      className={index === 0 ? "col-span-2" : undefined}
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={image.url}
                        alt={image.altZh ?? t("imageAlt", { n: index + 1 })}
                        className="aspect-[4/3] w-full rounded-md border object-cover"
                      />
                      {index === 0 && (
                        <figcaption className="mt-1 type-caption">
                          {t("fields.mainImage")}
                        </figcaption>
                      )}
                    </figure>
                  ))}
                </div>
              ) : (
                <p className="type-card-description">{t("fields.noImages")}</p>
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
  children,
}: {
  title: string;
  canEdit?: boolean;
  editing?: boolean;
  onEdit?: () => void;
  onSave?: () => void;
  onCancel?: () => void;
  isPending?: boolean;
  children: React.ReactNode;
}) {
  const t = useTranslations("admin.submissions");
  return (
    <section
      className={editing ? "space-y-4 rounded-lg bg-muted/40 p-4" : "space-y-3"}
    >
      <div className="flex items-center justify-between">
        <h3 className="type-subsection-title">{title}</h3>
        {canEdit && !editing && (
          <Button
            type="button"
            variant="ghost"
            size="compact"
            className="min-h-12"
            onClick={onEdit}
          >
            {t("edit")}
          </Button>
        )}
      </div>
      {children}
      {editing && (
        <div className="flex flex-wrap justify-end gap-2 pt-2">
          <Button
            className="min-h-12"
            variant="secondary"
            onClick={onCancel}
            disabled={isPending}
          >
            {t("cancel")}
          </Button>
          <Button
            className="min-h-12"
            variant="primary"
            onClick={onSave}
            disabled={isPending}
          >
            {t("save")}
          </Button>
        </div>
      )}
    </section>
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
  const [tagsText, setTagsText] = useState(draft.productTags.join(", "));
  return (
    <div className="space-y-3">
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <Field label={t("fields.productType")}>
          <Select
            value={draft.productType ?? EMPTY_SELECT_VALUE}
            onValueChange={(value) =>
              onUpdate(
                "productType",
                value === EMPTY_SELECT_VALUE ? null : value,
              )
            }
          >
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={EMPTY_SELECT_VALUE}>{t("notSet")}</SelectItem>
              {PRODUCT_TYPE_CATEGORIES.map((category) => (
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
      <Field label={t("details.productTags")}>
        <Input
          value={tagsText}
          onChange={(event) => {
            setTagsText(event.target.value);
            const tags = parseTags(event.target.value);
            onUpdate("productTags", tags);
            onUpdate("productTagsEn", deriveProductTagsEn(tags));
          }}
          placeholder={t("details.tagsPlaceholder")}
        />
      </Field>
    </div>
  );
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
        <UrlField
          label={t("links.official")}
          value={draft.websiteUrl}
          onChange={(value) => onUpdate("websiteUrl", value)}
        />
        <UrlField
          label="Pinkoi"
          value={draft.purchasePinkoi}
          onChange={(value) => onUpdate("purchasePinkoi", value)}
        />
        <UrlField
          label="Shopee"
          value={draft.purchaseShopee}
          onChange={(value) => onUpdate("purchaseShopee", value)}
        />
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
    return <p className="type-card-description">—</p>;

  return (
    <>
      {summary && <p className="whitespace-pre-wrap type-body">{summary}</p>}
      {sources.length > 0 && (
        <div className="space-y-1">
          <p className="type-metadata">{t("details.reputationSources")}</p>
          <ul className="flex flex-wrap gap-x-3 gap-y-1">
            {sources.map((source) => (
              <li key={source.href}>
                <a
                  className="type-link"
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
      <p className="mt-1 whitespace-pre-wrap type-body">{value}</p>
    </div>
  );
}

function Definition({ label, value }: { label: string; value: string | null }) {
  return (
    <div>
      <dt className="type-metadata">{label}</dt>
      <dd className="mt-1 type-body">{value ?? "—"}</dd>
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
              className="type-link break-all"
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
  if (values.length === 0) return <p className="type-card-description">—</p>;
  return (
    <ul className="list-disc space-y-1 pl-5 type-body">
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

function parseTags(value: string) {
  return [
    ...new Set(
      value
        .split(",")
        .map((tag) => tag.trim())
        .filter(Boolean),
    ),
  ].slice(0, 5);
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
