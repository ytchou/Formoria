import type {
  BrandSubmission,
  DenialReason,
  OtherUrl,
  SubmissionIntent,
  SubmissionStatus,
  SourceAttribution,
} from "@/lib/types";
import { auditedCall } from "@/lib/audit";
import { isLogoImageTags } from "@/lib/constants/brand-images";
import type {
  DuplicateCandidate,
  DuplicateCheckResult,
} from "@/lib/types/submission";
import type { Database, Json } from "@/lib/supabase/database.types";
import type {
  CuratedProductProposal,
  EnrichedData,
} from "@/lib/types/enriched-data";
import { enrichedDataFromDb } from "@/lib/types/enriched-data";
import type { StockistCandidate } from "@/lib/types/stockist";
import type {
  CurationDispatchStatus,
  CurationTargetStatus,
} from "@/lib/services/curation-jobs";
import {
  deriveSubmissionReviewStage,
  type SubmissionReviewStage,
} from "./submission-review-stage";
import { ConflictError, NotFoundError } from "@/lib/errors";
import { createServiceClient } from "@/lib/supabase/service";
import { imagePathToUrl } from "@/lib/images/image-url";
import {
  extractLatinRun,
  generateSlug,
  isReservedSlug,
  isValidSlug,
} from "@/lib/services/brands";
import { cleanBrandName } from "@/lib/services/brand-cleanup";
import { toBrandRow, toSubmissionRow } from "./_shared/field-map";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  deleteStoredImagePaths,
  storageKeyFromPublicUrlForRead,
} from "./image-upload";
import {
  bucketSigner,
  createSignedUrlsInBatches,
  type SignedUrlBatchResult,
} from "./_shared/signed-urls";
import { slugifyRomanizedName } from "@/lib/brands/slug";
import { L1_CATEGORIES } from "@/lib/taxonomy/ontology";
import { upsertEnrichedStockists } from "./stockists";
import { normalizeCommunityWebsite } from "./community-submissions";
import {
  ONLINE_STORE_CAMEL_FIELDS,
  ONLINE_STORES,
  ONLINE_STORE_COLUMNS,
  onlineStoreByKey,
  type OnlineStoreCamelField,
  type OnlineStoreColumn,
} from "@/lib/brands/online-stores";

// ---------------------------------------------------------------------------
// Row types
// ---------------------------------------------------------------------------

type SubmissionRow = Database["public"]["Tables"]["brand_submissions"]["Row"] & {
  [Column in OnlineStoreColumn]?: string | null;
};
type CurationTargetHistoryRow = Pick<
  Database["public"]["Tables"]["curation_job_targets"]["Row"],
  | "id"
  | "target_id"
  | "job_id"
  | "status"
  | "current_phase"
  | "error"
  | "created_at"
>;
type CurationJobReviewRow = Pick<
  Database["public"]["Tables"]["curation_jobs"]["Row"],
  "id" | "status" | "dispatch_status" | "dispatch_error" | "job_error"
>;
type SubmissionRowWithCategoryNote = Omit<
  SubmissionRow,
  "other_urls" | OnlineStoreColumn
> & {
  hero_image_url?: string | null;
  hero_image_storage_path?: string | null;
  category_note?: string | null;
  social_instagram?: string | null;
  social_threads?: string | null;
  social_facebook?: string | null;
  other_urls?: OtherUrl[] | null;
} & {
  [Column in OnlineStoreColumn]?: string | null;
};
type SubmissionImageRow =
  Database["public"]["Tables"]["submission_images"]["Row"];
type OwnerRecipientRow = Pick<
  Database["public"]["Tables"]["brand_submissions"]["Row"],
  "id" | "brand_id" | "submitter_email" | "submitted_at"
>;
type BrandImageReviewRow = Pick<
  Database["public"]["Tables"]["brand_images"]["Row"],
  | "id"
  | "brand_id"
  | "storage_path"
  | "source"
  | "status"
  | "sort_order"
  | "alt_zh"
  | "alt_en"
  | "tags"
  | "width"
  | "height"
>;
export type BrandSubmissionWithCategoryNote = BrandSubmission & {
  websiteUrl: string | null;
  categoryNote: string | null;
};
export type SubmissionReviewImage = {
  id: string;
  submissionId: string;
  storagePath: string | null;
  url: string;
  source: string;
  status: "active" | "candidate" | "draft" | "rejected";
  sortOrder: number;
  altZh: string | null;
  altEn: string | null;
  isLogo: boolean;
  width: number | null;
  height: number | null;
  originBrandImageId: string | null;
};
export type SubmissionReviewData = {
  name: string;
  description: string | null;
  descriptionEn: string | null;
  blurb: string | null;
  blurbEn: string | null;
  city: string | null;
  reputationSummary: Json | null;
  channels?: StockistCandidate[];
  /**
   * Curated-product proposals from the enrichment run (DEV-1469), seeded from
   * `enriched_data.products` and editable in the review like every other
   * field: a reviewer who fixes a name must not have that fix dropped. The
   * enrichment blob itself is never written from the review — an edit lands in
   * `review_overrides` under the same `products` key, which is why one mapper
   * serves both layers.
   */
  products?: CuratedProductProposal[];
  /**
   * The proposal keys the reviewer ticked to keep. Absent means "no decision
   * recorded yet", which is NOT the same as none kept: the review computes the
   * default tick set from the proposal diff, and approval materializes the
   * unticked ones as hidden rows rather than dropping them.
   */
  keptProductKeys?: string[];
  mitEvidence: Json | null;
  siteContent: Json | null;
  foundingYear: number | null;
  heroImageUrl: string | null;
  categorySlug: string | null;
  priceRange: number | null;
  subcategories: string[];
  subcategoriesEn: string[];
  websiteUrl: string | null;
  socialInstagram: string | null;
  socialThreads: string | null;
  socialFacebook: string | null;
  otherUrls: OtherUrl[];
} & { [Field in OnlineStoreCamelField]: string | null };
/**
 * `channels` is submission-only, so it is widened here. Curated-product
 * proposals are NOT: `products` lives on `EnrichedData` itself, which is what
 * puts it through `enrichedDataToDb`/`enrichedDataFromDb` and therefore through
 * `enrichedDataFromSubmissionDb` below. Re-declaring it here would be a second
 * copy of the same contract, free to drift.
 */
type EnrichedSubmissionData = EnrichedData & {
  channels?: StockistCandidate[];
};
type SubmissionReviewMissingField =
  | "description"
  | "categorySlug"
  | "subcategories"
  | "priceRange"
  | "website"
  | "heroImage"
  | "successfulEnrichment";
export type SubmissionReviewCompleteness = {
  complete: boolean;
  missingFields: SubmissionReviewMissingField[];
};
/**
 * A new-brand submission whose name already belongs to a live brand, or to
 * another pending new-brand row in the same queue.
 *
 * Advisory only — it must never gate approval. Same-name brands are legal:
 * `resolveUniqueSlug` dedupes the slug, so approving a duplicate SUCCEEDS and
 * silently mints a second brand page. `TONELIT 同理` (`tonelit`/`tonelit-2`) and
 * `NEWSTAR 明日之星` are both live twice from exactly this. Nothing in the system
 * catches it, so the reviewer is the only backstop and needs to be told.
 *
 * `pendingSiblings` covers the case a live-brand check alone misses: two pending
 * submissions for a brand that does not exist yet (`噗尼 Mobell` had two), where
 * approving the first is what creates the collision for the second.
 */
type SubmissionDuplicateWarning = {
  liveBrand: { slug: string; name: string } | null;
  pendingSiblings: number;
};
export type BrandSubmissionForReview = BrandSubmissionWithCategoryNote & {
  reviewKind: "new" | "refresh";
  duplicateWarning: SubmissionDuplicateWarning | null;
  baseBrandData: Json | null;
  baseBrandUpdatedAt: string | null;
  reviewOverrides: Json;
  enriched_data: EnrichedSubmissionData | null;
  latestCurationTargetStatus: CurationTargetStatus | null;
  latestCurationJobId: string | null;
  latestCurationPhase: string | null;
  latestCurationError: string | null;
  latestCurationJobStatus: string | null;
  latestCurationDispatchStatus: CurationDispatchStatus | null;
  reviewStage: SubmissionReviewStage;
  reviewData: SubmissionReviewData;
  reviewImages: SubmissionReviewImage[];
  reviewCompleteness: SubmissionReviewCompleteness;
};

/**
 * Mapper input: the required core fields are mandatory; columns added in later
 * migrations (pdpa_consent_at, hero_image_url, source_attribution) are optional so that
 * unit test fixtures can omit them without casts.
 */
type SubmissionRowInput = Pick<
  SubmissionRowWithCategoryNote,
  | "id"
  | "brand_id"
  | "brand_name"
  | "submitter_email"
  | "submitted_at"
  | "status"
> & {
  unified_business_number?: string | null;
} & Partial<
    Omit<
      SubmissionRowWithCategoryNote,
      | "id"
      | "brand_id"
      | "brand_name"
      | "submitter_email"
      | "submitted_at"
      | "status"
    >
  >;

type SuggestedSubcategoriesInput = string[] | { values?: string[] };
type ServiceClient = SupabaseClient<Database>;
type BrandInsert = Database["public"]["Tables"]["brands"]["Insert"] & {
  [Column in OnlineStoreColumn]?: string | null;
};

const GENERATED_GUEST_EMAIL_DOMAIN = "guest.formoria.invalid";
const ADMIN_REVIEW_SUBMISSIONS_PAGE_SIZE = 1_000;
const CURATION_TARGET_HISTORY_PAGE_SIZE = 1_000;
const OWNER_RECIPIENTS_PAGE_SIZE = 1_000;
const SUPABASE_IN_FILTER_CHUNK_SIZE = 200;
export const MAX_DROPPABLE_SUBMISSIONS = 100;
const APPROVAL_RPC_ERROR_MESSAGES = new Set([
  "Submission already processed",
  "Submission must have complete enrichment before approval",
  "Submission must have a successful enrichment run before approval",
]);

export type ApproveSubmissionResult = {
  brandId: string;
  submitterEmail: string;
  brandName: string;
  submitterName: string | null;
  isBrandOwner: boolean;
  /**
   * The curated-product half of the effective review layer this approval
   * already built (DEV-1469). Returned so the caller's materialization step
   * does not re-read the row and re-derive it — two derivations of one decision
   * are two chances to disagree about what the reviewer chose.
   */
  productReview: SubmissionProductReview;
};

function chunkValues<T>(values: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < values.length; index += size) {
    chunks.push(values.slice(index, index + size));
  }
  return chunks;
}

// ---------------------------------------------------------------------------
// Pure record builder (no DB calls — testable in isolation)
// ---------------------------------------------------------------------------

