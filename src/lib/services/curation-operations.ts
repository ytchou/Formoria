import type { SupabaseClient } from "@supabase/supabase-js";
import { auditedCall, getAuditContext, runWithAuditContext } from "@/lib/audit";
import { getLangfuse } from "@/lib/langfuse/client";
import { cleanBrandName, type NameCleanupResult } from "./brand-cleanup";
import { ENRICH_CHUNK_SIZE, mapWithConcurrency } from "./_shared/concurrency";
import {
  CLEARED_FIELDS_KEY,
  mergeBrandFieldStates,
  resolveRefreshEnrichmentPatch,
} from "./brand-write-policy";
import type { BrandFlatLinkColumns } from "@/lib/types";
import {
  ENRICH_LLM_PHASES,
  ENRICH_PHASES,
  isDeferredPhase,
  type CurationTask,
  type EnrichPhaseName,
} from "@/lib/constants/enrich-phases";
import { resolveProfileModel } from "@/lib/constants/llm-models";
import { normalizeToRootUrl } from "@/lib/url";
import {
  ONLINE_STORES,
  type OnlineStoreColumn,
} from "@/lib/brands/online-stores";
import {
  buildLinkEnrichPatch,
  classifySubmittedUrl,
  extractLinksFromUrls,
  hasLinkValue,
  LINK_FIELDS,
  linkColumnFor,
  type LinkField,
} from "./link-enrichment";
import {
  collectHubUrls,
  computeEvidence,
  deriveThreadsUrl,
  expandLinkHubs,
  expandThreadsBio,
  hasPurchaseChannel,
  type AdoptedLink,
  type ChannelSources,
} from "./enrich-phases/link-expansion";
import {
  fetchHtml,
  fetchHtmlWithMetadata,
} from "./enrich-phases/scraper/fetch-guards";
import {
  batchSearchBrandsWithSnippets,
  parseBrandSearchEntries,
} from "./enrich-phases/scraper/serper";
import {
  filterEntriesByHandle,
  HANDLE_QUERY,
  isUsableHandle,
  normalizeHandle,
} from "./enrich-phases/scraper/search";
import { isLinkAggregatorHost } from "./enrich-phases/scraper/input-detector";
import type { BrandSearchEntry } from "./enrich-phases/scraper/types";
import { extractInstagramHandle } from "./enrich-phases/scraper/parse/extractors";
import {
  getLatestSearchResults,
  isFreshSearchResult,
  type SearchResultRow,
} from "./search-results";
import {
  type ClassificationResult,
  type DetectResult,
} from "./category-classifier";
import type { DescriptionAttempt } from "./description-rewrite";
import type { BrandFactsAttempt } from "./brand-facts";
import {
  insertTriageResult,
  insertClassificationResult,
  updateDescriptionAuditResult,
  updateFactsAuditResult,
} from "./_shared/ai-results";
import type {
  BrandOutcome,
  CurationConfig,
  CurationTargetProgressEvent,
  OperationResult,
  PhaseResult,
  SourceOutcome,
} from "@/lib/types/curation";
import {
  applyDetectResult,
  applyNamesResult,
  runNamesPhase,
  type NameCandidateInput,
  buildPhaseResult,
  getDisplayBrandName,
  loadCachedSearchResults,
  runDescriptionsPhase,
  runFaqPhase,
  runProductsPhase,
  runStockistsPhase,
  STORAGE_FAILURE_PREFIX,
  runAcquirePhase,
  runStandaloneClassification,
  runDetectPhase,
  type BrandEnrichState,
  type SearchPhaseResult,
  hasPatchValues,
  getActiveImages,
  classifiedImageFromRow,
} from "./enrich-phases";
import type { NameCandidate } from "./name-arbiter";
import { isBrandNameProposal } from "@/lib/types/enriched-data";
import { probeStatic, type ProbeEvidence } from "./enrich-phases/gather";
import type { RankableImage } from "./enrich-phases/image-ranking";
import type { EnrichmentTarget } from "./_shared/enrichment-target";
import type { RenderProvider } from "./enrich-phases/scraper/render/types";
import { deriveCategoryFromSubcategories } from "./subcategories";
import {
  runEditorialAgent,
  type EditorialInput,
} from "./enrich-phases/editorial/graph";
import { buildEditorialDeps } from "./enrich-phases/editorial/validators";
import type {
  EnrichBrand as EditorialEnrichBrand,
  EnrichPatch as EditorialEnrichPatch,
  EnrichPhase as EditorialEnrichPhase,
} from "./enrich-phases/types";
import {
  fetchPhaseHistory,
  filterSatisfiedPhases,
} from "./enrich-phases/phase-satisfaction";
import { MAX_PROBE_URLS } from "./category-classifier";
import {
  formatBrandComplete,
  formatEnrichError,
  formatEnrichPatchField,
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
  source_brand_id?: string | null;
  slug: string;
  name?: string;
  status?: string | null;
  description?: string | null;
  description_en?: string | null;
  city?: string | null;
  category?: string | null;
  subcategories?: string[] | null;
  site_content?: unknown | null;
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

/** Same denormalisation pass as the copy call, against the `facts` audit rows. */
async function attachFactsAiResults(
  attempts: BrandFactsAttempt[],
  target: EnrichmentTarget,
  jobId?: string,
): Promise<void> {
  for (const attempt of attempts) {
    await updateFactsAuditResult({
      target,
      ...(jobId ? { jobId } : {}),
      attempt,
    });
  }
}

/**
 * Consecutive Gate C failures that stop the whole job.
 *
 * Three, because two is inside the noise of a genuinely flaky account and four
 * is another four brands' worth of doomed calls. "Consecutive" is measured in
 * completion order, not start order — see the abort flag in `runEnrich`.
 */
const LLM_BREAKER_CONSECUTIVE_LIMIT = 3;

/**
 * Thrown by `runEnrich` after the breaker trips and the in-flight chunk has
 * drained. `runJob` identifies it to sweep the job's untouched targets to
 * `cancelled` before finalizing the job as `failed`; nothing else catches it.
 */
class LlmCircuitBreakerError extends Error {
  constructor(consecutiveFailures: number) {
    super(
      `LLM circuit breaker tripped after ${consecutiveFailures} consecutive provider failures — remaining targets were not attempted`,
    );
    this.name = "LlmCircuitBreakerError";
  }
}

export function isLlmCircuitBreakerError(error: unknown): boolean {
  return error instanceof Error && error.name === "LlmCircuitBreakerError";
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

export { mapWithConcurrency };

export { ENRICH_PHASES };

/**
 * How many brands expand their links at once inside one chunk.
 *
 * Every unit is network-bound and nothing else: hub fetches, one Threads
 * fetch, and at most two Serper calls. It is deliberately wider than
 * `ENRICH_BRAND_CONCURRENCY` (which carries LLM and image work per unit) and
 * deliberately narrower than the chunk, so a slow host stalls three brands
 * rather than twenty.
 */
const LINK_EXPANSION_CONCURRENCY = 4;

/** Replayed search rows stay usable for three days. */
const SEARCH_REPLAY_MAX_AGE_MS = 3 * 86_400_000;

/**
 * One brand's slot in a `batchSearchBrandsWithSnippets` map. Derived from the
 * function rather than restated: the result shape is not exported, and a local
 * copy of it could disagree with the provider adapter without anyone noticing.
 */
type SerpResult = ReturnType<
  Awaited<ReturnType<typeof batchSearchBrandsWithSnippets>>["get"]
>;

/**
 * The handle an Instagram PROFILE url carries, or null.
 *
 * Only a profile yields a handle — the first segment of a post permalink is
 * `p` or `reel`, and searching for `"p"` would burn a Serper credit on noise.
 * `extractInstagramHandle` owns the host anchor and the reserved-path list, so
 * this stays a name for the same answer rather than a second copy of it.
 */
export function instagramHandleFromUrl(
  url: string | null | undefined,
): string | null {
  return extractInstagramHandle(url);
}

/**
 * A URL's first hostname label in `normalizeHandle`'s comparison form —
 * `https://1woof.com/` becomes `1woof`. Both sides of a handle comparison have
 * to be normalized as WHOLE units: a handle spelled `1.wo_of` would never
 * match its own site otherwise.
 */
function registrableLabel(url: string): string | null {
  try {
    const host = new URL(url).hostname.toLowerCase().replace(/^www\./, "");
    const label = host.split(".")[0] ?? "";
    return label.length > 0 ? normalizeHandle(label) : null;
  } catch {
    return null;
  }
}

const UNCONSULTED_SOURCES: ChannelSources = {
  hubs: "skipped",
  threads: "skipped",
  serpName: "skipped",
  serpHandle: "skipped",
};

/**
 * The one line a human (and the verdict finalizer's reader) sees for a brand
 * with no purchase channel. Every source is named with its own outcome, so
 * "we looked and there is nothing" is never confused with "we could not look".
 */
export function buildNoChannelDetail(
  sources: ChannelSources | undefined,
  evidence: "conclusive" | "inconclusive",
  instagramFollowers?: number,
): string {
  const s = sources ?? UNCONSULTED_SOURCES;
  const followers =
    typeof instagramFollowers === "number"
      ? ` instagram_followers=${instagramFollowers}`
      : "";
  return (
    `no purchase channel after hubs=${s.hubs} threads=${s.threads}` +
    ` serp_name=${s.serpName} serp_handle=${s.serpHandle}` +
    ` evidence=${evidence}${followers}`
  );
}

/**
 * Every phase `runEnrich` can be asked for. Aliased to the canonical
 * `EnrichPhaseName` rather than spelled out again: this used to be a
 * hand-maintained union and it had already drifted — `classify_images` was
 * missing, and adding `faq` to `ENRICH_PHASES` turned `needsPhase`'s new `faq`
 * clause into a branch TypeScript could prove unreachable. A local copy of a
 * list that lives in the constants module can only drift again, so there is no
 * copy now. (A second, narrower copy survived until DEV-1644 and still named
 * `links`; it went with `processEnrichBrand`, its only consumer.)
 */
type RunEnrichPhase = EnrichPhaseName;

type EnrichBrand = CurationBrand &
  Partial<BrandFlatLinkColumns> & {
    hero_image_url?: string | null;
    product_images?: string[] | null;
    heroImageUrl?: string | null;
    productPhotos?: string[] | null;
    overwrite_enrichment?: boolean;
    /** Submitted website URL — feeds `collectHubUrls` for link expansion. */
    website_url?: string | null;
    /** Submitted intent ('recommend' | 'refresh'). Gates triage row on no-channel. */
    intent?: string;
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
 * to the `clean` phase, which reports the candidate; the `names` phase owns
 * persisting the new name.
 */
export function applyChunkNameCleanup(
  chunk: EnrichBrand[],
): Map<string, NameCleanupResult> {
  const cleanups = new Map<string, NameCleanupResult>();

  for (const brand of chunk) {
    const cleanup = cleanBrandName(getDisplayBrandName(brand));
    if (!cleanup.changed) continue;
    cleanups.set(brand.id, cleanup);
    // Keep the mutation: query construction still needs the cleaned name.
    brand.name = cleanup.cleanedName;
  }

  return cleanups;
}

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
    // Presence check, not a URL. Since DEV-1551 the bucket key is what proves
    // an image exists; the legacy columns are kept in the chain only so a row
    // that predates the backfill is not re-enriched for nothing.
    return isEmptyField(
      brand.hero_image_storage_path ??
        brand.hero_image_url ??
        brand.heroImageUrl,
    );
  }

  if (phase === "faq") {
    // Entry counts are not part of this row; let the phase perform its own
    // cheap eligibility and provider gates rather than adding an N+1 query.
    return true;
  }

  return true;
}

type EnrichDescriptionPatch = Partial<{
  description: string | null;
  description_en: string | null;
  subcategories: string[] | null;
  city: string | null;
}>;

type EnrichPatches = {
  links?: Partial<BrandFlatLinkColumns>;
  /**
   * The single writer of `name` (DEV-1321). `clean` used to own this key and
   * LOST the `mergeEnrichPatches` spread to `links`, while at runtime
   * `appendPatch` let the last phase to run win instead — the two precedence
   * mechanisms disagreed about the same column, and `首頁 - 小朱甜點` is what
   * that disagreement wrote to a live row. Only one phase can produce a `name`
   * at all now, so the two paths cannot diverge.
   */
  names?: Partial<Pick<CurationBrand, "name">>;
  images?: EnrichImagePatch;
  descriptions?: EnrichDescriptionPatch;
  tags?: Partial<Pick<CurationBrand, "category">>;
};

type EnrichPatch = Partial<BrandFlatLinkColumns> &
  EnrichImagePatch &
  EnrichDescriptionPatch &
  Partial<Pick<EnrichBrand, "category" | "name">>;

type SubmissionEnrichmentRow = Record<OnlineStoreColumn, string | null> & {
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
  other_urls: unknown;
  enriched_data: unknown;
  owner_data: unknown;
  status: string;
};

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
    ["categorySlug", "category"],
    ["foundingYear", "founding_year"],
    ["city", "city"],
    ["subcategories", "subcategories"],
    ["subcategories_en", "subcategories_en"],
    ["productPhotos", "product_photos"],
    ["heroImageUrl", "hero_image_url"],
    ["description", "description"],
    ["socialInstagram", "social_instagram"],
    ["socialThreads", "social_threads"],
    ["socialFacebook", "social_facebook"],
    ...ONLINE_STORES.map((channel) => [channel.camel, channel.column] as const),
  ] as const;

  for (const [ownerKey, enrichedKey] of fieldMappings) {
    if (merged[enrichedKey] == null && ownerData[ownerKey] !== undefined) {
      merged[enrichedKey] = ownerData[ownerKey];
    }
  }

  return merged;
}

