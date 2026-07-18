import type {
  BrandSubmission,
  DenialReason,
  OtherUrl,
  SubmissionIntent,
  SubmissionStatus,
  SourceAttribution,
} from "@/lib/types";
import type { DuplicateCheckResult } from "@/lib/types/submission";
import type { Database, Json } from "@/lib/supabase/database.types";
import type { EnrichedData } from "@/lib/types/enriched-data";
import { enrichedDataFromDb } from "@/lib/types/enriched-data";
import type {
  CurationDispatchStatus,
  CurationTargetStatus,
} from "@/lib/services/curation-jobs";
import {
  deriveSubmissionReviewStage,
  type SubmissionReviewStage,
} from "./submission-review-stage";
import { NotFoundError } from "@/lib/errors";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import {
  extractLatinRun,
  generateSlug,
  isReservedSlug,
  isValidSlug,
} from "@/lib/services/brands";
import { toSubmissionRow } from "./field-map";
import type { SupabaseClient } from "@supabase/supabase-js";
import { deleteStoredImagePaths } from "./image-upload";
import { slugifyRomanizedName } from "@/lib/brands/slug";
import { PRODUCT_TYPE_CATEGORIES } from "@/lib/taxonomy/ontology";

// ---------------------------------------------------------------------------
// Row types
// ---------------------------------------------------------------------------

type SubmissionRow = Database["public"]["Tables"]["brand_submissions"]["Row"];
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
type SubmissionRowWithProductTypeNote = Omit<SubmissionRow, "other_urls"> & {
  hero_image_url?: string | null;
  product_type_note?: string | null;
  social_instagram?: string | null;
  social_threads?: string | null;
  social_facebook?: string | null;
  purchase_website?: string | null;
  purchase_pinkoi?: string | null;
  purchase_shopee?: string | null;
  other_urls?: OtherUrl[] | null;
};
type SubmissionImageRow = Database["public"]["Tables"]["submission_images"]["Row"];
export type BrandSubmissionWithProductTypeNote = BrandSubmission & {
  websiteUrl: string | null;
  productTypeNote: string | null;
};
export type SubmissionReviewImage = {
  id: string;
  submissionId: string;
  storagePath: string | null;
  url: string;
  source: string;
  status: "active" | "draft" | "rejected";
  sortOrder: number;
  altZh: string | null;
  altEn: string | null;
  width: number | null;
  height: number | null;
};
export type SubmissionReviewData = {
  name: string;
  description: string | null;
  descriptionEn: string | null;
  blurb: string | null;
  blurbEn: string | null;
  city: string | null;
  categoryAttributes: Json | null;
  reputationSummary: Json | null;
  retailLocations: Json | null;
  mitEvidence: Json | null;
  siteContent: Json | null;
  foundingYear: number | null;
  heroImageUrl: string | null;
  productType: string | null;
  priceRange: number | null;
  productTags: string[];
  productTagsEn: string[];
  websiteUrl: string | null;
  socialInstagram: string | null;
  socialThreads: string | null;
  socialFacebook: string | null;
  purchaseWebsite: string | null;
  purchasePinkoi: string | null;
  purchaseShopee: string | null;
  otherUrls: OtherUrl[];
};
type SubmissionReviewMissingField =
  | "description"
  | "productType"
  | "productTags"
  | "priceRange"
  | "website"
  | "heroImage"
  | "additionalImage"
  | "successfulEnrichment";
export type SubmissionReviewCompleteness = {
  complete: boolean;
  missingFields: SubmissionReviewMissingField[];
};
export type EnrichmentFilter = "all" | "complete" | "incomplete";
export type BrandSubmissionForReview = BrandSubmissionWithProductTypeNote & {
  enriched_data: EnrichedData | null;
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
  SubmissionRowWithProductTypeNote,
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
      SubmissionRowWithProductTypeNote,
      | "id"
      | "brand_id"
      | "brand_name"
      | "submitter_email"
      | "submitted_at"
      | "status"
    >
  >;

type SuggestedTagsInput = string[] | { values?: string[] };
type ServiceClient = SupabaseClient<Database>;
type BrandInsert = Database["public"]["Tables"]["brands"]["Insert"];

const GENERATED_GUEST_EMAIL_DOMAIN = "guest.formoria.invalid";
const CURATION_TARGET_HISTORY_PAGE_SIZE = 1_000;
const SUPABASE_IN_FILTER_CHUNK_SIZE = 200;
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
  purchaseWebsite?: string | null;
  purchasePinkoi?: string | null;
  purchaseShopee?: string | null;
  otherUrls?: OtherUrl[];
  suggestedTags?: string[] | { values?: string[] };
  pdpaConsentAt?: string;
  isOwner?: boolean;
  sourceAttribution?: SourceAttribution | null;
  productTypeNote?: string | null;
  ownerData?: Record<string, unknown>;
};

