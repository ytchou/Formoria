import type { SupabaseClient } from "@supabase/supabase-js";
import { cleanBrandName, type NameCleanupResult } from "./brand-cleanup";
import { ENRICH_CHUNK_SIZE, mapWithConcurrency } from "./concurrency";
import {
  CLEARED_FIELDS_KEY,
  resolveRefreshEnrichmentPatch,
} from "./brand-write-policy";
import type { BrandFlatLinkColumns } from "@/lib/types";
import type { SiteContent } from "@/lib/types/brand";
import type { ScrapedBrandData } from "@/lib/types/scraper";
import {
  ENRICH_LLM_PHASES,
  ENRICH_PHASES,
  phasesForSteps,
  type CurationStep,
} from "@/lib/constants/enrich-phases";
import { normalizeToRootUrl } from "@/lib/url";
import {
  buildLinkEnrichPatch,
  buildTextEnrichPatch,
  extractLinksFromUrls,
  hasLinkValue,
  LINK_FIELDS,
  linkColumnFor,
} from "./link-enrichment";
import {
  type ClassificationResult,
  type DetectResult,
} from "./product-type-classifier";
import type { DescriptionAttempt } from "./description-rewrite";
import { SEARCH_DELAY_MS } from "./enrich-phases/scraper/search";
import {
  insertTriageResult,
  insertClassificationResult,
  updateDescriptionAuditResult,
} from "./ai-results";
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
  runChannelsPhase,
  runStandaloneClassification,
  runDetectPhase,
  type BrandEnrichState,
  type SearchPhaseResult,
  hasPatchValues,
  isProviderFailure,
} from "./enrich-phases";
import type { BrandImageSearchOutcome } from "./enrich-phases/scraper/types";
import { buildCandidatePool } from "./enrich-phases/candidate-pool";
import type { EnrichmentTarget } from "./enrichment-target";
import {
  deriveProductTypeFromTags,
  MAX_PRODUCT_TAGS,
} from "./product-tags";
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
  product_tags?: string[] | null;
  category_attributes?: unknown | null;
  site_content?: SiteContent | null;
  reputation_summary?: unknown | null;
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

async function attachDescriptionAiResults(
  attempts: DescriptionAttempt[],
  target: EnrichmentTarget,
  jobId?: string,
): Promise<void> {
  for (const attempt of attempts) {
    await updateDescriptionAuditResult({
      target,
      ...(jobId ? { jobId } : {}),
      attempt,
    });
  }
}

const SCRAPE_DELAY_MS = 1000;
// Composite fan-out: one unit runs the whole phase chain (Serper + OpenAI +
// Postgres + sharp), so this is not the same knob as ENRICH_CHUNK_SIZE.
const ENRICH_BRAND_CONCURRENCY = 3;
// Postgres write amplification for progress rows; shares its value with
// ENRICH_CHUNK_SIZE by coincidence only.
const TARGET_PROGRESS_BATCH_SIZE = 20;
const TARGET_PROGRESS_FLUSH_INTERVAL_MS = 15_000;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

export { ENRICH_CHUNK_SIZE, mapWithConcurrency };

export { ENRICH_PHASES };

type EnrichPhase =
  "clean" | "links" | "images" | "descriptions" | "locations" | "tags";
type RunEnrichPhase =
  EnrichPhase | "discover" | "detect" | "slugs" | "expansion";

type EnrichBrand = CurationBrand &
  Partial<BrandFlatLinkColumns> & {
    hero_image_url?: string | null;
    product_images?: string[] | null;
    heroImageUrl?: string | null;
    productPhotos?: string[] | null;
    overwrite_enrichment?: boolean;
  };

/**
 * Cleans every brand name in a chunk in place, before any batch phase runs.
 *
 * The SERP and Google Images queries are built from the raw brand name, so a
 * name like `adela愛德拉 ｜守護家人，為愛研發` used to be searched verbatim
 * (DEV-1279). `cleanBrandName` is pure and synchronous, so it can run ahead of
 * the batch phases with no extra network cost.
 *
 * `getDisplayBrandName(brand)` is the key of every batch result map, so the
 * mutation MUST happen exactly once, before the first key is derived — a later
 * rename would turn every `map.get(name)` into a silent miss. The returned map
 * is keyed by target id (never by name) and carries the cleanup result through
 * to the `clean` phase, which still owns persisting the new name.
 */
export function applyChunkNameCleanup(
  chunk: EnrichBrand[],
): Map<string, NameCleanupResult> {
  const cleanups = new Map<string, NameCleanupResult>();

  for (const brand of chunk) {
    const cleanup = cleanBrandName(getDisplayBrandName(brand));
    if (!cleanup.changed) continue;
    cleanups.set(brand.id, cleanup);
    brand.name = cleanup.cleanedName;
  }

  return cleanups;
}

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
  brand_id: string | null;
  intent: string;
  base_brand_data: unknown;
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
    if (
      (key === "product_tags" || key === "product_tags_en") &&
      Array.isArray(value)
    ) {
      merged[key] = value.slice(0, MAX_PRODUCT_TAGS);
      continue;
    }

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

/** Empty for the purposes of "does this key hold a real value?". */
function isEmptyJsonValue(value: unknown): boolean {
  if (value == null) return true;
  if (typeof value === "string") return value.trim() === "";
  if (Array.isArray(value)) return value.length === 0;
  if (isPlainObject(value)) return Object.keys(value).length === 0;
  return false;
}

