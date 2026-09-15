import type { SupabaseClient } from "@supabase/supabase-js";
import type { ENRICH_PHASES } from "@/lib/constants/enrich-phases";
import type { BrandFlatLinkColumns } from "@/lib/types";
import type {
  CurationConfig,
  PhaseResult,
  PhaseResultStatus,
} from "@/lib/types/curation";
import type { Database } from "@/lib/supabase/database.types";
import type { ScrapedBrandData } from "@/lib/types/scraper";
import type { EnrichmentTarget } from "../_shared/enrichment-target";
import type { SearchCallStatus } from "../search-results";
import type { BrandSearchEntry } from "./scraper/types";
import type {
  BrandNameProposal,
  CuratedProductProposal,
  SubmissionFaqPatch,
} from "@/lib/types/enriched-data";
import { LINK_FIELD_TO_COLUMN } from "@/lib/types/link-fields";

export type EnrichPhase = (typeof ENRICH_PHASES)[number];

export type EnrichBrand = {
  id: string;
  source_brand_id?: string | null;
  slug: string;
  name?: string;
  status?: string | null;
  description?: string | null;
  description_en?: string | null;
  blurb?: string | null;
  blurb_en?: string | null;
  subcategories?: string[] | null;
  subcategories_en?: string[] | null;
  founding_year?: number | null;
  city?: string | null;
  site_content?: unknown | null;
  category?: string | null;
  purchase_website?: string | null;
  purchaseWebsite?: string | null;
  hero_image_url?: string | null;
  product_images?: string[] | null;
  heroImageUrl?: string | null;
  productPhotos?: string[] | null;
  // Set per brand by curation-operations; phases read it to decide whether to
  // regenerate rather than gap-fill.
  overwrite_enrichment?: boolean;
  website_url?: string | null;
  intent?: string | null;
} & Partial<BrandFlatLinkColumns>;

export type SearchPhaseResult = {
  urls: string[];
  snippets: string[];
  entries?: BrandSearchEntry[];
  rawEntries?: unknown;
  auditResultId?: string;
  callStatus?: SearchCallStatus;
  httpStatus?: number | null;
  error?: string | null;
  latencyMs?: number | null;
  /**
   * True when the result was replayed from `brand_search_results` instead of a
   * live provider call. `callStatus` is copied verbatim from the stored row, so
   * a cached row can carry `failed` from an outage that ended days ago —
   * callers must not read that as a live provider failure.
   */
  fromCache?: boolean;
};

/**
 * True when the search provider itself failed, so the absence of results says
 * nothing about the target. Callers use this to hard-fail a target instead of
 * reading an outage as "no results found".
 *
 * `malformed` is deliberately EXCLUDED and must never hard-fail a target: it
 * fires both on a genuine provider fault and on a response shape we simply
 * failed to anticipate. Treating it as a provider failure would hard-fail
 * brands whose payload is merely unusual. Do not add it.
 */
export function isProviderFailure(status?: SearchCallStatus): boolean {
  return (
    status === "failed" || status === "timeout" || status === "network_error"
  );
}

export type EnrichScrapedData = Partial<ScrapedBrandData> &
  Partial<BrandFlatLinkColumns> & {
    snippets?: string[];
  };

export type EnrichPatch = Partial<BrandFlatLinkColumns> &
  Partial<{
    description: string | null;
    description_en: string | null;
    city: string | null;
    hero_image_url: string | null;
    name: string;
    reputation_summary: unknown;
    subcategories: string[] | null;
    category: string | null;
    slug: string;
    blurb: string | null;
    blurb_en: string | null;
    founding_year: number | null;
    subcategories_en: string[] | null;
    /**
     * Sentinel key, not a brand column: the columns this run affirmatively
     * determined should be EMPTY. `resolveRefreshEnrichmentPatch` routes it
     * around the per-field loop and filters its entries instead, so it must be
     * representable on the patch a phase hands back. See `CLEARED_FIELDS_KEY`
     * in `brand-write-policy`.
     */
    _cleared_fields: string[];
    /** Internal refresh-only proposal; never a brand column. */
    _name_proposal: BrandNameProposal;
    /** FAQ entries proposed by the enrichment run; materialized at apply time. */
    faq: SubmissionFaqPatch;
    /** Storage path for the hero image, written by acquire for submission targets. */
    hero_image_storage_path: string | null;
    /** Curated product proposals, written by the products phase. */
    products: CuratedProductProposal[];
  }>;

