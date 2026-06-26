import type { SupabaseClient } from '@supabase/supabase-js'
import type { ENRICH_PHASES } from '@/lib/constants/enrich-phases'
import type { BrandFlatLinkColumns } from '@/lib/types'
import type { CurationConfig, PhaseResult, PhaseStatus } from '@/lib/types/curation'
import type { Database } from '@/lib/database.types'
import type {
  ClassificationResult,
  TriageResult,
} from '@/lib/services/product-type-classifier'
import type { ScrapedBrandData } from '@/lib/types/scraper'

export type EnrichPhase = (typeof ENRICH_PHASES)[number]

export type EnrichBrand = {
  id: string
  slug: string
  name?: string
  status?: string | null
  description?: string | null
  product_type?: string | null
  purchase_website?: string | null
  purchaseWebsite?: string | null
  tag_slugs?: string[] | null
  brand_highlights?: string | null
  hero_image_url?: string | null
  product_images?: string[] | null
  product_photos?: string[] | null
  heroImageUrl?: string | null
  productPhotos?: string[] | null
} & Partial<BrandFlatLinkColumns>

export type SearchPhaseResult = {
  urls: string[]
  snippets: string[]
  rawEntries?: unknown[]
}

export type EnrichScrapedData = Partial<ScrapedBrandData> & Partial<BrandFlatLinkColumns> & {
  snippets?: string[]
}

export type EnrichPatch = Partial<BrandFlatLinkColumns> &
  Partial<{
    brand_highlights: string | null
    description: string | null
    hero_image_url: string | null
    name: string
    product_photos: string[]
    product_type: string | null
    slug: string
    tag_slugs: string[]
  }>

export type BatchPhaseContext = {
  chunk: EnrichBrand[]
  chunkBrandNames: string[]
  phases: EnrichPhase[]
  dryRun: boolean
  onProgress?: CurationConfig['onProgress']
  supabase: SupabaseClient<Database>
}

export type BatchPhaseOutput = {
  searchResults: Map<string, SearchPhaseResult>
  imageSearchResults: Map<string, string[]>
  triageResults: Map<string, TriageResult>
  batchClassifications: Map<string, ClassificationResult>
  searchError: string | null
}

export type BrandEnrichState = {
  patches: EnrichPatch
  phaseResults: PhaseResult[]
  knownUrls: string[]
  discoveredUrls: string[]
  serpSnippets: string[]
  scrapedData: EnrichScrapedData
}

export type BrandPhaseContext = {
  brand: EnrichBrand
  phases: EnrichPhase[]
  batchData: BatchPhaseOutput
  dryRun: boolean
  onProgress?: CurationConfig['onProgress']
  supabase: SupabaseClient<Database>
}

export async function timePhase<T>(
  fn: () => Promise<T>
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
  detail?: string
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