export type CreateSubmissionInput = {
  brandId?: string;
  intent?: SubmissionIntent;
  brandName: string;
  submitterEmail: string;
  submitterName?: string;
  description?: string;
  websiteUrl?: string;
  heroImageUrl?: string;
  city?: string | null;
  socialInstagram?: string | null;
  socialThreads?: string | null;
  socialFacebook?: string | null;
  otherUrls?: OtherUrl[];
  suggestedSubcategories?: string[] | { values?: string[] };
  pdpaConsentAt?: string;
  isOwner?: boolean;
  sourceAttribution?: SourceAttribution | null;
  categoryNote?: string | null;
  ownerData?: Record<string, unknown>;
} & Partial<Pick<BrandSubmission, OnlineStoreCamelField>>;

export function buildSubmissionRecord(
  input: CreateSubmissionInput,
): Record<string, unknown> {
  const mapped = toSubmissionRow({
    brandId: input.brandId ?? null,
    intent: input.intent ?? "recommend",
    brandName: input.brandName,
    submitterEmail: input.submitterEmail,
    submitterName: input.submitterName ?? null,
    description: input.description ?? null,
    websiteUrl: input.websiteUrl ?? null,
    heroImageUrl: input.heroImageUrl ?? null,
    socialInstagram: input.socialInstagram ?? null,
    socialThreads: input.socialThreads ?? null,
    socialFacebook: input.socialFacebook ?? null,
    ...Object.fromEntries(
      ONLINE_STORES.map((channel) => [
        channel.camel,
        input[channel.camel] ?? null,
      ]),
    ),
    otherUrls: input.otherUrls ?? [],
    suggestedSubcategories: input.suggestedSubcategories ?? [],
    pdpaConsentAt: input.pdpaConsentAt ?? null,
    isBrandOwner: input.isOwner ?? false,
    sourceAttribution: input.sourceAttribution ?? null,
    categoryNote: input.categoryNote ?? null,
  });

  return {
    brand_id: mapped.brand_id,
    intent: mapped.intent,
    brand_name: mapped.brand_name,
    submitter_email: mapped.submitter_email,
    submitter_name: mapped.submitter_name,
    description: mapped.description,
    website_url: mapped.website_url,
    // DEV-1551: `toBrandRow` stopped emitting `hero_image_url` and now emits
    // the bucket key instead, so reading the old key here yielded undefined
    // and silently dropped the reviewer's hero choice.
    hero_image_storage_path: mapped.hero_image_storage_path,
    social_instagram: mapped.social_instagram,
    social_threads: mapped.social_threads,
    social_facebook: mapped.social_facebook,
    ...Object.fromEntries(
      ONLINE_STORE_COLUMNS.map((column) => [column, mapped[column]]),
    ),
    other_urls: mapped.other_urls,
    suggested_tags: mapped.suggested_tags,
    pdpa_consent_at: mapped.pdpa_consent_at,
    is_brand_owner: mapped.is_brand_owner,
    source_attribution: mapped.source_attribution,
    category_note: mapped.category_note,
    owner_data: ownerDataToDb(input.ownerData),
  };
}

// ---------------------------------------------------------------------------
// Mappers
// ---------------------------------------------------------------------------

function submissionToDomain(
  row: SubmissionRowInput,
): BrandSubmissionWithCategoryNote {
  const purchaseFields = Object.fromEntries(
    ONLINE_STORES.map((channel) => [
      channel.camel,
      row[channel.column] ?? null,
    ]),
  ) as Pick<BrandSubmission, OnlineStoreCamelField>;

  return {
    id: row.id,
    brandId: row.brand_id ?? null,
    intent: (row.intent as SubmissionIntent | null) ?? "recommend",
    brandName: row.brand_name,
    submitterEmail: row.submitter_email,
    submitterName: row.submitter_name ?? null,
    description: row.description ?? null,
    websiteUrl: row.website_url ?? null,
    /*
     * Prefer the bucket key (DEV-1551). The legacy `hero_image_url` is kept as
     * a fallback because a submission hero is often an EXTERNAL scraped URL
     * that never had an object of ours behind it — unlike a brand hero, which
     * is always downloaded into storage first.
     */
    heroImageUrl:
      imagePathToUrl(row.hero_image_storage_path) ?? row.hero_image_url ?? null,
    socialInstagram: row.social_instagram ?? null,
    socialThreads: row.social_threads ?? null,
    socialFacebook: row.social_facebook ?? null,
    ...purchaseFields,
    otherUrls: (row.other_urls as OtherUrl[]) ?? [],
    suggestedSubcategories: suggestedSubcategoriesFromDb(row.suggested_tags),
    status: row.status as BrandSubmission["status"],
    reviewerNotes: row.reviewer_notes ?? null,
    denialReason: (row.denial_reason as DenialReason) ?? null,
    submittedAt: row.submitted_at ?? "",
    reviewedAt: row.reviewed_at ?? null,
    reviewedBy: row.reviewed_by ?? null,
    pdpaConsentAt: row.pdpa_consent_at ?? null,
    validationStatus:
      (row.validation_status as BrandSubmission["validationStatus"]) ?? null,
    validationErrors: (row.validation_errors as string[] | null) ?? null,
    notifiedAt: row.notified_at ?? null,
    isBrandOwner: row.is_brand_owner ?? false,
    sourceAttribution:
      (row.source_attribution as BrandSubmission["sourceAttribution"]) ?? null,
    categoryNote: row.category_note ?? null,
  };
}

function submissionToInsert(
  data: Partial<Omit<BrandSubmission, "suggestedSubcategories">> & {
    romanizedName?: string | null;
    websiteUrl?: string | null;
    suggestedSubcategories?: SuggestedSubcategoriesInput;
    categoryNote?: string | null;
    ownerData?: Record<string, unknown>;
    idempotencyKey?: string | null;
  },
): Record<string, unknown> {
  return {
    ...toSubmissionRow(data),
    idempotency_key: data.idempotencyKey ?? null,
    owner_data: ownerDataToDb(data.ownerData),
  };
}

function isEnrichedData(value: unknown): value is EnrichedSubmissionData {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function enrichedDataFromSubmissionDb(
  value: Record<string, unknown>,
): EnrichedSubmissionData {
  return {
    ...enrichedDataFromDb(value),
    ...(Array.isArray(value.channels)
      ? { channels: value.channels as StockistCandidate[] }
      : {}),
  };
}

function isJsonObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function ownerDataToDb(
  value: Record<string, unknown> | undefined,
): Record<string, unknown> | null {
  if (!value) return null;
  const result = { ...value };
  if (Object.hasOwn(result, "categorySlug")) {
    result.category = result.categorySlug;
    delete result.categorySlug;
  }
  if (Object.hasOwn(result, "subcategoriesEn")) {
    result.subcategories_en = result.subcategoriesEn;
    delete result.subcategoriesEn;
  }
  return result;
}

function normalizeString(value: string | null | undefined): string | null {
  const trimmed = value?.trim() ?? "";
  return trimmed ? trimmed : null;
}

function generateSubmissionSlug(row: SubmissionRow): string {
  const romanizedSlug = slugifyRomanizedName(row.romanized_name);
  if (romanizedSlug) return romanizedSlug;

  const slugSource = extractLatinRun(row.brand_name) ?? row.brand_name;

  return generateSlug(slugSource);
}

export function buildGuestSubmissionEmail(): string {
  return `guest+${crypto.randomUUID()}@${GENERATED_GUEST_EMAIL_DOMAIN}`;
}

export function isGeneratedGuestSubmissionEmail(
  email: string | null | undefined,
): boolean {
  return (email ?? "").endsWith(`@${GENERATED_GUEST_EMAIL_DOMAIN}`);
}

function normalizeOtherUrls(value: unknown): OtherUrl[] {
  if (!Array.isArray(value)) return [];

  return value
    .map((link) => {
      if (typeof link === "string") {
        return { label: "", url: link.trim() };
      }

      if (link && typeof link === "object") {
        const candidate = link as Partial<OtherUrl>;
        return {
          label: normalizeString(candidate.label) ?? "",
          url: normalizeString(candidate.url) ?? "",
        };
      }

      return { label: "", url: "" };
    })
    .filter((link) => link.label || link.url);
}

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];

  return [
    ...new Set(
      value
        .filter((item): item is string => typeof item === "string")
        .map((item) => item.trim())
        .filter(Boolean),
    ),
  ];
}

function suggestedSubcategoriesFromDb(
  value: unknown,
): BrandSubmission["suggestedSubcategories"] {
  if (Array.isArray(value)) return normalizeStringArray(value);
  if (!isJsonObject(value)) return [];

  const values = normalizeStringArray(value.subcategories ?? value.values);
  const categorySlug =
    typeof value.category === "string" ? normalizeString(value.category) : null;
  return categorySlug ? { values, categorySlug } : { values };
}

function preferText(
  preferred: string | null | undefined,
  fallback: string | null | undefined,
): string | null {
  return normalizeString(preferred) ?? normalizeString(fallback);
}

function originalSuggestedSubcategories(
  value: BrandSubmission["suggestedSubcategories"],
): {
  categorySlug: string | null;
  subcategories: string[];
} {
  if (Array.isArray(value)) {
    return { categorySlug: null, subcategories: normalizeStringArray(value) };
  }

  const structured = value as { values?: string[]; categorySlug?: string };
  return {
    categorySlug: normalizeString(structured.categorySlug),
    subcategories: normalizeStringArray(structured.values),
  };
}

function isHttpUrl(value: string | null | undefined): boolean {
  if (!value) return false;
  try {
    const url = new URL(value);
    return (
      (url.protocol === "http:" || url.protocol === "https:") &&
      Boolean(url.hostname) &&
      !url.username &&
      !url.password
    );
  } catch {
    return false;
  }
}

function imageStatus(value: string): SubmissionReviewImage["status"] {
  if (value === "candidate" || value === "draft" || value === "rejected") {
    return value;
  }
  return "active";
}

const SUBMISSION_IMAGE_BUCKET = "brand-images";
const SUBMISSION_IMAGE_KEY_PREFIX = "submissions/";
/*
 * Five minutes: long enough for a reviewer to read a queue page, short enough
 * that a copied URL is not a durable leak. Raise it only alongside a real
 * complaint about links expiring mid-review.
 */
const SUBMISSION_IMAGE_SIGNED_URL_SECONDS = 300;

/** Injection seam: tests pass a plain function, never a Supabase mock. */
export type SignSubmissionImagePaths = (
  paths: string[],
) => Promise<SignedUrlBatchResult>;

const defaultSubmissionImageSigner: SignSubmissionImagePaths = (paths) =>
  createSignedUrlsInBatches(
    paths,
    bucketSigner(
      SUBMISSION_IMAGE_BUCKET,
      SUBMISSION_IMAGE_SIGNED_URL_SECONDS,
    ),
  );