// ---------------------------------------------------------------------------
// Phase output registry — typed slots, merge order, deposit/build helpers
// ---------------------------------------------------------------------------

/**
 * Each phase writes into a narrowly-typed slot so the patch cannot carry keys
 * the phase has no authority to set. The mapped type is the *shape* of each
 * slot; actual runtime validation is done by `depositPhaseOutput`.
 */
export type PhaseOutputSlots = {
  detect: Partial<Pick<EnrichPatch, "slug">>;
  linkExpansion: Partial<BrandFlatLinkColumns>;
  acquire: Partial<BrandFlatLinkColumns> &
    Partial<
      Pick<
        EnrichPatch,
        "hero_image_url" | "hero_image_storage_path" | "_cleared_fields"
      >
    >;
  names: Partial<Pick<EnrichPatch, "name" | "_name_proposal">>;
  editorial: Partial<
    Pick<
      EnrichPatch,
      | "description"
      | "description_en"
      | "city"
      | "blurb"
      | "blurb_en"
      | "subcategories"
      | "subcategories_en"
      | "category"
      | "founding_year"
      | "_cleared_fields"
      | "faq"
    >
  >;
  categoryDerivation: Partial<Pick<EnrichPatch, "category">>;
  products: Partial<Pick<EnrichPatch, "products">>;
};

export type PhaseOutputRegistry = {
  [K in keyof PhaseOutputSlots]?: PhaseOutputSlots[K];
};

// Order matters: names MUST follow linkExpansion and acquire — both may
// produce `name`, and the DEV-1321 incident was caused by the two precedence
// mechanisms disagreeing on merge order.
export const MERGE_ORDER: readonly (keyof PhaseOutputSlots)[] = [
  "detect",
  "linkExpansion",
  "acquire",
  "names",
  "editorial",
  "categoryDerivation",
  "products",
] as const;

/** Runtime key set derived from link-fields registry + the social/other columns. */
const BRAND_FLAT_LINK_KEYS: ReadonlySet<string> = new Set([
  ...Object.values(LINK_FIELD_TO_COLUMN),
  "other_urls",
]);

// Each typed-keys array uses `satisfies` so tsc rejects any string that
// isn't a key of the corresponding slot type. linkExpansion and acquire
// incorporate BRAND_FLAT_LINK_KEYS (runtime-derived) so their link columns
// are validated structurally via BrandFlatLinkColumns, not per-string.
const DETECT_KEYS = [
  "slug",
] as const satisfies readonly (keyof PhaseOutputSlots["detect"] & string)[];
const NAMES_KEYS = [
  "name",
  "_name_proposal",
] as const satisfies readonly (keyof PhaseOutputSlots["names"] & string)[];
const EDITORIAL_KEYS = [
  "description",
  "description_en",
  "city",
  "blurb",
  "blurb_en",
  "subcategories",
  "subcategories_en",
  "category",
  "founding_year",
  "_cleared_fields",
  "faq",
] as const satisfies readonly (keyof PhaseOutputSlots["editorial"] & string)[];
const ACQUIRE_EXTRA_KEYS = [
  "hero_image_url",
  "hero_image_storage_path",
  "_cleared_fields",
] as const satisfies readonly (Exclude<
  keyof PhaseOutputSlots["acquire"],
  keyof BrandFlatLinkColumns
> &
  string)[];
const CATEGORY_DERIVATION_KEYS = [
  "category",
] as const satisfies readonly (keyof PhaseOutputSlots["categoryDerivation"] &
  string)[];
