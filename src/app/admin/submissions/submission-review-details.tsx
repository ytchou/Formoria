"use client";

import { forwardRef, useEffect, useImperativeHandle, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { ChevronLeft, ChevronRight, Star } from "lucide-react";
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
import { Textarea } from "@/components/ui/textarea";
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

type Props = {
  submission: BrandSubmissionForReview;
};

type ReviewSection =
  "content" | "catalog" | "links" | "images" | "evidence" | "retail";

type UpdateReviewData = <K extends keyof SubmissionReviewData>(
  key: K,
  value: SubmissionReviewData[K],
) => void;

export type SubmissionReviewDetailsHandle = {
  cleanup: () => Promise<void>;
};

export const SubmissionReviewDetails = forwardRef<SubmissionReviewDetailsHandle, Props>(
  function SubmissionReviewDetails({ submission }, ref) {
  const t = useTranslations("admin.submissions");
  const router = useRouter();
  const [editingSection, setEditingSection] = useState<ReviewSection | null>(
    null,
  );
  const [draft, setDraft] = useState<SubmissionReviewData>(
    submission.reviewData,
  );
  const [draftImages, setDraftImages] = useState<SubmissionReviewImage[]>(
    activeImages(submission.reviewImages),
  );
  const draftBaseline = useRef<SubmissionReviewData>(submission.reviewData);
  const draftImagesBaseline = useRef<SubmissionReviewImage[]>(
    activeImages(submission.reviewImages),
  );
  const syncedReviewData = useRef(submission.reviewData);
  const [uploadedDraftIds, setUploadedDraftIds] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  useImperativeHandle(ref, () => ({
    cleanup: async () => {
      if (uploadedDraftIds.length > 0) {
        await cleanupSubmissionDraftImagesAction(
          submission.id,
          uploadedDraftIds,
        );
        setUploadedDraftIds([]);
      }
    },
  }));

  useEffect(() => {
    if (
      editingSection !== null ||
      syncedReviewData.current === submission.reviewData
    ) {
      return;
    }

    const images = activeImages(submission.reviewImages);
    syncedReviewData.current = submission.reviewData;
    draftBaseline.current = submission.reviewData;
    draftImagesBaseline.current = images;
    setDraft(submission.reviewData);
    setDraftImages(images);
    setUploadedDraftIds([]);
  }, [editingSection, submission.reviewData, submission.reviewImages]);

  const missingLabels = submission.reviewCompleteness.missingFields.map(
    (field) => t(`missingFields.${field}`),
  );
  const purchaseLinks = compactLinks([
    [t("links.official"), draft.websiteUrl],
    ["Pinkoi", draft.purchasePinkoi],
    ["Shopee", draft.purchaseShopee],
  ]);
  const socialLinks = compactLinks([
    ["Instagram", draft.socialInstagram],
    ["Threads", draft.socialThreads],
    ["Facebook", draft.socialFacebook],
  ]);
  const evidence = displayStrings(draft.mitEvidence);
  const reputation = displayStrings(draft.reputationSummary);
  const locations = displayStrings(draft.retailLocations);

  function update<K extends keyof SubmissionReviewData>(
    key: K,
    value: SubmissionReviewData[K],
  ) {
    setDraft((current) => ({ ...current, [key]: value }));
  }

  function startEditing(section: ReviewSection) {
    startTransition(async () => {
      setError(null);
      let nextDraft = draft;
      let nextImages = draftImages;

      if (editingSection !== null) {
        if (editingSection === "images" && uploadedDraftIds.length > 0) {
          const result = await cleanupSubmissionDraftImagesAction(
            submission.id,
            uploadedDraftIds,
          );
          if (result?.error) {
            setError(result.error);
            return;
          }
        }
        nextDraft = draftBaseline.current;
        nextImages = draftImagesBaseline.current;
        setDraft(nextDraft);
        setDraftImages(nextImages);
      }

      draftBaseline.current = nextDraft;
      draftImagesBaseline.current = nextImages;
      setUploadedDraftIds([]);
      setEditingSection(section);
    });
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

  function handleSave() {
    const orderedImages = reorderImages(draftImages);
    const hero = orderedImages[0] ?? null;
    const savedDraft: SubmissionReviewData = {
      ...draft,
      heroImageUrl: hero?.url ?? null,
      purchaseWebsite: draft.websiteUrl,
    };
    const input: SaveSubmissionReviewInput = {
      ...savedDraft,
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
      setDraft(savedDraft);
      setDraftImages(orderedImages);
      draftBaseline.current = savedDraft;
      draftImagesBaseline.current = orderedImages;
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
      setDraft(draftBaseline.current);
      setDraftImages(draftImagesBaseline.current);
      setUploadedDraftIds([]);
      setEditingSection(null);
    });
  }

  return (
    <div
      id={`submission-review-${submission.id}`}
      aria-label={t("reviewDetails")}
      className="flex-1 space-y-5 overflow-y-auto p-5"
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

      <ReviewSection
        title={t("details.content")}
        section="content"
        editingSection={editingSection}
        onEdit={() => startEditing("content")}
      >
        {editingSection === "content" ? (
          <ContentEditor draft={draft} onUpdate={update} />
        ) : (
          <ContentDetails data={draft} />
        )}
        {editingSection === "content" && (
          <EditSectionActions
            error={error}
            isPending={isPending}
            onCancel={handleCancel}
            onSave={handleSave}
          />
        )}
      </ReviewSection>

      <ReviewSection
        title={t("details.catalog")}
        section="catalog"
        editingSection={editingSection}
        onEdit={() => startEditing("catalog")}
      >
        {editingSection === "catalog" ? (
          <CatalogEditor draft={draft} onUpdate={update} />
        ) : (
          <CatalogDetails data={draft} />
        )}
        {editingSection === "catalog" && (
          <EditSectionActions
            error={error}
            isPending={isPending}
            onCancel={handleCancel}
            onSave={handleSave}
          />
        )}
      </ReviewSection>

      <ReviewSection
        title={t("details.links")}
        section="links"
        editingSection={editingSection}
        onEdit={() => startEditing("links")}
      >
        {editingSection === "links" ? (
          <LinksEditor draft={draft} onUpdate={update} />
        ) : (
          <LinksDetails
            otherUrls={draft.otherUrls}
            purchaseLinks={purchaseLinks}
            socialLinks={socialLinks}
          />
        )}
        {editingSection === "links" && (
          <EditSectionActions
            error={error}
            isPending={isPending}
            onCancel={handleCancel}
            onSave={handleSave}
          />
        )}
      </ReviewSection>

      <ReviewSection
        title={t("fields.heroImages")}
        section="images"
        editingSection={editingSection}
        onEdit={() => startEditing("images")}
      >
        {editingSection === "images" ? (
          <ImagesEditor
            submissionId={submission.id}
            images={draftImages}
            onMoveImage={moveImage}
            onRemoveImage={removeImage}
            onSetHero={setHero}
            onUpload={handleUpload}
          />
        ) : (
          <ImagesDetails images={draftImages} />
        )}
        {editingSection === "images" && (
          <EditSectionActions
            error={error}
            isPending={isPending}
            onCancel={handleCancel}
            onSave={handleSave}
          />
        )}
      </ReviewSection>

      {(editingSection === "evidence" ||
        evidence.length > 0 ||
        reputation.length > 0) && (
        <ReviewSection
          title={`${t("details.mitEvidence")} / ${t("details.reputation")}`}
          section="evidence"
          editingSection={editingSection}
          onEdit={() => startEditing("evidence")}
        >
          {editingSection === "evidence" ? (
            <EvidenceEditor draft={draft} onUpdate={update} />
          ) : (
            <EvidenceDetails evidence={evidence} reputation={reputation} />
          )}
          {editingSection === "evidence" && (
            <EditSectionActions
              error={error}
              isPending={isPending}
              onCancel={handleCancel}
              onSave={handleSave}
            />
          )}
        </ReviewSection>
      )}

      {(editingSection === "retail" || locations.length > 0) && (
        <ReviewSection
          title={t("details.locations")}
          section="retail"
          editingSection={editingSection}
          onEdit={() => startEditing("retail")}
        >
          {editingSection === "retail" ? (
            <RetailEditor draft={draft} onUpdate={update} />
          ) : (
            <StringList values={locations} />
          )}
          {editingSection === "retail" && (
            <EditSectionActions
              error={error}
              isPending={isPending}
              onCancel={handleCancel}
              onSave={handleSave}
            />
          )}
        </ReviewSection>
      )}
    </div>
  );
  }
);

function ContentDetails({ data }: { data: SubmissionReviewData }) {
  const t = useTranslations("admin.submissions");
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <div className="space-y-3">
        <ValueBlock
          label={t("details.chineseDescription")}
          value={data.description}
        />
        <ValueBlock label={t("details.chineseBlurb")} value={data.blurb} />
      </div>
      <div className="space-y-3">
        <ValueBlock
          label={t("details.englishDescription")}
          value={data.descriptionEn}
        />
        <ValueBlock label={t("details.englishBlurb")} value={data.blurbEn} />
      </div>
    </div>
  );
}

