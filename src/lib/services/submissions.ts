import type {
  BrandSubmission,
  DenialReason,
  OtherUrl,
  SubmissionIntent,
  SubmissionStatus,
} from "@/lib/types";
import { auditedCall } from "@/lib/audit";
import { isLogoImageTags } from "@/lib/constants/brand-images";
import type {
  DuplicateCandidate,
  DuplicateCheckResult,
} from "@/lib/types/submission";
import type { Database, Json } from "@/lib/supabase/database.types";
import type {
  BrandNameProposal,
  CuratedProductProposal,
  EnrichedData,
} from "@/lib/types/enriched-data";
import { enrichedDataFromDb } from "@/lib/types/enriched-data";
import type {
  CurationDispatchStatus,
  CurationTargetStatus,
} from "@/lib/services/curation-jobs";
import {
  deriveSubmissionReviewStage,
  selectStageTarget,
  type SubmissionReviewStage,
} from "./submission-review-stage";
import { ConflictError, NotFoundError } from "@/lib/errors";
import { createServiceClient } from "@/lib/supabase/service";
import { imagePathToUrl } from "@/lib/images/image-url";
import {
  BRAND_SUBMISSIONS_BUCKET,
  SUBMISSION_IMAGES_KEY_PREFIX,
} from "@/lib/images/storage-keys";
import {
  extractLatinRun,
  generateSlug,
  isReservedSlug,
  isValidSlug,
} from "@/lib/services/brands";
import { cleanBrandName } from "@/lib/services/brand-cleanup";
import { toSubmissionRow } from "./_shared/field-map";
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
import { materializeSubmissionStockists } from "./stockists";
import { promoteApprovedBrandImages } from "./promote-submission-images";
import { materializeSubmissionFaq } from "./brand-faq";
import { normalizeCommunityWebsite } from "./community-submissions";
import {
  ONLINE_STORES,
  ONLINE_STORE_COLUMNS,
  onlineStoreByKey,
  type OnlineStoreCamelField,
  type OnlineStoreColumn,
} from "@/lib/brands/online-stores";
import {
  applySubmissionReviewOverrides,
  buildRefreshSubmissionReviewData,
  buildSubmissionReviewData,
  buildSubmissionReviewOverrides,
  getSubmissionReviewCompleteness,
  normalizeDuplicateNameKey,
  normalizeOtherUrls,
  normalizeString,
  normalizeStringArray,
  normalizeSubmissionReviewImages,
  resolveSubmissionReviewImages,
  submissionReviewDataToBrandInsert,
  type BrandInsert,
  type BrandSubmissionWithCategoryNote,
  type SubmissionReviewCompleteness,
  type SubmissionReviewData,
  type SubmissionReviewImage,
  type SubmissionReviewSource,
} from "./submission-review-data";

// ---------------------------------------------------------------------------
// Row types
// ---------------------------------------------------------------------------

type SubmissionRow =
  Database["public"]["Tables"]["brand_submissions"]["Row"] & {
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
  | "no_op"
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
type BrandImageReviewRow = Pick<
  Database["public"]["Tables"]["brand_images"]["Row"],
  | "id"
  | "brand_id"
  | "storage_path"
  | "source"
  | "status"
  | "sort_order"
  | "tags"
  | "width"
  | "height"
>;
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
  enriched_data: EnrichedData | null;
  /** Refresh-only suggestion, kept outside the editable baseline. */
  nameProposal: BrandNameProposal | null;
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

const GENERATED_GUEST_EMAIL_DOMAIN = "guest.formoria.invalid";
const ADMIN_REVIEW_SUBMISSIONS_PAGE_SIZE = 1_000;
const CURATION_TARGET_HISTORY_PAGE_SIZE = 1_000;
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

function isEnrichedData(value: unknown): value is EnrichedData {
  return typeof value === "object" && value !== null && !Array.isArray(value);
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

function imageStatus(value: string): SubmissionReviewImage["status"] {
  if (value === "candidate" || value === "draft" || value === "rejected") {
    return value;
  }
  return "active";
}

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
    bucketSigner(BRAND_SUBMISSIONS_BUCKET, SUBMISSION_IMAGE_SIGNED_URL_SECONDS),
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

  return key && key.startsWith(SUBMISSION_IMAGES_KEY_PREFIX) ? key : null;
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
  const signable = [
    ...new Set(keys.filter((key): key is string => Boolean(key))),
  ];
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
    // A published brand image resolves through the public bucket. Only
    // `submissions/` keys require a signed URL, and those come through
    // `submissionImageToReviewImage` instead.
    url: imagePathToUrl(row.storage_path) ?? "",
    source: row.source,
    status: imageStatus(row.status),
    sortOrder: row.sort_order,
    isLogo: isLogoImageTags(row.tags),
    width: row.width,
    height: row.height,
    originBrandImageId: row.id,
  };
}