const PRODUCTS_KEYS = [
  "products",
] as const satisfies readonly (keyof PhaseOutputSlots["products"] & string)[];
export const SLOT_ALLOWED_KEYS: Record<
  keyof PhaseOutputSlots,
  ReadonlySet<string>
> = {
  detect: new Set<string>(DETECT_KEYS),
  linkExpansion: BRAND_FLAT_LINK_KEYS,
  acquire: new Set([...BRAND_FLAT_LINK_KEYS, ...ACQUIRE_EXTRA_KEYS]),
  names: new Set<string>(NAMES_KEYS),
  editorial: new Set<string>(EDITORIAL_KEYS),
  categoryDerivation: new Set<string>(CATEGORY_DERIVATION_KEYS),
  products: new Set<string>(PRODUCTS_KEYS),
};

/**
 * Write a phase's output into the registry. Throws if the slot was already
 * populated (double-write) or if the output carries keys outside the slot's
 * allowed set (structural-typing bypass guard).
 */
export function depositPhaseOutput<P extends keyof PhaseOutputSlots>(
  state: { outputs: PhaseOutputRegistry },
  phase: P,
  output: PhaseOutputSlots[P],
): void {
  if (state.outputs[phase] !== undefined) {
    throw new Error(
      `Phase "${phase}" already deposited output — double-write is not allowed`,
    );
  }

  const allowed = SLOT_ALLOWED_KEYS[phase];
  const excess = Object.keys(output).filter((k) => !allowed.has(k));
  if (excess.length > 0) {
    throw new Error(
      `Phase "${phase}" output contains disallowed keys: ${excess.join(", ")}`,
    );
  }

  state.outputs[phase] = output;
}

/**
 * Merge all populated slots in `MERGE_ORDER` into a single `EnrichPatch`.
 * Later phases overwrite earlier ones for overlapping keys.
 */
export function buildPendingPatch(registry: PhaseOutputRegistry): EnrichPatch {
  const result: EnrichPatch = {};
  for (const phase of MERGE_ORDER) {
    const slot = registry[phase];
    if (slot !== undefined) {
      Object.assign(result, slot);
    }
  }
  return result;
}

export type BatchPhaseContext = {
  chunk: EnrichBrand[];
  chunkBrandNames: string[];
  phases: EnrichPhase[];
  dryRun: boolean;
  onProgress?: CurationConfig["onProgress"];
  supabase: SupabaseClient<Database>;
  targetType?: EnrichmentTarget["type"];
  jobId?: string;
  /** Audit call-context summary a batch phase may attach verdict telemetry to. */
  summary?: Record<string, unknown>;
};

export type BrandEnrichState = {
  outputs: PhaseOutputRegistry;
  phaseResults: PhaseResult[];
  knownUrls: string[];
  discoveredUrls: string[];
  serpSnippets: string[];
  serpEntries: BrandSearchEntry[];
  scrapedData: EnrichScrapedData;
};

const LEGACY_DISPLAY_NAME_KEY = ["display", "brand", "name"].join("_");

export function getDisplayBrandName(brand: { name?: string | null }): string {
  const legacyName = (brand as Record<string, unknown>)[
    LEGACY_DISPLAY_NAME_KEY
  ];
  return brand.name ?? (typeof legacyName === "string" ? legacyName : "");
}

export async function timePhase<T>(
  fn: () => Promise<T>,
): Promise<{ result: T; durationMs: number }> {
  const startedAt = performance.now();

  const result = await fn();

  return {
    result,
    durationMs: performance.now() - startedAt,
  };
}

export function buildPhaseResult(
  phase: string,
  status: PhaseResultStatus,
  changedFields: string[],
  durationMs: number,
  error?: string,
  detail?: string,
): PhaseResult {
  return {
    phase,
    status,
    changedFields,
    durationMs,
    ...(error !== undefined ? { error } : {}),
    ...(detail !== undefined ? { detail } : {}),
  };
}

export function hasPatchValues(patch: object): boolean {
  return Object.keys(patch).length > 0;
}
