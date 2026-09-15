/**
 * Hydration module: rebuilds in-memory structures from persisted rows and
 * phase-carry data so downstream blocks can consume them without re-running
 * the phase that produced them.
 *
 * All DB access goes through injectable loaders — no direct Supabase imports.
 */

import type { EnrichmentTarget } from '../_shared/enrichment-target'
import type { EnrichScrapedData } from '../enrich-phases/types'
import type { CatalogDiscoveryResult } from '../enrich-phases/catalog-discovery'
import type { AcquireCarry } from './phase-outputs'
import type { NameCandidate } from '../name-arbiter'
import type { ScrapedImageSource } from '@/lib/types/scraper'

// ---------------------------------------------------------------------------
// Loader types — injectable so tests use fakes, not mocks
// ---------------------------------------------------------------------------

type ScrapeStructureRow = {
  title?: string
  description?: string
  story?: string
}

type SearchRow = {
  url: string
  snippets: string[]
}

type ImageSourceRow = {
  source_url: string
  provider_metadata: { pageUrl?: string } | null
}

type CatalogRow = {
  url: string
  raw_response: {
    url: string
    title: string | null
    titleSource: 'jsonld' | 'og' | 'h1' | 'title' | null
    text: string
    imageUrls: string[]
  } | null
  snippets: string[]
}

export type HydrationLoaders = {
  /** Load per-URL structured scrape data (from `loadPersistedScrapeStructure`). */
  loadScrapeStructure: (
    target: EnrichmentTarget,
  ) => Promise<Record<string, ScrapeStructureRow>>
  /** Load scrape search-result rows for snippets. */
  loadSearchRows: (target: EnrichmentTarget) => Promise<SearchRow[]>
  /** Load image source metadata from `brand_images`. */
  loadImageSources: (target: EnrichmentTarget) => Promise<ImageSourceRow[]>
  /** Load `search_type='catalog'` rows for catalog evidence hydration. */
  loadCatalogRows?: (target: EnrichmentTarget) => Promise<CatalogRow[]>
}

// ---------------------------------------------------------------------------
// hydrateScrapedData
// ---------------------------------------------------------------------------

/**
 * Compose `perSourceText`, `snippets`, and `imageSources` from persisted rows
 * into an `EnrichScrapedData`-shaped object.
 */
export async function hydrateScrapedData(
  target: EnrichmentTarget,
  loaders: HydrationLoaders,
): Promise<{
  perSourceText: Record<string, ScrapeStructureRow>
  snippets: string[]
  imageSources: ImageSourceRow[]
}> {
  const [perSourceText, searchRows, imageSources] = await Promise.all([
    loaders.loadScrapeStructure(target),
    loaders.loadSearchRows(target),
    loaders.loadImageSources(target),
  ])

  const snippets = searchRows.flatMap((row) => row.snippets)

  return {
    perSourceText,
    snippets,
    imageSources,
  }
}

// ---------------------------------------------------------------------------
// hydrateCatalogResult
// ---------------------------------------------------------------------------

type CatalogEvidence = {
  title: string | null
  titleSource: 'jsonld' | 'og' | 'h1' | 'title' | null
  text: string
  imageUrls: string[]
}

/**
 * Rebuild a `CatalogDiscoveryResult` from the carry's `triples` + persisted
 * `search_type='catalog'` rows (which supply evidence keyed by normalized URL).
 */
export async function hydrateCatalogResult(
  carry: AcquireCarry,
  target: EnrichmentTarget,
  loaders: HydrationLoaders,
): Promise<CatalogDiscoveryResult> {
  const evidence = new Map<string, CatalogEvidence>()

  if (loaders.loadCatalogRows) {
    const catalogRows = await loaders.loadCatalogRows(target)
    for (const row of catalogRows) {
      if (!row.raw_response) continue
      const key = row.raw_response.url ?? row.url
      if (!evidence.has(key)) {
        evidence.set(key, {
          title: row.raw_response.title,
          titleSource: row.raw_response.titleSource,
          text: row.raw_response.text,
          imageUrls: row.raw_response.imageUrls ?? [],
        })
      }
    }
  }

  return {
    triples: carry.catalog.triples,
    attempts: carry.catalog.attempts,
    evidence,
    zeroReason: carry.catalog.zeroReason,
    deadlineHit: carry.catalog.deadlineHit,
  }
}

// ---------------------------------------------------------------------------
// hydrateAcquireInputs
// ---------------------------------------------------------------------------

/**
 * The subset of `AcquirePhaseOutput` that the `names`/`products` blocks
 * consume. Rebuilt from carry + loaders so no phase is re-run.
 */
export type HydratedAcquireInputs = {
  scrapedData: EnrichScrapedData & {
    snippets?: string[]
  }
  catalogResult?: CatalogDiscoveryResult
  officialNameCandidates: NameCandidate[]
  acquisitionPageUrls: string[]
  priorityProductUrls: string[]
  scrapedImageSources: ScrapedImageSource[]
}

export async function hydrateAcquireInputs(
  carry: AcquireCarry,
  target: EnrichmentTarget,
  loaders: HydrationLoaders,
): Promise<HydratedAcquireInputs> {
  const [scrapedHydrated, catalogResult] = await Promise.all([
    hydrateScrapedData(target, loaders),
    hydrateCatalogResult(carry, target, loaders),
  ])

  const scrapedData: HydratedAcquireInputs['scrapedData'] = {
    perSourceText: scrapedHydrated.perSourceText,
    snippets: scrapedHydrated.snippets,
  }

  return {
    scrapedData,
    catalogResult,
    officialNameCandidates: carry.officialNameCandidates,
    acquisitionPageUrls: carry.acquisitionPageUrls,
    priorityProductUrls: carry.priorityProductUrls,
    scrapedImageSources: carry.scrapedImageSources,
  }
}
