import type { SupabaseClient } from "@supabase/supabase-js";
import { cleanBrandName } from "./brand-cleanup";
import { updateBrand } from "./brands";
import type { BrandFlatLinkColumns } from "@/lib/types";
import type { SiteContent } from "@/lib/types/brand";
import type { ScrapedBrandData } from "@/lib/types/scraper";
import { ENRICH_PHASES } from "@/lib/constants/enrich-phases";
import {
  buildLinkEnrichPatch,
  buildTextEnrichPatch,
  extractLinksFromUrls,
  hasLinkValue,
  LINK_FIELDS,
  linkColumnFor,
} from "./link-enrichment";
import { type ClassificationResult } from "./product-type-classifier";
import type { DescriptionAttempt } from "./description-rewrite";
import { SEARCH_DELAY_MS } from "./enrich-phases/scraper/search";
import {
  insertTriageResult,
  insertDescriptionResult,
  insertClassificationResult,
} from "./ai-results";
import { createServiceClient } from "@/lib/supabase/server";
import type {
  BrandOutcome,
  CurationConfig,
  CurationTargetProgressEvent,
  OperationResult,
  PhaseResult,
} from "@/lib/types/curation";
import {
  applyDetectResult,
  buildPhaseResult,
  getDisplayBrandName,
  loadCachedSearchResults,
  runBrandImagePhase,
  runCleanPhase,
  runDescriptionsPhase,
  runDiscoverPhase,
  runExpansionPhase,
  runClassifyImagesPhase,
  runImageSearchPhase,
  runLinksPhase,
  runStandaloneClassification,
  runDetectPhase,
  type BrandEnrichState,
  type SearchPhaseResult,
  hasPatchValues,
} from "./enrich-phases";
import { buildCandidatePool } from "./enrich-phases/candidate-pool";
import type { EnrichmentTarget } from "./enrichment-target";
import {
  formatBrandComplete,
  formatJobStart,
  formatJobSummary,
  formatPhaseProgress,
  logEnrichmentProgress,
  type BrandPhaseProgress,
  type EnrichmentSummary,
} from "./enrichment-logger";

export type { CurationConfig, OperationResult };
export { shouldSkipForNonBrand } from "./enrich-phases/detect";

type EnrichOperationResult = OperationResult & {
  enrichmentSummary: EnrichmentSummary;
};

type CurationBrand = {
  id: string;
  slug: string;
  name?: string;
  status?: string | null;
  description?: string | null;
  description_en?: string | null;
  city?: string | null;
  product_type?: string | null;
  category_attributes?: unknown | null;
  site_content?: SiteContent | null;
  reputation_summary?: unknown | null;
  retail_locations?: unknown | null;
  mit_evidence?: unknown | null;
  purchase_website?: string | null;
  purchaseWebsite?: string | null;
};

type SupabaseLike = Pick<SupabaseClient, "from">;

type JsonObject = Record<string, unknown>;
type TargetProgressBatchHandler = (
  events: CurationTargetProgressEvent[],
) => void | Promise<void>;
type CurationConfigWithBatchProgress = CurationConfig & {
  onTargetProgressBatch?: TargetProgressBatchHandler;
};
type EnrichmentPatchInput = {
  brandId: string;
  patch: JsonObject;
};

function errorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  if (typeof error === "object" && error !== null) {
    return JSON.stringify(error).slice(0, 500);
  }

  return String(error);
}

const FAQ_CATEGORY_COLUMNS: Record<string, string> = {
  mit: "faq_mit",
  where_to_buy: "faq_where_to_buy",
  products: "faq_products",
  price: "faq_price",
  founded: "faq_founded",
  reputation: "faq_reputation",
};

async function upsertBrandFaq(
  supabase: SupabaseClient,
  brandId: string,
  faqItems: Array<{ category: string; question: string; answer: string }>,
): Promise<void> {
  const row: Record<string, unknown> = {
    brand_id: brandId,
    updated_at: new Date().toISOString(),
  };

  const byCategory = new Map<
    string,
    Array<{ question: string; answer: string }>
  >();
  for (const item of faqItems) {
    const cat = item.category || "custom";
    const list = byCategory.get(cat) ?? [];
    list.push({ question: item.question, answer: item.answer });
    byCategory.set(cat, list);
  }

  for (const [category, items] of byCategory) {
    const column = FAQ_CATEGORY_COLUMNS[category];
    if (column && items.length >= 1) {
      const zhItem = items.find((i) => /[一-鿿]/.test(i.question));
      const enItem = items.find((i) => !/[一-鿿]/.test(i.question));
      if (zhItem || enItem) {
        row[column] = {
          question_zh: zhItem?.question ?? null,
          answer_zh: zhItem?.answer ?? null,
          question_en: enItem?.question ?? null,
          answer_en: enItem?.answer ?? null,
        };
      }
    }
  }

  let customIndex = 1;
  for (const [category, items] of byCategory) {
    if (FAQ_CATEGORY_COLUMNS[category]) continue;
    for (let i = 0; i < items.length && customIndex <= 4; i += 2) {
      const zhItem = items[i];
      const enItem = items[i + 1];
      if (zhItem) {
        row[`faq_custom_${customIndex}`] = enItem
          ? {
              question_zh: zhItem.question,
              answer_zh: zhItem.answer,
              question_en: enItem.question,
              answer_en: enItem.answer,
            }
          : {
              question_zh: zhItem.question,
              answer_zh: zhItem.answer,
              question_en: null,
              answer_en: null,
            };
        customIndex += 1;
      }
    }
  }

  const { error } = await supabase
    .from("brand_faq")
    .upsert(row, { onConflict: "brand_id" });
  if (error)
    console.error(`  [FAQ] upsert failed for ${brandId}:`, error.message);
}

async function logDescriptionAiResult(
  brandId: string,
  attempts: DescriptionAttempt[],
  target?: EnrichmentTarget,
): Promise<void> {
  for (const attempt of attempts) {
    await insertDescriptionResult({
      brandId,
      target,
      description: attempt.parsed.description_zh ?? "",
      priceRange: attempt.parsed.priceRange,
      productTags: attempt.parsed.productTags,
    });
  }
}

const SCRAPE_DELAY_MS = 1000;
const ENRICH_CHUNK_SIZE = 20;
const TARGET_PROGRESS_BATCH_SIZE = 20;
const TARGET_PROGRESS_FLUSH_INTERVAL_MS = 15_000;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

