import type { SupabaseClient } from '@supabase/supabase-js'
import type { ENRICH_PHASES } from '@/lib/constants/enrich-phases'
import type { BrandFlatLinkColumns } from '@/lib/types'
import type {
  CurationConfig,
  PhaseResult,
  PhaseStatus,
} from '@/lib/types/curation'
import type { SiteContent } from '@/lib/types/brand'
import type { Database } from '@/lib/supabase/database.types'
import type { ScrapedBrandData } from '@/lib/types/scraper'
import type { EnrichmentTarget } from '../_shared/enrichment-target'
import type { SearchCallStatus } from '../search-results'
import type { BrandSearchEntry } from './scraper/types'

export type EnrichPhase = (typeof ENRICH_PHASES)[number]

export type EnrichBrand = {
  id: string
  slug: string
  name?: string
  status?: string | null
  description?: string | null
  description_en?: string | null
  blurb?: string | null
  blurb_en?: string | null
  price_range?: number | null
  product_tags?: string[] | null
  product_tags_en?: string[] | null
  founding_year?: number | null
  city?: string | null
  site_content?: SiteContent | null
  category_attributes?: unknown | null
  product_type?: string | null
  purchase_website?: string | null
  purchaseWebsite?: string | null
  hero_image_url?: string | null
  product_images?: string[] | null
  heroImageUrl?: string | null
  productPhotos?: string[] | null
  // Set per brand by curation-operations; phases read it to decide whether to
  // regenerate rather than gap-fill.
  overwrite_enrichment?: boolean
  reputation_summary?: unknown | null
  mit_evidence?: unknown | null
} & Partial<BrandFlatLinkColumns>

export type SearchPhaseResult = {
  urls: string[]
  snippets: string[]
  entries?: BrandSearchEntry[]
  rawEntries?: unknown
  auditResultId?: string
  callStatus?: SearchCallStatus
  httpStatus?: number | null
  error?: string | null
  latencyMs?: number | null
  /**
   * True when the result was replayed from `brand_search_results` instead of a
   * live provider call. `callStatus` is copied verbatim from the stored row, so
   * a cached row can carry `failed` from an outage that ended days ago —
   * callers must not read that as a live provider failure.
   */
  fromCache?: boolean
}

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
  return status === 'failed' || status === 'timeout' || status === 'network_error'
}

export type EnrichScrapedData = Partial<ScrapedBrandData> &
  Partial<BrandFlatLinkColumns> & {
    snippets?: string[]
  }

export type EnrichPatch = Partial<BrandFlatLinkColumns> &
  Partial<{
    description: string | null
    description_en: string | null
    city: string | null
    category_attributes: unknown
    hero_image_url: string | null
    name: string
    reputation_summary: unknown
    price_range: number | null
    product_tags: string[] | null
    product_type: string | null
    slug: string
    blurb: string | null
    blurb_en: string | null
    founding_year: number | null
    product_tags_en: string[] | null
  }>

export type BatchPhaseContext = {
  chunk: EnrichBrand[]
  chunkBrandNames: string[]
  phases: EnrichPhase[]
  dryRun: boolean
  onProgress?: CurationConfig['onProgress']
  supabase: SupabaseClient<Database>
  targetType?: EnrichmentTarget['type']
  jobId?: string
}

export type BrandEnrichState = {
  patches: EnrichPatch
  phaseResults: PhaseResult[]
  knownUrls: string[]
  discoveredUrls: string[]
  serpSnippets: string[]
  serpEntries: BrandSearchEntry[]
  scrapedData: EnrichScrapedData
}

const LEGACY_DISPLAY_NAME_KEY = ['display', 'brand', 'name'].join('_')

export function getDisplayBrandName(brand: { name?: string | null }): string {
  const legacyName = (brand as Record<string, unknown>)[LEGACY_DISPLAY_NAME_KEY]
  return brand.name ?? (typeof legacyName === 'string' ? legacyName : '')
}

export async function timePhase<T>(
  fn: () => Promise<T>,
): Promise<{ result: T; durationMs: number }> {
  const startedAt = performance.now()

  const result = await fn()

  return {
    result,
    durationMs: performance.now() - startedAt,
  }
}

export function buildPhaseResult(
  phase: string,
  status: PhaseStatus,
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
  }
}

export function hasPatchValues(patch: object): boolean {
  return Object.keys(patch).length > 0
}