/**
 * The bucket key of a PRE-MODERATION image, or null for anything else.
 *
 * `submissions/` objects are deliberately not served by the `/i/` same-origin
 * proxy (DEV-1551): they are unreviewed uploads that only an admin may see. So
 * admin review resolves them to a signed URL instead. Published `brands/` keys
 * fall through untouched — they are public imagery.
 */
export function submissionImageStorageKey(
  image: SubmissionReviewImage,
): string | null {
  const stored = image.storagePath?.trim();
  const key =
    stored && stored.length > 0
      ? stored
      : storageKeyFromPublicUrlForRead(image.url);

  return key && key.startsWith(SUBMISSION_IMAGE_KEY_PREFIX) ? key : null;
}

/**
 * Replaces the stored public URL of every pre-moderation image with a signed
 * one. Called on the admin review projection, so the review screens keep
 * reading `image.url` and never have to know which images are gated.
 */
export async function attachSignedSubmissionImageUrls(
  images: SubmissionReviewImage[],
  signPaths: SignSubmissionImagePaths = defaultSubmissionImageSigner,
): Promise<SubmissionReviewImage[]> {
  const keys = images.map(submissionImageStorageKey);
  const signable = [...new Set(keys.filter((key): key is string => Boolean(key)))];
  if (signable.length === 0) return images;

  const { byPath, failures } = await signPaths(signable);

  if (failures.length > 0) {
    console.error("[submissions] some review images could not be signed", {
      count: failures.length,
      paths: failures.map((failure) => failure.path),
    });
  }

  return images.map((image, index) => {
    const key = keys[index];
    const signedUrl = key ? byPath.get(key) : undefined;
    return signedUrl ? { ...image, url: signedUrl } : image;
  });
}

function submissionImageToReviewImage(
  row: SubmissionImageRow,
): SubmissionReviewImage {
  return {
    id: row.id,
    submissionId: row.submission_id,
    storagePath: row.storage_path,
    /*
     * Placeholder until `attachSignedSubmissionImageUrls` replaces it.
     * `submissions/` objects are pre-moderation and the `/i/` proxy 404s them
     * on purpose, so there is no unsigned form to fall back to. A row whose
     * signing fails renders nothing, which is the correct failure for content
     * only an admin may see.
     */
    url: "",
    source: row.source,
    status: imageStatus(row.status),
    sortOrder: row.sort_order,
    altZh: row.alt_zh,
    altEn: row.alt_en,
    isLogo: isLogoImageTags(row.tags),
    width: row.width,
    height: row.height,
    originBrandImageId: row.origin_brand_image_id,
  };
}

function brandImageToReviewImage(
  row: BrandImageReviewRow,
  submissionId: string,
): SubmissionReviewImage {
  return {
    id: row.id,
    submissionId,
    storagePath: row.storage_path,
    // A PUBLISHED brand image, so the same-origin proxy serves it (DEV-1551).
    // Only `submissions/` keys are gated behind a signed URL, and those come
    // through `submissionImageToReviewImage` instead.
    url: imagePathToUrl(row.storage_path) ?? "",
    source: row.source,
    status: imageStatus(row.status),
    sortOrder: row.sort_order,
    altZh: row.alt_zh,
    altEn: row.alt_en,
    isLogo: isLogoImageTags(row.tags),
    width: row.width,
    height: row.height,
    originBrandImageId: row.id,
  };
}

export function normalizeSubmissionReviewImages(
  images: SubmissionReviewImage[],
): SubmissionReviewImage[] {
  const statusRank = {
    active: 0,
    draft: 1,
    candidate: 2,
    rejected: 3,
  } as const;
  const seenUrls = new Set<string>();

  return images
    .toSorted(
      (left, right) =>
        statusRank[left.status] - statusRank[right.status] ||
        left.sortOrder - right.sortOrder ||
        left.id.localeCompare(right.id),
    )
    .filter((image) => {
      const url = image.url.trim();
      if (!url || seenUrls.has(url)) return false;
      seenUrls.add(url);
      return true;
    });
}

export function resolveSubmissionReviewImages(
  stagingImages: SubmissionReviewImage[],
  publishedImages: SubmissionReviewImage[],
): SubmissionReviewImage[] {
  const normalizedStaging = normalizeSubmissionReviewImages(stagingImages);
  if (normalizedStaging.some((image) => image.status === "active")) {
    return normalizedStaging;
  }

  return normalizeSubmissionReviewImages([
    ...publishedImages,
    ...normalizedStaging,
  ]);
}

type SubmissionReviewSource = Pick<
  BrandSubmissionWithCategoryNote,
  | "brandName"
  | "description"
  | "websiteUrl"
  | "heroImageUrl"
  | "socialInstagram"
  | "socialThreads"
  | "socialFacebook"
  | "otherUrls"
  | "suggestedSubcategories"
> & Pick<BrandSubmissionWithCategoryNote, OnlineStoreCamelField>;

export function buildSubmissionReviewData(
  submission: SubmissionReviewSource,
  enrichedData: EnrichedSubmissionData | null | undefined,
  images: SubmissionReviewImage[],
): SubmissionReviewData {
  const originalTags = originalSuggestedSubcategories(
    submission.suggestedSubcategories,
  );
  const enrichedTags = normalizeStringArray(enrichedData?.subcategories);
  const enrichedOtherUrls = normalizeOtherUrls(enrichedData?.otherUrls);
  const activeImages = normalizeSubmissionReviewImages(images).filter(
    (image) => image.status === "active",
  );
  const websiteField = onlineStoreByKey.website.camel;
  const imageHero = activeImages.at(0);
  const websiteUrl = preferText(
    enrichedData?.[websiteField],
    submission[websiteField],
  );
  const purchaseFields = Object.fromEntries(
    ONLINE_STORE_CAMEL_FIELDS.map((field) => [
      field,
      preferText(enrichedData?.[field], submission[field]),
    ]),
  ) as Pick<SubmissionReviewData, OnlineStoreCamelField>;

  return {
    name:
      preferText(enrichedData?.name, submission.brandName) ??
      submission.brandName,
    description: preferText(enrichedData?.description, submission.description),
    descriptionEn: normalizeString(enrichedData?.descriptionEn),
    blurb: normalizeString(enrichedData?.blurb),
    blurbEn: normalizeString(enrichedData?.blurbEn),
    city: normalizeString(enrichedData?.city),
    reputationSummary: enrichedData?.reputationSummary ?? null,
    channels: enrichedData?.channels,
    products: enrichedData?.products,
    mitEvidence: enrichedData?.mitEvidence ?? null,
    siteContent: enrichedData?.siteContent ?? null,
    foundingYear: enrichedData?.foundingYear ?? null,
    /*
     * DEV-1551: the hero is carried as a STABLE reference — the `/i/<key>`
     * form of the image's bucket key. `imageHero.url` is a five-minute signed
     * URL for a `submissions/` object (and an empty string before signing), so
     * reading it here persisted either a value that expires or nothing at all.
     */
    heroImageUrl:
      imagePathToUrl(imageHero?.storagePath) ??
      preferText(enrichedData?.heroImageUrl, submission.heroImageUrl),
    categorySlug: preferText(
      enrichedData?.categorySlug,
      originalTags.categorySlug,
    ),
    priceRange: enrichedData?.priceRange ?? null,
    subcategories:
      enrichedTags.length > 0 ? enrichedTags : originalTags.subcategories,
    subcategoriesEn: normalizeStringArray(enrichedData?.subcategoriesEn),
    websiteUrl,
    socialInstagram: preferText(
      enrichedData?.socialInstagram,
      submission.socialInstagram,
    ),
    socialThreads: preferText(
      enrichedData?.socialThreads,
      submission.socialThreads,
    ),
    socialFacebook: preferText(
      enrichedData?.socialFacebook,
      submission.socialFacebook,
    ),
    ...purchaseFields,
    otherUrls:
      enrichedOtherUrls.length > 0
        ? enrichedOtherUrls
        : normalizeOtherUrls(submission.otherUrls),
  };
}

function refreshReviewSource(
  baseBrandData: Record<string, unknown>,
  fallback: BrandSubmissionWithCategoryNote,
): SubmissionReviewSource {
  const categorySlug = normalizeString(
    typeof baseBrandData.category === "string"
      ? baseBrandData.category
      : null,
  );
  const websiteColumn = onlineStoreByKey.website.column;
  const websiteUrl =
    typeof baseBrandData[websiteColumn] === "string"
      ? baseBrandData[websiteColumn]
      : null;
  const purchaseFields = Object.fromEntries(
    ONLINE_STORES.map((channel) => [
      channel.camel,
      typeof baseBrandData[channel.column] === "string"
        ? baseBrandData[channel.column]
        : null,
    ]),
  ) as Pick<SubmissionReviewSource, OnlineStoreCamelField>;

  return {
    brandName:
      typeof baseBrandData.name === "string"
        ? baseBrandData.name
        : fallback.brandName,
    description:
      typeof baseBrandData.description === "string"
        ? baseBrandData.description
        : null,
    websiteUrl,
    heroImageUrl:
      typeof baseBrandData.hero_image_url === "string"
        ? baseBrandData.hero_image_url
        : null,
    socialInstagram:
      typeof baseBrandData.social_instagram === "string"
        ? baseBrandData.social_instagram
        : null,
    socialThreads:
      typeof baseBrandData.social_threads === "string"
        ? baseBrandData.social_threads
        : null,
    socialFacebook:
      typeof baseBrandData.social_facebook === "string"
        ? baseBrandData.social_facebook
        : null,
    ...purchaseFields,
    otherUrls: normalizeOtherUrls(baseBrandData.other_urls),
    suggestedSubcategories: {
      values: normalizeStringArray(baseBrandData.subcategories),
      categorySlug: categorySlug ?? undefined,
    },
  };
}

export function buildRefreshSubmissionReviewData(
  baseBrandData: Record<string, unknown>,
  enrichedData: Record<string, unknown>,
  fallback: SubmissionReviewData,
): SubmissionReviewData {
  const baseReview = reviewDataFromDb(baseBrandData, fallback);
  return reviewDataFromDb(enrichedData, baseReview);
}