export { ENRICH_PHASES };

type EnrichPhase = "clean" | "links" | "images" | "descriptions" | "tags";
type RunEnrichPhase =
  EnrichPhase | "discover" | "detect" | "slugs" | "expansion";

type EnrichBrand = CurationBrand &
  Partial<BrandFlatLinkColumns> & {
    hero_image_url?: string | null;
    product_images?: string[] | null;
    heroImageUrl?: string | null;
    productPhotos?: string[] | null;
  };

type EnrichScrapedData = Partial<ScrapedBrandData> &
  Partial<BrandFlatLinkColumns> & {
    snippets?: string[];
  };

type EnrichImagePatch = Partial<{
  hero_image_url: string | null;
}>;

function isEmptyField(value: unknown): boolean {
  if (value == null) return true;
  if (typeof value === "string") return value.trim().length === 0;
  if (Array.isArray(value)) return value.length === 0;
  return false;
}

export function needsPhase(
  brand: Record<string, unknown>,
  phase: RunEnrichPhase,
): boolean {
  if (phase === "descriptions") {
    return (
      isEmptyField(brand.description) ||
      isEmptyField(brand.description_en) ||
      isEmptyField(brand.blurb_en)
    );
  }

  if (phase === "images") {
    return isEmptyField(brand.hero_image_url ?? brand.heroImageUrl);
  }

  if (phase === "expansion") {
    return isEmptyField(brand.reputation_summary ?? brand.reputationSummary);
  }

  return true;
}

function shouldSelectForRequestedPhases(
  brand: Record<string, unknown>,
  phases: RunEnrichPhase[],
): boolean {
  const fillGapPhases = phases.filter(
    (phase) =>
      phase === "descriptions" || phase === "images" || phase === "expansion",
  );

  if (fillGapPhases.length === 0) return true;
  return fillGapPhases.some((phase) => needsPhase(brand, phase));
}

type EnrichCleanPhase = {
  changed: boolean;
  original?: string;
  cleaned?: string;
};

type EnrichDescriptionsPhase = {
  changed: boolean;
};

type EnrichDescriptionPatch = Partial<{
  description: string | null;
  description_en: string | null;
  price_range: number | null;
  product_tags: string[] | null;
  city: string | null;
  category_attributes: unknown;
}>;

type EnrichProcessPhases = {
  clean?: EnrichCleanPhase;
  descriptions?: EnrichDescriptionsPhase;
};

type EnrichPatches = {
  clean?: Partial<Pick<CurationBrand, "name">>;
  links?: Partial<BrandFlatLinkColumns>;
  images?: EnrichImagePatch;
  descriptions?: EnrichDescriptionPatch;
  tags?: Partial<Pick<CurationBrand, "product_type">>;
};

type EnrichPatch = Partial<BrandFlatLinkColumns> &
  EnrichImagePatch &
  EnrichDescriptionPatch &
  Partial<Pick<EnrichBrand, "product_type" | "name">>;

type ProcessEnrichResult = {
  phases: EnrichProcessPhases;
  patches: EnrichPatches;
  patch: EnrichPatch;
  hasChanges: boolean;
};

type SubmissionEnrichmentRow = {
  id: string;
  brand_name: string;
  description: string | null;
  website_url: string | null;
  hero_image_url: string | null;
  social_instagram: string | null;
  social_threads: string | null;
  social_facebook: string | null;
  purchase_website: string | null;
  purchase_pinkoi: string | null;
  purchase_shopee: string | null;
  other_urls: unknown;
  enriched_data: unknown;
  owner_data: unknown;
  status: string;
};

function isRequestedPhase(phases: string[], phase: EnrichPhase): boolean {
  return phases.includes(phase);
}

function isPlainObject(value: unknown): value is JsonObject {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function seedEnrichedDataFromOwnerData(
  ownerData: unknown,
  existingEnriched: JsonObject | null | undefined,
): JsonObject {
  const existing = existingEnriched ?? {};
  if (!isPlainObject(ownerData)) return existing;

  const merged = { ...existing };
  const fieldMappings = [
    ["productType", "product_type"],
    ["foundingYear", "founding_year"],
    ["city", "city"],
    ["priceRange", "price_range"],
    ["productTags", "product_tags"],
    ["productPhotos", "product_photos"],
    ["retailLocations", "retail_locations"],
    ["mitStory", "mit_story"],
    ["heroImageUrl", "hero_image_url"],
    ["description", "description"],
    ["socialInstagram", "social_instagram"],
    ["socialThreads", "social_threads"],
    ["socialFacebook", "social_facebook"],
    ["purchaseWebsite", "purchase_website"],
    ["purchasePinkoi", "purchase_pinkoi"],
    ["purchaseShopee", "purchase_shopee"],
  ] as const;

  for (const [ownerKey, enrichedKey] of fieldMappings) {
    if (merged[enrichedKey] == null && ownerData[ownerKey] !== undefined) {
      merged[enrichedKey] = ownerData[ownerKey];
    }
  }

  return merged;
}

function deepMergeJsonObjects(base: JsonObject, patch: JsonObject): JsonObject {
  const merged: JsonObject = { ...base };

  for (const [key, value] of Object.entries(patch)) {
    const existing = merged[key];
    if (Array.isArray(existing) && Array.isArray(value)) {
      merged[key] = [...new Set([...existing, ...value])];
      continue;
    }

    merged[key] =
      isPlainObject(existing) && isPlainObject(value)
        ? deepMergeJsonObjects(existing, value)
        : value;
  }

  return merged;
}

function uniqueUrls(urls: string[]): string[] {
  const seen = new Set<string>();
  const unique: string[] = [];

  for (const url of urls) {
    const normalized = url.trim();
    if (!normalized || seen.has(normalized)) {
      continue;
    }

    seen.add(normalized);
    unique.push(normalized);
  }

  return unique;
}

function chunkItems<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];

  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }

  return chunks;
}

function collectKnownUrls(brand: EnrichBrand): string[] {
  const linkUrls = LINK_FIELDS.map(
    (field) => brand[linkColumnFor(field)],
  ).filter((url): url is string => hasLinkValue(url));

  return uniqueUrls(linkUrls);
}