function refreshReviewSource(
  baseBrandData: Record<string, unknown>,
  fallback: BrandSubmissionWithCategoryNote,
): SubmissionReviewSource {
  const categorySlug = normalizeString(
    typeof baseBrandData.category === "string" ? baseBrandData.category : null,
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

function buildReviewLayers(
  row: SubmissionRowWithCategoryNote,
  submission: BrandSubmissionWithCategoryNote,
  enrichedData: EnrichedData | null,
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
  // The reviewer's choice travels as the image's `status` and `sort_order`,
  // which `approve_submission` reads directly, not through this field.
  if (selectedHero) effective.heroImageUrl = selectedHero.url;

  return {
    baseline,
    effective,
    overrides,
  };
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
    > &
    Partial<Pick<BrandSubmission, OnlineStoreCamelField>> & {
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
    (page) => (page.data ?? []) as unknown as SubmissionRowWithCategoryNote[],
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
                "id, target_id, job_id, status, current_phase, error, created_at, no_op",
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
  // A submission's rows all sit in one chunk, and its pages are concatenated
  // in query order, so each group below is complete and newest first.
  const targetHistoryBySubmission = new Map<
    string,
    CurationTargetHistoryRow[]
  >();
  for (const target of targetHistory) {
    const history = targetHistoryBySubmission.get(target.target_id);
    if (history) history.push(target);
    else targetHistoryBySubmission.set(target.target_id, [target]);
  }
  // Mirrors the SQL apply/approve gates where they agree with the drop RPC:
  // a no-op rerun yields to an earlier `succeeded` run, and otherwise the true
  // latest row decides the stage (DEV-1929). See `selectStageTarget`.
  for (const [submissionId, history] of targetHistoryBySubmission) {
    const stageTarget = selectStageTarget(history);
    if (stageTarget) latestTargetBySubmission.set(submissionId, stageTarget);
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
                "id, submission_id, storage_path, source, status, sort_order, tags, width, height, origin_brand_image_id",
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

  // Refresh snapshots carry origin IDs instead of owning storage paths, so
  // their mirrored rows render from the live brand gallery. The gallery is
  // also the fallback for a brand-linked row with no active staged image.
  const rowsMissingActiveImages = rows.filter((row) => {
    if (!row.brand_id) return false;
    const staged = reviewImagesBySubmission.get(row.id) ?? [];
    return (
      staged.some((image) => image.originBrandImageId && !image.url.trim()) ||
      !staged.some((image) => image.status === "active" && image.url.trim())
    );
  });
  const publishedImagesByBrand = new Map<string, BrandImageReviewRow[]>();
  const brandIdsMissingActiveImages = [
    ...new Set(
      rowsMissingActiveImages
        .map((row) => row.brand_id)
        .filter((brandId): brandId is string => Boolean(brandId)),
    ),
  ];
  if (brandIdsMissingActiveImages.length > 0) {
    const publishedImageChunks = await Promise.all(
      chunkValues(
        brandIdsMissingActiveImages,
        SUPABASE_IN_FILTER_CHUNK_SIZE,
      ).map(async (brandIds) => {
        const chunkImages: BrandImageReviewRow[] = [];
        for (let page = 0; ; page += 1) {
          const { data: imageData, error: imagesError } = await supabase
            .from("brand_images")
            .select(
              "id, brand_id, storage_path, source, status, sort_order, tags, width, height",
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
      }),
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
      ? enrichedDataFromDb(
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
      nameProposal: enrichedData?.nameProposal ?? null,
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
    {
      provider: "submissions",
      operation: "dropNeedsDataSubmissions",
      kind: "service",
    },
    async () => {
      const supabase = createServiceClient();
      const { data, error } = await supabase.rpc(
        "drop_needs_data_submissions",
        {
          p_submission_ids: submissionIds,
        },
      );
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

export async function requestBrandRefresh(
  brandId: string,
  requester: { id: string; email: string },
): Promise<{ submissionId: string }> {
  return auditedCall(
    {
      provider: "submissions",
      operation: "requestBrandRefresh",
      kind: "service",
    },
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
    {
      provider: "submissions",
      operation: "requestBrandRefreshesBySlugs",
      kind: "service",
    },
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
            (user) =>
              user.email?.toLowerCase() === requesterEmail.toLowerCase(),
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
    {
      provider: "submissions",
      operation: "applyBrandRefresh",
      kind: "service",
    },
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

      await promoteApprovedBrandImages(submission.brand_id);

      try {
        await materializeSubmissionFaq(submissionId, submission.brand_id);
      } catch (err) {
        console.error("[applyBrandRefresh] materializeSubmissionFaq failed:", {
          submissionId,
          error: err,
        });
      }

      // Deliberate swallow: a failed stockists materialize is logged here and
      // recorded as a failed auditedCall row; the submission is already applied
      // and stays so. Recovery is a fresh refresh. Upgrade path: a retry queue,
      // if failures start appearing in the audit rows.
      try {
        await materializeSubmissionStockists(submissionId, submission.brand_id);
      } catch (err) {
        console.error(
          "[applyBrandRefresh] materializeSubmissionStockists failed:",
          { submissionId, error: err },
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
    ? enrichedDataFromDb(row.enriched_data as Record<string, unknown>)
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
    {
      provider: "submissions",
      operation: "saveSubmissionReview",
      kind: "service",
    },
    async () => {
      const supabase = createServiceClient();
      const { data: row, error: submissionError } = await supabase
        .from("brand_submissions")
        .select(ADMIN_REVIEW_SUBMISSIONS_SELECT)
        .eq("id", id)
        .eq("status", "pending")
        .single();
      if (submissionError || !row) {
        throw new NotFoundError("BrandSubmission", id, {
          cause: submissionError,
        });
      }

      const submissionRow = row as unknown as SubmissionRowWithCategoryNote;
      const submission = submissionToDomain(submissionRow);
      const enrichedData = isEnrichedData(submissionRow.enriched_data)
        ? enrichedDataFromDb(
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
    {
      provider: "submissions",
      operation: "stageSubmissionReviewImage",
      kind: "service",
    },
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

      // Signing must succeed before insertion: the route deletes the upload on error.
      const signedPreview = await defaultSubmissionImageSigner([
        input.storagePath,
      ]);
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
      const [staged] = await attachSignedSubmissionImageUrls(
        [submissionImageToReviewImage(data)],
        async () => signedPreview,
      );
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
    {
      provider: "submissions",
      operation: "cleanupSubmissionDraftImages",
      kind: "service",
    },
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
    {
      provider: "submissions",
      operation: "approveSubmission",
      kind: "service",
    },
    async () => {
      const supabase =
        typeof first === "string" ? createServiceClient() : first;
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
      const enrichedData: EnrichedData | null = isEnrichedData(
        enrichedDataRaw,
      )
        ? enrichedDataFromDb(
            enrichedDataRaw as Record<string, unknown>,
          )
        : null;

      const { data: imageRows, error: imageError } = await supabase
        .from("submission_images")
        .select(
          "id, submission_id, storage_path, source, status, sort_order, tags, width, height, origin_brand_image_id",
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
        throw new NotFoundError("BrandSubmission", id, {
          cause: approvalError,
        });

      // DEV-1551: the approval RPC copies `submission_images` into `brand_images`
      // and carries `storage_path` across verbatim, so the brand's imagery would
      // still name an object in private `brand-submissions`. Publishing requires
      // a verified `brands/` copy in public `brand-images`; the source remains as
      // submission history. `promoteApprovedBrandImages` never throws and never
      // deletes: approval must not fail because a copy failed, since a brand with
      // unservable images is recoverable (re-run
      // `scripts/enrichment/images/promote-submission-images.ts`) and a failed approval is not.
      await promoteApprovedBrandImages(approval.brand_id);

      try {
        await materializeSubmissionFaq(submission.id, approval.brand_id);
      } catch (err) {
        console.error("[approveSubmission] materializeSubmissionFaq failed:", {
          submissionId: submission.id,
          error: err,
        });
      }

      // Deliberate swallow: a failed stockists materialize is logged here and
      // recorded as a failed auditedCall row; the submission is already applied
      // and stays so. Recovery is a fresh refresh. Upgrade path: a retry queue,
      // if failures start appearing in the audit rows.
      try {
        await materializeSubmissionStockists(submission.id, approval.brand_id);
      } catch (err) {
        console.error(
          "[approveSubmission] materializeSubmissionStockists failed:",
          { submissionId: submission.id, error: err },
        );
      }

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
