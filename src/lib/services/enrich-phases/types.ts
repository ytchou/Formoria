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

export type EnrichPhase = (typeof ENRICH_PHASES)[number]

export type EnrichBrand = {
  id: string
  slug: string
  name?: string
  status?: string | null
  description?: string | null
  description_en?: string | null
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
  reputation_summary?: unknown | null
} & Partial<BrandFlatLinkColumns>

export type SearchPhaseResult = {
  urls: string[]
  snippets: string[]
  rawEntries?: unknown[]
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
  }>

export type BatchPhaseContext = {
  chunk: EnrichBrand[]
  chunkBrandNames: string[]
  phases: EnrichPhase[]
  dryRun: boolean
  onProgress?: CurationConfig['onProgress']
  supabase: SupabaseClient<Database>
}

export type BrandEnrichState = {
  patches: EnrichPatch
  phaseResults: PhaseResult[]
  knownUrls: string[]
  discoveredUrls: string[]
  serpSnippets: string[]
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