function normalizeScrapedData(
  scrapedData: EnrichScrapedData,
): EnrichScrapedData {
  return {
    ...scrapedData,
    social_instagram:
      scrapedData.social_instagram ?? scrapedData.socialInstagram,
    social_threads: scrapedData.social_threads ?? scrapedData.socialThreads,
    social_facebook: scrapedData.social_facebook ?? scrapedData.socialFacebook,
    purchase_website:
      scrapedData.purchase_website ?? scrapedData.purchaseWebsite,
    purchase_pinkoi: scrapedData.purchase_pinkoi ?? scrapedData.purchasePinkoi,
    purchase_shopee: scrapedData.purchase_shopee ?? scrapedData.purchaseShopee,
  };
}

export function processEnrichBrand(
  brand: EnrichBrand,
  scrapedData: EnrichScrapedData,
  phases: string[],
): ProcessEnrichResult {
  const phaseResults: EnrichProcessPhases = {};
  const patches: EnrichPatches = {};
  const normalizedScrapedData = normalizeScrapedData(scrapedData);

  if (isRequestedPhase(phases, "clean")) {
    const nameCleanup = cleanBrandName(brand.name ?? "");
    phaseResults.clean = nameCleanup.changed
      ? {
          changed: true,
          original: nameCleanup.originalName,
          cleaned: nameCleanup.cleanedName,
        }
      : { changed: false };

    if (nameCleanup.changed) {
      patches.clean = { name: nameCleanup.cleanedName };
    }
  }

  if (isRequestedPhase(phases, "links")) {
    const links = buildLinkEnrichPatch(brand, normalizedScrapedData);
    if (hasPatchValues(links)) {
      patches.links = links;
    }
  }

  if (isRequestedPhase(phases, "descriptions")) {
    const descriptions = buildTextEnrichPatch(brand, normalizedScrapedData);
    phaseResults.descriptions = { changed: hasPatchValues(descriptions) };
    if (hasPatchValues(descriptions)) {
      patches.descriptions = descriptions;
    }
  }

  const patch = mergeEnrichPatches(patches);

  return {
    phases: phaseResults,
    patches,
    patch,
    hasChanges: hasPatchValues(patch),
  };
}

export function mergeEnrichPatches(patches: EnrichPatches): EnrichPatch {
  return {
    ...patches.clean,
    ...patches.links,
    ...patches.images,
    ...patches.descriptions,
    ...patches.tags,
  };
}

function changedFieldsFromPhaseResults(phaseResults: PhaseResult[]): string[] {
  return [
    ...new Set(
      phaseResults.flatMap((phaseResult) => phaseResult.changedFields),
    ),
  ];
}

function phaseProgressStatus(
  status: PhaseResult["status"],
): BrandPhaseProgress["status"] {
  if (status === "succeeded") {
    return "success";
  }

  return status;
}

function mergeTargetProgressEvents(
  events: CurationTargetProgressEvent[],
): CurationTargetProgressEvent[] {
  const latestByTarget = new Map<string, CurationTargetProgressEvent>();

  for (const event of events) {
    const previous = latestByTarget.get(event.targetId);
    if (!previous) {
      latestByTarget.set(event.targetId, event);
      continue;
    }

    latestByTarget.set(event.targetId, {
      ...previous,
      ...event,
      ...(event.phaseResults === undefined &&
        previous.phaseResults !== undefined && {
          phaseResults: previous.phaseResults,
        }),
      ...(event.changedFields === undefined &&
        previous.changedFields !== undefined && {
          changedFields: previous.changedFields,
        }),
      ...(event.error === undefined &&
        previous.error !== undefined && {
          error: previous.error,
        }),
      ...(event.durationMs === undefined &&
        previous.durationMs !== undefined && {
          durationMs: previous.durationMs,
        }),
    });
  }

  return [...latestByTarget.values()];
}

function logPhaseResult(
  onProgress: (message: string) => void,
  brand: EnrichBrand,
  brandIndex: number,
  totalBrands: number,
  phaseResult: PhaseResult,
  phaseIndex: number,
  totalPhases: number,
): void {
  onProgress(
    formatPhaseProgress({
      brandSlug: brand.slug,
      brandIndex,
      totalBrands,
      phaseName: phaseResult.phase,
      phaseIndex,
      totalPhases,
      status: phaseProgressStatus(phaseResult.status),
      durationMs: phaseResult.durationMs,
      ...(phaseResult.error !== undefined ? { error: phaseResult.error } : {}),
    }),
  );
}

function buildBrandPhaseOrder(
  phases: RunEnrichPhase[],
  hasDetectPhases: boolean,
): string[] {
  return [
    hasDetectPhases && "detect",
    "clean",
    "links",
    "images",
    "descriptions",
    "expansion",
    phases.includes("tags") && "tags",
  ].filter((phase): phase is string => Boolean(phase));
}

export function createEnrichmentSummary(
  result: OperationResult,
  durationMs: number,
): EnrichmentSummary {
  return {
    success: result.brandOutcomes.filter(
      (outcome) => outcome.status === "succeeded",
    ).length,
    skipped: result.brandOutcomes.filter(
      (outcome) => outcome.status === "skipped",
    ).length,
    failed: result.brandOutcomes.filter(
      (outcome) => outcome.status === "failed",
    ).length,
    failedBrands: result.brandOutcomes
      .filter(
        (outcome): outcome is BrandOutcome & { error: string } =>
          outcome.status === "failed" && typeof outcome.error === "string",
      )
      .map((outcome) => {
        const failedPhase = outcome.phaseResults?.find(
          (phaseResult) => phaseResult.status === "failed",
        );
        return {
          slug: outcome.slug,
          phase: failedPhase?.phase ?? "brand",
          error: failedPhase?.error ?? outcome.error,
        };
      }),
    durationMs,
  };
}

function finishEnrichResult(
  result: OperationResult,
  startedAt: number,
  onProgress: (message: string) => void,
): EnrichOperationResult {
  const enrichmentSummary = createEnrichmentSummary(
    result,
    Date.now() - startedAt,
  );
  for (const line of formatJobSummary(enrichmentSummary)) {
    onProgress(line);
  }

  return {
    ...result,
    enrichmentSummary,
  };
}

function appendPatch(
  state: BrandEnrichState,
  patch: Record<string, unknown>,
): void {
  Object.assign(state.patches, patch);
}