function buildReviewLayers(
  row: SubmissionRowWithCategoryNote,
  submission: BrandSubmissionWithCategoryNote,
  enrichedData: EnrichedSubmissionData | null,
  images: SubmissionReviewImage[] = [],
): {
  baseline: SubmissionReviewData;
  effective: SubmissionReviewData;
  overrides: Record<string, unknown>;
} {
  const baseBrandData = isJsonObject(row.base_brand_data)
    ? row.base_brand_data
    : null;
  const isRefresh = submission.intent === "refresh" && baseBrandData !== null;
  const source = isRefresh
    ? refreshReviewSource(baseBrandData, submission)
    : submission;
  let baseline = buildSubmissionReviewData(source, enrichedData, []);
  if (isRefresh) {
    baseline = buildRefreshSubmissionReviewData(
      baseBrandData,
      isJsonObject(row.enriched_data) ? row.enriched_data : {},
      buildSubmissionReviewData(source, null, []),
    );
  }
  const overrides = isJsonObject(row.review_overrides)
    ? row.review_overrides
    : {};
  const effective = applySubmissionReviewOverrides(baseline, overrides);
  const selectedHero = normalizeSubmissionReviewImages(images).find(
    (image) => image.status === "active",
  );
  // Same rule as `buildSubmissionReviewData`: the reviewer's choice travels as
  // the bucket key, so it survives save and approval. A selected image with no
  // `storage_path` leaves the baseline hero alone rather than replacing it with
  // an unusable reference.
  const selectedHeroUrl = imagePathToUrl(selectedHero?.storagePath);
  if (selectedHeroUrl) effective.heroImageUrl = selectedHeroUrl;

  return {
    baseline,
    effective,
    overrides,
  };
}

/**
 * Mirrors `check_brand_duplicates`' normalisation byte for byte
 * (`lower(regexp_replace(name, '[[:space:][:punct:]]', '', 'g'))`) so the
 * advisory warning and that RPC agree on what "the same name" means.
 *
 * Exact match on the normalised key, NOT the RPC's `word_similarity > 0.7`:
 * every duplicate actually observed in production (`TONELIT 同理`,
 * `NEWSTAR 明日之星`, `噗尼 Mobell`, `慢慢挑`) is identical once normalised, and a
 * trigram threshold would additionally flag unrelated short CJK names. A
 * warning nobody trusts is worse than no warning.
 *
 * NFC first so a composed and a decomposed spelling of the same name collapse
 * together — the combining marks in `kué-tsí-li̍t` are the live example.
 */
export function normalizeDuplicateNameKey(name: string | null): string | null {
  if (!name) return null;
  const key = name
    .normalize("NFC")
    .toLocaleLowerCase()
    // Unicode-aware equivalent of the SQL POSIX classes: CJK names carry
    // full-width punctuation that [[:punct:]] catches but /\W/ would not.
    .replace(/[\p{White_Space}\p{P}\p{S}]/gu, "");
  return key.length > 0 ? key : null;
}

export function getSubmissionReviewCompleteness(
  data: SubmissionReviewData,
  images: SubmissionReviewImage[],
  latestTargetStatus: CurationTargetStatus | null,
): SubmissionReviewCompleteness {
  const missingFields: SubmissionReviewMissingField[] = [];
  const validCategories = new Set<string>(
    L1_CATEGORIES.map((category) => category.slug),
  );
  const activeImages = normalizeSubmissionReviewImages(images).filter(
    (image) => image.status === "active",
  );

  if (!normalizeString(data.description)) missingFields.push("description");
  if (!data.categorySlug || !validCategories.has(data.categorySlug)) {
    missingFields.push("categorySlug");
  }
  if (data.subcategories.length < 1 || data.subcategories.length > 5) {
    missingFields.push("subcategories");
  }
  if (![1, 2, 3].includes(data.priceRange ?? 0)) {
    missingFields.push("priceRange");
  }
  const purchaseLinkFields = ONLINE_STORE_CAMEL_FIELDS.filter(
    (field) => field !== onlineStoreByKey.website.camel,
  );
  const hasAnyLink =
    isHttpUrl(data.websiteUrl) ||
    [data.socialInstagram, data.socialThreads, data.socialFacebook].some(
      (value) => normalizeString(value) != null,
    ) ||
    purchaseLinkFields.some((field) => isHttpUrl(data[field]));
  if (!hasAnyLink) missingFields.push("website");
  if (activeImages.length === 0) missingFields.push("heroImage");
  if (latestTargetStatus !== "succeeded") {
    missingFields.push("successfulEnrichment");
  }

  return { complete: missingFields.length === 0, missingFields };
}

function submissionToBrandBase(row: SubmissionRow): BrandInsert {
  const rowWithSubmissionImages = row as SubmissionRow & {
    hero_image_url?: string | null;
    hero_image_storage_path?: string | null;
  };
  const purchaseFields = Object.fromEntries(
    ONLINE_STORE_COLUMNS.map((column) => [column, row[column]]),
  ) as Pick<BrandInsert, OnlineStoreColumn>;

  return {
    name: row.brand_name,
    slug: generateSubmissionSlug(row),
    romanized_name: normalizeString(row.romanized_name),
    description: row.description,
    hero_image_url: rowWithSubmissionImages.hero_image_url ?? null,
    // Carried across so an approved brand has a readable hero under the private
    // bucket (DEV-1551). `hero_image_url` rides along untouched for the SQL
    // functions that still read it.
    hero_image_storage_path:
      rowWithSubmissionImages.hero_image_storage_path ?? null,
    status: "approved",
    is_demo: false,
    category: null as unknown as string,
    founding_year: null,
    social_instagram: row.social_instagram,
    social_threads: row.social_threads,
    social_facebook: row.social_facebook,
    ...purchaseFields,
    other_urls: normalizeOtherUrls(row.other_urls),
    contact_email: row.submitter_email,
    site_content: null,
    submitted_at: row.submitted_at,
    approved_at: new Date().toISOString(),
  };
}

function submissionReviewDataPrefix(data: SubmissionReviewData) {
  const mapped = toBrandRow({
    name: data.name,
    description: data.description,
    descriptionEn: data.descriptionEn,
    blurb: data.blurb,
    blurbEn: data.blurbEn,
    heroImageUrl: data.heroImageUrl,
    categorySlug: data.categorySlug,
    foundingYear: data.foundingYear,
    city: data.city,
    socialInstagram: data.socialInstagram,
    socialThreads: data.socialThreads,
    socialFacebook: data.socialFacebook,
    ...Object.fromEntries(
      ONLINE_STORES.map((channel) => [
        channel.camel,
        channel === onlineStoreByKey.website
          ? data.websiteUrl
          : data[channel.camel],
      ]),
    ),
    otherUrls: data.otherUrls,
    priceRange: data.priceRange,
    subcategories: data.subcategories,
    subcategoriesEn: data.subcategoriesEn,
  });
  const purchaseFields = Object.fromEntries(
    ONLINE_STORE_COLUMNS.map((column) => [column, mapped[column]]),
  ) as Pick<BrandInsert, OnlineStoreColumn>;

  return { mapped, purchaseFields };
}

function submissionReviewDataToBrandInsert(
  data: SubmissionReviewData,
): Partial<BrandInsert> {
  const { mapped, purchaseFields } = submissionReviewDataPrefix(data);

  return {
    name: mapped.name,
    description: mapped.description,
    description_en: mapped.description_en,
    blurb: mapped.blurb,
    blurb_en: mapped.blurb_en,
    city: mapped.city,
    reputation_summary: data.reputationSummary,
    mit_evidence: data.mitEvidence,
    site_content: data.siteContent,
    founding_year: mapped.founding_year,
    // DEV-1551: `toBrandRow` stopped emitting `hero_image_url` and now emits
    // the bucket key instead, so reading the old key here yielded undefined
    // and silently dropped the reviewer's hero choice.
    hero_image_storage_path: mapped.hero_image_storage_path,
    category: mapped.category,
    price_range: mapped.price_range,
    subcategories: mapped.subcategories,
    subcategories_en: mapped.subcategories_en,
    social_instagram: mapped.social_instagram,
    social_threads: mapped.social_threads,
    social_facebook: mapped.social_facebook,
    ...purchaseFields,
    other_urls: mapped.other_urls,
  };
}

function submissionReviewDataToDb(
  data: SubmissionReviewData,
): Record<string, Json | undefined> {
  const { mapped, purchaseFields } = submissionReviewDataPrefix(data);

  return {
    name: mapped.name,
    description: mapped.description,
    description_en: mapped.description_en,
    blurb: data.blurb,
    blurb_en: data.blurbEn,
    city: data.city,
    reputation_summary: data.reputationSummary,
    channels: data.channels as unknown as Json,
    // Same key the enrichment blob uses, so `buildRefreshSubmissionReviewData`
    // reads proposals straight out of `enriched_data` through the same mapper
    // that reads them back out of `review_overrides`. `kept_product_keys` only
    // ever comes from a review — enrichment has no opinion on what to keep.
    products: data.products as unknown as Json,
    kept_product_keys: data.keptProductKeys as unknown as Json,
    mit_evidence: data.mitEvidence,
    site_content: data.siteContent,
    founding_year: mapped.founding_year,
    // DEV-1551: `toBrandRow` stopped emitting `hero_image_url` and now emits
    // the bucket key instead, so reading the old key here yielded undefined
    // and silently dropped the reviewer's hero choice.
    hero_image_storage_path: mapped.hero_image_storage_path,
    category: mapped.category,
    price_range: mapped.price_range,
    subcategories: mapped.subcategories,
    subcategories_en: mapped.subcategories_en,
    social_instagram: mapped.social_instagram,
    social_threads: mapped.social_threads,
    social_facebook: mapped.social_facebook,
    ...purchaseFields,
    other_urls: mapped.other_urls as unknown as Json,
  };
}