/**
 * Keys whose array value REPLACES the stored one instead of unioning with it.
 *
 * The merge's default is a `Set` union, which is right for arrays of scalars
 * and wrong for everything here. `channels` and `products` are arrays of
 * OBJECTS, so the Set union is a no-op on identity and every rerun appends its
 * whole list to the stored one. `subcategories` and its aligned English labels
 * are complete classifier results, so the newest pair is likewise the whole
 * list rather than a union.
 * `_cleared_fields` is the mirror case — a later run that finds real evidence
 * has to be able to un-clear a field, and a union would make the first clear
 * permanent.
 *
 * A SET, not a third hand-written branch. Each of these was added as its own
 * `if (Object.hasOwn(patch, …))` block after the merge, so a fourth key added
 * without its block appended silently across every rerun and nothing failed.
 */
const REPLACE_NOT_UNION_KEYS = new Set<string>([
  "channels",
  "products",
  "subcategories",
  "subcategories_en",
  CLEARED_FIELDS_KEY,
]);

function deepMergeJsonObjects(base: JsonObject, patch: JsonObject): JsonObject {
  const merged: JsonObject = { ...base };

  for (const [key, value] of Object.entries(patch)) {
    const existing = merged[key];
    if (REPLACE_NOT_UNION_KEYS.has(key)) {
      merged[key] = value;
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
  // Complete arrays in REPLACE_NOT_UNION_KEYS are replaced, not unioned, by
  // `deepMergeJsonObjects` itself.
  const merged = deepMergeJsonObjects(base, patch);
  if (Object.hasOwn(patch, CLEARED_FIELDS_KEY)) {
    // A clear from this run must beat a stale value in the stored base. The
    // sentinel is the only patch representation that can express deletion,
    // so remove fields it names before the existing value-wins filter runs.
    const assertedClears = patch[CLEARED_FIELDS_KEY];
    if (Array.isArray(assertedClears)) {
      for (const field of assertedClears) {
        if (typeof field === "string" && !Object.hasOwn(patch, field)) {
          delete merged[field];
        }
      }
    }
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

/**
 * Gate C's marker, the LLM counterpart of {@link PROVIDER_FAILURE_PREFIX}.
 *
 * Separate prefix, same job: it is the only thing that survives the throw ->
 * per-brand catch -> persisted target round trip, so `summary.providerFailed`
 * and the alerting path can tell an OpenAI outage from a Serper one when
 * reading a `curation_job_targets` row back days later.
 */
const LLM_PROVIDER_FAILURE_PREFIX = "LLM provider unavailable";

/**
 * True when `message` was produced by {@link describeProviderFailure} (Gate A)
 * or {@link describeLlmProviderFailure} (Gate C). Both are provider outages for
 * the purposes of counting and alerting — the operator response ("stop the run,
 * fix the account") is the same, only the vendor differs.
 */
export function isProviderFailureMessage(
  message: string | null | undefined,
): boolean {
  return (
    typeof message === "string" &&
    (message.startsWith(PROVIDER_FAILURE_PREFIX) ||
      message.startsWith(LLM_PROVIDER_FAILURE_PREFIX))
  );
}

/** True only for the LLM half, used by the circuit breaker's consecutive count. */
export function isLlmProviderFailureMessage(
  message: string | null | undefined,
): boolean {
  return (
    typeof message === "string" &&
    message.startsWith(LLM_PROVIDER_FAILURE_PREFIX)
  );
}

function describeLlmProviderFailure(failedPhases: readonly string[]): string {
  const phases = failedPhases.length > 0 ? failedPhases.join(", ") : "LLM";
  return `${LLM_PROVIDER_FAILURE_PREFIX} — every attempted LLM phase failed at the provider: ${phases}`;
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
 * Phases a PRODUCTS-SCOPED run may name, and nothing else: the products phase
 * plus its hard dependency. `curated-products/backfill.ts` enqueues exactly
 * this set as `CURATED_PRODUCT_BACKFILL_PHASES`, and the set is repeated here
 * rather than imported because that module reaches `curation-jobs` and
 * `submissions` — importing it from the runner would close a cycle to buy one
 * array.
 *
 * The two must stay in step. When they drifted (this set still naming the
 * retired `links`/`site_identity` while the backfill had moved to `acquire`)
 * every backfill target recorded `skipped`, its refresh submission stayed
 * pending and un-approvable, and the brand's pending-refresh unique index
 * (23505) then blocked every future refresh of that brand.
 */
const PRODUCTS_SCOPED_RUN_PHASES = new Set<string>(["acquire", "products"]);

export function isProductsScopedRun(phases: readonly string[]): boolean {
  return (
    phases.includes("products") &&
    phases.every((phase) => PRODUCTS_SCOPED_RUN_PHASES.has(phase))
  );
}

/**
 * "Did this run learn anything?" — Gate C's question, and it is NOT the same as
 * `hasPatchValues`, which is a bare key count.
 *
 * `patch.products` is the exception that forces the distinction. The products
 * phase emits `products: []` when it RAN and found nothing, because a stale
 * proposal list has to be cleared rather than left standing. That empty array
 * is a real value for a products-scoped backfill: without it the target records
 * `skipped`, its refresh submission stays pending and un-approvable, and the
 * brand's pending-refresh unique index (23505) then blocks every future refresh
 * of that brand.
 *
 * For a FULL enrichment run the same array must count for nothing. Fifteen
 * phases ran, none of them found a field, and that is exactly the shape Gate C
 * exists to report — `skipped`, plus the WEAK-BRAND counter. Letting one
 * phase's empty list stand in for a patch would retire both, silently, for
 * every run that includes `products`.
 */
export function hasMaterialPatchValues(
  patch: object,
  options: { productsScopedRun: boolean },
): boolean {
  if (options.productsScopedRun) return hasPatchValues(patch);

  return Object.entries(patch as Record<string, unknown>).some(
    ([key, value]) =>
      !(key === "products" && Array.isArray(value) && value.length === 0),
  );
}

export type ProviderGateDecision = {
  /** `warn` when the kill switch is off — log and continue instead of failing. */
  action: "fail" | "warn";
  message: string;
};

/**
 * Gate A: acquire failed at the provider, so any absence of results says
 * nothing about the brand. Returns the gate decision, or `null` when healthy.
 *
 * After the wave collapse, Gate A reads the acquire PhaseResult instead of
 * individual SERP and image-search outcomes.
 */
export function evaluateProviderGate(input: {
  acquireResult?: PhaseResult;
}): ProviderGateDecision | null {
  const { acquireResult } = input;
  if (
    !acquireResult ||
    acquireResult.status !== "failed" ||
    acquireResult.providerFailure !== true
  ) {
    return null;
  }

  const message = describeProviderFailure("acquire", {
    error: acquireResult.error,
  });

  return {
    action: process.env.CURATION_PROVIDER_GATE === "off" ? "warn" : "fail",
    message,
  };
}

const LLM_PHASE_NAMES = new Set<string>(ENRICH_LLM_PHASES);

/**
 * Gate C: every LLM phase this brand actually attempted failed at the provider.
 *
 * Returns the message to throw with, or `null` when at least one LLM call got
 * through (or none was attempted). This is the LLM analogue of Gate A, and it
 * necessarily fires AFTER the phases rather than before them: a search-provider
 * outage is visible in the SERP result the pipeline already holds, but an LLM
 * outage is only discoverable by calling.
 *
 * The counting rule is what protects the healthy case. A phase contributes to
 * the denominator only when it was attempted (`status !== 'skipped'`), and to
 * the numerator only when it failed with `providerFailure`. So a brand whose
 * descriptions phase succeeded with an empty patch is untouched, and a brand
 * whose every phase was skipped by scope is untouched — only the 2026-08-02
 * shape (every call 429, nothing learned) trips it.
 */
export function llmStageFailure(
  phaseResults: readonly PhaseResult[],
): string | null {
  const attempted = phaseResults.filter(
    (phaseResult) =>
      LLM_PHASE_NAMES.has(phaseResult.phase) &&
      phaseResult.status !== "skipped",
  );
  if (attempted.length === 0) {
    return null;
  }

  const providerFailed = attempted.filter(
    (phaseResult) =>
      phaseResult.status === "failed" && phaseResult.providerFailure === true,
  );
  if (providerFailed.length !== attempted.length) {
    return null;
  }

  return describeLlmProviderFailure(
    providerFailed.map((phaseResult) => phaseResult.phase),
  );
}

/**
 * Gate C with its kill switch applied. Shares `CURATION_PROVIDER_GATE=off` with
 * Gate A deliberately: an operator disabling the provider gates mid-incident
 * wants both off, and two switches is one more thing to get wrong at 2am.
 */
export function evaluateLlmProviderGate(
  phaseResults: readonly PhaseResult[],
): ProviderGateDecision | null {
  const message = llmStageFailure(phaseResults);
  if (!message) {
    return null;
  }

  return {
    action: process.env.CURATION_PROVIDER_GATE === "off" ? "warn" : "fail",
    message,
  };
}

/**
 * Gate C's sibling: a phase died on OUR infrastructure, not a vendor's.
 *
 * The phase reports this by prefixing its `error` (see STORAGE_FAILURE_PREFIX),
 * the same mechanism Gates A and C use, so the attribution survives the round
 * trip through `curation_job_targets.phase_results`.
 *
 * It has to be a separate gate rather than a fourth `providerFailure` producer.
 * `providerFailure` is what Gate C counts and what feeds the LLM circuit
 * breaker, and the breaker's trip cancels every unstarted target in the job and
 * pages the operator for a provider outage. A Supabase Storage outage would then
 * take a whole run down under a diagnosis naming the wrong vendor — while the
 * account it accused was healthy. This path fails the affected target (so Resume
 * picks it up) and stops there.
 *
 * Unlike Gate C it does not require EVERY attempted phase to have failed: one
 * phase that could not read its own inputs already means this target's work is
 * incomplete, and the phase only emits this at all when every one of its batches
 * died.
 */
export function storageStageFailure(
  phaseResults: readonly PhaseResult[],
): string | null {
  const failed = phaseResults.filter(
    (phaseResult) =>
      phaseResult.status === "failed" &&
      phaseResult.error?.startsWith(STORAGE_FAILURE_PREFIX) === true,
  );
  if (failed.length === 0) {
    return null;
  }

  return `${STORAGE_FAILURE_PREFIX} — ${failed
    .map((phaseResult) => phaseResult.phase)
    .join(", ")} could not read its inputs out of Supabase Storage`;
}

/** Same kill switch as Gates A and C, for the same 2am reason. */
export function evaluateStorageGate(
  phaseResults: readonly PhaseResult[],
): ProviderGateDecision | null {
  const message = storageStageFailure(phaseResults);
  if (!message) {
    return null;
  }

  return {
    action: process.env.CURATION_PROVIDER_GATE === "off" ? "warn" : "fail",
    message,
  };
}

/**
 * Gate B: nothing downstream can consume. After the wave collapse, acquire is
 * the primary evidence source. If acquire ran and produced evidence (scrapedData
 * or images), there are inputs. If acquire was satisfied-skipped, fall back to
 * the knownUrls check.
 */
export function hasNoEnrichmentInputs(input: {
  knownUrls: string[];
  acquireResult?: {
    scrapedData?: unknown;
    scrapedImageUrls?: string[];
  };
}): boolean {
  const { acquireResult } = input;

  // If acquire ran and produced evidence, there are inputs
  if (acquireResult) {
    if (acquireResult.scrapedData != null) return false;
    if (
      acquireResult.scrapedImageUrls &&
      acquireResult.scrapedImageUrls.length > 0
    )
      return false;
  }

  // Fall back to known URLs
  return uniqueUrls(input.knownUrls).length === 0;
}

function chunkItems<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];

  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }

  return chunks;
}

// Probe cap imported from the prompt owner — see `probeLines` in category-classifier.ts.
// Probing more would pay for evidence no model ever reads.

function collectKnownUrls(brand: EnrichBrand): string[] {
  const linkUrls = LINK_FIELDS.map(
    (field) => brand[linkColumnFor(field)],
  ).filter((url): url is string => hasLinkValue(url));

  return uniqueUrls(linkUrls);
}

/**
 * The products phase ranks images against each proposal's own page, so it needs
 * this run's classified pool. Acquire hands over the full in-memory pool when it
 * runs — but when it was satisfied from history it runs nothing, and the target's
 * stored active images are the only pool there is.
 *
 * Without this fallback a re-run verifies every proposal's image against an
 * EMPTY pool, and an empty pool passes: the brand keeps whatever image the model
 * echoed back, unranked and unverified.
 */
async function loadImagePoolFromHistory(
  supabase: SupabaseLike,
  target: EnrichmentTarget,
): Promise<RankableImage[]> {
  try {
    const rows = await getActiveImages(supabase, target);
    return rows
      .map(classifiedImageFromRow)
      .filter((image): image is RankableImage => image !== null);
  } catch {
    // A pool is an input, not a precondition. A failed read leaves products to
    // record its own `unverified` image flag rather than failing the brand.
    return [];
  }
}

export function mergeEnrichPatches(patches: EnrichPatches): EnrichPatch {
  return {
    ...patches.links,
    // `names` after `links` mirrors the runtime `appendPatch` order exactly: the
    // batched names phase runs immediately after the links wave. Keep the two in
    // step — them drifting apart is the DEV-1321 bug.
    ...patches.names,
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

/**
 * The phase labels the per-brand progress log counts through ("[3/7] acquire").
 *
 * After the wave collapse, the order is: detect → acquire → names →
 * descriptions → stockists → faq → tags → products → persist.
 * Clean, discover, links, site_identity, images and classify_images are
 * retired — `clean` folded into the chunk-level `applyChunkNameCleanup`.
 */
function buildBrandPhaseOrder(
  phases: RunEnrichPhase[],
  hasDetectPhases: boolean,
): string[] {
  return [
    hasDetectPhases && "detect",
    "acquire",
    "names",
    "descriptions",
    "stockists",
    "faq",
    phases.includes("tags") && "tags",
  ]
    .filter((phase): phase is string => Boolean(phase))
    .filter((phase) => !isDeferredPhase(phase));
}

type AcquirePhaseResult = Awaited<ReturnType<typeof runAcquirePhase>>;

/**
 * Per-target state carried across the chunk's TWO per-brand loops.
 *
 * Loop A: detect application → acquire → Gate A → Gate B → name candidates.
 * Then ONE batched `names` call for the whole chunk.
 * Loop B: names verdict → editorial → products → tags → persist.
 *
 * The context is what makes the split possible: everything loop B needs about a
 * brand (its acquire output, its satisfied phases, its accumulated state) is
 * held here rather than in a closure that dies with loop A's callback.
 *
 * `completed` is the single source of truth for "this target already recorded a
 * terminal outcome". The batch phases and loop B read it, so a target that
 * skipped or failed in loop A is never re-emitted and never counted twice.
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
  /** Acquire phase output, threaded to products and Gate A/B. */
  acquireResult: AcquirePhaseResult | null;
  urlExtracted: Partial<BrandFlatLinkColumns>;
  currentPhase: string | undefined;
  completed: boolean;
  satisfiedPhaseSet: Set<EnrichPhaseName>;
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
  return auditedCall(
    {
      provider: "enrich",
      operation: "persistSubmissionEnrichmentResults",
      kind: "service",
    },
    async () => {
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

      let persistablePatch = routeSubmissionNamePatch(row.intent, patch);
      if (row.intent === "refresh") {
        if (!row.brand_id || !isPlainObject(row.base_brand_data)) {
          throw new Error("Refresh submission is missing its brand snapshot");
        }
        const { data: fieldStates, error: fieldStateError } = await supabase
          .from("brand_field_state")
          .select("field, source, updated_at, updated_by")
          .eq("brand_id", row.brand_id);
        if (fieldStateError) throw fieldStateError;

        const fieldState = mergeBrandFieldStates(fieldStates ?? []);
        const filtered = resolveRefreshEnrichmentPatch(
          persistablePatch,
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

      const existing = {
        ...((row.enriched_data ?? {}) as Record<string, unknown>),
      };
      if (row.intent === "refresh") delete existing.name;
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
    },
  );
}

/**
 * New submissions publish an accepted name through their enrichment blob.
 * Refreshes stage only a high-confidence proposal; their live name changes
 * exclusively when an admin copies it into the ordinary review override.
 */
export function routeSubmissionNamePatch(
  intent: string,
  patch: Record<string, unknown>,
): Record<string, unknown> {
  const routed = { ...patch };
  const proposal = isBrandNameProposal(routed._name_proposal)
    ? routed._name_proposal
    : null;
  delete routed._name_proposal;

  if (intent === "refresh") {
    delete routed.name;
    if (proposal) routed._name_proposal = proposal;
  }

  return routed;
}

/**
 * Fill-gaps merge of the purchase columns: whatever enrichment already produced
 * wins, otherwise the submitted value is used.
 *
 * The submitted value is reduced to its origin only for a store that accepts a
 * bare root (today: the brand's own website) — that column is meant to hold the
 * site, not a page on it. A marketplace store is the opposite: its bare root
 * is the platform's front door, so the submitted URL is carried through intact.
 */
function mergeSubmittedPurchaseColumns(
  existing: JsonObject,
  submission: Record<OnlineStoreColumn, string | null>,
): Record<OnlineStoreColumn, string | null> {
  return Object.fromEntries(
    ONLINE_STORES.map((channel): [OnlineStoreColumn, string | null] => {
      const enriched = existing[channel.column];
      if (typeof enriched === "string") return [channel.column, enriched];
      const submitted = submission[channel.column];
      return [
        channel.column,
        channel.allowBareRoot ? normalizeToRootUrl(submitted) : submitted,
      ];
    }),
  ) as Record<OnlineStoreColumn, string | null>;
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

  return {
    ...existing,
    id: submission.id,
    source_brand_id: submission.brand_id,
    // A refresh seeds from the live snapshot, but only an explicit job-level
    // `overwrite` lets an admin re-touch already-populated rows (e.g. re-running
    // image classification on submissions whose tags are already set).
    overwrite_enrichment: options?.overwrite === true,
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
    site_content: isPlainObject(existing.site_content)
      ? existing.site_content
      : null,
    category: typeof existing.category === "string" ? existing.category : null,
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
    ...mergeSubmittedPurchaseColumns(existing, submission),
    hero_image_url:
      typeof existing.hero_image_url === "string"
        ? existing.hero_image_url
        : (submission.hero_image_url ?? null),
    website_url: submission.website_url ?? null,
    other_urls: submission.other_urls,
    intent: submission.intent,
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
  return auditedCall(
    {
      provider: "enrich",
      operation: "persistEnrichmentResults",
      kind: "service",
    },
    async () => {
      void supabase;
      void brandIdOrPatches;
      void patchOrJobId;
      throw new Error(
        "Direct brand enrichment is retired; create a refresh submission instead",
      );
    },
  );
}

export async function runEnrich(
  config: CurationConfig & {
    phases: string[];
    /**
     * Task-based selection, threaded from job params for logging. Phase
     * resolution happens at the caller (job-runner / CLI); `phases` already
     * carries the resolved closure.
     */
    task?: CurationTask;
    /**
     * Phases the operator named literally (via `params.phases` or the CLI
     * `--phases` flag). Phases derived from a task closure or legacy steps
     * are NOT explicit: they should not trigger force-regeneration guards
     * like the FAQ re-author switch. Defaults to `[]` when absent, so the
     * non-forcing path is the default.
     */
    explicitPhases?: readonly string[];
    renderProvider?: RenderProvider;
  },
  supabase: SupabaseLike,
): Promise<EnrichOperationResult> {
  return auditedCall(
    { provider: "enrich", operation: "runEnrich", kind: "service" },
    async () => {
      const langfuse = getLangfuse();
      const langfuseTrace = langfuse?.trace({
        name: "enrich",
        metadata: {
          brandSlug: config.slugs?.[0] ?? "batch",
          jobId: config.jobId,
          correlationId: getAuditContext().correlationId,
        },
      }) ?? undefined;

      return runWithAuditContext({ langfuseTrace }, async () => {
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

      // Phase resolution happens at the caller (job-runner / CLI); the
      // resolved list arrives here in config.phases.
      const phases = config.phases as RunEnrichPhase[];
      const target =
        config.target ?? (config.slugs?.length ? "brands" : "submissions");
      if (target === "brands") {
        throw new Error(
          "Brand-target enrichment is retired; create a refresh submission instead",
        );
      }
      const enrichDelayMs = SCRAPE_DELAY_MS;
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
        onProgress(
          formatEnrichError(`Failed to fetch submissions: ${message}`),
        );
        throw error;
      }

      const typedSubmissions = (submissions ?? []) as SubmissionEnrichmentRow[];
      allBrands = typedSubmissions.map((submission) =>
        submissionToEnrichBrand(submission, {
          overwrite: config.overwrite === true,
        }),
      );

      const totalBrands = allBrands.length;
      for (const line of formatJobStart(totalBrands)) {
        onProgress(line);
      }
      const brandChunks = chunkItems(allBrands, ENRICH_CHUNK_SIZE);

      /**
       * Circuit breaker state, job-wide rather than per chunk: a dead OpenAI
       * account does not recover between chunks, and on 2026-08-02 the run kept
       * going for 11.5 hours producing 407 falsely-green targets.
       *
       * Cooperative abort, NOT a mid-flight throw. `mapWithConcurrency` awaits a
       * rejecting `Promise.all` with no cancellation, so throwing from inside a
       * callback would leave up to ENRICH_BRAND_CONCURRENCY - 1 siblings still
       * writing progress rows while the job is being finalized. Instead the flag is
       * raised, every not-yet-started callback returns immediately, the in-flight
       * ones finish normally (their results are legitimate), and `runEnrich` throws
       * the sentinel only after the chunk has fully drained.
       *
       * "Consecutive" is completion order, so with ENRICH_BRAND_CONCURRENCY = 3 the
       * trip can overshoot to roughly 5 targets before the flag is observed. That
       * is deliberate: bounding the overshoot would require cancellation the map
       * does not have, and 5 doomed targets is far cheaper than 407.
       */
      let consecutiveLlmProviderFailures = 0;
      let llmBreakerTripped = false;

      for (
        let chunkIndex = 0;
        chunkIndex < brandChunks.length;
        chunkIndex += 1
      ) {
        if (chunkIndex > 0) {
          await delay(enrichDelayMs);
        }

        const chunk = brandChunks[chunkIndex];
        // No "tags" here: the category moved to the descriptions phase, so a tags
        // run no longer implies a detect call. Mirrors `hasDetectPhases` in
        // `enrich-phases/detect.ts` — the two must agree or this banner announces a
        // detect step that never runs.
        const hasDetectPhases =
          phases.includes("detect") || phases.includes("slugs");
        const activeSteps = [
          hasDetectPhases && "detect",
          phases.includes("acquire") && "acquire",
          phases.includes("tags") && !phases.includes("descriptions") && "tags",
          phases.includes("descriptions") &&
            phases.includes("tags") &&
            "descriptions+tags",
          phases.includes("descriptions") &&
            !phases.includes("tags") &&
            "descriptions",
          phases.includes("stockists") && "stockists",
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
        // Populated by loop A, read by the batched `names` call that runs between
        // the loops, and resumed by loop B. Keyed by target id — see the
        // `BrandWaveContext` doc comment for why a name key would be unsafe here.
        const brandContexts = new Map<string, BrandWaveContext>();
        const isBrandCompleted = (brandId: string): boolean =>
          brandContexts.get(brandId)?.completed === true;
        // Competing `name` proposals collected during loop A, consumed by the
        // batched names phase that runs between the loops. Keyed by target id for
        // the same reason `brandContexts` is: `clean` and `detect` can rewrite a
        // name, so a name key would be a silent miss.
        const nameCandidates = new Map<string, NameCandidateInput>();
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
        const _recordBatchPhase = async (
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
            brandContexts
              .get(brand.id)
              ?.state.phaseResults.push(targetPhaseResult);
          }
          await emitBatchPhaseProgress(phaseResult.phase);
        };

        // ---- Cached SERP loading (replays stored search results) ----
        // An enrichment run needs SERP context for detect and LLM phases,
        // so replay the stored results. Replayed rows are marked `fromCache`
        // so a historical provider failure is never mistaken for a live one.
        const requestedPhases = new Set<string>(phases);
        const needsCachedSerp =
          ENRICH_LLM_PHASES.some((phase) => requestedPhases.has(phase));

        let searchResults = new Map<string, SearchPhaseResult>();
        // Raw SERP rows keyed by brand ID — used by the gather block to
        // check freshness before deciding whether to re-search.
        let rawSearchResultsById = new Map<string, SearchResultRow>();
        // The handle-anchored search replays from its OWN kind of row. Without
        // the split a fresh name row would stand in for a handle row that was
        // never written, and the second search would be skipped forever.
        let rawHandleSearchResultsById = new Map<string, SearchResultRow>();
        if (needsCachedSerp) {
          rawSearchResultsById = await getLatestSearchResults(
            chunk.map((brand) => brand.id),
            'serp',
            targetType,
            'name',
          );
          rawHandleSearchResultsById = await getLatestSearchResults(
            chunk.map((brand) => brand.id),
            'serp',
            targetType,
            'handle',
          );
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
            onProgress(
              `  [SERP-CACHE] Loaded ${cachedCount} cached snippet sets`,
            );
          }
        }

        // ---- Link expansion gather block (per brand, before detect) ----
        // Four deterministic sources are consulted IN COST ORDER, each one only
        // when the cheaper ones left the brand without a purchase channel: hub
        // pages (free fetches), the Threads bio (one free fetch), a by-name
        // SERP (one credit), and a handle-anchored SERP (one credit). Every
        // step records its own outcome, because the verdict finalizer may act
        // only on a brand where every source ANSWERED — an outage has to read
        // as `unknown`, never as "this brand has no shop".
        type GatherExpansionEntry = {
          patch: Partial<BrandFlatLinkColumns>;
          serp: 'replayed' | 'searched' | 'none';
          sources: ChannelSources;
          /** Statuses of the search calls actually made, replay included. */
          serpCallStatuses: Array<string | null | undefined>;
          linkExpansion: NonNullable<PhaseResult['linkExpansion']>;
        };
        const linkExpansionByBrandId = new Map<string, GatherExpansionEntry>();

        await mapWithConcurrency(chunk, LINK_EXPANSION_CONCURRENCY, async (brand) => {
          const brandName = getDisplayBrandName(brand);
          const hubUrls = collectHubUrls(brand);

          // Build confirmed URL set from submitted website_url and other_urls
          const confirmedHubUrls = new Set<string>();
          if (brand.website_url) confirmedHubUrls.add(brand.website_url);
          if (Array.isArray(brand.other_urls)) {
            for (const entry of brand.other_urls as Array<{ url?: string }>) {
              if (entry?.url && typeof entry.url === 'string') {
                confirmedHubUrls.add(entry.url);
              }
            }
          }

          const expansion = await expandLinkHubs({
            brandName,
            hubUrls,
            confirmedHubUrls,
            fetchHtml,
          });

          // Build patch from hub-scraped links and adopt onto the brand object
          let patch = buildLinkEnrichPatch(
            brand as BrandFlatLinkColumns,
            expansion.scraped,
            brandName,
          );
          Object.assign(brand, patch);

          const adoptedLinks: AdoptedLink[] = [...expansion.adopted];
          const gatedTags = [...(expansion.gated ?? [])];
          // Mutable: the handle SERP may find hubs of its own, and the trace
          // has to count every hub page this brand cost us.
          let hubsFetched = expansion.hubsFetched;
          const serpCallStatuses: Array<string | null | undefined> = [];
          const sources: ChannelSources = {
            hubs:
              hubUrls.length === 0
                ? 'skipped'
                : expansion.adopted.length > 0
                  ? 'found'
                  : (expansion.fetchFailures ?? 0) > 0
                    ? 'unknown'
                    : 'absent',
            threads: 'skipped',
            serpName: 'skipped',
            serpHandle: 'skipped',
          };
          let serp: 'replayed' | 'searched' | 'none' = 'none';

          // Re-read only after a step adopted something: every step below is
          // gated on this value, and nothing but an adoption can change it.
          let hasChannel = hasPurchaseChannel(brand);

          /**
           * Merge an adoption into the patch that is actually PERSISTED.
           * Assigning onto `brand` alone only survives inside this run: the
           * refresh submission is written from `patch`, so a SERP-found shop
           * that never reached it was silently dropped (DEV-1702 proof run).
           * An earlier source owns its column — nothing here displaces a value
           * already in the patch.
           */
          const mergeIntoPatch = (extracted: Partial<BrandFlatLinkColumns>) => {
            const next: Record<string, unknown> = { ...patch };
            for (const [column, value] of Object.entries(extracted)) {
              if (typeof value !== 'string') continue;
              if (hasLinkValue(next[column] as string | null)) continue;
              next[column] = value;
            }
            patch = next as Partial<BrandFlatLinkColumns>;
          };

          /** Adopt SERP URLs onto the brand and say what that answered. */
          const applySerpUrls = (urls: string[]): SourceOutcome => {
            const extracted = extractLinksFromUrls(urls, brandName);
            if (Object.keys(extracted).length === 0) return 'absent';
            Object.assign(brand, extracted);
            mergeIntoPatch(extracted);
            hasChannel = hasPurchaseChannel(brand);
            return hasChannel ? 'found' : 'absent';
          };

          // ---- Threads bio: one fetch of the brand's own profile ----
          if (!hasChannel) {
            const threadsUrl =
              brand.social_threads ?? deriveThreadsUrl(brand.social_instagram);
            if (threadsUrl) {
              const bio = await expandThreadsBio({
                brandName,
                threadsUrl,
                confirmedHubUrls,
                fetchHtmlWithMetadata,
                fetchHtml,
              });
              sources.threads = bio.threads;
              adoptedLinks.push(...bio.adopted);
              if (bio.gated?.length) gatedTags.push(...bio.gated);
              if (bio.adopted.length > 0) {
                const threadsPatch = buildLinkEnrichPatch(
                  brand as BrandFlatLinkColumns,
                  bio.scraped,
                  brandName,
                );
                Object.assign(brand, threadsPatch);
                patch = { ...patch, ...threadsPatch };
                hasChannel = hasPurchaseChannel(brand);
              }
            }
          }

          // ---- By-name SERP: replay a fresh cached row, or search live ----
          if (!hasChannel) {
            const cachedRow = rawSearchResultsById.get(brand.id);
            if (
              cachedRow &&
              isFreshSearchResult(cachedRow, SEARCH_REPLAY_MAX_AGE_MS)
            ) {
              serp = 'replayed';
              serpCallStatuses.push(cachedRow.callStatus);
              sources.serpName = applySerpUrls(cachedRow.urls);
            } else {
              serp = 'searched';
              // `searchBrandUrls` flattens the provider's call status away and
              // reports a dead call exactly the way it reports an empty answer
              // — an empty array — so every empty name query had to read as
              // `unknown`, and no brand could ever be judged on its name query.
              // The batch call carries the status through.
              let nameResult: SerpResult = undefined;
              try {
                const results = await batchSearchBrandsWithSnippets(
                  [brandName],
                  undefined,
                  1,
                  () => ({
                    target: { type: targetType, id: brand.id },
                    jobId: config.jobId,
                    config: { phase: 'acquire' as const },
                  }),
                );
                nameResult = results.get(brandName);
              } catch (error) {
                onProgress(`  [SERP-FAIL] ${brand.slug}: ${errorMessage(error)}`);
              }
              serpCallStatuses.push(nameResult?.callStatus);
              const nameStatus = nameResult?.callStatus;
              // Only a call that ANSWERED may say "there is no shop":
              // `empty` is a live query that ranked nothing, `succeeded` one
              // that ranked something. Everything else is an outage.
              // `malformed` stays `unknown` here even though
              // `isProviderFailure` excludes it — an unparseable body is not
              // evidence of an empty web.
              sources.serpName =
                nameResult &&
                (nameStatus === 'succeeded' || nameStatus === 'empty')
                  ? applySerpUrls(nameResult.urls)
                  : 'unknown';
            }
          }

          // ---- Handle-anchored SERP: the last credit, spent only after the
          //      brand's own name found nothing. A Taiwanese shop page
          //      routinely prints the brand's Instagram handle, never its
          //      name, so this is the query the name query cannot be. ----
          if (!hasChannel) {
            const handle = instagramHandleFromUrl(brand.social_instagram);
            if (!handle || !isUsableHandle(handle)) {
              sources.serpHandle = 'skipped';
            } else {
              let entries: BrandSearchEntry[] | null = null;
              const cachedHandleRow = rawHandleSearchResultsById.get(brand.id);
              if (
                cachedHandleRow &&
                isFreshSearchResult(cachedHandleRow, SEARCH_REPLAY_MAX_AGE_MS)
              ) {
                serpCallStatuses.push(cachedHandleRow.callStatus);
                // The stored row keeps the provider's own payload, so a replay
                // rebuilds the same title/snippet-bearing entries the live call
                // returned and the handle filter answers identically. Only a
                // legacy row without a raw payload falls back to the URL-only
                // shape, which can match on URL segments alone — narrower than
                // a live call, never wider.
                const replayed = parseBrandSearchEntries(
                  cachedHandleRow.rawResponse,
                );
                entries =
                  replayed.length > 0
                    ? replayed
                    : cachedHandleRow.urls.map((link) => ({
                        title: '',
                        link,
                      }));
              } else {
                let handleResult: SerpResult = undefined;
                try {
                  const results = await batchSearchBrandsWithSnippets(
                    [brandName],
                    () => HANDLE_QUERY(handle),
                    1,
                    () => ({
                      target: { type: targetType, id: brand.id },
                      jobId: config.jobId,
                      config: {
                        phase: 'acquire' as const,
                        queryKind: 'handle' as const,
                      },
                    }),
                  );
                  handleResult = results.get(brandName);
                } catch (error) {
                  onProgress(`  [SERP-FAIL] ${brand.slug}: ${errorMessage(error)}`);
                }
                serpCallStatuses.push(handleResult?.callStatus);
                // Same rule as the by-name query: `succeeded` and `empty` are
                // definitive answers from the provider; every other status
                // (including `malformed`) is an outage and reads `unknown`.
                const handleStatus = handleResult?.callStatus;
                if (
                  !handleResult ||
                  (handleStatus !== undefined &&
                    handleStatus !== 'succeeded' &&
                    handleStatus !== 'empty')
                ) {
                  sources.serpHandle = 'unknown';
                } else {
                  entries = handleResult.entries ?? [];
                }
              }

              if (entries) {
                const matchedLinks = filterEntriesByHandle(entries, handle).map(
                  (entry) => entry.link,
                );
                const hubLinks = matchedLinks.filter(isLinkAggregatorHost);
                const platformLinks = matchedLinks.filter(
                  (link) => !isLinkAggregatorHost(link),
                );
                const adoptedBefore = adoptedLinks.length;
                let handleFetchFailures = 0;

                // No brand-NAME gate here. `filterEntriesByHandle` already
                // matched every one of these links on the brand's own
                // Instagram handle by whole-segment equality, and THAT is the
                // identity check — re-gating on name tokens rejects the shop
                // of every brand whose handle does not spell its name.
                const extracted = extractLinksFromUrls(platformLinks);
                if (Object.keys(extracted).length > 0) {
                  Object.assign(brand, extracted);
                  mergeIntoPatch(extracted);
                  for (const [column, value] of Object.entries(extracted)) {
                    if (typeof value !== 'string') continue;
                    const field = LINK_FIELDS.find(
                      (candidate) => linkColumnFor(candidate) === column,
                    );
                    if (!field) continue;
                    adoptedLinks.push({
                      field,
                      value,
                      source: 'serp_handle',
                      hubUrl: value,
                    });
                  }
                }

                // A matched link aggregator is the brand's own hub — it
                // carries the brand's handle — so it is expanded on the same
                // terms as a hub the brand submitted, and confirmed.
                if (hubLinks.length > 0) {
                  const handleHubs = await expandLinkHubs({
                    brandName,
                    hubUrls: hubLinks,
                    confirmedHubUrls: new Set([
                      ...confirmedHubUrls,
                      ...hubLinks,
                    ]),
                    fetchHtml,
                  });
                  hubsFetched += handleHubs.hubsFetched;
                  handleFetchFailures += handleHubs.fetchFailures ?? 0;
                  if (handleHubs.gated?.length) {
                    gatedTags.push(...handleHubs.gated);
                  }
                  if (handleHubs.adopted.length > 0) {
                    const hubPatch = buildLinkEnrichPatch(
                      brand as BrandFlatLinkColumns,
                      handleHubs.scraped,
                      brandName,
                    );
                    Object.assign(brand, hubPatch);
                    patch = { ...patch, ...hubPatch };
                    for (const link of handleHubs.adopted) {
                      adoptedLinks.push({ ...link, source: 'serp_handle' });
                    }
                  }
                }

                // A matched link on the brand's OWN domain — the host label is
                // the handle itself. No platform pattern can recognise it, so
                // it is classified the way a human-submitted URL is. Nothing
                // weaker than host-label equality may reach this branch.
                const normalizedHandle = normalizeHandle(handle);
                for (const link of platformLinks) {
                  if (Object.values(extracted).includes(link)) continue;
                  const hostLabel = registrableLabel(link);
                  if (hostLabel === null || hostLabel !== normalizedHandle) {
                    continue;
                  }
                  for (const [field, value] of Object.entries(
                    classifySubmittedUrl(link),
                  )) {
                    if (typeof value !== 'string') continue;
                    if (!field.startsWith('purchase')) continue;
                    const column = linkColumnFor(field as LinkField);
                    const existing = (brand as Record<string, unknown>)[column];
                    if (hasLinkValue(existing as string | null)) continue;
                    (brand as Record<string, unknown>)[column] = value;
                    const adoption: Partial<BrandFlatLinkColumns> = {};
                    (adoption as Record<string, unknown>)[column] = value;
                    mergeIntoPatch(adoption);
                    adoptedLinks.push({
                      field: field as LinkField,
                      value,
                      source: 'serp_handle',
                      hubUrl: link,
                    });
                  }
                }

                hasChannel = hasPurchaseChannel(brand);
                sources.serpHandle = hasChannel
                  ? 'found'
                  : adoptedLinks.length === adoptedBefore &&
                      handleFetchFailures > 0
                    ? // Nothing adopted because a hub page never loaded: that
                      // is not the same finding as a hub with no shop on it.
                      'unknown'
                    : 'absent';
              }
            }
          }

          const adopted = adoptedLinks.map((link) => ({
            field: link.field,
            url: link.value,
            source: link.source,
          }));

          linkExpansionByBrandId.set(brand.id, {
            patch,
            serp,
            sources,
            serpCallStatuses,
            linkExpansion: {
              hubsFetched,
              adopted,
              serp,
              sources,
              ...(gatedTags.length ? { gated: gatedTags.join(', ') } : {}),
            },
          });
        });

        // ---- Probe evidence collection (per-brand, AFTER link expansion) ----
        // Moved after expansion so adopted URLs are included in the probe set.
        // Skipped for products-only jobs: probes only feed the detect phase.
        const probeEvidenceByBrandId = new Map<string, ProbeEvidence[]>();
        if (hasDetectPhases) {
          // A free GET on each brand's own known URLs. Kept PER BRAND: the whole
          // point is that detect judges a brand on its own pages, and a flat list
          // of the chunk's URLs (F10) could only ever be thrown away.
          //
          // One `probeStatic` call for the chunk rather than one per brand — it
          // already runs four at a time whatever it is handed, so a per-brand call
          // would serialize the chunk behind each brand's slowest host.
          const probeUrlsByBrandId = new Map<string, string[]>();
          const probeUrls: string[] = [];
          const seenProbeUrls = new Set<string>();
          for (const brand of chunk) {
            const urls = collectKnownUrls(brand).slice(
              0,
              MAX_PROBE_URLS,
            );
            if (urls.length === 0) continue;
            probeUrlsByBrandId.set(brand.id, urls);
            for (const url of urls) {
              if (seenProbeUrls.has(url)) continue;
              seenProbeUrls.add(url);
              probeUrls.push(url);
            }
          }
          if (probeUrls.length > 0) {
            const probes = await probeStatic(probeUrls);
            const probeByUrl = new Map(
              probes.map((probe) => [probe.url, probe] as const),
            );
            for (const [brandId, urls] of probeUrlsByBrandId) {
              const evidence = urls
                .map((url) => probeByUrl.get(url))
                .filter((probe): probe is ProbeEvidence => probe !== undefined);
              if (evidence.length > 0) {
                probeEvidenceByBrandId.set(brandId, evidence);
              }
            }
          }
        }

        // ---- Detect batch (reads probes + cached SERP) ----
        if (hasDetectPhases) await emitBatchPhaseProgress("detect");
        const detectPhaseResult = await runDetectPhase(
          batchContext,
          searchResults,
          probeEvidenceByBrandId,
        );
        const detectResults = detectPhaseResult.detectResults;
        const standaloneClassificationResult =
          await runStandaloneClassification(batchContext);
        const batchClassifications =
          standaloneClassificationResult.batchClassifications;
        /**
         * Detect and tags are BATCH-level phases that run before wave B, so their
         * outcome is not written by `recordBatchPhase` (which serves discover and
         * image search only). When the batch died at the provider, the signal is
         * grafted onto each brand's own detect/tags entry at the point the batch
         * result is applied — one entry per brand, replacing rather than duplicating
         * the `applyDetectResult` entry, so `phase_results` keeps exactly one
         * `detect` row per target.
         */
        const detectProviderFailure =
          detectPhaseResult.phaseResult.status === "failed" &&
          detectPhaseResult.phaseResult.providerFailure === true;
        const tagsProviderFailure =
          standaloneClassificationResult.phaseResult.status === "failed" &&
          standaloneClassificationResult.phaseResult.providerFailure === true;

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
         * brand that exited during loop A is neither re-emitted by the batch phases
         * that follow nor picked up (and re-counted) by loop B.
         */
        const recordOutcome = async (
          ctx: BrandWaveContext,
          outcome: BrandOutcome,
        ): Promise<void> => {
          ctx.completed = true;
          // Any target that got all the way through is proof the provider is
          // answering, so the consecutive run resets here rather than only on the
          // failure side — otherwise three failures spread across a healthy hour
          // would eventually trip the breaker.
          if (outcome.status === "succeeded") {
            consecutiveLlmProviderFailures = 0;
          }
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
        /** Shared catch body for both loops — a Gate A throw lands here. */
        const failBrand = async (
          ctx: BrandWaveContext,
          err: unknown,
        ): Promise<void> => {
          const errMsg = errorMessage(err);
          const outcomePhaseResults = ctx.state.phaseResults;
          if (isLlmProviderFailureMessage(errMsg)) {
            consecutiveLlmProviderFailures += 1;
            if (
              !llmBreakerTripped &&
              consecutiveLlmProviderFailures >= LLM_BREAKER_CONSECUTIVE_LIMIT
            ) {
              llmBreakerTripped = true;
              onProgress(
                `[LLM-BREAKER] ${consecutiveLlmProviderFailures} consecutive provider failures — aborting the run; remaining targets will be cancelled`,
              );
            }
          }
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

        /**
         * Gate C and its storage sibling, invoked immediately before EVERY exit
         * that would record a non-failed outcome. One end-of-callback check is
         * not enough: a brand can leave through the Gate B skip or the empty-patch
         * skip, and a provider-failed brand recorded `skipped` is invisible to the
         * Resume feature, which picks up `failed` and `cancelled` targets only.
         * Throwing hands the brand to `failBrand`.
         *
         * Gate C is evaluated first so a genuine LLM outage keeps its message and
         * its circuit-breaker contribution. The storage message deliberately carries
         * neither: `failBrand` recognises the provider prefixes only, so a Supabase
         * outage fails its target without feeding the breaker that would cancel the
         * rest of the job.
         */
        const enforcePostPhaseGates = (ctx: BrandWaveContext): void => {
          const decision =
            evaluateLlmProviderGate(ctx.state.phaseResults) ??
            evaluateStorageGate(ctx.state.phaseResults);
          if (!decision) {
            return;
          }
          if (decision.action === "warn") {
            // Kill switch (CURATION_PROVIDER_GATE=off) is engaged.
            onProgress(
              `  [LLM-GATE OFF] ${ctx.brand.slug}: ${decision.message}`,
            );
            return;
          }
          throw new Error(decision.message);
        };

        // ---- Loop A: detect application → acquire → Gate A → Gate B →
        //      name candidates. Ends at the batched `names` call below. ----
        await mapWithConcurrency(
          chunk,
          ENRICH_BRAND_CONCURRENCY,
          async (brand, brandOffset) => {
            // Cooperative abort: the breaker tripped while earlier targets in this
            // chunk were running. Return WITHOUT recording anything — the target
            // stays `pending`/`running` so `runJob` can sweep it to `cancelled`,
            // which is what makes it eligible for Resume later.
            if (llmBreakerTripped) return;

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
              acquireResult: null,
              urlExtracted: {},
              currentPhase: undefined,
              completed: false,
              satisfiedPhaseSet: new Set(),
            };
            brandContexts.set(brand.id, ctx);
            const state = ctx.state;

            // ---- Satisfaction check (history-based) --------------------------
            const history = await fetchPhaseHistory(
              supabase as unknown as SupabaseClient,
              'submission',
              brand.id,
            );
            const { skipped: satisfiedSkips } = filterSatisfiedPhases(
              phases as EnrichPhaseName[],
              history,
              ctx.overwrite,
            );
            ctx.satisfiedPhaseSet = new Set(satisfiedSkips.map((s) => s.phase));
            for (const skip of satisfiedSkips) {
              state.phaseResults.push(buildPhaseResult(skip.phase, "skipped", [], 0, undefined, "phase output already satisfied"));
              await logCurrentPhase(ctx, state.phaseResults[state.phaseResults.length - 1]);
            }
            if (satisfiedSkips.length > 0) {
              onProgress(`  [SATISFACTION] ${brand.slug}: skipped ${satisfiedSkips.map((s) => s.phase).join(", ")} (already satisfied)`);
            }

            await emitTargetProgress(ctx, "running");

            try {
              const satisfiedPhaseSet = ctx.satisfiedPhaseSet;

              // ---- Detect application ----
              let detectApplication: ReturnType<typeof applyDetectResult> | undefined;
              if (!satisfiedPhaseSet.has("detect")) {
                detectApplication = applyDetectResult(
                  ctx.detectResult,
                  brand,
                  phases,
                );
                if (hasDetectPhases) {
                  await markCurrentPhase(ctx, "detect");
                  const detectEntry = detectProviderFailure
                    ? {
                        ...detectPhaseResult.phaseResult,
                        changedFields: [],
                      }
                    : detectApplication.phaseResult;
                  state.phaseResults.push(detectEntry);
                  await logCurrentPhase(ctx, detectEntry);
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
                      categorySlug: detectResult?.categorySlug ?? null,
                      confidence: detectResult?.confidence ?? "high",
                    });
                  }

                  await recordOutcome(ctx, {
                    slug: brand.slug,
                    name: getDisplayBrandName(brand),
                    ...(target === "submissions"
                      ? { submissionId: brand.id }
                      : {}),
                    status: "skipped",
                    changedFields: changedFieldsFromPhaseResults(
                      state.phaseResults,
                    ),
                    phaseResults: state.phaseResults,
                    error: skipReason,
                  });
                  result.skipped += 1;
                  finishBrand(ctx);
                  return;
                }
              }

              // ---- Link expansion patch + no-purchase-channel gate ----
              const expansion = linkExpansionByBrandId.get(brand.id);
              if (expansion) {
                appendPatch(state, expansion.patch);
              }
              if (!hasPurchaseChannel(brand)) {
                // The verdict finalizer reads this back off the trace, so the
                // per-source outcomes and the evidence verdict travel WITH the
                // skip rather than being recomputed later from a summary that
                // no longer knows which source failed.
                const evidence = computeEvidence(
                  expansion?.sources,
                  expansion?.serpCallStatuses ?? [],
                );
                const instagramFollowers = probeEvidenceByBrandId
                  .get(brand.id)
                  ?.find(
                    (probe) => typeof probe.instagramFollowers === 'number',
                  )?.instagramFollowers;
                const noChannelDetail = buildNoChannelDetail(
                  expansion?.sources,
                  evidence,
                  instagramFollowers,
                );
                onProgress(
                  `  [NO-CHANNEL] ${brand.slug}: ${noChannelDetail}`,
                );

                // New submissions get a triage row; refreshes do not (the brand
                // already exists). Mirrors the listing_reject path.
                if (brand.intent !== 'refresh' && !config.dryRun) {
                  await insertTriageResult({
                    brandId: brand.id,
                    target: { type: targetType, id: brand.id },
                    isNonBrand: true,
                    nonBrandReason: `no_purchase_channel: ${noChannelDetail}`,
                    slugGenerated: null,
                    categorySlug: null,
                    confidence: 'medium',
                  });
                }

                const noChannelError = `no_purchase_channel: ${noChannelDetail}`;
                state.phaseResults.push({
                  ...buildPhaseResult('acquire', 'skipped', [], 0, noChannelError),
                  ...(expansion
                    ? {
                        linkExpansion: {
                          ...expansion.linkExpansion,
                          evidence,
                          ...(instagramFollowers !== undefined
                            ? { instagramFollowers }
                            : {}),
                        },
                      }
                    : {}),
                });
                await recordOutcome(ctx, {
                  slug: brand.slug,
                  name: getDisplayBrandName(brand),
                  ...(target === 'submissions'
                    ? { submissionId: brand.id }
                    : {}),
                  status: 'skipped',
                  changedFields: changedFieldsFromPhaseResults(
                    state.phaseResults,
                  ),
                  phaseResults: state.phaseResults,
                  error: noChannelError,
                });
                result.skipped += 1;
                finishBrand(ctx);
                return;
              }

              // Populate SERP-derived data from cached search results
              if (searchResults.size > 0) {
                const searchResult = searchResults.get(
                  getDisplayBrandName(brand),
                ) ?? { urls: [], snippets: [] };
                state.discoveredUrls = uniqueUrls(
                  searchResult.urls.filter(
                    (url) => !state.knownUrls.includes(url),
                  ),
                );
                state.serpSnippets = searchResult.snippets;
                state.serpEntries = searchResult.entries ?? [];
              }

              ctx.urlExtracted = extractLinksFromUrls(
                state.discoveredUrls,
                getDisplayBrandName(brand),
              );

              // `clean` is DEFERRED and no longer scheduled: `applyChunkNameCleanup`
              // (run once per chunk, above) already normalizes the name and its
              // result is the `cleaned` name candidate below.

              // ---- Acquire (replaces links + images + classify + quarantine) ----
              let acquireResult: Awaited<ReturnType<typeof runAcquirePhase>> | undefined;
              if (!satisfiedPhaseSet.has("acquire")) {
                await markCurrentPhase(ctx, "acquire");
                acquireResult = await runAcquirePhase({
                  brand,
                  phases,
                  discoveredUrls: state.discoveredUrls,
                  knownUrls: state.knownUrls,
                  dryRun: config.dryRun,
                  target: { type: targetType, id: brand.id },
                  jobId: config.jobId,
                  renderProvider: config.renderProvider,
                  budgetScale: config.budgetScale,
                  linkExpansion: expansion?.linkExpansion,
                });
                ctx.acquireResult = acquireResult;
                state.phaseResults.push(acquireResult.phaseResult);
                await logCurrentPhase(ctx, acquireResult.phaseResult);
                state.scrapedData = acquireResult.scrapedData ?? {};
                appendPatch(state, acquireResult.patch);
              }

              // Gate A — acquire provider failure means no input for downstream
              const providerGate = evaluateProviderGate({
                acquireResult: acquireResult?.phaseResult,
              });
              if (providerGate) {
                if (providerGate.action === "warn") {
                  onProgress(
                    `  [PROVIDER-GATE OFF] ${brand.slug}: ${providerGate.message}`,
                  );
                } else {
                  throw new Error(providerGate.message);
                }
              }

              // Gate B — nothing downstream can consume
              if (
                hasNoEnrichmentInputs({
                  knownUrls: state.knownUrls,
                  acquireResult: acquireResult
                    ? {
                        scrapedData: acquireResult.scrapedData,
                        scrapedImageUrls: acquireResult.scrapedImageUrls,
                      }
                    : undefined,
                })
              ) {
                enforcePostPhaseGates(ctx);

                weakBrandCount += 1;
                onProgress(
                  `  [WEAK-BRAND] ${brand.slug}: no useful data found`,
                );
                await recordOutcome(ctx, {
                  slug: brand.slug,
                  name: getDisplayBrandName(brand),
                  ...(target === "submissions"
                    ? { submissionId: brand.id }
                    : {}),
                  status: "skipped",
                  changedFields: changedFieldsFromPhaseResults(
                    state.phaseResults,
                  ),
                  phaseResults: state.phaseResults,
                  error:
                    "No usable enrichment inputs: acquire found no evidence and no known URLs",
                });
                result.skipped += 1;
                finishBrand(ctx);
                return;
              }

              // ---- Names phase (per-brand) ----
              const candidates: NameCandidate[] = [
                {
                  source: "stored",
                  value:
                    nameCleanups.get(brand.id)?.originalName ??
                    getDisplayBrandName(brand),
                },
              ];
              // `applyChunkNameCleanup` only records a brand when the cleanup
              // actually changed the name, which is exactly the condition the
              // retired `clean` phase used to emit `cleanedName` under.
              const cleanedName = nameCleanups.get(brand.id)?.cleanedName;
              if (cleanedName) {
                candidates.push({
                  source: "cleaned",
                  value: cleanedName,
                });
              }
              if (detectApplication?.brandName) {
                candidates.push({
                  source: "detected",
                  value: detectApplication.brandName,
                });
              }
              if (acquireResult?.officialNameCandidates.length) {
                candidates.push(...acquireResult.officialNameCandidates);
              }
              const brandNameCandidateInput: NameCandidateInput = {
                candidates,
                snippets: state.serpSnippets,
              };
              nameCandidates.set(brand.id, brandNameCandidateInput);
            } catch (err) {
              await failBrand(ctx, err);
            }
          },
        );

        // ---- Names: ONE arbiter call for the whole chunk -----------------
        // The second of the two batch points. Between the loops rather than
        // inside one, because the arbiter is only worth its price when it sees
        // every brand's candidates at once: called per brand it was 20 requests
        // per chunk for the work of one (F9).
        //
        // Built from the SURVIVORS only. A brand that left in loop A — non-brand,
        // Gate A, Gate B, or an error — already carries a terminal outcome, and
        // handing it to the arbiter would pay for a verdict nothing can apply.
        const survivingContexts = chunk
          .map((brand) => brandContexts.get(brand.id))
          .filter(
            (entry): entry is BrandWaveContext =>
              entry !== undefined && !entry.completed,
          );
        const namesContexts: BrandWaveContext[] = llmBreakerTripped
          ? []
          : survivingContexts.filter(
              (entry) => !entry.satisfiedPhaseSet.has("names"),
            );
        let namesResult: Awaited<ReturnType<typeof runNamesPhase>> | undefined;
        if (namesContexts.length > 0) {
          const namesChunk = namesContexts.map((entry) => entry.brand);
          namesResult = await runNamesPhase(
            {
              ...batchContext,
              chunk: namesChunk,
              chunkBrandNames: namesChunk.map(getDisplayBrandName),
            },
            nameCandidates,
          );
        }

        // ---- Loop B: names verdict → editorial → products → tags → persist
        const loopBContexts: BrandWaveContext[] = llmBreakerTripped
          ? []
          : survivingContexts;
        await mapWithConcurrency(
          loopBContexts,
          ENRICH_BRAND_CONCURRENCY,
          async (ctx) => {
            // Same cooperative abort as loop A: the breaker can trip on a brand
            // that ran while this one was queued.
            if (llmBreakerTripped) return;

            const brand = ctx.brand;
            const state = ctx.state;
            const overwrite = ctx.overwrite;
            const satisfiedPhaseSet = ctx.satisfiedPhaseSet;
            const acquireResult = ctx.acquireResult ?? undefined;

            try {
              // ---- Names verdict (from the batch above) ------------------
              if (namesResult && !satisfiedPhaseSet.has("names")) {
                await markCurrentPhase(ctx, "names");
                const candidates =
                  nameCandidates.get(brand.id)?.candidates ?? [];
                const application = phases.includes("names")
                  ? applyNamesResult(
                      namesResult.verdicts.get(brand.id),
                      brand,
                      candidates,
                    )
                  : { phaseResult: namesResult.phaseResult, patch: {} };
                const namesEntry = namesResult.providerFailure
                  ? { ...namesResult.phaseResult, changedFields: [] }
                  : application.phaseResult;
                state.phaseResults.push(namesEntry);
                await logCurrentPhase(ctx, namesEntry);
                appendPatch(state, application.patch);
              }

              // ---- Editorial agent (descriptions + stockists + faq) --------
              // When at least one editorial sub-phase is unsatisfied, run the
              // editorial agent which wraps all three phases with cross-output
              // validation and repair. When EDITORIAL_AGENT=off the agent
              // returns a fallback and we fall through to the individual calls.
              //
              // Track whether descriptions ran so downstream listing-verdict and
              // ai-result attachment logic can reference its output safely.
              let descriptionsResult:
                | Awaited<ReturnType<typeof runDescriptionsPhase>>
                | undefined;

              const editorialUnsatisfied =
                !satisfiedPhaseSet.has("descriptions") ||
                !satisfiedPhaseSet.has("stockists") ||
                !satisfiedPhaseSet.has("faq");

              if (editorialUnsatisfied) {
                // Filter out satisfied phases so the editorial agent skips them
                const editorialPhases = (phases as EditorialEnrichPhase[]).filter(
                  (p) => !satisfiedPhaseSet.has(p),
                );
                const editorialInput: EditorialInput = {
                  brand: brand as EditorialEnrichBrand,
                  phases: editorialPhases,
                  scrapedData: state.scrapedData,
                  serpSnippets: state.serpSnippets,
                  overwrite,
                  dryRun: config.dryRun,
                  target: { type: targetType, id: brand.id },
                  jobId: config.jobId,
                  pendingPatch: state.patches as EditorialEnrichPatch,
                  explicitPhases: config.explicitPhases ?? [],
                };

                // Real validators, one repair turn, and the evidence tool —
                // `buildEditorialDeps` owns all three. What shipped instead was a
                // validator that always answered with an empty array and a repair
                // that echoed its patch back (F11), which left the graph's
                // validate -> repair edge unreachable and `LLM_PROFILES.editorial`
                // never resolved.
                const editorialDeps = buildEditorialDeps({
                  runDescriptions: async (input) => {
                    const result = await runDescriptionsPhase({
                      brand: input.brand,
                      phases: input.phases,
                      serpSnippets: input.serpSnippets,
                      overwrite: input.overwrite,
                      dryRun: input.dryRun,
                      target: input.target,
                      jobId: input.jobId,
                      pendingPatch: input.pendingPatch,
                    });
                    return {
                      phaseResult: result.phaseResult,
                      patch: result.patch,
                      descriptionRewrite: result.descriptionRewrite,
                      brandFacts: result.brandFacts,
                      attempts: result.attempts,
                      factsAttempts: result.factsAttempts,
                      listingVerdict: result.listingVerdict,
                    };
                  },
                  runStockists: async (input) => {
                    const result = await runStockistsPhase({
                      brand: input.brand,
                      phases: input.phases,
                      scrapedData: input.scrapedData ?? undefined,
                      overwrite: input.overwrite,
                      dryRun: input.dryRun,
                      target: input.target,
                      jobId: input.jobId,
                    });
                    return { phaseResult: result.phaseResult, patch: result.patch };
                  },
                  runFaq: async (input) => {
                    const result = await runFaqPhase({
                      brand: input.brand,
                      phases: input.phases,
                      serpSnippets: input.serpSnippets,
                      scrapedData: input.scrapedData ?? null,
                      overwrite: input.overwrite,
                      dryRun: input.dryRun,
                      target: input.target,
                      jobId: input.jobId,
                      explicitPhases: input.explicitPhases ?? [],
                    });
                    return { phaseResult: result.phaseResult, patch: result.patch };
                  },
                  brandName: getDisplayBrandName(brand),
                  audit: {
                    ...(config.jobId ? { jobId: config.jobId } : {}),
                    target: { type: targetType, id: brand.id },
                    modelName: resolveProfileModel("editorial"),
                  },
                  // The run's own client, so the evidence tool reads the pack
                  // this job wrote rather than opening a second connection.
                  supabase: supabase as unknown as SupabaseClient,
                });

                const editorialOutput = await runEditorialAgent(editorialInput, editorialDeps);

                if (editorialOutput.agentOutcome !== "fallback") {
                  // Agent ran — apply its results
                  for (const pr of editorialOutput.phaseResults) {
                    state.phaseResults.push(pr);
                    await logCurrentPhase(ctx, pr);
                  }
                  appendPatch(state, editorialOutput.patch);

                  // Extract descriptions-specific output for downstream logic
                  const descriptionsPhaseResult = editorialOutput.phaseResults.find(
                    (pr) => pr.phase === "descriptions",
                  );
                  if (descriptionsPhaseResult) {
                    descriptionsResult = {
                      phaseResult: descriptionsPhaseResult,
                      patch: editorialOutput.patch,
                      descriptionRewrite: editorialOutput.descriptionRewrite,
                      brandFacts: editorialOutput.brandFacts,
                      attempts: editorialOutput.attempts,
                      factsAttempts: editorialOutput.factsAttempts,
                      listingVerdict: editorialOutput.listingVerdict,
                    };
                  }

                  // Category derivation from subcategories (same logic as before)
                  if (descriptionsResult) {
                    const effectiveCategory =
                      typeof descriptionsResult.patch.category === "string"
                        ? descriptionsResult.patch.category
                        : typeof state.patches.category === "string"
                          ? state.patches.category
                          : brand.category;
                    const effectiveSubcategories = Array.isArray(
                      descriptionsResult.patch.subcategories,
                    )
                      ? descriptionsResult.patch.subcategories.filter(
                          (tag): tag is string => typeof tag === "string",
                        )
                      : (brand.subcategories ?? []);
                    if (
                      descriptionsResult.phaseResult.status === "succeeded" &&
                      !effectiveCategory
                    ) {
                      const derivedCategory = deriveCategoryFromSubcategories(
                        effectiveSubcategories,
                      );
                      if (derivedCategory) {
                        appendPatch(state, { category: derivedCategory });
                        // Mutate the phase result in-place so the outcome carries
                        // the derived category field
                        descriptionsResult.phaseResult.changedFields = [
                          ...new Set([
                            ...descriptionsResult.phaseResult.changedFields,
                            "category",
                          ]),
                        ];
                        onProgress(
                          `  [CATEGORY] ${brand.slug}: derived ${derivedCategory} from subcategories`,
                        );
                      }
                    }

                    // Stage-2 listing gate
                    const listingVerdict = descriptionsResult.listingVerdict;
                    const listingReason =
                      listingVerdict?.reason ??
                      "Listing check rejected this brand (no reason given)";
                    if (listingVerdict?.verdict === "reject") {
                      onProgress(
                        `  [NOT-LISTABLE] ${brand.slug}: ${listingReason} (taiwan_connection=${listingVerdict.taiwanConnection ?? "unknown"}, own_products=${listingVerdict.hasOwnProducts ?? "unknown"}, purchase_channel=${listingVerdict.hasPurchaseChannel ?? "unknown"})`,
                      );

                      if (target === "submissions") {
                        if (!config.dryRun) {
                          await insertTriageResult({
                            brandId: brand.id,
                            target: { type: targetType, id: brand.id },
                            isNonBrand: true,
                            nonBrandReason: `listing_reject: ${listingReason}`,
                            slugGenerated: null,
                            categorySlug:
                              (typeof descriptionsResult.patch.category === "string"
                                ? descriptionsResult.patch.category
                                : brand.category) ?? null,
                            confidence: "medium",
                          });
                        }

                        await recordOutcome(ctx, {
                          slug: brand.slug,
                          name: getDisplayBrandName(brand),
                          submissionId: brand.id,
                          status: "skipped",
                          changedFields: changedFieldsFromPhaseResults(
                            state.phaseResults,
                          ),
                          phaseResults: state.phaseResults,
                          error: `Listing check rejected this submission: ${listingReason}`,
                        });
                        result.skipped += 1;
                        finishBrand(ctx);
                        return;
                      }
                    }
                  }
                } else {
                  // Fallback: EDITORIAL_AGENT=off or agent error — run individual phases
                  if (!satisfiedPhaseSet.has("descriptions")) {
                    await markCurrentPhase(ctx, "descriptions");
                    descriptionsResult = await runDescriptionsPhase({
                      brand,
                      phases,
                      serpSnippets: state.serpSnippets,
                      overwrite,
                      dryRun: config.dryRun,
                      target: { type: targetType, id: brand.id },
                      jobId: config.jobId,
                      pendingPatch: state.patches,
                    });
                    const effectiveCategory =
                      typeof descriptionsResult.patch.category === "string"
                        ? descriptionsResult.patch.category
                        : typeof state.patches.category === "string"
                          ? state.patches.category
                          : brand.category;
                    const effectiveSubcategories = Array.isArray(
                      descriptionsResult.patch.subcategories,
                    )
                      ? descriptionsResult.patch.subcategories.filter(
                          (tag): tag is string => typeof tag === "string",
                        )
                      : (brand.subcategories ?? []);
                    if (
                      descriptionsResult.phaseResult.status === "succeeded" &&
                      !effectiveCategory
                    ) {
                      const derivedCategory = deriveCategoryFromSubcategories(
                        effectiveSubcategories,
                      );
                      if (derivedCategory) {
                        descriptionsResult.patch.category = derivedCategory;
                        descriptionsResult.phaseResult.changedFields = [
                          ...new Set([
                            ...descriptionsResult.phaseResult.changedFields,
                            "category",
                          ]),
                        ];
                        onProgress(
                          `  [CATEGORY] ${brand.slug}: derived ${derivedCategory} from subcategories`,
                        );
                      }
                    }
                    const listingVerdict = descriptionsResult.listingVerdict;
                    const listingReason =
                      listingVerdict?.reason ??
                      "Listing check rejected this brand (no reason given)";
                    if (listingVerdict?.verdict === "reject") {
                      onProgress(
                        `  [NOT-LISTABLE] ${brand.slug}: ${listingReason} (taiwan_connection=${listingVerdict.taiwanConnection ?? "unknown"}, own_products=${listingVerdict.hasOwnProducts ?? "unknown"}, purchase_channel=${listingVerdict.hasPurchaseChannel ?? "unknown"})`,
                      );
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
                        if (!config.dryRun) {
                          await insertTriageResult({
                            brandId: brand.id,
                            target: { type: targetType, id: brand.id },
                            isNonBrand: true,
                            nonBrandReason: `listing_reject: ${listingReason}`,
                            slugGenerated: null,
                            categorySlug: effectiveCategory ?? null,
                            confidence: "medium",
                          });
                        }

                        await recordOutcome(ctx, {
                          slug: brand.slug,
                          name: getDisplayBrandName(brand),
                          submissionId: brand.id,
                          status: "skipped",
                          changedFields: changedFieldsFromPhaseResults(
                            state.phaseResults,
                          ),
                          phaseResults: state.phaseResults,
                          error: `Listing check rejected this submission: ${listingReason}`,
                        });
                        result.skipped += 1;
                        finishBrand(ctx);
                        return;
                      }
                    }
                  }

                  if (!satisfiedPhaseSet.has("stockists")) {
                    await markCurrentPhase(ctx, "stockists");
                    const stockistsResult = await runStockistsPhase({
                      brand,
                      phases,
                      scrapedData: state.scrapedData,
                      overwrite,
                      dryRun: config.dryRun,
                      target: { type: targetType, id: brand.id },
                      jobId: config.jobId,
                    });
                    state.phaseResults.push(stockistsResult.phaseResult);
                    await logCurrentPhase(ctx, stockistsResult.phaseResult);
                    appendPatch(state, stockistsResult.patch);
                  }

                  if (!satisfiedPhaseSet.has("faq")) {
                    await markCurrentPhase(ctx, "faq");
                    const faqResult = await runFaqPhase({
                      brand,
                      phases,
                      serpSnippets: state.serpSnippets,
                      scrapedData: state.scrapedData,
                      overwrite,
                      dryRun: config.dryRun,
                      target: { type: targetType, id: brand.id },
                      jobId: config.jobId,
                      explicitPhases: config.explicitPhases ?? [],
                    });
                    state.phaseResults.push(faqResult.phaseResult);
                    await logCurrentPhase(ctx, faqResult.phaseResult);
                    appendPatch(state, faqResult.patch);
                  }
                }
              }

              if (!satisfiedPhaseSet.has("products")) {
                await markCurrentPhase(ctx, "products");
                const productsTarget: EnrichmentTarget = {
                  type: targetType,
                  id: brand.id,
                };
                // Acquire's own pool when it ran this time; the target's stored
                // active images when it was satisfied from history. Never `[]`
                // by default — an empty pool passes every image check.
                //
                // The history read is skipped when `products` is out of scope:
                // the phase refuses immediately in that case, so the query would
                // buy nothing and would run once per brand.
                const imagePool =
                  acquireResult?.imagePool ??
                  (phases.includes("products")
                    ? await loadImagePoolFromHistory(supabase, productsTarget)
                    : []);
                const productsResult = await runProductsPhase({
                  brand,
                  phases,
                  scrapedData: state.scrapedData,
                  // The site the earlier phases resolved — or REVOKED. Reading the
                  // pre-run snapshot instead would mine a contaminated website.
                  pendingPatch: state.patches,
                  dryRun: config.dryRun,
                  target: productsTarget,
                  jobId: config.jobId,
                  // Everything acquire learned about where this brand's products
                  // and images live. Hard-coded empty before (F6), which is why
                  // the agent never rendered a page it had a reason to render.
                  imagePool,
                  catalogResult: acquireResult?.catalogResult,
                  acquisitionPageUrls: acquireResult?.acquisitionPageUrls ?? [],
                  renderProvider: config.renderProvider,
                });
                state.phaseResults.push(productsResult.phaseResult);
                await logCurrentPhase(ctx, productsResult.phaseResult);
                // The proposals ride the patch as `products`, which
                // `mergeSubmissionEnrichedData` replaces rather than unions. No target
                // type is added and no row is written here: materialization is the
                // moderator's approval.
                appendPatch(state, productsResult.patch);
              }

              let classification: ClassificationResult | null = null;
              let hasCompletedTagClassification = false;
              if (
                !satisfiedPhaseSet.has("tags") &&
                !(
                  phases.includes("descriptions") &&
                  state.serpSnippets.length > 0
                ) &&
                phases.includes("tags")
              ) {
                classification = batchClassifications.get(brand.slug) ?? null;
                // The standalone classification is batched like detect, so its
                // provider failure has to be grafted onto each brand here or Gate C
                // would see a tags-only run as having attempted no LLM phase at all.
                if (!classification && tagsProviderFailure) {
                  const tagsEntry: PhaseResult = {
                    ...standaloneClassificationResult.phaseResult,
                    changedFields: [],
                  };
                  state.phaseResults.push(tagsEntry);
                  await logCurrentPhase(ctx, tagsEntry);
                }
              }

              if (classification) {
                await markCurrentPhase(ctx, "tags");
                const tagStartedAt = Date.now();
                hasCompletedTagClassification = true;
                if (classification.categorySlug !== brand.category) {
                  appendPatch(state, { category: classification.categorySlug });
                  const tagPhaseResult = buildPhaseResult(
                    "tags",
                    "succeeded",
                    ["category"],
                    Date.now() - tagStartedAt,
                  );
                  state.phaseResults.push(tagPhaseResult);
                  await logCurrentPhase(ctx, tagPhaseResult);
                  onProgress(
                    `  [CATEGORY] ${brand.slug}: ${brand.category ?? "null"} → ${classification.categorySlug} (${classification.confidence})`,
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
                    `  [CATEGORY] ${brand.slug}: ${brand.category ?? "null"} (unchanged)`,
                  );
                }
              }

              const patch = state.patches;
              const patchKeys = Object.keys(patch);
              if (patchKeys.length > 0) {
                for (const key of patchKeys) {
                  const val = (patch as Record<string, unknown>)[key];
                  onProgress(formatEnrichPatchField(key, val));
                }
              }

              const changedFields = changedFieldsFromPhaseResults(
                state.phaseResults,
              );

              if (
                !hasMaterialPatchValues(patch, {
                  productsScopedRun: isProductsScopedRun(phases),
                }) &&
                !hasCompletedTagClassification
              ) {
                // Gate C: "every LLM phase died at the provider" and "every LLM
                // phase ran and found nothing new" produce the identical empty
                // patch. Recording the first as `skipped` is the exact shape of the
                // 2026-08-02 incident, so it has to be checked before the skip.
                enforcePostPhaseGates(ctx);

                if (state.discoveredUrls.length <= 1) {
                  weakBrandCount += 1;
                  onProgress(
                    `  [WEAK-BRAND] ${brand.slug}: no useful data found (no enrichment changes)`,
                  );
                }
                if (!config.dryRun && descriptionsResult) {
                  if (descriptionsResult.attempts.length > 0) {
                    await attachDescriptionAiResults(
                      descriptionsResult.attempts,
                      { type: targetType, id: brand.id },
                      config.jobId,
                    );
                  }
                  if (descriptionsResult.factsAttempts.length > 0) {
                    await attachFactsAiResults(
                      descriptionsResult.factsAttempts,
                      { type: targetType, id: brand.id },
                      config.jobId,
                    );
                  }
                }
                const skippedOutcome: BrandOutcome = {
                  slug: brand.slug,
                  name: getDisplayBrandName(brand),
                  ...(target === "submissions"
                    ? { submissionId: brand.id }
                    : {}),
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

              // Gate C on the success path. A patch built entirely by the non-LLM
              // phases (links, clean, images) is still a real patch, so this brand
              // would have persisted and reported `succeeded` while every LLM phase
              // it ran was talking to a dead account.
              enforcePostPhaseGates(ctx);

              await config.onPatch?.({
                targetId: brand.id,
                targetType: targetType as "submission" | "brand",
                slug: brand.slug,
                name: getDisplayBrandName(brand),
                patch: patch as Record<string, unknown>,
                phaseResults: state.phaseResults,
              });

              if (!config.dryRun) {
                const detectResult = ctx.detectResult;
                if (detectResult) {
                  await insertTriageResult({
                    brandId: brand.id,
                    target: { type: targetType, id: brand.id },
                    isNonBrand: false,
                    nonBrandReason: null,
                    slugGenerated: detectResult.slugGenerated,
                    categorySlug: detectResult.categorySlug,
                    confidence: detectResult.confidence,
                  });
                }
                if (descriptionsResult) {
                  if (descriptionsResult.attempts.length > 0) {
                    await attachDescriptionAiResults(
                      descriptionsResult.attempts,
                      { type: targetType, id: brand.id },
                      config.jobId,
                    );
                  }
                  if (descriptionsResult.factsAttempts.length > 0) {
                    await attachFactsAiResults(
                      descriptionsResult.factsAttempts,
                      { type: targetType, id: brand.id },
                      config.jobId,
                    );
                  }
                }
                if (classification) {
                  await insertClassificationResult({
                    brandId: brand.id,
                    target: { type: targetType, id: brand.id },
                    categorySlug: classification.categorySlug,
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
                    ...(target === "submissions"
                      ? { submissionId: brand.id }
                      : {}),
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

        // Safe to throw only here: `mapWithConcurrency` above has resolved, so no
        // callback is still writing, and the progress batch has been flushed. That
        // is why `runJob`'s sweep of the remaining targets races nothing and needs
        // no fencing RPC.
        if (llmBreakerTripped) {
          throw new LlmCircuitBreakerError(consecutiveLlmProviderFailures);
        }
      }

      if (weakBrandCount > 0) {
        onProgress(
          `\n[WEAK-BRAND SUMMARY] ${weakBrandCount} brand(s) had no usable enrichment inputs — review for potential non-brands`,
        );
      }

      const enrichResult = finishEnrichResult(result, startedAt, onProgress);

      // Update Langfuse trace status before returning
      try {
        if (langfuseTrace) {
          (langfuseTrace as { update: (input: Record<string, unknown>) => void }).update({
            metadata: { status: enrichResult.errors.length ? "failed" : "succeeded" },
          });
        }
      } catch {
        // Langfuse errors must never block production
      }

      return enrichResult;
      }); // runWithAuditContext
    },
  );
}