export async function persistSubmissionEnrichmentResults(
  supabase: SupabaseClient,
  submissionId: string,
  patch: JsonObject,
  jobId?: string,
): Promise<void> {
  const { data: row, error: selectError } = await supabase
    .from("brand_submissions")
    .select("enriched_data, status")
    .eq("id", submissionId)
    .single();

  if (selectError || !row) {
    console.warn(
      `Skipping enrichment persistence for missing submission ${submissionId}`,
    );
    return;
  }

  if (row.status !== "pending") {
    console.warn(
      `Skipping enrichment persistence for non-pending submission ${submissionId}`,
    );
    return;
  }

  const existing = (row.enriched_data ?? {}) as Record<string, unknown>;
  const merged = deepMergeJsonObjects(
    existing,
    patch as Record<string, unknown>,
  );
  if (jobId) {
    const { data, error } = await (
      supabase as unknown as {
        rpc: (
          name: "apply_submission_enrichment_result",
          args: {
            p_submission_id: string;
            p_enriched_data: JsonObject;
            p_job_id: string;
          },
        ) => Promise<{ data: boolean; error: { message?: string } | null }>;
      }
    ).rpc("apply_submission_enrichment_result", {
      p_submission_id: submissionId,
      p_enriched_data: merged as JsonObject,
      p_job_id: jobId,
    });
    if (error) throw new Error(error.message ?? "Failed to persist submission enrichment");
    if (!data) throw new Error("Curation job is no longer running");
    return;
  }

  const { error: updateError, count } = await supabase
    .from("brand_submissions")
    .update({ enriched_data: merged }, { count: "exact" })
    .eq("id", submissionId)
    .eq("status", "pending");

  if (updateError) {
    throw new Error(
      updateError.message ?? "Failed to update brand submission enrichment",
    );
  }

  if (count === 0) {
    console.warn(
      `Skipping enrichment persistence after pending status changed for submission ${submissionId}`,
    );
  }
}

function submissionToEnrichBrand(
  submission: SubmissionEnrichmentRow,
): EnrichBrand {
  const existingEnriched = isPlainObject(submission.enriched_data)
    ? submission.enriched_data
    : {};
  const existing = seedEnrichedDataFromOwnerData(
    submission.owner_data,
    existingEnriched,
  );

  return {
    ...existing,
    id: submission.id,
    slug: `submission-${submission.id}`,
    name:
      typeof existing.name === "string" ? existing.name : submission.brand_name,
    status: submission.status,
    description:
      typeof existing.description === "string"
        ? existing.description
        : submission.description,
    description_en:
      typeof existing.description_en === "string"
        ? existing.description_en
        : null,
    city: typeof existing.city === "string" ? existing.city : null,
    category_attributes: existing.category_attributes ?? null,
    site_content: isPlainObject(existing.site_content)
      ? (existing.site_content as EnrichBrand["site_content"])
      : null,
    reputation_summary: existing.reputation_summary ?? null,
    retail_locations: existing.retail_locations ?? null,
    mit_evidence: existing.mit_evidence ?? null,
    product_type:
      typeof existing.product_type === "string" ? existing.product_type : null,
    social_instagram:
      typeof existing.social_instagram === "string"
        ? existing.social_instagram
        : submission.social_instagram,
    social_threads:
      typeof existing.social_threads === "string"
        ? existing.social_threads
        : submission.social_threads,
    social_facebook:
      typeof existing.social_facebook === "string"
        ? existing.social_facebook
        : submission.social_facebook,
    purchase_website:
      typeof existing.purchase_website === "string"
        ? existing.purchase_website
        : (submission.purchase_website ?? submission.website_url),
    purchase_pinkoi:
      typeof existing.purchase_pinkoi === "string"
        ? existing.purchase_pinkoi
        : submission.purchase_pinkoi,
    purchase_shopee:
      typeof existing.purchase_shopee === "string"
        ? existing.purchase_shopee
        : submission.purchase_shopee,
    hero_image_url:
      typeof existing.hero_image_url === "string"
        ? existing.hero_image_url
        : (submission.hero_image_url ?? null),
  };
}

export async function persistEnrichmentResults(
  supabase: SupabaseClient,
  brandId: string,
  patch: JsonObject,
): Promise<void>;
export async function persistEnrichmentResults(
  supabase: SupabaseClient,
  patches: EnrichmentPatchInput[],
  jobId?: string,
): Promise<void>;
export async function persistEnrichmentResults(
  supabase: SupabaseClient,
  brandIdOrPatches: string | EnrichmentPatchInput[],
  patchOrJobId?: JsonObject | string,
): Promise<void> {
  void supabase;

  const patches = Array.isArray(brandIdOrPatches)
    ? brandIdOrPatches
    : [{ brandId: brandIdOrPatches, patch: patchOrJobId as JsonObject }];
  const jobId =
    Array.isArray(brandIdOrPatches) && typeof patchOrJobId === "string"
      ? patchOrJobId
      : undefined;

  for (const item of patches) {
    await updateBrand(
      item.brandId,
      {
        ...item.patch,
        brand_enriched_at: new Date().toISOString(),
      } as never,
      { source: "enriched", jobId },
    );
  }
}