function reviewDataFromDb(
  data: Record<string, unknown>,
  fallback: SubmissionReviewData,
): SubmissionReviewData {
  const websiteColumn = onlineStoreByKey.website.column;
  const websiteUrl =
    data[websiteColumn] === null || typeof data[websiteColumn] === "string"
      ? (data[websiteColumn] as string | null)
      : fallback.websiteUrl;
  const purchaseFields = Object.fromEntries(
    ONLINE_STORES.map((channel) => [
      channel.camel,
      data[channel.column] === null ||
      typeof data[channel.column] === "string"
        ? data[channel.column]
        : fallback[channel.camel],
    ]),
  ) as Pick<SubmissionReviewData, OnlineStoreCamelField>;

  return {
    name: typeof data.name === "string" ? data.name : fallback.name,
    description:
      data.description === null || typeof data.description === "string"
        ? data.description
        : fallback.description,
    descriptionEn:
      data.description_en === null || typeof data.description_en === "string"
        ? data.description_en
        : fallback.descriptionEn,
    blurb:
      data.blurb === null || typeof data.blurb === "string"
        ? data.blurb
        : fallback.blurb,
    blurbEn:
      data.blurb_en === null || typeof data.blurb_en === "string"
        ? data.blurb_en
        : fallback.blurbEn,
    city:
      data.city === null || typeof data.city === "string"
        ? data.city
        : fallback.city,
    reputationSummary:
      data.reputation_summary === undefined
        ? fallback.reputationSummary
        : (data.reputation_summary as Json | null),
    channels:
      data.channels === undefined
        ? fallback.channels
        : Array.isArray(data.channels)
          ? (data.channels as StockistCandidate[])
          : fallback.channels,
    products:
      data.products === undefined
        ? fallback.products
        : Array.isArray(data.products)
          ? (data.products as CuratedProductProposal[])
          : fallback.products,
    keptProductKeys:
      data.kept_product_keys === undefined
        ? fallback.keptProductKeys
        : Array.isArray(data.kept_product_keys)
          ? normalizeStringArray(data.kept_product_keys)
          : fallback.keptProductKeys,
    mitEvidence:
      data.mit_evidence === undefined
        ? fallback.mitEvidence
        : (data.mit_evidence as Json | null),
    siteContent:
      data.site_content === undefined
        ? fallback.siteContent
        : (data.site_content as Json | null),
    foundingYear:
      data.founding_year === null || typeof data.founding_year === "number"
        ? data.founding_year
        : fallback.foundingYear,
    heroImageUrl:
      data.hero_image_url === null || typeof data.hero_image_url === "string"
        ? data.hero_image_url
        : fallback.heroImageUrl,
    categorySlug:
      data.category === null || typeof data.category === "string"
        ? data.category
        : fallback.categorySlug,
    priceRange:
      data.price_range === null || typeof data.price_range === "number"
        ? data.price_range
        : fallback.priceRange,
    subcategories: Array.isArray(data.subcategories)
      ? normalizeStringArray(data.subcategories)
      : fallback.subcategories,
    subcategoriesEn: Array.isArray(data.subcategories_en)
      ? normalizeStringArray(data.subcategories_en)
      : fallback.subcategoriesEn,
    websiteUrl,
    socialInstagram:
      data.social_instagram === null ||
      typeof data.social_instagram === "string"
        ? data.social_instagram
        : fallback.socialInstagram,
    socialThreads:
      data.social_threads === null || typeof data.social_threads === "string"
        ? data.social_threads
        : fallback.socialThreads,
    socialFacebook:
      data.social_facebook === null || typeof data.social_facebook === "string"
        ? data.social_facebook
        : fallback.socialFacebook,
    ...purchaseFields,
    otherUrls: Array.isArray(data.other_urls)
      ? normalizeOtherUrls(data.other_urls)
      : fallback.otherUrls,
  };
}