export function buildSubmissionRecord(
  input: CreateSubmissionInput,
): Record<string, unknown> {
  return {
    brand_id: input.brandId ?? null,
    intent: input.intent ?? "recommend",
    brand_name: input.brandName,
    submitter_email: input.submitterEmail,
    submitter_name: input.submitterName ?? null,
    description: input.description ?? null,
    website_url: input.websiteUrl ?? null,
    hero_image_url: input.heroImageUrl ?? null,
    social_instagram: input.socialInstagram ?? null,
    social_threads: input.socialThreads ?? null,
    social_facebook: input.socialFacebook ?? null,
    purchase_website: input.purchaseWebsite ?? null,
    purchase_pinkoi: input.purchasePinkoi ?? null,
    purchase_shopee: input.purchaseShopee ?? null,
    other_urls: input.otherUrls ?? [],
    suggested_tags: input.suggestedTags ?? [],
    pdpa_consent_at: input.pdpaConsentAt ?? null,
    is_brand_owner: input.isOwner ?? false,
    source_attribution: input.sourceAttribution ?? null,
    product_type_note: input.productTypeNote ?? null,
    owner_data: input.ownerData ?? null,
  };
}

// ---------------------------------------------------------------------------
// Mappers
// ---------------------------------------------------------------------------

export function submissionToDomain(
  row: SubmissionRowInput,
): BrandSubmissionWithProductTypeNote {
  return {
    id: row.id,
    brandId: row.brand_id ?? null,
    intent: (row.intent as SubmissionIntent | null) ?? "recommend",
    brandName: row.brand_name,
    submitterEmail: row.submitter_email,
    submitterName: row.submitter_name ?? null,
    description: row.description ?? null,
    websiteUrl: row.website_url ?? null,
    heroImageUrl: row.hero_image_url ?? null,
    socialInstagram: row.social_instagram ?? null,
    socialThreads: row.social_threads ?? null,
    socialFacebook: row.social_facebook ?? null,
    purchaseWebsite: row.purchase_website ?? null,
    purchasePinkoi: row.purchase_pinkoi ?? null,
    purchaseShopee: row.purchase_shopee ?? null,
    otherUrls: (row.other_urls as OtherUrl[]) ?? [],
    suggestedTags: (row.suggested_tags as string[]) ?? [],
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
    productTypeNote: row.product_type_note ?? null,
  };
}

export function submissionToInsert(
  data: Partial<Omit<BrandSubmission, "suggestedTags">> & {
    romanizedName?: string | null;
    websiteUrl?: string | null;
    suggestedTags?: SuggestedTagsInput;
    productTypeNote?: string | null;
    ownerData?: Record<string, unknown>;
  },
): Record<string, unknown> {
  return {
    ...toSubmissionRow(data),
    owner_data: data.ownerData ?? null,
  };
}

function isEnrichedData(value: unknown): value is EnrichedData {
  return typeof value === "object" && value !== null && !Array.isArray(value);
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

  return [...new Set(
    value
      .filter((item): item is string => typeof item === "string")
      .map((item) => item.trim())
      .filter(Boolean),
  )];
}

function preferText(
  preferred: string | null | undefined,
  fallback: string | null | undefined,
): string | null {
  return normalizeString(preferred) ?? normalizeString(fallback);
}