export async function runEnrich(
  config: CurationConfig & { phases: string[] },
  supabase: SupabaseLike,
): Promise<EnrichOperationResult> {
  const startedAt = Date.now();
  const onProgress = config.onProgress ?? logEnrichmentProgress;
  const onTargetProgress = config.onTargetProgress;
  const onTargetProgressBatch = (config as CurationConfigWithBatchProgress)
    .onTargetProgressBatch;
  const result: OperationResult = {
    processed: 0,
    updated: 0,
    skipped: 0,
    errors: [],
    brandOutcomes: [],
  };

  const phases = config.phases as RunEnrichPhase[];
  const target =
    config.target ?? (config.slugs?.length ? "brands" : "submissions");
  const enrichDelayMs = phases.includes("discover")
    ? SEARCH_DELAY_MS
    : SCRAPE_DELAY_MS;
  const includesDiscover = phases.includes("discover");
  let weakBrandCount = 0;
  let allBrands: EnrichBrand[] = [];

  if (target === "submissions") {
    let query = supabase
      .from("brand_submissions")
      .select("*")
      .eq("status", "pending")
      .is("brand_id", null);

    if (config.submissionIds?.length) {
      query = query.in("id", config.submissionIds);
    }

    if (!config.overwrite && !config.submissionIds?.length) {
      query = query.is("enriched_data", null);
    }

    if (config.limit !== undefined) {
      query = query.limit(config.limit);
    }

    const { data: submissions, error } = await query;

    if (error) {
      const message = error.message ?? "Failed to fetch submissions";
      result.errors.push(message);
      onProgress(`[ENRICH] ERROR: Failed to fetch submissions: ${message}`);
      throw error;
    }

    allBrands = ((submissions ?? []) as SubmissionEnrichmentRow[]).map(
      submissionToEnrichBrand,
    );
  } else {
    let query = supabase
      .from("brands")
      .select(
        "id, slug, name, status, description, description_en, blurb, blurb_en, price_range, product_tags, product_tags_en, founding_year, product_type, category_attributes, site_content, reputation_summary, retail_locations, mit_evidence, social_instagram, social_threads, social_facebook, purchase_website, purchase_pinkoi, purchase_shopee, hero_image_url, city",
      );

    if (config.slugs && config.slugs.length > 0) {
      query = query.in("slug", config.slugs);
    }

    if (config.status) {
      query = query.eq("status", config.status);
    }

    if (config.limit !== undefined && config.overwrite) {
      query = query.limit(config.limit);
    }

    const { data, error } = await query;

    if (error) {
      const message = error.message ?? "Failed to fetch brands";
      result.errors.push(message);
      onProgress(`[ENRICH] ERROR: Failed to fetch brands: ${message}`);
      throw error;
    }

    const brands = (data ?? []) as EnrichBrand[];
    const phaseEligibleBrands = config.overwrite
      ? brands
      : brands.filter((brand) =>
          shouldSelectForRequestedPhases(
            brand as Record<string, unknown>,
            phases,
          ),
        );
    allBrands =
      config.limit === undefined
        ? phaseEligibleBrands
        : phaseEligibleBrands.slice(0, config.limit);
  }

  const totalBrands = allBrands.length;
  for (const line of formatJobStart(totalBrands)) {
    onProgress(line);
  }
  const brandChunks = chunkItems(allBrands, ENRICH_CHUNK_SIZE);

  for (let chunkIndex = 0; chunkIndex < brandChunks.length; chunkIndex += 1) {
    if (chunkIndex > 0) {
      await delay(enrichDelayMs);
    }

    const chunk = brandChunks[chunkIndex];
    const hasDetectPhases =
      phases.includes("detect") ||
      phases.includes("slugs") ||
      phases.includes("tags");
    const activeSteps = [
      phases.includes("discover") && "SERP",
      phases.includes("images") && "images",
      hasDetectPhases && "detect",
      phases.includes("tags") && !phases.includes("descriptions") && "tags",
      phases.includes("descriptions") &&
        phases.includes("tags") &&
        "descriptions+tags",
      phases.includes("descriptions") &&
        !phases.includes("tags") &&
        "descriptions",
    ].filter(Boolean);
    onProgress(
      `\n[BATCH ${chunkIndex + 1}/${brandChunks.length}] ${chunk.length} brands — fetching ${activeSteps.join(" + ")}...`,
    );

    const chunkBrandNames = chunk.map(getDisplayBrandName);
    const targetType: EnrichmentTarget["type"] =
      target === "submissions" ? "submission" : "brand";
    const batchContext = {
      chunk,
      chunkBrandNames,
      phases,
      dryRun: config.dryRun,
      onProgress,
      supabase: supabase as unknown as SupabaseClient,
      targetType,
      jobId: config.jobId,
    };

    const pendingTargetProgress: CurationTargetProgressEvent[] = [];
    let lastTargetProgressFlushAt = Date.now();
    const flushTargetProgress = async (force: boolean): Promise<void> => {
      if (!onTargetProgressBatch || pendingTargetProgress.length === 0) {
        return;
      }

      if (
        !force &&
        pendingTargetProgress.length < TARGET_PROGRESS_BATCH_SIZE &&
        Date.now() - lastTargetProgressFlushAt <
          TARGET_PROGRESS_FLUSH_INTERVAL_MS
      ) {
        return;
      }

      const events = mergeTargetProgressEvents(pendingTargetProgress);
      pendingTargetProgress.length = 0;
      await onTargetProgressBatch(events);
      lastTargetProgressFlushAt = Date.now();
    };
    const emitTargetProgressBatch = async (
      events: CurationTargetProgressEvent[],
    ): Promise<void> => {
      if (events.length === 0) return;
      if (!onTargetProgressBatch) {
        for (const event of events) {
          await onTargetProgress?.(event);
        }
        return;
      }

      await flushTargetProgress(true);
      await onTargetProgressBatch(mergeTargetProgressEvents(events));
      lastTargetProgressFlushAt = Date.now();
    };
    const queueTargetProgress = async (
      event: CurationTargetProgressEvent,
    ): Promise<void> => {
      if (!onTargetProgressBatch) {
        await onTargetProgress?.(event);
        return;
      }

      pendingTargetProgress.push(event);
      await flushTargetProgress(false);
    };
    const batchPhaseResults = new Map<string, PhaseResult[]>();
    const emitBatchPhaseProgress = async (phase: string): Promise<void> => {
      await emitTargetProgressBatch(
        chunk.map((brand) => ({
          targetId: brand.id,
          targetType,
          slug: brand.slug,
          name: getDisplayBrandName(brand),
          status: "running",
          currentPhase: phase,
          phaseResults: batchPhaseResults.get(brand.id) ?? [],
        })),
      );
    };
    const recordBatchPhase = async (
      phaseResult: PhaseResult,
      changedField: string,
      hasTargetResult: (brand: EnrichBrand) => boolean,
    ): Promise<void> => {
      for (const brand of chunk) {
        const targetPhaseResult = {
          ...phaseResult,
          changedFields:
            hasTargetResult(brand) && !config.dryRun
              ? phaseResult.changedFields.filter(
                  (field) => field === changedField,
                )
              : [],
        };
        batchPhaseResults.set(brand.id, [
          ...(batchPhaseResults.get(brand.id) ?? []),
          targetPhaseResult,
        ]);
      }
      await emitBatchPhaseProgress(phaseResult.phase);
    };

    if (phases.includes("discover")) await emitBatchPhaseProgress("discover");
    const discoverResult = await runDiscoverPhase(batchContext);
    let searchResults = discoverResult.searchResults;
    const searchError = discoverResult.searchError;
    if (phases.includes("discover")) {
      await recordBatchPhase(
        discoverResult.phaseResult,
        "serp_search_results",
        (brand) => {
          const result = searchResults.get(getDisplayBrandName(brand));
          return Boolean(
            result && (result.urls.length > 0 || result.snippets.length > 0),
          );
        },
      );
    }

    if (
      !phases.includes("discover") &&
      (hasDetectPhases || phases.includes("descriptions"))
    ) {
      const cached = await loadCachedSearchResults(
        chunk.map((brand) => brand.id),
        targetType,
      );
      const cachedByName = new Map<string, SearchPhaseResult>();
      for (const brand of chunk) {
        const row = cached.get(brand.id);
        if (row) {
          cachedByName.set(getDisplayBrandName(brand), row);
        }
      }
      searchResults = cachedByName;
      const cachedCount = [...searchResults.values()].filter(
        (r) => r.snippets.length > 0,
      ).length;
      if (cachedCount > 0) {
        onProgress(`  [SERP-CACHE] Loaded ${cachedCount} cached snippet sets`);
      }
    }

    if (phases.includes("images")) await emitBatchPhaseProgress("image-search");
    const imageSearchResult = await runImageSearchPhase(
      batchContext,
      searchResults,
    );
    const imageSearchResults = imageSearchResult.imageSearchResults;
    if (phases.includes("images")) {
      await recordBatchPhase(
        imageSearchResult.phaseResult,
        "image_search_results",
        (brand) =>
          (imageSearchResults.get(getDisplayBrandName(brand))?.length ?? 0) > 0,
      );
    }

    if (hasDetectPhases) await emitBatchPhaseProgress("detect");
    const detectPhaseResult = await runDetectPhase(batchContext, searchResults);
    const detectResults = detectPhaseResult.detectResults;
    const standaloneClassificationResult =
      await runStandaloneClassification(batchContext);
    const batchClassifications =
      standaloneClassificationResult.batchClassifications;

    for (const brand of chunk) {
      result.processed += 1;
      const brandIndex = result.processed;
      const brandStartedAt = Date.now();
      const phaseOrder = buildBrandPhaseOrder(phases, hasDetectPhases);
      const totalPhases = phaseOrder.length;
      let currentPhase: string | undefined;
      const emitTargetProgress = async (
        status: "running" | BrandOutcome["status"],
        options?: {
          phaseResults?: PhaseResult[];
          changedFields?: string[];
          error?: string;
          durationMs?: number;
        },
      ): Promise<void> => {
        const event: CurationTargetProgressEvent = {
          targetId: brand.id,
          targetType,
          slug: brand.slug,
          name: getDisplayBrandName(brand),
          status,
          currentPhase,
          ...options,
        };
        await queueTargetProgress(event);
      };
      const markCurrentPhase = async (phase: string): Promise<void> => {
        currentPhase = phase;
        await emitTargetProgress("running");
      };
      const logCurrentPhase = async (
        phaseResult: PhaseResult,
      ): Promise<void> => {
        currentPhase = phaseResult.phase;
        const rawIndex = phaseOrder.indexOf(phaseResult.phase);
        const phaseIndex = rawIndex >= 0 ? rawIndex + 1 : totalPhases;
        logPhaseResult(
          onProgress,
          brand,
          brandIndex,
          totalBrands,
          phaseResult,
          phaseIndex,
          totalPhases,
        );
        await emitTargetProgress("running", {
          phaseResults: outcomePhaseResults,
        });
      };
      const recordOutcome = async (outcome: BrandOutcome): Promise<void> => {
        result.brandOutcomes.push(outcome);
        await emitTargetProgressBatch([
          {
            targetId: brand.id,
            targetType,
            slug: brand.slug,
            name: getDisplayBrandName(brand),
            status: outcome.status,
            currentPhase,
            phaseResults: outcome.phaseResults,
            changedFields: outcome.changedFields,
            error: outcome.error,
            durationMs: Date.now() - brandStartedAt,
          },
        ]);
      };
      let outcomePhaseResults: PhaseResult[] = [];

      await emitTargetProgress("running");

      try {
        const detectResult = detectResults.get(brand.slug);
        const state: BrandEnrichState = {
          patches: {},
          phaseResults: [...(batchPhaseResults.get(brand.id) ?? [])],
          knownUrls: collectKnownUrls(brand),
          discoveredUrls: [],
          serpSnippets: [],
          scrapedData: {},
        };
        outcomePhaseResults = state.phaseResults;
        const detectApplication = applyDetectResult(
          detectResult,
          brand,
          phases,
        );
        if (hasDetectPhases) {
          await markCurrentPhase("detect");
          state.phaseResults.push(detectApplication.phaseResult);
          await logCurrentPhase(detectApplication.phaseResult);
        }
        appendPatch(state, detectApplication.patch);

        let detectedSlug = state.patches.slug;

        if (target === "brands" && detectedSlug && !config.dryRun) {
          const svc = createServiceClient();
          const { data: slugOwner } = await svc
            .from("brands")
            .select("id")
            .eq("slug", detectedSlug)
            .neq("id", brand.id)
            .maybeSingle();
          if (slugOwner) {
            onProgress(
              `  [SLUG-CONFLICT] "${detectedSlug}" already taken — keeping original slug`,
            );
            delete state.patches.slug;
            detectApplication.phaseResult.changedFields =
              detectApplication.phaseResult.changedFields.filter(
                (field) => field !== "slug",
              );
            detectedSlug = undefined;
          }
        }

        if (detectApplication.isNonBrand) {
          onProgress(
            `  [NON-BRAND] ${brand.slug}: ${detectResult?.nonBrandReason ?? "non-brand"} (${detectResult?.confidence})`,
          );

          if (!config.dryRun) {
            await insertTriageResult({
              brandId: brand.id,
              target: { type: targetType, id: brand.id },
              isNonBrand: true,
              nonBrandReason: detectResult?.nonBrandReason ?? null,
              slugGenerated: detectResult?.slugGenerated ?? null,
              productType: detectResult?.productType ?? null,
              confidence: detectResult?.confidence ?? "high",
            });
            if (target === "brands") {
              await updateBrand(
                brand.id,
                {
                  status: "hidden",
                  brand_enriched_at: new Date().toISOString(),
                } as never,
                { source: "enriched", jobId: config.jobId },
              );
            }
          }

          await recordOutcome({
            slug: brand.slug,
            name: getDisplayBrandName(brand),
            ...(target === "submissions" ? { submissionId: brand.id } : {}),
            status: "skipped",
            changedFields: changedFieldsFromPhaseResults(state.phaseResults),
            phaseResults: state.phaseResults,
          });
          result.skipped += 1;
          onProgress(
            formatBrandComplete(
              brand.slug,
              brandIndex,
              totalBrands,
              Date.now() - brandStartedAt,
            ),
          );
          continue;
        }

        if (searchError) {
          throw new Error(searchError);
        }

        if (phases.includes("discover")) {
          const searchResult = searchResults.get(
            getDisplayBrandName(brand),
          ) ?? { urls: [], snippets: [] };
          state.discoveredUrls = uniqueUrls(
            searchResult.urls.filter((url) => !state.knownUrls.includes(url)),
          );
          state.serpSnippets = searchResult.snippets;
        } else if (searchResults.size > 0) {
          const searchResult = searchResults.get(
            getDisplayBrandName(brand),
          ) ?? { urls: [], snippets: [] };
          state.serpSnippets = searchResult.snippets;
        }

        const urlExtracted = extractLinksFromUrls(state.discoveredUrls);
        let imageSearchUrls: string[] = [];
        if (phases.includes("images")) {
          imageSearchUrls =
            imageSearchResults.get(getDisplayBrandName(brand)) ?? [];
          onProgress(`  [IMAGE-SEARCH] ${imageSearchUrls.length} images found`);
        }

        if (
          !phases.includes("tags") &&
          uniqueUrls([...state.knownUrls, ...state.discoveredUrls]).length ===
            0 &&
          !hasPatchValues(urlExtracted) &&
          imageSearchUrls.length === 0
        ) {
          if (includesDiscover && state.discoveredUrls.length <= 1) {
            weakBrandCount += 1;
            onProgress(
              `  [WEAK-BRAND] ${brand.slug}: no useful data found (${state.discoveredUrls.length} search results, nothing to scrape)`,
            );
          }
          await recordOutcome({
            slug: brand.slug,
            name: getDisplayBrandName(brand),
            ...(target === "submissions" ? { submissionId: brand.id } : {}),
            status: "skipped",
            changedFields: changedFieldsFromPhaseResults(state.phaseResults),
            phaseResults: state.phaseResults,
          });
          result.skipped += 1;
          onProgress(
            formatBrandComplete(
              brand.slug,
              brandIndex,
              totalBrands,
              Date.now() - brandStartedAt,
            ),
          );
          continue;
        }

        await markCurrentPhase("clean");
        const cleanResult = await runCleanPhase(brand, phases);
        state.phaseResults.push(cleanResult.phaseResult);
        await logCurrentPhase(cleanResult.phaseResult);
        appendPatch(state, cleanResult.patch);

        await markCurrentPhase("links");
        const linksResult = await runLinksPhase({
          brand,
          phases,
          discoveredUrls: state.discoveredUrls,
          knownUrls: state.knownUrls,
          dryRun: config.dryRun,
          target: { type: targetType, id: brand.id },
          jobId: config.jobId,
        });
        state.phaseResults.push(linksResult.phaseResult);
        await logCurrentPhase(linksResult.phaseResult);
        state.scrapedData = linksResult.scrapedData ?? {};
        appendPatch(state, linksResult.patch);

        const candidateImages = buildCandidatePool({
          scraped: linksResult.scrapedImageUrls,
          jsonLdImages: linksResult.jsonLdImageUrls,
          googleImages: imageSearchUrls,
        });
        await markCurrentPhase("images");
        const brandImageResult = await runBrandImagePhase({
          brand,
          phases,
          imageSearchUrls,
          candidateImages,
          dryRun: config.dryRun,
          target: { type: targetType, id: brand.id },
        });
        state.phaseResults.push(brandImageResult.phaseResult);
        await logCurrentPhase(brandImageResult.phaseResult);
        appendPatch(state, brandImageResult.patch);

        await markCurrentPhase("classify-images");
        const classifyImagesResult = await runClassifyImagesPhase({
          brand,
          phases,
          dryRun: config.dryRun,
          overwrite: config.overwrite,
          target: { type: targetType, id: brand.id },
          jobId: config.jobId,
        });
        state.phaseResults.push(classifyImagesResult.phaseResult);
        await logCurrentPhase(classifyImagesResult.phaseResult);
        appendPatch(state, classifyImagesResult.patch);

        await markCurrentPhase("descriptions");
        const descriptionsResult = await runDescriptionsPhase({
          brand,
          phases,
          serpSnippets: state.serpSnippets,
          overwrite: config.overwrite,
          dryRun: config.dryRun,
          target: { type: targetType, id: brand.id },
          jobId: config.jobId,
        });
        state.phaseResults.push(descriptionsResult.phaseResult);
        await logCurrentPhase(descriptionsResult.phaseResult);
        appendPatch(state, descriptionsResult.patch);
        const reputationAlreadySet =
          descriptionsResult.patch.reputation_summary != null;

        await markCurrentPhase("expansion");
        const expansionResult = await runExpansionPhase({
          brand,
          phases,
          serpSnippets: state.serpSnippets,
          scrapedData: state.scrapedData,
          overwrite: config.overwrite,
          reputationAlreadySet,
          target: { type: targetType, id: brand.id },
          jobId: config.jobId,
        });
        state.phaseResults.push(expansionResult.phaseResult);
        await logCurrentPhase(expansionResult.phaseResult);
        appendPatch(state, expansionResult.patch);

        let classification: ClassificationResult | null = null;
        let hasCompletedTagClassification = false;
        if (
          !(phases.includes("descriptions") && state.serpSnippets.length > 0) &&
          phases.includes("tags")
        ) {
          classification = batchClassifications.get(brand.slug) ?? null;
        }

        if (classification) {
          await markCurrentPhase("tags");
          const tagStartedAt = Date.now();
          hasCompletedTagClassification = true;
          if (classification.productType !== brand.product_type) {
            appendPatch(state, { product_type: classification.productType });
            const tagPhaseResult = buildPhaseResult(
              "tags",
              "succeeded",
              ["product_type"],
              Date.now() - tagStartedAt,
            );
            state.phaseResults.push(tagPhaseResult);
            await logCurrentPhase(tagPhaseResult);
            onProgress(
              `  [TAG] ${brand.slug}: ${brand.product_type ?? "null"} → ${classification.productType} (${classification.confidence})`,
            );
          } else {
            const tagPhaseResult = buildPhaseResult(
              "tags",
              "succeeded",
              [],
              Date.now() - tagStartedAt,
            );
            state.phaseResults.push(tagPhaseResult);
            await logCurrentPhase(tagPhaseResult);
            onProgress(
              `  [TAG] ${brand.slug}: ${brand.product_type} (unchanged)`,
            );
          }
        }

        const patch = state.patches;
        if (includesDiscover) {
          onProgress(
            `  [DISCOVER] ${state.discoveredUrls.length} new URLs found`,
          );
        }
        const patchKeys = Object.keys(patch);
        if (patchKeys.length > 0) {
          for (const key of patchKeys) {
            const val = (patch as Record<string, unknown>)[key];
            const display = Array.isArray(val)
              ? `[${val.length} items]`
              : typeof val === "string" && val.length > 60
                ? `${val.slice(0, 60)}…`
                : val;
            onProgress(`  [ENRICH] ${key}: ${display}`);
          }
        }

        const changedFields = changedFieldsFromPhaseResults(state.phaseResults);

        if (!hasPatchValues(patch) && !hasCompletedTagClassification) {
          if (includesDiscover && state.discoveredUrls.length <= 1) {
            weakBrandCount += 1;
            onProgress(
              `  [WEAK-BRAND] ${brand.slug}: no useful data found (${state.discoveredUrls.length} search results, no enrichment changes)`,
            );
          }
          if (!config.dryRun && descriptionsResult.attempts.length > 0) {
            await logDescriptionAiResult(
              brand.id,
              descriptionsResult.attempts,
              { type: targetType, id: brand.id },
            );
          }
          const skippedOutcome: BrandOutcome = {
            slug: brand.slug,
            name: getDisplayBrandName(brand),
            ...(target === "submissions" ? { submissionId: brand.id } : {}),
            status: "skipped",
            changedFields,
            phaseResults: state.phaseResults,
          };
          await recordOutcome(skippedOutcome);
          result.skipped += 1;
          onProgress(
            formatBrandComplete(
              brand.slug,
              brandIndex,
              totalBrands,
              Date.now() - brandStartedAt,
            ),
          );
          continue;
        }

        if (!config.dryRun) {
          if (detectResult) {
            await insertTriageResult({
              brandId: brand.id,
              target: { type: targetType, id: brand.id },
              isNonBrand: false,
              nonBrandReason: null,
              slugGenerated: detectResult.slugGenerated,
              productType: detectResult.productType,
              confidence: detectResult.confidence,
            });
          }
          if (descriptionsResult.attempts.length > 0) {
            await logDescriptionAiResult(
              brand.id,
              descriptionsResult.attempts,
              { type: targetType, id: brand.id },
            );
          }
          if (classification) {
            await insertClassificationResult({
              brandId: brand.id,
              target: { type: targetType, id: brand.id },
              productType: classification.productType,
              confidence: classification.confidence,
            });
          }
          await markCurrentPhase("persist");
          try {
            if (target === "submissions") {
              await persistSubmissionEnrichmentResults(
                supabase as unknown as SupabaseClient,
                brand.id,
                patch as JsonObject,
                config.jobId,
              );
            } else {
              await persistEnrichmentResults(
                supabase as unknown as SupabaseClient,
                [{ brandId: brand.id, patch: patch as JsonObject }],
                config.jobId,
              );
            }
          } catch (err) {
            const errMsg = errorMessage(err);
            outcomePhaseResults.push(
              buildPhaseResult("persist", "failed", [], 0, errMsg),
            );
            result.errors.push(`${brand.slug}: ${errMsg}`);
            await recordOutcome({
              slug: brand.slug,
              name: getDisplayBrandName(brand),
              ...(target === "submissions" ? { submissionId: brand.id } : {}),
              status: "failed",
              changedFields: changedFieldsFromPhaseResults(outcomePhaseResults),
              phaseResults: outcomePhaseResults,
              error: errMsg,
            });
            result.skipped += 1;
            onProgress(
              formatBrandComplete(
                brand.slug,
                brandIndex,
                totalBrands,
                Date.now() - brandStartedAt,
              ),
            );
            continue;
          }

          if (
            target === "brands" &&
            descriptionsResult.descriptionRewrite?.faq
          ) {
            await upsertBrandFaq(
              supabase as unknown as SupabaseClient,
              brand.id,
              descriptionsResult.descriptionRewrite.faq,
            );
          }
        }

        const succeededOutcome: BrandOutcome = {
          slug: brand.slug,
          name: getDisplayBrandName(brand),
          ...(target === "submissions" ? { submissionId: brand.id } : {}),
          status: "succeeded",
          changedFields,
          phaseResults: state.phaseResults,
        };
        await recordOutcome(succeededOutcome);
        result.updated += 1;
        onProgress(
          formatBrandComplete(
            brand.slug,
            brandIndex,
            totalBrands,
            Date.now() - brandStartedAt,
          ),
        );
      } catch (err) {
        const errMsg = errorMessage(err);
        if (
          !outcomePhaseResults.some(
            (phaseResult) => phaseResult.status === "failed",
          )
        ) {
          outcomePhaseResults.push(
            buildPhaseResult(currentPhase ?? "brand", "failed", [], 0, errMsg),
          );
        }
        result.errors.push(`${brand.slug}: ${errMsg}`);
        await recordOutcome({
          slug: brand.slug,
          name: getDisplayBrandName(brand),
          ...(target === "submissions" ? { submissionId: brand.id } : {}),
          status: "failed",
          changedFields: changedFieldsFromPhaseResults(outcomePhaseResults),
          phaseResults: outcomePhaseResults,
          error: errMsg,
        });
        result.skipped += 1;
        onProgress(
          formatBrandComplete(
            brand.slug,
            brandIndex,
            totalBrands,
            Date.now() - brandStartedAt,
          ),
        );
      }
    }

    await flushTargetProgress(true);

    onProgress(
      `[PROGRESS] ${result.processed}/${totalBrands} processed | ${result.updated} updated | ${result.skipped} skipped | ${result.errors.length} errors`,
    );
  }

  if (weakBrandCount > 0) {
    onProgress(
      `\n[WEAK-BRAND SUMMARY] ${weakBrandCount} brand(s) had no useful search results — review for potential non-brands`,
    );
  }

  return finishEnrichResult(result, startedAt, onProgress);
}