function jsonValuesEqual(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

export function buildSubmissionReviewOverrides(
  baseline: SubmissionReviewData,
  edited: SubmissionReviewData,
): Record<string, Json | undefined> {
  const baselineRow = submissionReviewDataToDb(baseline);
  const editedRow = submissionReviewDataToDb(edited);

  return Object.fromEntries(
    Object.entries(editedRow).filter(
      ([key, value]) =>
        key !== "hero_image_url" && !jsonValuesEqual(value, baselineRow[key]),
    ),
  );
}

export function applySubmissionReviewOverrides(
  baseline: SubmissionReviewData,
  overrides: Record<string, unknown>,
): SubmissionReviewData {
  const fieldOverrides = Object.fromEntries(
    Object.entries(overrides).filter(([key]) => key !== "hero_image_url"),
  );
  return reviewDataFromDb(
    { ...submissionReviewDataToDb(baseline), ...fieldOverrides },
    baseline,
  );
}

async function resolveUniqueSlug(
  supabase: ServiceClient,
  slug: string,
): Promise<string> {
  let candidate = slug;
  let suffix = 2;

  while (true) {
    const { data, error } = await supabase
      .from("brands")
      .select("id")
      .eq("slug", candidate)
      .maybeSingle();

    if (error) throw error;
    if (!data && !isReservedSlug(candidate)) return candidate;

    candidate = `${slug}-${suffix}`;
    suffix += 1;
  }
}

// ---------------------------------------------------------------------------
// Service functions
// ---------------------------------------------------------------------------

export async function createSubmission(
  data: Pick<BrandSubmission, "brandName" | "submitterEmail"> &
    Partial<
      Pick<
        BrandSubmission,
        | "brandId"
        | "submitterName"
        | "description"
        | "heroImageUrl"
        | "socialInstagram"
        | "socialThreads"
        | "socialFacebook"
        | "otherUrls"
        | "pdpaConsentAt"
        | "isBrandOwner"
        | "sourceAttribution"
      >
    > & Partial<Pick<BrandSubmission, OnlineStoreCamelField>> & {
      websiteUrl?: string | null;
      romanizedName?: string | null;
      suggestedSubcategories?: SuggestedSubcategoriesInput;
      categoryNote?: string | null;
      intent?: SubmissionIntent;
      ownerData?: Record<string, unknown>;
      idempotencyKey?: string | null;
    },
  _options?: { useServiceRole?: boolean },
): Promise<BrandSubmissionWithCategoryNote> {
  return auditedCall(
    { provider: "submissions", operation: "createSubmission", kind: "service" },
    async () => {
  // Authorization and abuse checks happen at the action boundary. The data
  // write itself always uses the service role so the public submission journey
  // remains available after application-role table grants are revoked.
  const supabase = createServiceClient();
  const row = submissionToInsert(data);
  const { data: inserted, error } = await supabase
    .from("brand_submissions")
    .insert(row)
    .select("*")
    .single();

  if (error) {
    if (error.code !== "23505" || !data.idempotencyKey) throw error;

    const { data: existing, error: lookupError } = await supabase
      .from("brand_submissions")
      .select("*")
      .eq("idempotency_key", data.idempotencyKey)
      .maybeSingle();

    if (lookupError) throw lookupError;
    if (!existing) throw error;
    return submissionToDomain(existing);
  }
  return submissionToDomain(inserted);
    },
  );
}

export type ApprovedOwnerSubmissionRecipient = {
  submitterEmail: string;
};

export async function getApprovedOwnerSubmissionRecipients(
  brandIds: string[],
): Promise<Map<string, ApprovedOwnerSubmissionRecipient>> {
  const uniqueBrandIds = [...new Set(brandIds.filter(Boolean))];
  if (uniqueBrandIds.length === 0) return new Map();

  const supabase = createServiceClient();
  const chunks = chunkValues(uniqueBrandIds, SUPABASE_IN_FILTER_CHUNK_SIZE);
  const results = await Promise.all(
    chunks.map(async (chunk) => {
      // A brand can accumulate any number of approved owner submissions, so an
      // unpaged read can stop at PostgREST's row cap and silently lose whole
      // brands. brand_id leads the sort so page boundaries are deterministic;
      // submitted_at stays descending so the first row seen per brand is still
      // the newest one, which is what the dedupe below keeps.
      const chunkRows: OwnerRecipientRow[] = [];
      for (let page = 0; ; page += 1) {
        const { data, error } = await supabase
          .from("brand_submissions")
          .select("id, brand_id, submitter_email, submitted_at")
          .in("brand_id", chunk)
          .eq("status", "approved")
          .eq("is_brand_owner", true)
          .order("brand_id", { ascending: true })
          .order("submitted_at", { ascending: false, nullsFirst: false })
          .order("id", { ascending: true })
          .range(
            page * OWNER_RECIPIENTS_PAGE_SIZE,
            (page + 1) * OWNER_RECIPIENTS_PAGE_SIZE - 1,
          );
        if (error) throw error;

        const pageRows = (data ?? []) as OwnerRecipientRow[];
        chunkRows.push(...pageRows);
        if (pageRows.length < OWNER_RECIPIENTS_PAGE_SIZE) break;
      }
      return chunkRows;
    }),
  );

  const recipients = new Map<string, ApprovedOwnerSubmissionRecipient>();
  for (const submission of results.flat()) {
    if (!submission.brand_id || recipients.has(submission.brand_id)) continue;
    recipients.set(submission.brand_id, {
      submitterEmail: submission.submitter_email,
    });
  }

  return recipients;
}

const ADMIN_REVIEW_SUBMISSIONS_SELECT = `
  id,
  base_brand_data,
  base_brand_updated_at,
  brand_id,
  brand_name,
  submitter_email,
  submitter_name,
  description,
  website_url,
  hero_image_url,
  hero_image_storage_path,
  social_instagram,
  social_threads,
  social_facebook,
  ${ONLINE_STORE_COLUMNS.join(",\n  ")},
  other_urls,
  suggested_tags,
  status,
  reviewer_notes,
  submitted_at,
  reviewed_at,
  reviewed_by,
  pdpa_consent_at,
  validation_status,
  validation_errors,
  notified_at,
  is_brand_owner,
  intent,
  source_attribution,
  category_note,
  enriched_data,
  owner_data,
  review_overrides,
  refresh_requested_by
`;

export async function getSubmissionsForReview(options?: {
  status?: SubmissionStatus;
}): Promise<BrandSubmissionForReview[]> {
  const supabase = createServiceClient();
  const fetchPage = async (from: number, to: number) => {
    let query = supabase
      .from("brand_submissions")
      .select(ADMIN_REVIEW_SUBMISSIONS_SELECT, { count: "exact" });
    if (options?.status) query = query.eq("status", options.status);
    return query
      .order("submitted_at", { ascending: false })
      .order("id", { ascending: false })
      .range(from, to);
  };
  const firstPage = await fetchPage(0, ADMIN_REVIEW_SUBMISSIONS_PAGE_SIZE - 1);
  if (firstPage.error) throw firstPage.error;

  const total = firstPage.count ?? firstPage.data?.length ?? 0;
  const remainingPages = await Promise.all(
    Array.from(
      {
        length: Math.max(
          0,
          Math.ceil(total / ADMIN_REVIEW_SUBMISSIONS_PAGE_SIZE) - 1,
        ),
      },
      (_, index) => {
        const from = (index + 1) * ADMIN_REVIEW_SUBMISSIONS_PAGE_SIZE;
        return fetchPage(from, from + ADMIN_REVIEW_SUBMISSIONS_PAGE_SIZE - 1);
      },
    ),
  );
  const failedPage = remainingPages.find((page) => page.error);
  if (failedPage?.error) throw failedPage.error;

  const rows = [firstPage, ...remainingPages].flatMap(
    (page) =>
      (page.data ?? []) as unknown as SubmissionRowWithCategoryNote[],
  );
  const submissionIds = rows.map((row) => row.id);
  const targetHistory = (
    await Promise.all(
      chunkValues(submissionIds, SUPABASE_IN_FILTER_CHUNK_SIZE).map(
        async (targetIds) => {
          const chunkHistory: CurationTargetHistoryRow[] = [];
          for (let page = 0; ; page += 1) {
            const { data: pageData, error: targetHistoryError } = await supabase
              .from("curation_job_targets")
              .select(
                "id, target_id, job_id, status, current_phase, error, created_at",
              )
              .eq("target_type", "submission")
              .in("target_id", targetIds)
              .order("created_at", { ascending: false })
              .order("id", { ascending: false })
              .range(
                page * CURATION_TARGET_HISTORY_PAGE_SIZE,
                (page + 1) * CURATION_TARGET_HISTORY_PAGE_SIZE - 1,
              );

            if (targetHistoryError) throw targetHistoryError;

            const pageRows = (pageData ?? []) as CurationTargetHistoryRow[];
            chunkHistory.push(...pageRows);
            if (pageRows.length < CURATION_TARGET_HISTORY_PAGE_SIZE) break;
          }
          return chunkHistory;
        },
      ),
    )
  ).flat();

  const latestTargetBySubmission = new Map<
    string,
    {
      target_id: string;
      job_id: string;
      status: string;
      current_phase: string | null;
      error: string | null;
    }
  >();
  for (const target of targetHistory ?? []) {
    if (!latestTargetBySubmission.has(target.target_id)) {
      latestTargetBySubmission.set(target.target_id, target);
    }
  }

  const latestJobIds = [
    ...new Set(
      [...latestTargetBySubmission.values()].map((target) => target.job_id),
    ),
  ];
  const latestJobById = new Map<string, CurationJobReviewRow>();
  if (latestJobIds.length > 0) {
    const jobChunks = await Promise.all(
      chunkValues(latestJobIds, SUPABASE_IN_FILTER_CHUNK_SIZE).map(
        async (jobIds) => {
          const { data: jobData, error: jobsError } = await supabase
            .from("curation_jobs")
            .select("id, status, dispatch_status, dispatch_error, job_error")
            .in("id", jobIds);
          if (jobsError) throw jobsError;
          return (jobData ?? []) as CurationJobReviewRow[];
        },
      ),
    );
    for (const job of jobChunks.flat()) {
      latestJobById.set(job.id, job);
    }
  }

  const reviewImagesBySubmission = new Map<string, SubmissionReviewImage[]>();
  if (submissionIds.length > 0) {
    const imageChunks = await Promise.all(
      chunkValues(submissionIds, SUPABASE_IN_FILTER_CHUNK_SIZE).map(
        async (targetIds) => {
          // A chunk of 200 submissions can hold several thousand images, so an
          // unpaged read silently stops at PostgREST's row cap. Ordering by
          // submission_id first keeps every page boundary deterministic; the
          // consumer re-sorts by sort_order anyway.
          const chunkImages: SubmissionImageRow[] = [];
          for (let page = 0; ; page += 1) {
            const { data: imageData, error: imagesError } = await supabase
              .from("submission_images")
              .select(
                "id, submission_id, storage_path, source, status, sort_order, alt_zh, alt_en, tags, width, height, origin_brand_image_id",
              )
              .in("submission_id", targetIds)
              .order("submission_id", { ascending: true })
              .order("sort_order", { ascending: true })
              .order("created_at", { ascending: true })
              .order("id", { ascending: true })
              .range(
                page * ADMIN_REVIEW_SUBMISSIONS_PAGE_SIZE,
                (page + 1) * ADMIN_REVIEW_SUBMISSIONS_PAGE_SIZE - 1,
              );
            if (imagesError) throw imagesError;

            const pageImages = (imageData ?? []) as SubmissionImageRow[];
            chunkImages.push(...pageImages);
            if (pageImages.length < ADMIN_REVIEW_SUBMISSIONS_PAGE_SIZE) break;
          }
          return chunkImages;
        },
      ),
    );

    // Signed before grouping, so the whole page costs one batched sign call.
    const signedReviewImages = await attachSignedSubmissionImageUrls(
      imageChunks.flat().map(submissionImageToReviewImage),
    );

    for (const image of signedReviewImages) {
      const current = reviewImagesBySubmission.get(image.submissionId) ?? [];
      current.push(image);
      reviewImagesBySubmission.set(image.submissionId, current);
    }
  }

  const approvedRowsMissingActiveImages = rows.filter((row) => {
    if (row.status !== "approved" || !row.brand_id) return false;
    return !(reviewImagesBySubmission.get(row.id) ?? []).some(
      (image) => image.status === "active",
    );
  });
  const publishedImagesByBrand = new Map<string, BrandImageReviewRow[]>();
  const approvedBrandIds = [
    ...new Set(
      approvedRowsMissingActiveImages
        .map((row) => row.brand_id)
        .filter((brandId): brandId is string => Boolean(brandId)),
    ),
  ];
  if (approvedBrandIds.length > 0) {
    const publishedImageChunks = await Promise.all(
      chunkValues(approvedBrandIds, SUPABASE_IN_FILTER_CHUNK_SIZE).map(
        async (brandIds) => {
          const chunkImages: BrandImageReviewRow[] = [];
          for (let page = 0; ; page += 1) {
            const { data: imageData, error: imagesError } = await supabase
              .from("brand_images")
              .select(
                "id, brand_id, storage_path, source, status, sort_order, alt_zh, alt_en, tags, width, height",
              )
              .in("brand_id", brandIds)
              .eq("status", "active")
              .order("brand_id", { ascending: true })
              .order("sort_order", { ascending: true })
              .order("id", { ascending: true })
              .range(
                page * ADMIN_REVIEW_SUBMISSIONS_PAGE_SIZE,
                (page + 1) * ADMIN_REVIEW_SUBMISSIONS_PAGE_SIZE - 1,
              );
            if (imagesError) throw imagesError;

            const pageImages = (imageData ?? []) as BrandImageReviewRow[];
            chunkImages.push(...pageImages);
            if (pageImages.length < ADMIN_REVIEW_SUBMISSIONS_PAGE_SIZE) break;
          }
          return chunkImages;
        },
      ),
    );

    for (const image of publishedImageChunks.flat()) {
      const current = publishedImagesByBrand.get(image.brand_id) ?? [];
      current.push(image);
      publishedImagesByBrand.set(image.brand_id, current);
    }
  }

  // Advisory duplicate lookup. Only new-brand rows can collide — a refresh
  // already points at its brand — so the whole block is skipped when the queue
  // has none. Filtered to `approved`: `hidden` is this project's soft-delete and
  // `is_demo` rows are seeds, and warning about either would train the reviewer
  // to ignore the warning.
  const liveBrandByNameKey = new Map<string, { slug: string; name: string }>();
  const pendingCountByNameKey = new Map<string, number>();
  for (const row of rows) {
    if (row.brand_id) continue;
    const key = normalizeDuplicateNameKey(row.brand_name);
    if (key)
      pendingCountByNameKey.set(key, (pendingCountByNameKey.get(key) ?? 0) + 1);
  }
  if (pendingCountByNameKey.size > 0) {
    for (let page = 0; ; page += 1) {
      const { data: brandRows, error: brandRowsError } = await supabase
        .from("brands")
        .select("name, slug")
        .eq("status", "approved")
        .eq("is_demo", false)
        // `slug` is unique, so it is a stable tiebreaker: ordering by a
        // non-unique column across pages can skip or repeat rows.
        .order("slug", { ascending: true })
        .range(
          page * ADMIN_REVIEW_SUBMISSIONS_PAGE_SIZE,
          (page + 1) * ADMIN_REVIEW_SUBMISSIONS_PAGE_SIZE - 1,
        );
      if (brandRowsError) throw brandRowsError;

      const pageRows = brandRows ?? [];
      for (const brand of pageRows) {
        const key = normalizeDuplicateNameKey(brand.name);
        if (key && !liveBrandByNameKey.has(key)) {
          liveBrandByNameKey.set(key, { slug: brand.slug, name: brand.name });
        }
      }
      if (pageRows.length < ADMIN_REVIEW_SUBMISSIONS_PAGE_SIZE) break;
    }
  }

  return rows.map((row) => {
    const latestTarget = latestTargetBySubmission.get(row.id);
    const latestJob = latestTarget
      ? latestJobById.get(latestTarget.job_id)
      : undefined;
    const submission = submissionToDomain(row);
    const enrichedData = isEnrichedData(row.enriched_data)
      ? enrichedDataFromSubmissionDb(
          row.enriched_data as Record<string, unknown>,
        )
      : null;
    const targetStatus = isCurationTargetStatus(latestTarget?.status)
      ? latestTarget.status
      : null;
    const dispatchStatus = isCurationDispatchStatus(latestJob?.dispatch_status)
      ? latestJob.dispatch_status
      : null;
    const stagedImages = reviewImagesBySubmission.get(row.id) ?? [];
    const publishedImages = submission.brandId
      ? (publishedImagesByBrand.get(submission.brandId) ?? []).map((image) =>
          brandImageToReviewImage(image, submission.id),
        )
      : [];
    const reviewImages = resolveSubmissionReviewImages(
      stagedImages,
      publishedImages,
    );
    const reviewLayers = buildReviewLayers(
      row,
      submission,
      enrichedData,
      reviewImages,
    );
    const reviewData = reviewLayers.effective;
    const reviewCompleteness = getSubmissionReviewCompleteness(
      reviewData,
      reviewImages,
      targetStatus,
    );
    const duplicateNameKey = row.brand_id
      ? null
      : normalizeDuplicateNameKey(row.brand_name);
    const liveDuplicate = duplicateNameKey
      ? (liveBrandByNameKey.get(duplicateNameKey) ?? null)
      : null;
    // Minus itself: a row is always in its own pending tally.
    const pendingSiblings = duplicateNameKey
      ? (pendingCountByNameKey.get(duplicateNameKey) ?? 1) - 1
      : 0;
    const duplicateWarning =
      liveDuplicate || pendingSiblings > 0
        ? { liveBrand: liveDuplicate, pendingSiblings }
        : null;

    return {
      ...submission,
      reviewKind: submission.intent === "refresh" ? "refresh" : "new",
      duplicateWarning,
      baseBrandData: row.base_brand_data ?? null,
      baseBrandUpdatedAt: row.base_brand_updated_at ?? null,
      reviewOverrides: row.review_overrides ?? {},
      enriched_data: enrichedData,
      latestCurationTargetStatus: targetStatus,
      latestCurationJobId: latestTarget?.job_id ?? null,
      latestCurationPhase: latestTarget?.current_phase ?? null,
      latestCurationError:
        latestTarget?.error ??
        latestJob?.job_error ??
        latestJob?.dispatch_error ??
        null,
      latestCurationJobStatus: latestJob?.status ?? null,
      latestCurationDispatchStatus: dispatchStatus,
      reviewData,
      reviewImages,
      reviewCompleteness,
      reviewStage: deriveSubmissionReviewStage({
        submissionStatus: submission.status,
        targetStatus,
        jobStatus: latestJob?.status ?? null,
        dispatchStatus,
      }),
    };
  });
}

export async function getSubmission(id: string): Promise<BrandSubmission> {
  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("brand_submissions")
    .select("*")
    .eq("id", id)
    .single();

  if (error || !data)
    throw new NotFoundError("BrandSubmission", id, { cause: error });
  return submissionToDomain(data);
}

export type DropNeedsDataSubmissionsResult = {
  deletedCount: number;
  cleanupFailed: boolean;
};

/**
 * Hard-deletes a bounded batch of submissions whose stage is still Needs Data.
 * The RPC performs the stage check and deletion in one transaction; storage is
 * intentionally cleaned up afterwards because it is an external side effect.
 */
export async function dropNeedsDataSubmissions(
  submissionIds: string[],
): Promise<DropNeedsDataSubmissionsResult> {
  return auditedCall(
    { provider: "submissions", operation: "dropNeedsDataSubmissions", kind: "service" },
    async () => {
  const supabase = createServiceClient();
  const { data, error } = await supabase.rpc("drop_needs_data_submissions", {
    p_submission_ids: submissionIds,
  });
  if (error) throw error;

  const storagePaths = (Array.isArray(data) ? data : []).filter(
    (path): path is string => typeof path === "string",
  );
  let cleanupFailed = false;
  try {
    await deleteStoredImagePaths(storagePaths);
  } catch (storageError) {
    cleanupFailed = true;
    console.error(
      `[dropNeedsDataSubmissions] Failed to delete submission images for ${submissionIds.join(",")}:`,
      storageError,
    );
  }

  return { deletedCount: submissionIds.length, cleanupFailed };
    },
  );
}

/**
 * Rolls a rejected submission back to `pending` so curation can run against it
 * again. Approved submissions are deliberately excluded: they carry a live
 * `brand_id` and their status transition drives provenance/location triggers,
 * so unwinding one is not a status flip.
 */
export async function reopenSubmission(id: string): Promise<BrandSubmission> {
  return auditedCall(
    { provider: "submissions", operation: "reopenSubmission", kind: "service" },
    async () => {
  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("brand_submissions")
    .update({
      status: "pending",
      reviewed_at: null,
      reviewed_by: null,
      denial_reason: null,
      reviewer_notes: null,
    })
    .eq("id", id)
    .eq("status", "rejected")
    .select("*")
    .maybeSingle();

  if (error) throw error;
  if (!data) {
    throw new Error("Only rejected submissions can be reopened");
  }

  return submissionToDomain(data);
    },
  );
}

export async function requestBrandRefresh(
  brandId: string,
  requester: { id: string; email: string },
): Promise<{ submissionId: string }> {
  return auditedCall(
    { provider: "submissions", operation: "requestBrandRefresh", kind: "service" },
    async () => {
  const supabase = createServiceClient();
  const { data, error } = await supabase.rpc("request_brand_refresh", {
    p_brand_id: brandId,
    p_requested_by: requester.id,
    p_requester_email: requester.email,
  });
  if (error) throw error;
  if (!data) throw new Error("Refresh request returned no submission ID");
  return { submissionId: data };
    },
  );
}

export type BrandRefreshRequestOutcome = {
  slug: string;
  name: string;
  submissionId: string | null;
  error: string | null;
};

export async function requestBrandRefreshesBySlugs(
  slugs: string[],
  requesterEmail: string,
  options?: { dryRun?: boolean },
): Promise<BrandRefreshRequestOutcome[]> {
  return auditedCall(
    { provider: "submissions", operation: "requestBrandRefreshesBySlugs", kind: "service" },
    async () => {
  const normalizedSlugs = [
    ...new Set(slugs.map((slug) => slug.trim()).filter(Boolean)),
  ];
  if (normalizedSlugs.length === 0) return [];

  const supabase = createServiceClient();
  const { data: brands, error: brandsError } = await supabase
    .from("brands")
    .select("id, name, slug, status")
    .in("slug", normalizedSlugs);
  if (brandsError) throw brandsError;

  const brandBySlug = new Map(
    (brands ?? []).map((brand) => [brand.slug, brand]),
  );
  const missing = normalizedSlugs.filter((slug) => !brandBySlug.has(slug));
  if (missing.length > 0) {
    throw new Error(`Brands not found: ${missing.join(", ")}`);
  }

  let requesterId: string | null = null;
  for (let page = 1; requesterId === null; page += 1) {
    const { data, error } = await supabase.auth.admin.listUsers({
      page,
      perPage: 1_000,
    });
    if (error) throw error;
    requesterId =
      data.users.find(
        (user) => user.email?.toLowerCase() === requesterEmail.toLowerCase(),
      )?.id ?? null;
    if (data.users.length < 1_000) break;
  }
  if (!requesterId) {
    throw new Error(`Configured admin user not found: ${requesterEmail}`);
  }
  const resolvedRequesterId = requesterId;

  return Promise.all(
    normalizedSlugs.map(async (slug) => {
      const brand = brandBySlug.get(slug);
      if (!brand) {
        return {
          slug,
          name: slug,
          submissionId: null,
          error: "Brand not found",
        };
      }
      if (brand.status !== "approved" && brand.status !== "hidden") {
        return {
          slug,
          name: brand.name,
          submissionId: null,
          error: "Only approved or hidden brands can be refreshed",
        };
      }
      if (options?.dryRun) {
        return { slug, name: brand.name, submissionId: null, error: null };
      }

      const { data, error } = await supabase.rpc("request_brand_refresh", {
        p_brand_id: brand.id,
        p_requested_by: resolvedRequesterId,
        p_requester_email: requesterEmail,
      });
      return {
        slug,
        name: brand.name,
        submissionId: error ? null : data,
        error: error?.message ?? null,
      };
    }),
  );
    },
  );
}

export async function applyBrandRefresh(
  submissionId: string,
  reviewerId: string,
): Promise<{ brandId: string; cleanupFailed: boolean }> {
  return auditedCall(
    { provider: "submissions", operation: "applyBrandRefresh", kind: "service" },
    async () => {
  const supabase = createServiceClient();
  const { data: submission, error: submissionError } = await supabase
    .from("brand_submissions")
    .select("brand_id, intent, status")
    .eq("id", submissionId)
    .single();
  if (submissionError || !submission?.brand_id) {
    throw new NotFoundError("BrandSubmission", submissionId, {
      cause: submissionError,
    });
  }
  if (submission.intent !== "refresh" || submission.status !== "pending") {
    throw new Error("Refresh submission already processed");
  }

  const { data: storagePaths, error } = await supabase.rpc(
    "apply_brand_refresh",
    { p_reviewer_id: reviewerId, p_submission_id: submissionId },
  );
  // 55P03 = lock_not_available: the brand or submission row is locked by another
  // in-flight apply. The function sets a 2s lock_timeout so this surfaces as a
  // retryable message instead of blocking the whole bulk approval.
  if (error?.code === "55P03") {
    throw new ConflictError(
      "Another update is being applied to this brand. Try again in a moment.",
      { cause: error },
    );
  }
  if (error) throw error;

  let cleanupFailed = false;
  try {
    await deleteStoredImagePaths(storagePaths ?? []);
  } catch (storageError) {
    cleanupFailed = true;
    console.error(
      `[applyBrandRefresh] Failed to delete retired images for ${submissionId}:`,
      storageError,
    );
  }

  return { brandId: submission.brand_id, cleanupFailed };
    },
  );
}

/**
 * What the review DECIDED about the curated-product proposals riding one
 * submission (DEV-1469) — the effective layer, never the raw enrichment blob.
 *
 * Materialization must read this and not `enriched_data.products`: a reviewer's
 * fix to a name, a category, or a description lands in `review_overrides` under
 * the same `products` key, so reading the blob would silently publish the
 * machine's first draft and drop every correction.
 *
 * IT IS A PROJECTION OF `buildReviewLayers(...).effective`, not a second
 * implementation of it. The precedence this needs is the precedence the whole
 * review already has — an override replaces the proposal array when the key is
 * present, otherwise the enrichment blob shows through — and the hand-rolled
 * copy that used to live here was free to drift from the merge that actually
 * decides what a reviewer sees.
 *
 * `keptProductKeys` is `undefined` when no decision was recorded, which is NOT
 * the same as `[]`. Absent means "the reviewer never opened the section", and
 * the caller applies the section's own default (every new proposal kept); `[]`
 * means "the reviewer looked and kept nothing". `SubmissionReviewData` keeps the
 * distinction — the field is optional there for exactly this reason.
 */
export type SubmissionProductReview = {
  products: CuratedProductProposal[];
  keptProductKeys: string[] | undefined;
};

function submissionProductReview(
  reviewData: SubmissionReviewData,
): SubmissionProductReview {
  return {
    products: reviewData.products ?? [],
    keptProductKeys: reviewData.keptProductKeys,
  };
}

/**
 * The reading half. `approveSubmission` already holds the effective layer and
 * hands it straight to the materializer; this is for the refresh path, which
 * does not.
 */
export async function getSubmissionProductReview(
  id: string,
): Promise<SubmissionProductReview> {
  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("brand_submissions")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new NotFoundError("BrandSubmission", id);

  const row = {
    ...data,
    other_urls: normalizeOtherUrls(data.other_urls),
  } as unknown as SubmissionRowWithCategoryNote;
  const enrichedData = isEnrichedData(row.enriched_data)
    ? enrichedDataFromSubmissionDb(row.enriched_data as Record<string, unknown>)
    : null;

  // Images are not passed: the only thing they can change on the effective
  // layer is `heroImageUrl`, and this projection reads neither it nor anything
  // derived from it.
  return submissionProductReview(
    buildReviewLayers(row, submissionToDomain(row), enrichedData).effective,
  );
}

export type SaveSubmissionReviewInput = SubmissionReviewData & {
  images: Array<{ id: string; sortOrder: number }>;
};

export async function saveSubmissionReview(
  id: string,
  input: SaveSubmissionReviewInput,
): Promise<void> {
  return auditedCall(
    { provider: "submissions", operation: "saveSubmissionReview", kind: "service" },
    async () => {
  const supabase = createServiceClient();
  const { data: row, error: submissionError } = await supabase
    .from("brand_submissions")
    .select(ADMIN_REVIEW_SUBMISSIONS_SELECT)
    .eq("id", id)
    .eq("status", "pending")
    .single();
  if (submissionError || !row) {
    throw new NotFoundError("BrandSubmission", id, { cause: submissionError });
  }

  const submissionRow = row as unknown as SubmissionRowWithCategoryNote;
  const submission = submissionToDomain(submissionRow);
  const enrichedData = isEnrichedData(submissionRow.enriched_data)
    ? enrichedDataFromSubmissionDb(
        submissionRow.enriched_data as Record<string, unknown>,
      )
    : null;
  const { baseline } = buildReviewLayers(
    submissionRow,
    submission,
    enrichedData,
  );
  const overrides = buildSubmissionReviewOverrides(baseline, input);
  const { error } = await supabase.rpc("save_submission_review", {
    p_submission_id: id,
    p_review_data: overrides as Json,
    p_images: input.images.map((image) => ({
      id: image.id,
      // Keep the payload compatible with linked databases before the hero-order migration.
      is_hero: image.sortOrder === 0,
      sort_order: image.sortOrder,
    })) as unknown as Json,
  });

  if (error) throw error;
    },
  );
}

export type StageSubmissionReviewImageInput = {
  submissionId: string;
  storagePath: string;
  width: number;
  height: number;
};

export async function stageSubmissionReviewImage(
  input: StageSubmissionReviewImageInput,
): Promise<SubmissionReviewImage> {
  return auditedCall(
    { provider: "submissions", operation: "stageSubmissionReviewImage", kind: "service" },
    async () => {
  const supabase = createServiceClient();
  const { data: submission, error: submissionError } = await supabase
    .from("brand_submissions")
    .select("id, intent, brand_id")
    .eq("id", input.submissionId)
    .eq("status", "pending")
    .maybeSingle();
  if (submissionError) throw submissionError;
  if (!submission)
    throw new NotFoundError("BrandSubmission", input.submissionId);
  if (submission.brand_id && submission.intent !== "refresh") {
    throw new NotFoundError("BrandSubmission", input.submissionId);
  }

  const { data, error } = await supabase
    .from("submission_images")
    .insert({
      submission_id: input.submissionId,
      // DEV-1551 task 12: the bucket key is the only reference written. The
      // `url` column keeps its schema default; nothing here fills it.
      storage_path: input.storagePath,
      source_url: input.storagePath,
      source: "admin",
      status: "draft",
      sort_order: 0,
      width: input.width,
      height: input.height,
    })
    .select("*")
    .single();
  if (error) throw error;
  // A no-op unless the object landed under `submissions/` — see
  // `attachSignedSubmissionImageUrls`. Applied here so a freshly staged image
  // is displayable by the same rule as the rest of the queue.
  const [staged] = await attachSignedSubmissionImageUrls([
    submissionImageToReviewImage(data),
  ]);
  return staged;
    },
  );
}

export async function cleanupSubmissionDraftImages(
  submissionId: string,
  imageIds: string[],
): Promise<void> {
  if (imageIds.length === 0) return;

  return auditedCall(
    { provider: "submissions", operation: "cleanupSubmissionDraftImages", kind: "service" },
    async () => {
  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("submission_images")
    .select("id, storage_path")
    .eq("submission_id", submissionId)
    .eq("status", "draft")
    .in("id", imageIds);
  if (error) throw error;

  const draftRows = data ?? [];
  await deleteStoredImagePaths(
    draftRows.flatMap((image) =>
      image.storage_path ? [image.storage_path] : [],
    ),
  );

  if (draftRows.length > 0) {
    const { error: deleteError } = await supabase
      .from("submission_images")
      .delete()
      .eq("submission_id", submissionId)
      .eq("status", "draft")
      .in(
        "id",
        draftRows.map((image) => image.id),
      );
    if (deleteError) throw deleteError;
  }
    },
  );
}

export async function approveSubmission(
  id: string,
  reviewerId: string,
): Promise<ApproveSubmissionResult>;
export async function approveSubmission(
  supabase: ServiceClient,
  id: string,
  reviewerId: string,
): Promise<ApproveSubmissionResult>;
export async function approveSubmission(
  first: string | ServiceClient,
  second: string,
  third?: string,
): Promise<ApproveSubmissionResult> {
  return auditedCall(
    { provider: "submissions", operation: "approveSubmission", kind: "service" },
    async () => {
  const supabase = typeof first === "string" ? createServiceClient() : first;
  const id = typeof first === "string" ? first : second;
  const reviewerId = typeof first === "string" ? second : (third as string);

  const { data: submission, error: fetchError } = await supabase
    .from("brand_submissions")
    .select("*")
    .eq("id", id)
    .single();

  if (fetchError || !submission) {
    throw new NotFoundError("BrandSubmission", id, { cause: fetchError });
  }
  if (submission.intent === "refresh") {
    throw new Error(
      "Refresh submissions must be applied to the existing brand",
    );
  }

  const enrichedDataRaw = submission.enriched_data;
  const enrichedData: EnrichedSubmissionData | null = isEnrichedData(
    enrichedDataRaw,
  )
    ? enrichedDataFromSubmissionDb(enrichedDataRaw as Record<string, unknown>)
    : null;

  const { data: imageRows, error: imageError } = await supabase
    .from("submission_images")
    .select(
      "id, submission_id, storage_path, source, status, sort_order, alt_zh, alt_en, tags, width, height, origin_brand_image_id",
    )
    .eq("submission_id", id)
    .order("sort_order", { ascending: true });
  if (imageError) throw imageError;
  const reviewImages = normalizeSubmissionReviewImages(
    ((imageRows ?? []) as unknown as SubmissionImageRow[]).map(
      submissionImageToReviewImage,
    ),
  );

  const typedSubmission = {
    ...submission,
    other_urls: normalizeOtherUrls(submission.other_urls),
  } as unknown as SubmissionRowWithCategoryNote;
  const submissionDomain = submissionToDomain(typedSubmission);
  const reviewData = buildReviewLayers(
    typedSubmission,
    submissionDomain,
    enrichedData,
    reviewImages,
  ).effective;

  const baseSlug = generateSubmissionSlug(submission);
  if (!isValidSlug(baseSlug)) {
    throw new Error(`Generated slug "${baseSlug}" is not valid kebab-case`);
  }
  const slug = await resolveUniqueSlug(supabase, baseSlug);

  // Last gate before a name reaches the public directory. The enrich-side name
  // arbiter (DEV-1321) is the intended writer, but it only governs rows enriched
  // after it shipped: `噗尼 Mobell` was enriched earlier, carried the scraped page
  // title `噗尼 Mobell - 網頁不存在` in enriched_data.name, and published under it
  // because approval copied that field verbatim. Any submission enriched before
  // the arbiter — or by a future path that bypasses it — still lands here, so the
  // clean runs at the boundary rather than trusting upstream.
  //
  // `cleanBrandName` returns the original when cleaning would empty the string,
  // so this can never publish a blank name. The slug is untouched: it derives
  // from the submission row, not from this field, and was already correct on the
  // polluted row.
  const brandInsert: BrandInsert = {
    ...submissionToBrandBase(submission),
    ...submissionReviewDataToBrandInsert(reviewData),
    name: cleanBrandName(reviewData.name).cleanedName,
    slug,
    status: "approved",
  };
  const { data: approvalRows, error: approvalError } = await supabase.rpc(
    "approve_submission_with_romanized_name",
    {
      p_brand_data: brandInsert as unknown as Json,
      p_reviewer_id: reviewerId,
      p_submission_id: id,
    },
  );

  if (approvalError) {
    if (approvalError.code === "P0002") {
      throw new NotFoundError("BrandSubmission", id, {
        cause: approvalError,
      });
    }

    if (APPROVAL_RPC_ERROR_MESSAGES.has(approvalError.message)) {
      throw new Error(approvalError.message);
    }

    throw approvalError;
  }

  const approval = approvalRows?.at(0);
  if (!approval)
    throw new NotFoundError("BrandSubmission", id, { cause: approvalError });

  // The maps producer is gone, but pending submissions can still carry legacy
  // channels. Keep draining those rows until the Phase 2 importer takes over.
  if (reviewData.channels) {
    try {
      const stockistsResult = await upsertEnrichedStockists(
        approval.brand_id,
        reviewData.channels,
      );
      if (!stockistsResult.ok) {
        console.error(
          "[approveSubmission] Failed to upsert enriched channels:",
          stockistsResult.code,
        );
      }
    } catch (stockistError) {
      console.error(
        "[approveSubmission] Failed to upsert enriched channels:",
        stockistError,
      );
    }
  }

  // No FAQ write here on purpose: `brand_faq_entries` is written only by the
  // `faq` enrichment phase, behind the preset validators. An approved brand
  // renders the template floors until that phase runs against it.

  return {
    brandId: approval.brand_id,
    submitterEmail: approval.submitter_email,
    brandName: approval.brand_name,
    submitterName: approval.submitter_name ?? null,
    isBrandOwner: approval.is_brand_owner ?? false,
    // `reviewData` is the effective layer built at the top of this function,
    // from the row as it stood when the approval ran. Materialization is the
    // caller's next step and consumes exactly this.
    productReview: submissionProductReview(reviewData),
  };
    },
  );
}

function isCurationTargetStatus(
  value: string | null | undefined,
): value is CurationTargetStatus {
  return [
    "pending",
    "running",
    "succeeded",
    "skipped",
    "failed",
    "cancelled",
  ].includes(value ?? "");
}

function isCurationDispatchStatus(
  value: string | null | undefined,
): value is CurationDispatchStatus {
  return ["pending", "dispatched", "failed"].includes(value ?? "");
}

export async function rejectSubmission(
  id: string,
  reviewerId: string,
  denialReason: DenialReason,
  notes?: string,
): Promise<BrandSubmission> {
  return auditedCall(
    { provider: "submissions", operation: "rejectSubmission", kind: "service" },
    async () => {
  const supabase = createServiceClient();

  const { data: storagePaths, error: rejectionError } = await supabase.rpc(
    "reject_submission",
    {
      p_denial_reason: denialReason,
      p_reviewer_notes: notes ?? null,
      p_reviewer_id: reviewerId,
      p_submission_id: id,
    },
  );
  if (rejectionError) throw rejectionError;

  const { data, error } = await supabase
    .from("brand_submissions")
    .select("*")
    .eq("id", id)
    .single();
  if (error || !data) {
    throw new NotFoundError("BrandSubmission", id, { cause: error });
  }

  try {
    await deleteStoredImagePaths(storagePaths ?? []);
  } catch (storageError) {
    console.error(
      `[rejectSubmission] Failed to delete staged images for ${id}:`,
      storageError,
    );
  }

  return submissionToDomain(data);
    },
  );
}

export async function checkBrandDuplicates(
  name: string,
  website?: string,
): Promise<DuplicateCheckResult> {
  const supabase = createServiceClient();
  const websiteKey = normalizeCommunityWebsite(website)?.key;

  const { data, error } = await supabase.rpc("check_brand_duplicates", {
    p_name: name,
    p_website_key: websiteKey,
  });

  if (error) {
    console.error("[checkBrandDuplicates] RPC error:", error.message);
    return { nameMatches: [], websiteMatches: [] };
  }

  // The RPC returns snake_case JSON; camelCase is the TS-side convention, so the
  // rename happens here at the service-layer boundary rather than in the UI.
  const mapCandidate = (candidate: {
    id: string;
    name: string;
    slug: string;
    similarity: number;
    matched_on: DuplicateCandidate["matchedOn"];
  }): DuplicateCandidate => ({
    id: candidate.id,
    name: candidate.name,
    slug: candidate.slug,
    similarity: candidate.similarity,
    matchedOn: candidate.matched_on,
  });

  return {
    nameMatches: (data?.name_matches ?? []).map(mapCandidate),
    websiteMatches: (data?.website_matches ?? []).map(mapCandidate),
  };
}
