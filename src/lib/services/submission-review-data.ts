/**
 * Pure submission review-data model: the review projection built from a
 * submission and its enrichment, the completeness gate, and the review
 * override layer. No Supabase, storage, or network calls live here — the
 * persistence side stays in `./submissions`, which imports from this module
 * (never the other way round).
 */
import type { BrandSubmission, OtherUrl } from "@/lib/types";
import type { Database, Json } from "@/lib/supabase/database.types";
import type {
  CuratedProductProposal,
  EnrichedData,
} from "@/lib/types/enriched-data";
import { parseSubmissionStockists } from "@/lib/types/enriched-data";
import type { StockistCandidate } from "@/lib/types/stockist";
import type { CurationTargetStatus } from "@/lib/services/curation-jobs";
import { toBrandRow } from "./_shared/field-map";
import { L1_CATEGORIES } from "@/lib/taxonomy/ontology";
import {
  ONLINE_STORE_CAMEL_FIELDS,
  ONLINE_STORES,
  ONLINE_STORE_COLUMNS,
  onlineStoreByKey,
  type OnlineStoreCamelField,
  type OnlineStoreColumn,
} from "@/lib/brands/online-stores";

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
  /**
   * Stockist candidates proposed by enrichment (`enriched_data.stockists`),
   * shown read-only in the review. Never written back by a review save:
   * `materializeSubmissionStockists` reads the enrichment blob directly at
   * apply/approve time.
   */
  stockists?: StockistCandidate[];
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
  siteContent: Json | null;
  foundingYear: number | null;
  heroImageUrl: string | null;
  categorySlug: string | null;
  subcategories: string[];
  subcategoriesEn: string[];
  websiteUrl: string | null;
  socialInstagram: string | null;
  socialThreads: string | null;
  socialFacebook: string | null;
  otherUrls: OtherUrl[];
} & { [Field in OnlineStoreCamelField]: string | null };
type SubmissionReviewMissingField =
  | "description"
  | "categorySlug"
  | "subcategories"
  | "website"
  | "heroImage"
  | "successfulEnrichment";
export type SubmissionReviewCompleteness = {
  complete: boolean;
  missingFields: SubmissionReviewMissingField[];
};
export type BrandInsert = Database["public"]["Tables"]["brands"]["Insert"] & {
  [Column in OnlineStoreColumn]?: string | null;
};

export function normalizeString(
  value: string | null | undefined,
): string | null {
  const trimmed = value?.trim() ?? "";
  return trimmed ? trimmed : null;
}

export function normalizeOtherUrls(value: unknown): OtherUrl[] {
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

export function normalizeStringArray(value: unknown): string[] {
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
  // A refresh mirrors the gallery into submission_images with no storage path,
  // so those rows arrive unsigned. Borrow the URL of the brand image each one
  // mirrors: the review must keep the submission_images IDs, because those are
  // the only IDs `save_submission_review` accepts.
  const publishedUrlById = new Map(
    publishedImages.map((image) => [image.id, image.url]),
  );
  const normalizedStaging = normalizeSubmissionReviewImages(
    stagingImages.map((image) =>
      !image.url.trim() && image.originBrandImageId
        ? {
            ...image,
            url: publishedUrlById.get(image.originBrandImageId) ?? "",
          }
        : image,
    ),
  );
  if (normalizedStaging.some((image) => image.status === "active")) {
    return normalizedStaging;
  }

  return normalizeSubmissionReviewImages([
    ...publishedImages,
    ...normalizedStaging,
  ]);
}

export type SubmissionReviewSource = Pick<
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
> &
  Pick<BrandSubmissionWithCategoryNote, OnlineStoreCamelField>;

export function buildSubmissionReviewData(
  submission: SubmissionReviewSource,
  enrichedData: EnrichedData | null | undefined,
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
    stockists: enrichedData?.stockists,
    products: enrichedData?.products,
    siteContent: enrichedData?.siteContent ?? null,
    foundingYear: enrichedData?.foundingYear ?? null,
    /*
     * Display reference only. `approve_submission` owns the brand hero: it
     * selects the first active `submission_images` row and overwrites
     * `brands.hero_image_url` after the insert, ignoring anything sent in
     * `p_brand_data`. Deriving `/i/<key>` here would be worse than useless,
     * because a `submissions/` key is one the image proxy 404s on purpose.
     */
    heroImageUrl:
      normalizeString(imageHero?.url) ??
      preferText(enrichedData?.heroImageUrl, submission.heroImageUrl),
    categorySlug: preferText(
      enrichedData?.categorySlug,
      originalTags.categorySlug,
    ),
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

export function buildRefreshSubmissionReviewData(
  baseBrandData: Record<string, unknown>,
  enrichedData: Record<string, unknown>,
  fallback: SubmissionReviewData,
): SubmissionReviewData {
  const baseReview = reviewDataFromDb(baseBrandData, fallback);
  const stockists = parseSubmissionStockists(enrichedData.stockists);
  return {
    ...reviewDataFromDb(enrichedData, baseReview),
    stockists: stockists ?? undefined,
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
  if (data.subcategories.length < 1) {
    missingFields.push("subcategories");
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
    subcategories: data.subcategories,
    subcategoriesEn: data.subcategoriesEn,
  });
  const purchaseFields = Object.fromEntries(
    ONLINE_STORE_COLUMNS.map((column) => [column, mapped[column]]),
  ) as Pick<BrandInsert, OnlineStoreColumn>;

  return { mapped, purchaseFields };
}

export function submissionReviewDataToBrandInsert(
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
    site_content: data.siteContent,
    founding_year: mapped.founding_year,
    // No hero key is written from review data. `toBrandRow` stopped emitting
    // `hero_image_url`, and a submission hero lives under a `submissions/` key
    // the image proxy refuses to serve, so `approve_submission` is the only
    // correct owner of the brand hero.
    category: mapped.category,
    subcategories: mapped.subcategories,
    subcategories_en: mapped.subcategories_en,
    social_instagram: mapped.social_instagram,
    social_threads: mapped.social_threads,
    social_facebook: mapped.social_facebook,
    ...purchaseFields,
    other_urls: mapped.other_urls,
  };
}

export function submissionReviewDataToDb(
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
    // Same key the enrichment blob uses, so `buildRefreshSubmissionReviewData`
    // reads proposals straight out of `enriched_data` through the same mapper
    // that reads them back out of `review_overrides`. `kept_product_keys` only
    // ever comes from a review — enrichment has no opinion on what to keep.
    products: data.products as unknown as Json,
    kept_product_keys: data.keptProductKeys as unknown as Json,
    site_content: data.siteContent,
    founding_year: mapped.founding_year,
    // No hero key is written from review data. `toBrandRow` stopped emitting
    // `hero_image_url`, and a submission hero lives under a `submissions/` key
    // the image proxy refuses to serve, so `approve_submission` is the only
    // correct owner of the brand hero.
    category: mapped.category,
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
      data[channel.column] === null || typeof data[channel.column] === "string"
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
    // Read-only in the review: never stored in `review_overrides`, so the
    // fallback (the enrichment proposal) always wins.
    stockists: fallback.stockists,
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