function originalSuggestedTags(
  value: BrandSubmission["suggestedTags"],
): { productType: string | null; productTags: string[] } {
  if (Array.isArray(value)) {
    return { productType: null, productTags: normalizeStringArray(value) };
  }

  const structured = value as { values?: string[]; productType?: string };
  return {
    productType: normalizeString(structured.productType),
    productTags: normalizeStringArray(structured.values),
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
  if (value === "draft" || value === "rejected") return value;
  return "active";
}

function submissionImageToReviewImage(
  row: SubmissionImageRow,
): SubmissionReviewImage {
  return {
    id: row.id,
    submissionId: row.submission_id,
    storagePath: row.storage_path,
    url: row.url,
    source: row.source,
    status: imageStatus(row.status),
    sortOrder: row.sort_order,
    altZh: row.alt_zh,
    altEn: row.alt_en,
    width: row.width,
    height: row.height,
  };
}

export function normalizeSubmissionReviewImages(
  images: SubmissionReviewImage[],
): SubmissionReviewImage[] {
  const statusRank = { active: 0, draft: 1, rejected: 2 } as const;
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

type SubmissionReviewSource = Pick<
  BrandSubmissionWithProductTypeNote,
  | "brandName"
  | "description"
  | "websiteUrl"
  | "heroImageUrl"
  | "socialInstagram"
  | "socialThreads"
  | "socialFacebook"
  | "purchaseWebsite"
  | "purchasePinkoi"
  | "purchaseShopee"
  | "otherUrls"
  | "suggestedTags"
>;

export function buildSubmissionReviewData(
  submission: SubmissionReviewSource,
  enrichedData: EnrichedData | null | undefined,
  images: SubmissionReviewImage[],
): SubmissionReviewData {
  const originalTags = originalSuggestedTags(submission.suggestedTags);
  const enrichedTags = normalizeStringArray(enrichedData?.productTags);
  const enrichedOtherUrls = normalizeOtherUrls(enrichedData?.otherUrls);
  const activeImages = normalizeSubmissionReviewImages(images).filter(
    (image) => image.status === "active",
  );
  const imageHero = activeImages.find((image) => image.sortOrder === 0);
  const websiteUrl = preferText(
    enrichedData?.purchaseWebsite,
    submission.purchaseWebsite ?? submission.websiteUrl,
  );

  return {
    name: preferText(enrichedData?.name, submission.brandName) ?? submission.brandName,
    description: preferText(enrichedData?.description, submission.description),
    descriptionEn: normalizeString(enrichedData?.descriptionEn),
    blurb: normalizeString(enrichedData?.blurb),
    blurbEn: normalizeString(enrichedData?.blurbEn),
    city: normalizeString(enrichedData?.city),
    categoryAttributes: enrichedData?.categoryAttributes ?? null,
    reputationSummary: enrichedData?.reputationSummary ?? null,
    retailLocations: enrichedData?.retailLocations ?? null,
    mitEvidence: enrichedData?.mitEvidence ?? null,
    siteContent: enrichedData?.siteContent ?? null,
    foundingYear: enrichedData?.foundingYear ?? null,
    heroImageUrl:
      normalizeString(imageHero?.url) ??
      preferText(enrichedData?.heroImageUrl, submission.heroImageUrl),
    productType: preferText(enrichedData?.productType, originalTags.productType),
    priceRange: enrichedData?.priceRange ?? null,
    productTags: enrichedTags.length > 0 ? enrichedTags : originalTags.productTags,
    productTagsEn: normalizeStringArray(enrichedData?.productTagsEn),
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
    purchaseWebsite: websiteUrl,
    purchasePinkoi: preferText(
      enrichedData?.purchasePinkoi,
      submission.purchasePinkoi,
    ),
    purchaseShopee: preferText(
      enrichedData?.purchaseShopee,
      submission.purchaseShopee,
    ),
    otherUrls:
      enrichedOtherUrls.length > 0
        ? enrichedOtherUrls
        : normalizeOtherUrls(submission.otherUrls),
  };
}

export function getSubmissionReviewCompleteness(
  data: SubmissionReviewData,
  images: SubmissionReviewImage[],
  latestTargetStatus: CurationTargetStatus | null,
): SubmissionReviewCompleteness {
  const missingFields: SubmissionReviewMissingField[] = [];
  const validProductTypes = new Set<string>(
    PRODUCT_TYPE_CATEGORIES.map((category) => category.slug),
  );
  const activeImages = normalizeSubmissionReviewImages(images).filter(
    (image) => image.status === "active",
  );
  const heroImage = activeImages.find(
    (image) => image.sortOrder === 0 && image.url === data.heroImageUrl,
  );

  if (!normalizeString(data.description)) missingFields.push("description");
  if (!data.productType || !validProductTypes.has(data.productType)) {
    missingFields.push("productType");
  }
  if (data.productTags.length < 1 || data.productTags.length > 5) {
    missingFields.push("productTags");
  }
  if (![1, 2, 3].includes(data.priceRange ?? 0)) {
    missingFields.push("priceRange");
  }
  if (!isHttpUrl(data.websiteUrl)) missingFields.push("website");
  if (!heroImage) missingFields.push("heroImage");
  if (activeImages.filter((image) => image.id !== heroImage?.id).length < 1) {
    missingFields.push("additionalImage");
  }
  if (latestTargetStatus !== "succeeded") {
    missingFields.push("successfulEnrichment");
  }

  return { complete: missingFields.length === 0, missingFields };
}

function submissionToBrandBase(row: SubmissionRow): BrandInsert {
  const rowWithSubmissionImages = row as SubmissionRow & {
    hero_image_url?: string | null;
  };

  return {
    name: row.brand_name,
    slug: generateSubmissionSlug(row),
    romanized_name: normalizeString(row.romanized_name),
    description: row.description,
    hero_image_url: rowWithSubmissionImages.hero_image_url ?? null,
    status: "approved",
    is_demo: false,
    product_type: null as unknown as string,
    founding_year: null,
    social_instagram: row.social_instagram,
    social_threads: row.social_threads,
    social_facebook: row.social_facebook,
    purchase_website: row.purchase_website ?? row.website_url,
    purchase_pinkoi: row.purchase_pinkoi,
    purchase_shopee: row.purchase_shopee,
    other_urls: normalizeOtherUrls(row.other_urls),
    retail_locations: [],
    contact_email: row.submitter_email,
    site_content: null,
    submitted_at: row.submitted_at,
    approved_at: new Date().toISOString(),
  };
}

function submissionReviewDataToBrandInsert(
  data: SubmissionReviewData,
): Partial<BrandInsert> {
  return {
    name: data.name,
    description: data.description,
    description_en: data.descriptionEn,
    blurb: data.blurb,
    blurb_en: data.blurbEn,
    city: data.city,
    category_attributes: data.categoryAttributes,
    reputation_summary: data.reputationSummary,
    retail_locations: data.retailLocations ?? [],
    mit_evidence: data.mitEvidence,
    site_content: data.siteContent,
    founding_year: data.foundingYear,
    hero_image_url: data.heroImageUrl,
    product_type: data.productType,
    price_range: data.priceRange,
    product_tags: data.productTags,
    product_tags_en: data.productTagsEn,
    social_instagram: data.socialInstagram,
    social_threads: data.socialThreads,
    social_facebook: data.socialFacebook,
    purchase_website: data.websiteUrl,
    purchase_pinkoi: data.purchasePinkoi,
    purchase_shopee: data.purchaseShopee,
    other_urls: data.otherUrls,
  };
}

function submissionReviewDataToDb(data: SubmissionReviewData): Json {
  return {
    name: data.name,
    description: data.description,
    description_en: data.descriptionEn,
    blurb: data.blurb,
    blurb_en: data.blurbEn,
    city: data.city,
    category_attributes: data.categoryAttributes,
    reputation_summary: data.reputationSummary,
    retail_locations: data.retailLocations,
    mit_evidence: data.mitEvidence,
    site_content: data.siteContent,
    founding_year: data.foundingYear,
    hero_image_url: data.heroImageUrl,
    product_type: data.productType,
    price_range: data.priceRange,
    product_tags: data.productTags,
    product_tags_en: data.productTagsEn,
    social_instagram: data.socialInstagram,
    social_threads: data.socialThreads,
    social_facebook: data.socialFacebook,
    purchase_website: data.websiteUrl,
    purchase_pinkoi: data.purchasePinkoi,
    purchase_shopee: data.purchaseShopee,
    other_urls: data.otherUrls as unknown as Json,
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
        | "purchaseWebsite"
        | "purchasePinkoi"
        | "purchaseShopee"
        | "otherUrls"
        | "pdpaConsentAt"
        | "isBrandOwner"
        | "sourceAttribution"
      >
    > & {
      websiteUrl?: string | null;
      romanizedName?: string | null;
      suggestedTags?: SuggestedTagsInput;
      productTypeNote?: string | null;
      intent?: SubmissionIntent;
      ownerData?: Record<string, unknown>;
    },
  options?: { useServiceRole?: boolean },
): Promise<BrandSubmissionWithProductTypeNote> {
  const supabase = options?.useServiceRole
    ? createServiceClient()
    : await createClient();
  const row = submissionToInsert(data);
  const { data: inserted, error } = await supabase
    .from("brand_submissions")
    .insert(row)
    .select("*")
    .single();

  if (error) throw error;
  return submissionToDomain(inserted);
}

const ADMIN_SUBMISSIONS_SELECT = `
  id,
  brand_id,
  brand_name,
  submitter_email,
  submitter_name,
  description,
  website_url,
  hero_image_url,
  social_instagram,
  social_threads,
  social_facebook,
  purchase_website,
  purchase_pinkoi,
  purchase_shopee,
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
  product_type_note,
  enriched_data,
  owner_data
`;

const ADMIN_REVIEW_SUBMISSIONS_SELECT = `
  id,
  brand_id,
  brand_name,
  submitter_email,
  submitter_name,
  description,
  website_url,
  hero_image_url,
  social_instagram,
  social_threads,
  social_facebook,
  purchase_website,
  purchase_pinkoi,
  purchase_shopee,
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
  product_type_note,
  enriched_data,
  owner_data
`;

export async function getAdminSubmissions(): Promise<
  BrandSubmissionWithProductTypeNote[]
> {
  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("brand_submissions")
    .select(ADMIN_SUBMISSIONS_SELECT)
    .order("submitted_at", { ascending: false });

  if (error) throw error;
  return ((data ?? []) as unknown as SubmissionRowWithProductTypeNote[]).map(
    submissionToDomain,
  );
}

export async function getSubmissionsForReview(options?: {
  status?: SubmissionStatus;
}): Promise<
  BrandSubmissionForReview[]
> {
  const supabase = createServiceClient();
  let query = supabase
    .from("brand_submissions")
    .select(ADMIN_REVIEW_SUBMISSIONS_SELECT);
  if (options?.status) query = query.eq("status", options.status);
  const { data, error } = await query.order("submitted_at", { ascending: false });

  if (error) throw error;

  const rows = (data ?? []) as unknown as SubmissionRowWithProductTypeNote[];
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
          const { data: imageData, error: imagesError } = await supabase
            .from("submission_images")
            .select(
              "id, submission_id, storage_path, url, source, status, sort_order, alt_zh, alt_en, width, height",
            )
            .in("submission_id", targetIds)
            .order("sort_order", { ascending: true })
            .order("created_at", { ascending: true });
          if (imagesError) throw imagesError;
          return (imageData ?? []) as SubmissionImageRow[];
        },
      ),
    );

    for (const image of imageChunks.flat().map(submissionImageToReviewImage)) {
      const current = reviewImagesBySubmission.get(image.submissionId) ?? [];
      current.push(image);
      reviewImagesBySubmission.set(image.submissionId, current);
    }
  }

  return rows.map((row) => {
    const latestTarget = latestTargetBySubmission.get(row.id);
    const latestJob = latestTarget
      ? latestJobById.get(latestTarget.job_id)
      : undefined;
    const submission = submissionToDomain(row);
    const enrichedData = isEnrichedData(row.enriched_data)
      ? enrichedDataFromDb(row.enriched_data as Record<string, unknown>)
      : null;
    const targetStatus = isCurationTargetStatus(latestTarget?.status)
      ? latestTarget.status
      : null;
    const dispatchStatus = isCurationDispatchStatus(latestJob?.dispatch_status)
      ? latestJob.dispatch_status
      : null;
    const reviewImages = normalizeSubmissionReviewImages(
      reviewImagesBySubmission.get(row.id) ?? [],
    );
    const reviewData = buildSubmissionReviewData(
      submission,
      enrichedData,
      reviewImages,
    );
    const reviewCompleteness = getSubmissionReviewCompleteness(
      reviewData,
      reviewImages,
      targetStatus,
    );
    return {
      ...submission,
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
        enrichmentComplete: reviewCompleteness.complete,
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

export async function getSubmissions(
  status?: SubmissionStatus,
  options?: { limit?: number },
): Promise<BrandSubmission[]> {
  const supabase = createServiceClient();
  let query = supabase.from("brand_submissions").select("*");

  if (status) {
    query = query.eq("status", status);
  }

  query = query.order("submitted_at", { ascending: false });
  if (options?.limit) {
    query = query.limit(options.limit);
  }

  const { data, error } = await query;

  if (error) throw error;
  return (data ?? []).map(submissionToDomain);
}

export type SaveSubmissionReviewInput = SubmissionReviewData & {
  images: Array<{ id: string; isHero: boolean; sortOrder: number }>;
};

export async function saveSubmissionReview(
  id: string,
  input: SaveSubmissionReviewInput,
): Promise<void> {
  const supabase = createServiceClient();
  const { error } = await supabase.rpc("save_submission_review", {
    p_submission_id: id,
    p_review_data: submissionReviewDataToDb(input),
    p_images: input.images.map((image) => ({
      id: image.id,
      is_hero: image.isHero,
      sort_order: image.sortOrder,
    })) as unknown as Json,
  });

  if (error) throw error;
}

export type StageSubmissionReviewImageInput = {
  submissionId: string;
  storagePath: string;
  url: string;
  width: number;
  height: number;
};

export async function stageSubmissionReviewImage(
  input: StageSubmissionReviewImageInput,
): Promise<SubmissionReviewImage> {
  const supabase = createServiceClient();
  const { data: submission, error: submissionError } = await supabase
    .from("brand_submissions")
    .select("id")
    .eq("id", input.submissionId)
    .eq("status", "pending")
    .is("brand_id", null)
    .maybeSingle();
  if (submissionError) throw submissionError;
  if (!submission)
    throw new NotFoundError("BrandSubmission", input.submissionId);

  const { data, error } = await supabase
    .from("submission_images")
    .insert({
      submission_id: input.submissionId,
      storage_path: input.storagePath,
      url: input.url,
      source_url: input.url,
      source: "admin",
      status: "draft",
      sort_order: 0,
      width: input.width,
      height: input.height,
    })
    .select("*")
    .single();
  if (error) throw error;
  return submissionImageToReviewImage(data);
}

export async function cleanupSubmissionDraftImages(
  submissionId: string,
  imageIds: string[],
): Promise<void> {
  if (imageIds.length === 0) return;

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

  const enrichedDataRaw = submission.enriched_data;
  const enrichedData: EnrichedData | null = isEnrichedData(enrichedDataRaw)
    ? enrichedDataFromDb(enrichedDataRaw as Record<string, unknown>)
    : null;

  const { data: imageRows, error: imageError } = await supabase
    .from("submission_images")
    .select(
      "id, submission_id, storage_path, url, source, status, sort_order, alt_zh, alt_en, width, height",
    )
    .eq("submission_id", id)
    .order("sort_order", { ascending: true });
  if (imageError) throw imageError;

  const reviewImages = normalizeSubmissionReviewImages(
    ((imageRows ?? []) as SubmissionImageRow[]).map(submissionImageToReviewImage),
  );
  const reviewData = buildSubmissionReviewData(
    submissionToDomain({
      ...submission,
      other_urls: normalizeOtherUrls(submission.other_urls),
    }),
    enrichedData,
    reviewImages,
  );

  const baseSlug = generateSubmissionSlug(submission);
  if (!isValidSlug(baseSlug)) {
    throw new Error(`Generated slug "${baseSlug}" is not valid kebab-case`);
  }
  const slug = await resolveUniqueSlug(supabase, baseSlug);

  const brandInsert: BrandInsert = {
    ...submissionToBrandBase(submission),
    ...submissionReviewDataToBrandInsert(reviewData),
    name: reviewData.name,
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

  return {
    brandId: approval.brand_id,
    submitterEmail: approval.submitter_email,
    brandName: approval.brand_name,
    submitterName: approval.submitter_name ?? null,
    isBrandOwner: approval.is_brand_owner ?? false,
  };
}

function isCurationTargetStatus(
  value: string | null | undefined,
): value is CurationTargetStatus {
  return ["pending", "running", "succeeded", "skipped", "failed", "cancelled"].includes(
    value ?? "",
  );
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
}

export async function checkBrandDuplicates(
  name: string,
): Promise<DuplicateCheckResult> {
  const supabase = await createClient();

  const { data, error } = await supabase.rpc("check_brand_duplicates", {
    p_name: name,
    p_ubn: null,
  });

  if (error) {
    console.error("[checkBrandDuplicates] RPC error:", error.message);
    return { nameMatches: [] };
  }

  return {
    nameMatches: data?.name_matches ?? [],
  };
}