function ContentEditor({
  draft,
  onUpdate,
}: {
  draft: SubmissionReviewData;
  onUpdate: UpdateReviewData;
}) {
  const t = useTranslations("admin.submissions");
  return (
    <div className="space-y-4">
      <Field label={t("details.brandName")}>
        <Input
          value={draft.name}
          onChange={(event) => onUpdate("name", event.target.value)}
        />
      </Field>
      <div className="grid gap-4 md:grid-cols-2">
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

function CatalogDetails({ data }: { data: SubmissionReviewData }) {
  const t = useTranslations("admin.submissions");
  return (
    <div className="space-y-4">
      <dl className="grid gap-4 sm:grid-cols-2">
        <Definition label={t("fields.productType")} value={data.productType} />
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
  );
}

function CatalogEditor({
  draft,
  onUpdate,
}: {
  draft: SubmissionReviewData;
  onUpdate: UpdateReviewData;
}) {
  const t = useTranslations("admin.submissions");
  const [tagsText, setTagsText] = useState(draft.productTags.join(", "));
  return (
    <div className="space-y-4">
      <div className="grid gap-4 md:grid-cols-2">
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
            <SelectTrigger>
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
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={EMPTY_SELECT_VALUE}>{t("notSet")}</SelectItem>
              {[1, 2, 3].map((value) => (
                <SelectItem key={value} value={value.toString()}>
                  {"$".repeat(value)}
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

function LinksDetails({
  purchaseLinks,
  socialLinks,
  otherUrls,
}: {
  purchaseLinks: Array<[string, string]>;
  socialLinks: Array<[string, string]>;
  otherUrls: OtherUrl[];
}) {
  const t = useTranslations("admin.submissions");
  return (
    <div className="grid gap-4 md:grid-cols-3">
      <LinkList title={t("fields.purchaseLinks")} links={purchaseLinks} />
      <LinkList title={t("fields.socialLinks")} links={socialLinks} />
      <LinkList
        title={t("details.otherLinks")}
        links={otherUrls.map((link) => [link.label || link.url, link.url])}
      />
    </div>
  );
}

function LinksEditor({
  draft,
  onUpdate,
}: {
  draft: SubmissionReviewData;
  onUpdate: UpdateReviewData;
}) {
  const t = useTranslations("admin.submissions");
  return (
    <div className="space-y-4">
      <div className="grid gap-4 md:grid-cols-2">
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

function ImagesDetails({ images }: { images: SubmissionReviewImage[] }) {
  const t = useTranslations("admin.submissions");
  if (images.length === 0) {
    return <p className="type-body-muted">{t("fields.noImages")}</p>;
  }
  return (
    <div className="flex gap-3 overflow-x-auto">
      {images.map((image, index) => (
        <figure key={image.id} className="shrink-0">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={image.url}
            alt={image.altZh ?? t("imageAlt", { n: index + 1 })}
            className="h-28 w-36 rounded-md border object-cover"
          />
          {index === 0 && (
            <figcaption className="mt-1 type-caption">
              {t("fields.mainImage")}
            </figcaption>
          )}
        </figure>
      ))}
    </div>
  );
}

function ImagesEditor({
  submissionId,
  images,
  onUpload,
  onRemoveImage,
  onMoveImage,
  onSetHero,
}: {
  submissionId: string;
  images: SubmissionReviewImage[];
  onUpload: (url: string, metadata?: ImageUploadMetadata) => void;
  onRemoveImage: (id: string) => void;
  onMoveImage: (id: string, offset: -1 | 1) => void;
  onSetHero: (id: string) => void;
}) {
  const t = useTranslations("admin.submissions");
  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {images.map((image, index) => (
          <div key={image.id} className="rounded-md border bg-background p-2">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={image.url}
              alt={image.altZh ?? t("imageAlt", { n: index + 1 })}
              className="aspect-[4/3] w-full rounded-sm object-cover"
            />
            <div className="mt-2 flex items-center justify-between gap-1">
              <Button
                shape="pill"
                variant={index === 0 ? "primary" : "ghost"}
                className="h-12 w-12 p-0"
                onClick={() => onSetHero(image.id)}
                aria-label={t("setHero", { n: index + 1 })}
              >
                <Star className="size-4" aria-hidden="true" />
              </Button>
              <Button
                shape="pill"
                variant="ghost"
                className="h-12 w-12 p-0"
                onClick={() => onMoveImage(image.id, -1)}
                disabled={index === 0}
                aria-label={t("moveLeft", { n: index + 1 })}
              >
                <ChevronLeft className="size-4" aria-hidden="true" />
              </Button>
              <Button
                shape="pill"
                variant="ghost"
                className="h-12 w-12 p-0"
                onClick={() => onMoveImage(image.id, 1)}
                disabled={index === images.length - 1}
                aria-label={t("moveRight", { n: index + 1 })}
              >
                <ChevronRight className="size-4" aria-hidden="true" />
              </Button>
              <Button
                className="min-h-12"
                variant="ghost"
                onClick={() => onRemoveImage(image.id)}
                aria-label={t("removeImage", { n: index + 1 })}
              >
                {t("fields.remove")}
              </Button>
            </div>
          </div>
        ))}
      </div>
      {images.length < MAX_REVIEW_IMAGES && (
        <ImageUploader
          mode="multi"
          bucket="brand-images"
          path={`submissions/${submissionId}`}
          value={[]}
          maxFiles={MAX_REVIEW_IMAGES - images.length}
          uploadEndpoint={`/api/admin/submissions/${submissionId}/images`}
          onUpload={onUpload}
        />
      )}
    </div>
  );
}

function EvidenceDetails({
  evidence,
  reputation,
}: {
  evidence: string[];
  reputation: string[];
}) {
  const t = useTranslations("admin.submissions");
  return (
    <div className="grid gap-4 md:grid-cols-2">
      {evidence.length > 0 && (
        <div className="space-y-2">
          <p className="type-metadata">{t("details.mitEvidence")}</p>
          <StringList values={evidence} />
        </div>
      )}
      {reputation.length > 0 && (
        <div className="space-y-2">
          <p className="type-metadata">{t("details.reputation")}</p>
          <StringList values={reputation} />
        </div>
      )}
    </div>
  );
}

function EvidenceEditor({
  draft,
  onUpdate,
}: {
  draft: SubmissionReviewData;
  onUpdate: UpdateReviewData;
}) {
  const t = useTranslations("admin.submissions");
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <Field label={t("details.mitEvidence")}>
        <Textarea
          value={displayStrings(draft.mitEvidence).join("\n")}
          onChange={(event) =>
            onUpdate("mitEvidence", parseLines(event.target.value))
          }
        />
      </Field>
      <Field label={t("details.reputation")}>
        <Textarea
          value={displayStrings(draft.reputationSummary).join("\n")}
          onChange={(event) =>
            onUpdate("reputationSummary", parseLines(event.target.value))
          }
        />
      </Field>
    </div>
  );
}

function RetailEditor({
  draft,
  onUpdate,
}: {
  draft: SubmissionReviewData;
  onUpdate: UpdateReviewData;
}) {
  const t = useTranslations("admin.submissions");
  return (
    <Field label={t("details.locations")}>
      <Textarea
        value={displayStrings(draft.retailLocations).join("\n")}
        onChange={(event) =>
          onUpdate("retailLocations", parseLines(event.target.value))
        }
      />
    </Field>
  );
}

function EditSectionActions({
  error,
  isPending,
  onCancel,
  onSave,
}: {
  error: string | null;
  isPending: boolean;
  onCancel: () => void;
  onSave: () => void;
}) {
  const t = useTranslations("admin.submissions");
  return (
    <>
      <div className="flex justify-end gap-2 pt-3">
        <Button variant="secondary" onClick={onCancel} disabled={isPending}>
          {t("cancel")}
        </Button>
        <Button variant="primary" onClick={onSave} disabled={isPending}>
          {t("save")}
        </Button>
      </div>
      {error && <p className="type-error">{error}</p>}
    </>
  );
}

function ReviewSection({
  title,
  section,
  editingSection,
  onEdit,
  children,
}: {
  title: string;
  section?: ReviewSection;
  editingSection?: ReviewSection | null;
  onEdit?: () => void;
  children: React.ReactNode;
}) {
  const t = useTranslations("admin.submissions");
  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="type-subsection-title">{title}</h3>
        {onEdit && editingSection !== section && (
          <Button variant="ghost" size="compact" onClick={onEdit}>
            {t("edit")}
          </Button>
        )}
      </div>
      {children}
    </section>
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
  if (links.length === 0) return null;
  return (
    <div className="space-y-2">
      <p className="type-metadata">{title}</p>
      <ul className="space-y-2">
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

function StringList({ values }: { values: string[] }) {
  return (
    <ul className="list-disc space-y-1 pl-5 type-body">
      {values.map((value) => (
        <li key={value}>{value}</li>
      ))}
    </ul>
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
    <Label className="block space-y-2">
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

function parseLines(value: string) {
  return value
    .split("\n")
    .map((item) => item.trim())
    .filter(Boolean);
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

function isReviewImageMetadata(metadata?: ImageUploadMetadata): boolean {
  return Boolean(
    metadata &&
    typeof metadata.id === "string" &&
    typeof metadata.submissionId === "string" &&
    typeof metadata.url === "string" &&
    metadata.status === "draft",
  );
}