export function mergeSubmissionEnrichedData(
  base: JsonObject,
  patch: JsonObject,
): JsonObject {
  const merged = deepMergeJsonObjects(base, patch);
  if (Object.hasOwn(patch, "channels")) {
    // channels are object arrays; deepMergeJsonObjects unions with Set (no-op on objects).
    merged.channels = patch.channels;
  }
  if (Object.hasOwn(patch, CLEARED_FIELDS_KEY)) {
    // Replace, never union. A later run that finds real evidence has to be able
    // to un-clear the field; the array-union default would make the first clear
    // permanent.
    merged[CLEARED_FIELDS_KEY] = patch[CLEARED_FIELDS_KEY];
  }
  const clearedFields = merged[CLEARED_FIELDS_KEY];
  if (Array.isArray(clearedFields)) {
    // A field cannot be both set and cleared, and the value wins.
    const stillCleared = clearedFields.filter(
      (field) => typeof field === "string" && isEmptyJsonValue(merged[field]),
    );
    if (stillCleared.length > 0) {
      merged[CLEARED_FIELDS_KEY] = stillCleared;
    } else {
      delete merged[CLEARED_FIELDS_KEY];
    }
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

/**
 * Every Gate A message starts with this marker. It is the only thing that
 * survives the throw -> per-brand catch -> persisted target round trip, so it
 * doubles as the classifier used to count provider failures in the job summary.
 */
const PROVIDER_FAILURE_PREFIX = "Search provider unavailable";

/** True when `message` was produced by {@link describeProviderFailure}. */
export function isProviderFailureMessage(
  message: string | null | undefined,
): boolean {
  return (
    typeof message === "string" && message.startsWith(PROVIDER_FAILURE_PREFIX)
  );
}

function describeProviderFailure(
  stage: string,
  detail: { error?: string | null; httpStatus?: number | null },
): string {
  const reason =
    detail.error ??
    (typeof detail.httpStatus === "number"
      ? `Serper HTTP ${detail.httpStatus}`
      : "provider call failed");

  return `${PROVIDER_FAILURE_PREFIX} — ${stage}: ${reason}`;
}

/**
 * Gate A: the SERP stage for this brand failed at the provider, so any absence
 * of results says nothing about the brand. Returns the failure message to throw
 * with, or `null` when the stage is healthy.
 *
 * A `fromCache` search result is a replayed `brand_search_results` row whose
 * `callStatus` was copied verbatim from a past run — a failure recorded during
 * an outage that ended days ago must never fail a live run, so cached results
 * are ignored entirely.
 */
export function serpStageFailure(input: {
  searchResult?: SearchPhaseResult;
  imageOutcome?: BrandImageSearchOutcome;
}): string | null {
  const { searchResult, imageOutcome } = input;

  if (
    searchResult &&
    searchResult.fromCache !== true &&
    isProviderFailure(searchResult.callStatus)
  ) {
    return describeProviderFailure("SERP", {
      error: searchResult.error,
      httpStatus: searchResult.httpStatus,
    });
  }

  if (imageOutcome && isProviderFailure(imageOutcome.callStatus)) {
    return describeProviderFailure("image search", {
      error: imageOutcome.error,
      httpStatus: imageOutcome.httpStatus,
    });
  }

  return null;
}

export type ProviderGateDecision = {
  /** `warn` when the kill switch is off — log and continue instead of failing. */
  action: "fail" | "warn";
  message: string;
};

/**
 * Gate A with its kill switch applied. `CURATION_PROVIDER_GATE=off` downgrades a
 * hard fail to a logged warning so the gate can be disabled without a deploy;
 * unset (the default) keeps the gate active.
 */
export function evaluateProviderGate(input: {
  searchResult?: SearchPhaseResult;
  imageOutcome?: BrandImageSearchOutcome;
}): ProviderGateDecision | null {
  const message = serpStageFailure(input);
  if (!message) {
    return null;
  }

  return {
    action: process.env.CURATION_PROVIDER_GATE === "off" ? "warn" : "fail",
    message,
  };
}

/**
 * Gate B: nothing downstream can consume. URLs feed scraping and link phases,
 * images feed classification, and SERP snippets feed the description and
 * channel phases — so a brand with snippets but zero URLs still has usable LLM
 * input and must NOT be treated as empty.
 */
export function hasNoEnrichmentInputs(input: {
  knownUrls: string[];
  discoveredUrls: string[];
  urlExtracted: object;
  imageSearchUrls: string[];
  serpSnippets: string[];
}): boolean {
  return (
    uniqueUrls([...input.knownUrls, ...input.discoveredUrls]).length === 0 &&
    !hasPatchValues(input.urlExtracted) &&
    input.imageSearchUrls.length === 0 &&
    input.serpSnippets.length === 0
  );
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
    "locations",
    "expansion",
    phases.includes("tags") && "tags",
  ].filter((phase): phase is string => Boolean(phase));
}

type LinksPhaseResult = Awaited<ReturnType<typeof runLinksPhase>>;

/**
 * Per-target state carried across the two per-brand waves that the batched
 * image search now sits between.
 *
 * Wave A runs detect application -> clean -> links. The batched serper image
 * call then runs with the websites and names those phases produced. Wave B
 * resumes from this object for the images, description, location, expansion,
 * tag and persist phases.
 *
 * `completed` is the single source of truth for "this target already recorded a
 * terminal outcome in wave A". Both the batch phases between the waves and wave
 * B itself read it, so a target that skipped or failed early is never
 * re-emitted, never re-processed, and never counted twice.
 */
type BrandWaveContext = {
  brand: EnrichBrand;
  /** 1-based position across the whole job, used for progress logging. */
  brandIndex: number;
  /** Slot in `result.brandOutcomes`; assigned by index so waves stay ordered. */
  outcomeIndex: number;
  brandStartedAt: number;
  overwrite: boolean;
  state: BrandEnrichState;
  detectResult: DetectResult | undefined;
  /** Wave A's links output; wave B feeds it into the candidate image pool. */
  linksResult: LinksPhaseResult | null;
  urlExtracted: Partial<BrandFlatLinkColumns>;
  currentPhase: string | undefined;
  completed: boolean;
};

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
    providerFailed: result.brandOutcomes.filter(
      (outcome) =>
        outcome.status === "failed" &&
        (isProviderFailureMessage(outcome.error) ||
          (outcome.phaseResults?.some(
            (phaseResult) => phaseResult.providerFailure === true,
          ) ??
            false)),
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
    .select("enriched_data, status, intent, brand_id, base_brand_data")
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

  let persistablePatch = patch as Record<string, unknown>;
  if (row.intent === "refresh") {
    if (!row.brand_id || !isPlainObject(row.base_brand_data)) {
      throw new Error("Refresh submission is missing its brand snapshot");
    }
    const { data: fieldStates, error: fieldStateError } = await supabase
      .from("brand_field_state")
      .select("field, source, admin_locked")
      .eq("brand_id", row.brand_id);
    if (fieldStateError) throw fieldStateError;

    const fieldState = Object.fromEntries(
      (fieldStates ?? []).map((state) => [
        state.field,
        { source: state.source, adminLocked: state.admin_locked },
      ]),
    );
    const filtered = resolveRefreshEnrichmentPatch(
      persistablePatch,
      row.base_brand_data,
      fieldState,
    );
    persistablePatch = filtered.allowed;
    if (filtered.skipped.length > 0) {
      console.info("[refresh-enrichment:protected-fields]", {
        submissionId,
        brandId: row.brand_id,
        skipped: filtered.skipped,
      });
    }
  }

  const existing = (row.enriched_data ?? {}) as Record<string, unknown>;
  const merged = mergeSubmissionEnrichedData(existing, persistablePatch);
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
    if (error)
      throw new Error(
        error.message ?? "Failed to persist submission enrichment",
      );
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

export function submissionToEnrichBrand(
  submission: SubmissionEnrichmentRow,
  options?: { overwrite?: boolean },
): EnrichBrand {
  const existingEnriched = isPlainObject(submission.enriched_data)
    ? submission.enriched_data
    : {};
  const isRefresh = submission.intent === "refresh";
  const existing =
    isRefresh && isPlainObject(submission.base_brand_data)
      ? deepMergeJsonObjects(submission.base_brand_data, existingEnriched)
      : seedEnrichedDataFromOwnerData(submission.owner_data, existingEnriched);
  if (isRefresh && Object.hasOwn(existingEnriched, "channels")) {
    // channels are object arrays; deepMergeJsonObjects unions with Set (no-op on objects).
    // Overridden per-site until deepMergeJsonObjects handles object-array fields.
    existing.channels = existingEnriched.channels;
  }

  return {
    ...existing,
    id: submission.id,
    // A refresh always overwrites; an explicit job-level `overwrite` lets an
    // admin force a re-run to re-touch already-populated rows (e.g. re-running
    // image classification on submissions whose tags are already set).
    overwrite_enrichment: isRefresh || options?.overwrite === true,
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
        : normalizeToRootUrl(submission.purchase_website),
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
  void brandIdOrPatches;
  void patchOrJobId;
  throw new Error(
    "Direct brand enrichment is retired; create a refresh submission instead",
  );
}

export async function runEnrich(
  config: CurationConfig & {
    phases: string[];
    /**
     * Operator-facing selection. When present it wins over `phases`: the three
     * steps expand into the full phase list, so everything downstream keeps
     * working on phase names. Absent means the caller passed phases directly
     * and nothing about its behaviour changes.
     */
    steps?: readonly CurationStep[];
  },
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

  const phases = (
    config.steps?.length ? phasesForSteps(config.steps) : config.phases
  ) as RunEnrichPhase[];
  const target =
    config.target ?? (config.slugs?.length ? "brands" : "submissions");
  if (target === "brands") {
    throw new Error(
      "Brand-target enrichment is retired; create a refresh submission instead",
    );
  }
  const enrichDelayMs = phases.includes("discover")
    ? SEARCH_DELAY_MS
    : SCRAPE_DELAY_MS;
  const includesDiscover = phases.includes("discover");
  let weakBrandCount = 0;
  let allBrands: EnrichBrand[] = [];

  let query = supabase
    .from("brand_submissions")
    .select("*")
    .eq("status", "pending");

  if (config.submissionIds?.length) {
    query = query.in("id", config.submissionIds);
  } else {
    query = query.is("brand_id", null);
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
    (submission) =>
      submissionToEnrichBrand(submission, {
        overwrite: config.overwrite === true,
      }),
  );

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
    // No "tags" here: the category moved to the descriptions phase, so a tags
    // run no longer implies a detect call. Mirrors `hasDetectPhases` in
    // `enrich-phases/detect.ts` — the two must agree or this banner announces a
    // detect step that never runs.
    const hasDetectPhases = phases.includes("detect") || phases.includes("slugs");
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
      phases.includes("locations") && "locations",
    ].filter(Boolean);
    onProgress(
      `\n[BATCH ${chunkIndex + 1}/${brandChunks.length}] ${chunk.length} brands — fetching ${activeSteps.join(" + ")}...`,
    );

    // Must stay directly above the first `getDisplayBrandName` call: the batch
    // queries below are built from these names, and every batch result map is
    // keyed by them.
    const nameCleanups = applyChunkNameCleanup(chunk);
    if (nameCleanups.size > 0) {
      onProgress(
        `  [CLEAN] Normalized ${nameCleanups.size} brand name(s) before search`,
      );
    }

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
    let targetProgressBatchWrite = Promise.resolve();
    const serializeTargetProgressBatch = <T>(
      write: () => Promise<T>,
    ): Promise<T> => {
      const nextWrite = targetProgressBatchWrite.then(write, write);
      targetProgressBatchWrite = nextWrite.then(
        () => undefined,
        () => undefined,
      );
      return nextWrite;
    };
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

      await serializeTargetProgressBatch(async () => {
        await flushTargetProgress(true);
        await onTargetProgressBatch(mergeTargetProgressEvents(events));
        lastTargetProgressFlushAt = Date.now();
      });
    };
    const queueTargetProgress = async (
      event: CurationTargetProgressEvent,
    ): Promise<void> => {
      if (!onTargetProgressBatch) {
        await onTargetProgress?.(event);
        return;
      }

      await serializeTargetProgressBatch(async () => {
        pendingTargetProgress.push(event);
        await flushTargetProgress(false);
      });
    };
    // Populated by wave A, read by the batched image search that runs between
    // the waves, and resumed by wave B. Keyed by target id — see the
    // `BrandWaveContext` doc comment for why a name key would be unsafe here.
    const brandContexts = new Map<string, BrandWaveContext>();
    const isBrandCompleted = (brandId: string): boolean =>
      brandContexts.get(brandId)?.completed === true;
    const batchPhaseResults = new Map<string, PhaseResult[]>();
    const emitBatchPhaseProgress = async (phase: string): Promise<void> => {
      await emitTargetProgressBatch(
        // A batch phase can now run after wave A has already recorded terminal
        // outcomes for some targets; re-emitting "running" for those would flip
        // a finished row back to in-progress in the UI.
        chunk
          .filter((brand) => !isBrandCompleted(brand.id))
          .map((brand) => ({
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
        if (isBrandCompleted(brand.id)) continue;
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
        // A brand context snapshots `batchPhaseResults` when it is created, so a
        // batch phase running after wave A (image search) has to be appended to
        // the live per-brand state as well or it never reaches the outcome.
        brandContexts.get(brand.id)?.state.phaseResults.push(targetPhaseResult);
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

    // An enrichment-only run (no `discover`) still needs SERP context, so replay
    // the stored results for any run that includes at least one LLM phase.
    // Replayed rows are marked `fromCache` so a historical provider failure is
    // never mistaken for a live one.
    const requestedPhases = new Set<string>(phases);
    const needsCachedSerp =
      !requestedPhases.has("discover") &&
      ENRICH_LLM_PHASES.some((phase) => requestedPhases.has(phase));

    if (needsCachedSerp) {
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

    // Detect (and the standalone classification that shares its batch slot) now
    // runs BEFORE the image search. Image search is a paid serper call per
    // brand, and detect is what rejects non-brands — running detect first stops
    // credits being spent on entries the very next step throws away.
    if (hasDetectPhases) await emitBatchPhaseProgress("detect");
    const detectPhaseResult = await runDetectPhase(batchContext, searchResults);
    const detectResults = detectPhaseResult.detectResults;
    const standaloneClassificationResult =
      await runStandaloneClassification(batchContext);
    const batchClassifications =
      standaloneClassificationResult.batchClassifications;

    const chunkStartIndex = chunkIndex * ENRICH_CHUNK_SIZE;
    // Identical for every brand in the chunk, so it is built once rather than
    // per target inside each wave.
    const phaseOrder = buildBrandPhaseOrder(phases, hasDetectPhases);
    const totalPhases = phaseOrder.length;

    const emitTargetProgress = async (
      ctx: BrandWaveContext,
      status: "running" | BrandOutcome["status"],
      options?: {
        phaseResults?: PhaseResult[];
        changedFields?: string[];
        error?: string;
        durationMs?: number;
      },
    ): Promise<void> => {
      const event: CurationTargetProgressEvent = {
        targetId: ctx.brand.id,
        targetType,
        slug: ctx.brand.slug,
        name: getDisplayBrandName(ctx.brand),
        status,
        currentPhase: ctx.currentPhase,
        ...options,
      };
      await queueTargetProgress(event);
    };
    const markCurrentPhase = async (
      ctx: BrandWaveContext,
      phase: string,
    ): Promise<void> => {
      ctx.currentPhase = phase;
      await emitTargetProgress(ctx, "running");
    };
    const logCurrentPhase = async (
      ctx: BrandWaveContext,
      phaseResult: PhaseResult,
    ): Promise<void> => {
      ctx.currentPhase = phaseResult.phase;
      const rawIndex = phaseOrder.indexOf(phaseResult.phase);
      const phaseIndex = rawIndex >= 0 ? rawIndex + 1 : totalPhases;
      logPhaseResult(
        onProgress,
        ctx.brand,
        ctx.brandIndex,
        totalBrands,
        phaseResult,
        phaseIndex,
        totalPhases,
      );
      await emitTargetProgress(ctx, "running", {
        phaseResults: ctx.state.phaseResults,
      });
    };
    /**
     * Terminal for this target. Marking `completed` here — in the one place
     * every skip, failure and success funnels through — is what guarantees a
     * brand that exited during wave A is neither re-emitted by the batch phases
     * that follow nor picked up (and re-counted) by wave B.
     */
    const recordOutcome = async (
      ctx: BrandWaveContext,
      outcome: BrandOutcome,
    ): Promise<void> => {
      ctx.completed = true;
      result.brandOutcomes[ctx.outcomeIndex] = outcome;
      await emitTargetProgressBatch([
        {
          targetId: ctx.brand.id,
          targetType,
          slug: ctx.brand.slug,
          name: getDisplayBrandName(ctx.brand),
          status: outcome.status,
          currentPhase: ctx.currentPhase,
          phaseResults: outcome.phaseResults,
          changedFields: outcome.changedFields,
          error: outcome.error,
          durationMs: Date.now() - ctx.brandStartedAt,
        },
      ]);
    };
    const finishBrand = (ctx: BrandWaveContext): void => {
      onProgress(
        formatBrandComplete(
          ctx.brand.slug,
          ctx.brandIndex,
          totalBrands,
          Date.now() - ctx.brandStartedAt,
        ),
      );
    };
    /** Shared catch body for both waves — a Gate A throw lands here. */
    const failBrand = async (
      ctx: BrandWaveContext,
      err: unknown,
    ): Promise<void> => {
      const errMsg = errorMessage(err);
      const outcomePhaseResults = ctx.state.phaseResults;
      // Tag the recorded phase result so the job summary can tell "the provider
      // was down" apart from "this brand legitimately had no data" — the two
      // must not page the same way.
      const providerFailure = isProviderFailureMessage(errMsg);
      if (
        !outcomePhaseResults.some(
          (phaseResult) => phaseResult.status === "failed",
        )
      ) {
        outcomePhaseResults.push({
          ...buildPhaseResult(
            ctx.currentPhase ?? "brand",
            "failed",
            [],
            0,
            errMsg,
          ),
          ...(providerFailure ? { providerFailure: true } : {}),
        });
      } else if (providerFailure) {
        const failedIndex = outcomePhaseResults.findIndex(
          (phaseResult) => phaseResult.status === "failed",
        );
        const failedPhase = outcomePhaseResults[failedIndex];
        if (failedPhase) {
          outcomePhaseResults[failedIndex] = {
            ...failedPhase,
            providerFailure: true,
          };
        }
      }
      result.errors.push(`${ctx.brand.slug}: ${errMsg}`);
      await recordOutcome(ctx, {
        slug: ctx.brand.slug,
        name: getDisplayBrandName(ctx.brand),
        ...(target === "submissions" ? { submissionId: ctx.brand.id } : {}),
        status: "failed",
        changedFields: changedFieldsFromPhaseResults(outcomePhaseResults),
        phaseResults: outcomePhaseResults,
        error: errMsg,
      });
      result.skipped += 1;
      finishBrand(ctx);
    };

    // ---- Wave A: detect application -> clean -> links -------------------
    // Everything the image query needs (the brand's own domain, the corrected
    // name) is produced here, so it has to complete before the batched serper
    // call below.
    await mapWithConcurrency(
      chunk,
      ENRICH_BRAND_CONCURRENCY,
      async (brand, brandOffset) => {
        result.processed += 1;
        const brandIndex = chunkStartIndex + brandOffset + 1;
        const ctx: BrandWaveContext = {
          brand,
          brandIndex,
          outcomeIndex: brandIndex - 1,
          brandStartedAt: Date.now(),
          overwrite: brand.overwrite_enrichment === true,
          state: {
            patches: {},
            phaseResults: [...(batchPhaseResults.get(brand.id) ?? [])],
            knownUrls: collectKnownUrls(brand),
            discoveredUrls: [],
            serpSnippets: [],
            serpEntries: [],
            scrapedData: {},
          },
          detectResult: detectResults.get(brand.slug),
          linksResult: null,
          urlExtracted: {},
          currentPhase: undefined,
          completed: false,
        };
        brandContexts.set(brand.id, ctx);
        const state = ctx.state;

        await emitTargetProgress(ctx, "running");

        try {
          const detectApplication = applyDetectResult(
            ctx.detectResult,
            brand,
            phases,
          );
          if (hasDetectPhases) {
            await markCurrentPhase(ctx, "detect");
            state.phaseResults.push(detectApplication.phaseResult);
            await logCurrentPhase(ctx, detectApplication.phaseResult);
          }
          appendPatch(state, detectApplication.patch);

          if (detectApplication.isNonBrand) {
            const detectResult = ctx.detectResult;
            const skipReason = detectResult?.nonBrandReason
              ? `Detection classified this entry as not a brand: ${detectResult.nonBrandReason}`
              : "Detection classified this entry as not a brand";
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
            }

            await recordOutcome(ctx, {
              slug: brand.slug,
              name: getDisplayBrandName(brand),
              ...(target === "submissions" ? { submissionId: brand.id } : {}),
              status: "skipped",
              changedFields: changedFieldsFromPhaseResults(state.phaseResults),
              phaseResults: state.phaseResults,
              error: skipReason,
            });
            result.skipped += 1;
            finishBrand(ctx);
            return;
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
            state.serpEntries = searchResult.entries ?? [];
          } else if (searchResults.size > 0) {
            const searchResult = searchResults.get(
              getDisplayBrandName(brand),
            ) ?? { urls: [], snippets: [] };
            state.serpSnippets = searchResult.snippets;
            state.serpEntries = searchResult.entries ?? [];
          }

          // Same SERP-derived path the links phase gates: without the brand
          // name these are just "first URL matching a platform shape", which is
          // how One Wood acquired facebook.com/threebrothersboards.
          ctx.urlExtracted = extractLinksFromUrls(
            state.discoveredUrls,
            getDisplayBrandName(brand),
          );

          await markCurrentPhase(ctx, "clean");
          const cleanResult = await runCleanPhase(
            brand,
            phases,
            nameCleanups.get(brand.id),
          );
          state.phaseResults.push(cleanResult.phaseResult);
          await logCurrentPhase(ctx, cleanResult.phaseResult);
          appendPatch(state, cleanResult.patch);

          await markCurrentPhase(ctx, "links");
          const linksResult = await runLinksPhase({
            brand,
            phases,
            discoveredUrls: state.discoveredUrls,
            knownUrls: state.knownUrls,
            dryRun: config.dryRun,
            target: { type: targetType, id: brand.id },
            jobId: config.jobId,
            supabase: batchContext.supabase,
          });
          ctx.linksResult = linksResult;
          state.phaseResults.push(linksResult.phaseResult);
          await logCurrentPhase(ctx, linksResult.phaseResult);
          state.scrapedData = linksResult.scrapedData ?? {};
          appendPatch(state, linksResult.patch);
        } catch (err) {
          await failBrand(ctx, err);
        }
      },
    );

    // ---- Batched image search (between the waves) -----------------------
    // Still exactly ONE batched serper call for the whole chunk — it is not
    // inside either per-brand loop. What changed is where it sits: after detect
    // has rejected non-brands and after links has found each brand's own
    // domain, so no credit is spent on a rejected entry and the `site:` query
    // can fire on a target's very first enrichment run.
    const pendingBrands = chunk.filter((brand) => !isBrandCompleted(brand.id));
    // `BrandEnrichState["patches"]` deliberately, not the local `EnrichPatch`:
    // this is the phase-layer patch shape the image search reads.
    const pendingPatches = new Map<string, BrandEnrichState["patches"]>();
    for (const brand of pendingBrands) {
      const ctx = brandContexts.get(brand.id);
      if (ctx) pendingPatches.set(brand.id, ctx.state.patches);
    }
    if (phases.includes("images")) await emitBatchPhaseProgress("image-search");
    const imageSearchResult = await runImageSearchPhase(
      {
        ...batchContext,
        chunk: pendingBrands,
        chunkBrandNames: pendingBrands.map(getDisplayBrandName),
      },
      searchResults,
      pendingPatches,
    );
    // Both maps are keyed by target id, not by display name — `clean`/`detect`
    // can rewrite a name and this phase now runs after them.
    const imageSearchResults = imageSearchResult.imageSearchResults;
    // Per-brand provider call outcomes; Gate A consumes these to hard-fail a
    // target whose image search never actually reached the provider.
    const imageSearchOutcomes = imageSearchResult.imageSearchOutcomes;
    if (phases.includes("images")) {
      await recordBatchPhase(
        imageSearchResult.phaseResult,
        "image_search_results",
        (brand) => (imageSearchResults.get(brand.id)?.length ?? 0) > 0,
      );
    }

    // ---- Wave B: images -> descriptions -> locations -> ... -> persist ---
    await mapWithConcurrency(
      pendingBrands,
      ENRICH_BRAND_CONCURRENCY,
      async (brand) => {
        const ctx = brandContexts.get(brand.id);
        // A brand with no context never entered wave A, and one already marked
        // completed recorded its outcome there — neither may be processed (or
        // counted) again here.
        if (!ctx || ctx.completed) return;
        const state = ctx.state;
        const overwrite = ctx.overwrite;

        try {
          let imageSearchUrls: string[] = [];
          if (phases.includes("images")) {
            imageSearchUrls = imageSearchResults.get(brand.id) ?? [];
            onProgress(
              `  [IMAGE-SEARCH] ${imageSearchUrls.length} images found`,
            );
          }

          // Gate A — the pipeline is one-way SERP -> ENRICHMENT: a provider
          // failure means there is no input, so hard-fail the target instead of
          // burning LLM tokens on nothing. The per-brand catch below turns this
          // throw into a recorded FAILED target carrying the provider message.
          const providerGate = evaluateProviderGate({
            searchResult: searchResults.get(getDisplayBrandName(brand)),
            imageOutcome: imageSearchOutcomes.get(brand.id),
          });
          if (providerGate) {
            if (providerGate.action === "warn") {
              // Kill switch (CURATION_PROVIDER_GATE=off) is engaged.
              onProgress(
                `  [PROVIDER-GATE OFF] ${brand.slug}: ${providerGate.message}`,
              );
            } else {
              throw new Error(providerGate.message);
            }
          }

          // Gate B — nothing downstream can consume, so skip before any LLM
          // phase runs. Snippets count as usable input (descriptions and
          // channels read them), so this only fires when every input is empty.
          //
          // It sits in wave B rather than wave A because `imageSearchUrls` is
          // one of its inputs and only exists once the batched search above has
          // run. Clean and links having already run costs nothing: a target
          // that trips this gate has no URLs at all, so the links phase had an
          // empty URL set and issued no fetches.
          if (
            hasNoEnrichmentInputs({
              knownUrls: state.knownUrls,
              discoveredUrls: state.discoveredUrls,
              urlExtracted: ctx.urlExtracted,
              imageSearchUrls,
              serpSnippets: state.serpSnippets,
            })
          ) {
            if (includesDiscover && state.discoveredUrls.length <= 1) {
              weakBrandCount += 1;
              onProgress(
                `  [WEAK-BRAND] ${brand.slug}: no useful data found (${state.discoveredUrls.length} search results, nothing to scrape)`,
              );
            }
            await recordOutcome(ctx, {
              slug: brand.slug,
              name: getDisplayBrandName(brand),
              ...(target === "submissions" ? { submissionId: brand.id } : {}),
              status: "skipped",
              changedFields: changedFieldsFromPhaseResults(state.phaseResults),
              phaseResults: state.phaseResults,
              error:
                "No usable enrichment inputs: no known or discovered URLs, no extractable links, no image results, and no search snippets",
            });
            result.skipped += 1;
            finishBrand(ctx);
            return;
          }

          const linksResult = ctx.linksResult;
          const candidateImages = buildCandidatePool({
            // Prefer the provenance-carrying list; fall back to bare URLs so a
            // scraper result predating `imageSources` still contributes.
            scraped:
              linksResult && linksResult.scrapedImageSources.length > 0
                ? linksResult.scrapedImageSources.map((image) => ({
                    url: image.url,
                    method: image.method,
                    pageUrl: image.pageUrl,
                    position: image.position,
                  }))
                : (linksResult?.scrapedImageUrls ?? []),
            jsonLdImages: linksResult?.jsonLdImageUrls ?? [],
            googleImages: (imageSearchOutcomes.get(brand.id)?.rows ?? imageSearchUrls).map((row) =>
              typeof row === 'string'
                ? row
                : {
                    url: row.url,
                    sourceUrl: row.sourceUrl ?? row.url,
                    pageUrl: row.pageUrl,
                    previewUrl: row.previewUrl,
                    title: row.title,
                    providerSource: row.source,
                    domain: row.domain,
                    position: row.position,
                    query: row.query,
                    auditResultId: row.auditResultId,
                    imageWidth: row.imageWidth,
                    imageHeight: row.imageHeight,
                    thumbnailWidth: row.thumbnailWidth,
                    thumbnailHeight: row.thumbnailHeight,
                  }
            ),
          });
          await markCurrentPhase(ctx, "images");
          const brandImageResult = await runBrandImagePhase({
            brand,
            phases,
            imageSearchUrls,
            candidateImages,
            dryRun: config.dryRun,
            target: { type: targetType, id: brand.id },
          });
          state.phaseResults.push(brandImageResult.phaseResult);
          await logCurrentPhase(ctx, brandImageResult.phaseResult);
          appendPatch(state, brandImageResult.patch);

          await markCurrentPhase(ctx, "classify-images");
          const classifyImagesResult = await runClassifyImagesPhase({
            brand,
            phases,
            dryRun: config.dryRun,
            overwrite,
            target: { type: targetType, id: brand.id },
            jobId: config.jobId,
          });
          state.phaseResults.push(classifyImagesResult.phaseResult);
          await logCurrentPhase(ctx, classifyImagesResult.phaseResult);
          appendPatch(state, classifyImagesResult.patch);

          await markCurrentPhase(ctx, "descriptions");
          const descriptionsResult = await runDescriptionsPhase({
            brand,
            phases,
            serpSnippets: state.serpSnippets,
            overwrite,
            dryRun: config.dryRun,
            target: { type: targetType, id: brand.id },
            jobId: config.jobId,
            pendingPatch: state.patches,
          });
          // The descriptions phase now assigns the category explicitly, from
          // site content and image alt text. That value wins: the tag-vote
          // derivation below is a fallback for when the model returned null.
          const effectiveProductType =
            typeof descriptionsResult.patch.product_type === "string"
              ? descriptionsResult.patch.product_type
              : typeof state.patches.product_type === "string"
                ? state.patches.product_type
                : brand.product_type;
          const effectiveProductTags = Array.isArray(
            descriptionsResult.patch.product_tags,
          )
            ? descriptionsResult.patch.product_tags.filter(
                (tag): tag is string => typeof tag === "string",
              )
            : (brand.product_tags ?? []);
          if (
            descriptionsResult.phaseResult.status === "succeeded" &&
            !effectiveProductType
          ) {
            const derivedProductType =
              deriveProductTypeFromTags(effectiveProductTags);
            if (derivedProductType) {
              descriptionsResult.patch.product_type = derivedProductType;
              descriptionsResult.phaseResult.changedFields = [
                ...new Set([
                  ...descriptionsResult.phaseResult.changedFields,
                  "product_type",
                ]),
              ];
              onProgress(
                `  [CATEGORY] ${brand.slug}: derived ${derivedProductType} from product tags`,
              );
            }
          }
          // Stage-2 listing gate. Absent or `list` verdicts are a no-op, so a model
          // that never emitted the field behaves exactly as before.
          const listingVerdict =
            descriptionsResult.descriptionRewrite?.listing ?? null;
          const listingReason =
            listingVerdict?.reason ??
            "Listing check rejected this brand (no reason given)";
          if (listingVerdict?.verdict === "reject") {
            onProgress(
              `  [NOT-LISTABLE] ${brand.slug}: ${listingReason} (taiwan_connection=${listingVerdict.taiwanConnection ?? "unknown"}, own_products=${listingVerdict.hasOwnProducts ?? "unknown"}, purchase_channel=${listingVerdict.hasPurchaseChannel ?? "unknown"})`,
            );
            // Annotated before the phase is logged so the emitted progress event and
            // the recorded outcome carry the same detail string.
            descriptionsResult.phaseResult.detail = [
              descriptionsResult.phaseResult.detail,
              `listing verdict: reject — ${listingReason}`,
            ]
              .filter(Boolean)
              .join("; ");
          }

          state.phaseResults.push(descriptionsResult.phaseResult);
          await logCurrentPhase(ctx, descriptionsResult.phaseResult);
          appendPatch(state, descriptionsResult.patch);

          if (listingVerdict?.verdict === "reject") {
            if (target === "submissions") {
              // A submission is not yet published, so this is a real gate: mirror the
              // detect non-brand path exactly — triage row, then a skipped outcome.
              if (!config.dryRun) {
                await insertTriageResult({
                  brandId: brand.id,
                  target: { type: targetType, id: brand.id },
                  isNonBrand: true,
                  nonBrandReason: `listing_reject: ${listingReason}`,
                  slugGenerated: null,
                  productType: effectiveProductType ?? null,
                  confidence: "medium",
                });
              }

              await recordOutcome(ctx, {
                slug: brand.slug,
                name: getDisplayBrandName(brand),
                submissionId: brand.id,
                status: "skipped",
                changedFields: changedFieldsFromPhaseResults(state.phaseResults),
                phaseResults: state.phaseResults,
                error: `Listing check rejected this submission: ${listingReason}`,
              });
              result.skipped += 1;
              finishBrand(ctx);
              return;
            }
            // An approved brand is already public: record only — the onProgress log
            // and the phase detail above are the whole action. Nothing is
            // unpublished or hidden, brands.status is untouched, and the run
            // continues to the remaining phases. insertTriageResult is deliberately
            // NOT called here: its row shape is the detect-phase triage schema, and
            // widening it would be a schema change.
          }

          const reputationAlreadySet =
            descriptionsResult.patch.reputation_summary != null;

          await markCurrentPhase(ctx, "locations");
          const channelsResult = await runChannelsPhase({
            brand,
            phases,
            descriptionRewrite: descriptionsResult.descriptionRewrite,
            serpResult: searchResults.get(getDisplayBrandName(brand)) ?? null,
            scrapedData: state.scrapedData,
            overwrite,
            dryRun: config.dryRun,
            target: { type: targetType, id: brand.id },
            jobId: config.jobId,
            supabase: batchContext.supabase,
          });
          state.phaseResults.push(channelsResult.phaseResult);
          await logCurrentPhase(ctx, channelsResult.phaseResult);
          appendPatch(state, channelsResult.patch);

          await markCurrentPhase(ctx, "expansion");
          const expansionResult = await runExpansionPhase({
            brand,
            phases,
            serpSnippets: state.serpSnippets,
            scrapedData: state.scrapedData,
            overwrite,
            reputationAlreadySet,
            target: { type: targetType, id: brand.id },
            jobId: config.jobId,
          });
          state.phaseResults.push(expansionResult.phaseResult);
          await logCurrentPhase(ctx, expansionResult.phaseResult);
          appendPatch(state, expansionResult.patch);

          let classification: ClassificationResult | null = null;
          let hasCompletedTagClassification = false;
          if (
            !(
              phases.includes("descriptions") && state.serpSnippets.length > 0
            ) &&
            phases.includes("tags")
          ) {
            classification = batchClassifications.get(brand.slug) ?? null;
          }

          if (classification) {
            await markCurrentPhase(ctx, "tags");
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
              await logCurrentPhase(ctx, tagPhaseResult);
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
              await logCurrentPhase(ctx, tagPhaseResult);
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

          const changedFields = changedFieldsFromPhaseResults(
            state.phaseResults,
          );

          if (!hasPatchValues(patch) && !hasCompletedTagClassification) {
            if (includesDiscover && state.discoveredUrls.length <= 1) {
              weakBrandCount += 1;
              onProgress(
                `  [WEAK-BRAND] ${brand.slug}: no useful data found (${state.discoveredUrls.length} search results, no enrichment changes)`,
              );
            }
            if (!config.dryRun && descriptionsResult.attempts.length > 0) {
              await attachDescriptionAiResults(
                descriptionsResult.attempts,
                { type: targetType, id: brand.id },
                config.jobId,
              );
            }
            const skippedOutcome: BrandOutcome = {
              slug: brand.slug,
              name: getDisplayBrandName(brand),
              ...(target === "submissions" ? { submissionId: brand.id } : {}),
              status: "skipped",
              changedFields,
              phaseResults: state.phaseResults,
              error:
                "All requested phases completed, but no new enrichment fields were found",
            };
            await recordOutcome(ctx, skippedOutcome);
            result.skipped += 1;
            finishBrand(ctx);
            return;
          }

          if (!config.dryRun) {
            const detectResult = ctx.detectResult;
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
              await attachDescriptionAiResults(
                descriptionsResult.attempts,
                { type: targetType, id: brand.id },
                config.jobId,
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
            await markCurrentPhase(ctx, "persist");
            try {
              await persistSubmissionEnrichmentResults(
                supabase as unknown as SupabaseClient,
                brand.id,
                patch as JsonObject,
                config.jobId,
              );
            } catch (err) {
              const errMsg = errorMessage(err);
              state.phaseResults.push(
                buildPhaseResult("persist", "failed", [], 0, errMsg),
              );
              result.errors.push(`${brand.slug}: ${errMsg}`);
              await recordOutcome(ctx, {
                slug: brand.slug,
                name: getDisplayBrandName(brand),
                ...(target === "submissions" ? { submissionId: brand.id } : {}),
                status: "failed",
                changedFields: changedFieldsFromPhaseResults(
                  state.phaseResults,
                ),
                phaseResults: state.phaseResults,
                error: errMsg,
              });
              result.skipped += 1;
              finishBrand(ctx);
              return;
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
          await recordOutcome(ctx, succeededOutcome);
          result.updated += 1;
          finishBrand(ctx);
        } catch (err) {
          await failBrand(ctx, err);
        }
      },
    );

    await serializeTargetProgressBatch(() => flushTargetProgress(true));

    onProgress(
      `[PROGRESS] ${result.processed}/${totalBrands} processed | ${result.updated} updated | ${result.skipped} skipped | ${result.errors.length} errors`,
    );
  }

  if (weakBrandCount > 0) {
    onProgress(
      `\n[WEAK-BRAND SUMMARY] ${weakBrandCount} brand(s) had no usable enrichment inputs — review for potential non-brands`,
    );
  }

  return finishEnrichResult(result, startedAt, onProgress);
}
