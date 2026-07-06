import type { SupabaseClient } from '@supabase/supabase-js'
import { cleanBrandName } from './brand-cleanup'
import { insertSlugRedirect, updateBrand } from './brands'
import type { BrandFlatLinkColumns } from '@/lib/types'
import type { ScrapedBrandData } from '@/lib/types/scraper'
import { ENRICH_PHASES } from '@/lib/constants/enrich-phases'
import {
  buildLinkEnrichPatch,
  buildTextEnrichPatch,
  extractLinksFromUrls,
  hasLinkValue,
  LINK_FIELDS,
  linkColumnFor,
} from './link-enrichment'
import {
  type ClassificationResult,
} from './product-type-classifier'
import { SEARCH_DELAY_MS } from './enrich-phases/scraper/search'
import { insertTriageResult, insertDescriptionResult, insertClassificationResult } from './ai-results'
import { createServiceClient } from '@/lib/supabase/server'
import type { BrandOutcome, CurationConfig, OperationResult, PhaseResult } from '@/lib/types/curation'
import {
  applyTriageResult,
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
  runTriagePhase,
  type BrandEnrichState,
  type SearchPhaseResult,
  hasPatchValues,
} from './enrich-phases'
import { buildCandidatePool } from './enrich-phases/candidate-pool'
import {
  formatBrandComplete,
  formatJobStart,
  formatJobSummary,
  formatPhaseProgress,
  logEnrichmentProgress,
  type BrandPhaseProgress,
  type EnrichmentSummary,
} from './enrichment-logger'

export type { BrandOutcome, CurationConfig, OperationResult }
export { shouldSkipForNonBrand } from './enrich-phases/triage'

type EnrichOperationResult = OperationResult & {
  enrichmentSummary: EnrichmentSummary
}

type CurationBrand = {
  id: string
  slug: string
  name?: string
  status?: string | null
  description?: string | null
  product_type?: string | null
  purchase_website?: string | null
  purchaseWebsite?: string | null
}

type SupabaseLike = Pick<SupabaseClient, 'from'>

type JsonObject = Record<string, unknown>
type EnrichmentPatchInput = {
  brandId: string
  patch: JsonObject
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message
  }

  return String(error)
}

const SCRAPE_DELAY_MS = 1000

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}

export { ENRICH_PHASES }

type EnrichPhase = 'clean' | 'links' | 'images' | 'descriptions' | 'tags'
type RunEnrichPhase = EnrichPhase | 'discover' | 'detect' | 'slugs' | 'expansion'

type EnrichBrand = CurationBrand &
  Partial<BrandFlatLinkColumns> & {
    hero_image_url?: string | null
    product_images?: string[] | null
    product_photos?: string[] | null
    heroImageUrl?: string | null
    productPhotos?: string[] | null
  }

type EnrichScrapedData = Partial<ScrapedBrandData> & Partial<BrandFlatLinkColumns> & {
  snippets?: string[]
}

type EnrichImagePatch = Partial<{
  hero_image_url: string | null
  product_photos: string[]
}>

function isEmptyField(value: unknown): boolean {
  if (value == null) return true
  if (typeof value === 'string') return value.trim().length === 0
  if (Array.isArray(value)) return value.length === 0
  return false
}

export function needsPhase(brand: Record<string, unknown>, phase: RunEnrichPhase): boolean {
  if (phase === 'descriptions') {
    return isEmptyField(brand.description)
  }

  if (phase === 'images') {
    return isEmptyField(brand.hero_image_url ?? brand.heroImageUrl)
  }

  if (phase === 'expansion') {
    return (
      isEmptyField(brand.reputation_summary ?? brand.reputationSummary) ||
      isEmptyField(brand.manufacturing) ||
      isEmptyField(brand.certifications) ||
      isEmptyField(brand.policies)
    )
  }

  return true
}

function shouldSelectForRequestedPhases(brand: Record<string, unknown>, phases: RunEnrichPhase[]): boolean {
  const fillGapPhases = phases.filter((phase) => (
    phase === 'descriptions' ||
    phase === 'images' ||
    phase === 'expansion'
  ))

  if (fillGapPhases.length === 0) return true
  return fillGapPhases.some((phase) => needsPhase(brand, phase))
}

type EnrichCleanPhase = {
  changed: boolean
  original?: string
  cleaned?: string
}

type EnrichDescriptionsPhase = {
  changed: boolean
}

type EnrichDescriptionPatch = Partial<{
  description: string | null
  price_range: number | null
  product_tags: string[] | null
}>

type EnrichProcessPhases = {
  clean?: EnrichCleanPhase
  descriptions?: EnrichDescriptionsPhase
}

type EnrichPatches = {
  clean?: Partial<Pick<CurationBrand, 'name'>>
  links?: Partial<BrandFlatLinkColumns>
  images?: EnrichImagePatch
  descriptions?: EnrichDescriptionPatch
  tags?: Partial<Pick<CurationBrand, 'product_type'>>
}

type EnrichPatch = Partial<BrandFlatLinkColumns> &
  EnrichImagePatch &
  EnrichDescriptionPatch &
  Partial<Pick<EnrichBrand, 'product_type' | 'name'>>

type ProcessEnrichResult = {
  phases: EnrichProcessPhases
  patches: EnrichPatches
  patch: EnrichPatch
  hasChanges: boolean
}

type SubmissionEnrichmentRow = {
  id: string
  brand_name: string
  description: string | null
  website_url: string | null
  hero_image_url: string | null
  product_photos: string[] | null
  social_instagram: string | null
  social_threads: string | null
  social_facebook: string | null
  purchase_website: string | null
  purchase_pinkoi: string | null
  purchase_shopee: string | null
  other_urls: unknown
  enriched_data: unknown
  status: string
  brand_id: string | null
}

function isRequestedPhase(phases: string[], phase: EnrichPhase): boolean {
  return phases.includes(phase)
}

function isPlainObject(value: unknown): value is JsonObject {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function mergeProductPhotos(existing: unknown[], incoming: unknown[]): unknown[] {
  const merged: unknown[] = []
  const seenUrls = new Set<string>()
  const seenValues = new Set<unknown>()

  for (const photo of [...existing, ...incoming]) {
    if (!isPlainObject(photo) || typeof photo.url !== 'string') {
      if (seenValues.has(photo)) {
        continue
      }

      seenValues.add(photo)
      merged.push(photo)
      continue
    }

    if (seenUrls.has(photo.url)) {
      continue
    }

    seenUrls.add(photo.url)
    merged.push(photo)
  }

  return merged
}

function deepMergeJsonObjects(base: JsonObject, patch: JsonObject): JsonObject {
  const merged: JsonObject = { ...base }

  for (const [key, value] of Object.entries(patch)) {
    const existing = merged[key]
    if (Array.isArray(existing) && Array.isArray(value)) {
      merged[key] = key === 'product_photos'
        ? mergeProductPhotos(existing, value)
        : [...new Set([...existing, ...value])]
      continue
    }

    merged[key] = isPlainObject(existing) && isPlainObject(value)
      ? deepMergeJsonObjects(existing, value)
      : value
  }

  return merged
}

function uniqueUrls(urls: string[]): string[] {
  const seen = new Set<string>()
  const unique: string[] = []

  for (const url of urls) {
    const normalized = url.trim()
    if (!normalized || seen.has(normalized)) {
      continue
    }

    seen.add(normalized)
    unique.push(normalized)
  }

  return unique
}

function chunkItems<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = []

  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size))
  }

  return chunks
}

function collectKnownUrls(brand: EnrichBrand): string[] {
  const linkUrls = LINK_FIELDS
    .map((field) => brand[linkColumnFor(field)])
    .filter((url): url is string => hasLinkValue(url))

  return uniqueUrls(linkUrls)
}

function normalizeScrapedData(scrapedData: EnrichScrapedData): EnrichScrapedData {
  return {
    ...scrapedData,
    social_instagram: scrapedData.social_instagram ?? scrapedData.socialInstagram,
    social_threads: scrapedData.social_threads ?? scrapedData.socialThreads,
    social_facebook: scrapedData.social_facebook ?? scrapedData.socialFacebook,
    purchase_website: scrapedData.purchase_website ?? scrapedData.purchaseWebsite,
    purchase_pinkoi: scrapedData.purchase_pinkoi ?? scrapedData.purchasePinkoi,
    purchase_shopee: scrapedData.purchase_shopee ?? scrapedData.purchaseShopee,
  }
}

export function processEnrichBrand(
  brand: EnrichBrand,
  scrapedData: EnrichScrapedData,
  phases: string[]
): ProcessEnrichResult {
  const phaseResults: EnrichProcessPhases = {}
  const patches: EnrichPatches = {}
  const normalizedScrapedData = normalizeScrapedData(scrapedData)

  if (isRequestedPhase(phases, 'clean')) {
    const nameCleanup = cleanBrandName(brand.name ?? '')
    phaseResults.clean = nameCleanup.changed
      ? {
          changed: true,
          original: nameCleanup.originalName,
          cleaned: nameCleanup.cleanedName,
        }
      : { changed: false }

    if (nameCleanup.changed) {
      patches.clean = { name: nameCleanup.cleanedName }
    }
  }

  if (isRequestedPhase(phases, 'links')) {
    const links = buildLinkEnrichPatch(brand, normalizedScrapedData)
    if (hasPatchValues(links)) {
      patches.links = links
    }
  }

  if (isRequestedPhase(phases, 'descriptions')) {
    const descriptions = buildTextEnrichPatch(brand, normalizedScrapedData)
    phaseResults.descriptions = { changed: hasPatchValues(descriptions) }
    if (hasPatchValues(descriptions)) {
      patches.descriptions = descriptions
    }
  }

  const patch = mergeEnrichPatches(patches)

  return {
    phases: phaseResults,
    patches,
    patch,
    hasChanges: hasPatchValues(patch),
  }
}

export function mergeEnrichPatches(patches: EnrichPatches): EnrichPatch {
  return {
    ...patches.clean,
    ...patches.links,
    ...patches.images,
    ...patches.descriptions,
    ...patches.tags,
  }
}

function changedFieldsFromPhaseResults(phaseResults: PhaseResult[]): string[] {
  return [...new Set(phaseResults.flatMap((phaseResult) => phaseResult.changedFields))]
}

function phaseProgressStatus(status: PhaseResult['status']): BrandPhaseProgress['status'] {
  if (status === 'succeeded') {
    return 'success'
  }

  return status
}

function logPhaseResult(
  onProgress: (message: string) => void,
  brand: EnrichBrand,
  brandIndex: number,
  totalBrands: number,
  phaseResult: PhaseResult,
  phaseIndex: number,
  totalPhases: number
): void {
  onProgress(formatPhaseProgress({
    brandSlug: brand.slug,
    brandIndex,
    totalBrands,
    phaseName: phaseResult.phase,
    phaseIndex,
    totalPhases,
    status: phaseProgressStatus(phaseResult.status),
    durationMs: phaseResult.durationMs,
    ...(phaseResult.error !== undefined ? { error: phaseResult.error } : {}),
  }))
}

function buildBrandPhaseOrder(phases: RunEnrichPhase[], hasTriagePhases: boolean): string[] {
  return [
    hasTriagePhases && 'triage',
    'clean',
    'links',
    'images',
    'descriptions',
    'expansion',
    phases.includes('tags') && 'tags',
  ].filter((phase): phase is string => Boolean(phase))
}

export function createEnrichmentSummary(result: OperationResult, durationMs: number): EnrichmentSummary {
  return {
    success: result.brandOutcomes.filter((outcome) => outcome.status === 'succeeded').length,
    skipped: result.brandOutcomes.filter((outcome) => outcome.status === 'skipped').length,
    failed: result.brandOutcomes.filter((outcome) => outcome.status === 'failed').length,
    failedBrands: result.brandOutcomes
      .filter((outcome): outcome is BrandOutcome & { error: string } =>
        outcome.status === 'failed' && typeof outcome.error === 'string'
      )
      .map((outcome) => {
        const failedPhase = outcome.phaseResults?.find((phaseResult) => phaseResult.status === 'failed')
        return {
          slug: outcome.slug,
          phase: failedPhase?.phase ?? 'brand',
          error: failedPhase?.error ?? outcome.error,
        }
      }),
    durationMs,
  }
}

function finishEnrichResult(
  result: OperationResult,
  startedAt: number,
  onProgress: (message: string) => void
): EnrichOperationResult {
  const enrichmentSummary = createEnrichmentSummary(result, Date.now() - startedAt)
  for (const line of formatJobSummary(enrichmentSummary)) {
    onProgress(line)
  }

  return {
    ...result,
    enrichmentSummary,
  }
}

function appendPatch(state: BrandEnrichState, patch: Record<string, unknown>): void {
  Object.assign(state.patches, patch)
}

export async function persistSubmissionEnrichmentResults(
  supabase: SupabaseClient,
  submissionId: string,
  patch: JsonObject
): Promise<void> {
  const { data: row, error: selectError } = await supabase
    .from('brand_submissions')
    .select('enriched_data, status')
    .eq('id', submissionId)
    .single()

  if (selectError || !row) {
    console.warn(`Skipping enrichment persistence for missing submission ${submissionId}`)
    return
  }

  if (row.status !== 'pending') {
    console.warn(`Skipping enrichment persistence for non-pending submission ${submissionId}`)
    return
  }

  const existing = (row.enriched_data ?? {}) as Record<string, unknown>
  const merged = deepMergeJsonObjects(existing, patch as Record<string, unknown>)
  const { error: updateError, count } = await supabase
    .from('brand_submissions')
    .update({ enriched_data: merged }, { count: 'exact' })
    .eq('id', submissionId)
    .eq('status', 'pending')

  if (updateError) {
    throw new Error(updateError.message ?? 'Failed to update brand submission enrichment')
  }

  if (count === 0) {
    console.warn(`Skipping enrichment persistence after pending status changed for submission ${submissionId}`)
  }
}

function submissionToEnrichBrand(submission: SubmissionEnrichmentRow): EnrichBrand {
  const existing = isPlainObject(submission.enriched_data) ? submission.enriched_data : {}

  return {
    id: submission.id,
    slug: `submission-${submission.id}`,
    name: typeof existing.name === 'string' ? existing.name : submission.brand_name,
    status: submission.status,
    description: typeof existing.description === 'string' ? existing.description : submission.description,
    product_type: typeof existing.product_type === 'string' ? existing.product_type : null,
    social_instagram: typeof existing.social_instagram === 'string' ? existing.social_instagram : submission.social_instagram,
    social_threads: typeof existing.social_threads === 'string' ? existing.social_threads : submission.social_threads,
    social_facebook: typeof existing.social_facebook === 'string' ? existing.social_facebook : submission.social_facebook,
    purchase_website: typeof existing.purchase_website === 'string'
      ? existing.purchase_website
      : submission.purchase_website ?? submission.website_url,
    purchase_pinkoi: typeof existing.purchase_pinkoi === 'string' ? existing.purchase_pinkoi : submission.purchase_pinkoi,
    purchase_shopee: typeof existing.purchase_shopee === 'string' ? existing.purchase_shopee : submission.purchase_shopee,
    hero_image_url: typeof existing.hero_image_url === 'string' ? existing.hero_image_url : (submission.hero_image_url ?? null),
    product_photos: Array.isArray(existing.product_photos)
      ? existing.product_photos.filter((url): url is string => typeof url === 'string')
      : (Array.isArray(submission.product_photos) ? (submission.product_photos as string[]).filter((url): url is string => typeof url === 'string') : []),
  }
}

export async function persistEnrichmentResults(
  supabase: SupabaseClient,
  brandId: string,
  patch: JsonObject
): Promise<void>
export async function persistEnrichmentResults(
  supabase: SupabaseClient,
  patches: EnrichmentPatchInput[],
  jobId?: string
): Promise<void>
export async function persistEnrichmentResults(
  supabase: SupabaseClient,
  brandIdOrPatches: string | EnrichmentPatchInput[],
  patchOrJobId?: JsonObject | string,
): Promise<void> {
  void supabase

  const patches = Array.isArray(brandIdOrPatches)
    ? brandIdOrPatches
    : [{ brandId: brandIdOrPatches, patch: patchOrJobId as JsonObject }]
  const jobId = Array.isArray(brandIdOrPatches) && typeof patchOrJobId === 'string'
    ? patchOrJobId
    : undefined

  for (const item of patches) {
    await updateBrand(
      item.brandId,
      {
        ...item.patch,
        brand_enriched_at: new Date().toISOString(),
      } as never,
      { source: 'enriched', jobId },
    )
  }
}

export async function runEnrich(
  config: CurationConfig & { phases: string[] },
  supabase: SupabaseLike
): Promise<EnrichOperationResult> {
  const startedAt = Date.now()
  const onProgress = config.onProgress ?? logEnrichmentProgress
  const result: OperationResult = {
    processed: 0,
    updated: 0,
    skipped: 0,
    errors: [],
    brandOutcomes: [],
  }

  const phases = config.phases as RunEnrichPhase[]
  const target = config.target ?? (config.slugs?.length ? 'brands' : 'submissions')
  const enrichDelayMs = phases.includes('discover') ? SEARCH_DELAY_MS : SCRAPE_DELAY_MS
  const includesDiscover = phases.includes('discover')
  let weakBrandCount = 0
  let allBrands: EnrichBrand[] = []

  if (target === 'submissions') {
    let query = supabase
      .from('brand_submissions')
      .select('*')
      .eq('status', 'pending')
      .is('brand_id', null)

    if (config.submissionIds?.length) {
      query = query.in('id', config.submissionIds)
    }

    if (!config.overwrite) {
      query = query.is('enriched_data', null)
    }

    if (config.limit !== undefined) {
      query = query.limit(config.limit)
    }

    const { data: submissions, error } = await query

    if (error) {
      const message = error.message ?? 'Failed to fetch submissions'
      result.errors.push(message)
      onProgress(`[ENRICH] ERROR: Failed to fetch submissions: ${message}`)
      throw error
    }

    allBrands = ((submissions ?? []) as SubmissionEnrichmentRow[]).map(submissionToEnrichBrand)
  } else {
    let query = supabase
      .from('brands')
      .select(
        'id, slug, name, status, description, product_type, site_content, reputation_summary, manufacturing, certifications, policies, social_instagram, social_threads, social_facebook, purchase_website, purchase_pinkoi, purchase_shopee, hero_image_url, product_photos'
      )

    if (config.slugs && config.slugs.length > 0) {
      query = query.in('slug', config.slugs)
    }

    if (config.status) {
      query = query.eq('status', config.status)
    }

    if (config.limit !== undefined && config.overwrite) {
      query = query.limit(config.limit)
    }

    const { data, error } = await query

    if (error) {
      const message = error.message ?? 'Failed to fetch brands'
      result.errors.push(message)
      onProgress(`[ENRICH] ERROR: Failed to fetch brands: ${message}`)
      throw error
    }

    const brands = (data ?? []) as EnrichBrand[]
    const phaseEligibleBrands = config.overwrite
      ? brands
      : brands.filter((brand) => shouldSelectForRequestedPhases(brand as Record<string, unknown>, phases))
    allBrands = config.limit === undefined
      ? phaseEligibleBrands
      : phaseEligibleBrands.slice(0, config.limit)
  }

  const totalBrands = allBrands.length
  for (const line of formatJobStart(totalBrands)) {
    onProgress(line)
  }
  const brandChunks = chunkItems(allBrands, 20)

  for (let chunkIndex = 0; chunkIndex < brandChunks.length; chunkIndex += 1) {
    if (chunkIndex > 0) {
      await delay(enrichDelayMs)
    }

    const chunk = brandChunks[chunkIndex]
    const hasTriagePhases = phases.includes('detect') || phases.includes('slugs') || phases.includes('tags')
    const activeSteps = [
      phases.includes('discover') && 'SERP',
      phases.includes('images') && 'images',
      hasTriagePhases && 'triage',
      phases.includes('tags') && !phases.includes('descriptions') && 'tags',
      phases.includes('descriptions') && phases.includes('tags') && 'descriptions+tags',
      phases.includes('descriptions') && !phases.includes('tags') && 'descriptions',
    ].filter(Boolean)
    onProgress(`\n[BATCH ${chunkIndex + 1}/${brandChunks.length}] ${chunk.length} brands — fetching ${activeSteps.join(' + ')}...`)

    const chunkBrandNames = chunk.map(getDisplayBrandName)
    const batchContext = {
      chunk,
      chunkBrandNames,
      phases,
      dryRun: config.dryRun,
      onProgress,
      supabase: supabase as unknown as SupabaseClient,
    }

    const discoverResult = await runDiscoverPhase(batchContext)
    let searchResults = discoverResult.searchResults
    const searchError = discoverResult.searchError

    if (!phases.includes('discover') && (hasTriagePhases || phases.includes('descriptions'))) {
      const cached = await loadCachedSearchResults(
        chunk.map((brand) => brand.id)
      )
      const cachedByName = new Map<string, SearchPhaseResult>()
      for (const brand of chunk) {
        const row = cached.get(brand.id)
        if (row) {
          cachedByName.set(getDisplayBrandName(brand), row)
        }
      }
      searchResults = cachedByName
      const cachedCount = [...searchResults.values()].filter(r => r.snippets.length > 0).length
      if (cachedCount > 0) {
        onProgress(`  [SERP-CACHE] Loaded ${cachedCount} cached snippet sets`)
      }
    }

    const imageSearchResult = await runImageSearchPhase(batchContext, searchResults)
    const imageSearchResults = imageSearchResult.imageSearchResults

    const triagePhaseResult = await runTriagePhase(batchContext, searchResults)
    const triageResults = triagePhaseResult.triageResults
    const standaloneClassificationResult = await runStandaloneClassification(batchContext)
    const batchClassifications = standaloneClassificationResult.batchClassifications

    for (const brand of chunk) {
      result.processed += 1
      const brandIndex = result.processed
      const brandStartedAt = Date.now()
      const phaseOrder = buildBrandPhaseOrder(phases, hasTriagePhases)
      const totalPhases = phaseOrder.length
      const logCurrentPhase = (phaseResult: PhaseResult): void => {
        const rawIndex = phaseOrder.indexOf(phaseResult.phase)
        const phaseIndex = rawIndex >= 0 ? rawIndex + 1 : totalPhases
        logPhaseResult(
          onProgress,
          brand,
          brandIndex,
          totalBrands,
          phaseResult,
          phaseIndex,
          totalPhases,
        )
      }
      let outcomePhaseResults: PhaseResult[] = []

      try {
        const triageResult = triageResults.get(brand.slug)
        const state: BrandEnrichState = {
          patches: {},
          phaseResults: [],
          knownUrls: collectKnownUrls(brand),
          discoveredUrls: [],
          serpSnippets: [],
          scrapedData: {},
        }
        outcomePhaseResults = state.phaseResults
        const triageApplication = applyTriageResult(triageResult, brand, phases)
        if (hasTriagePhases) {
          state.phaseResults.push(triageApplication.phaseResult)
          logCurrentPhase(triageApplication.phaseResult)
        }
        appendPatch(state, triageApplication.patch)

        let triageSlug = state.patches.slug

        if (target === 'brands' && triageSlug && !config.dryRun) {
          const svc = createServiceClient()
          const { data: slugOwner } = await svc
            .from('brands')
            .select('id')
            .eq('slug', triageSlug)
            .neq('id', brand.id)
            .maybeSingle()
          if (slugOwner) {
            onProgress(`  [SLUG-CONFLICT] "${triageSlug}" already taken — keeping original slug`)
            delete state.patches.slug
            triageApplication.phaseResult.changedFields = triageApplication.phaseResult.changedFields.filter(
              (field) => field !== 'slug'
            )
            triageSlug = undefined
          }
        }

        if (triageApplication.isNonBrand) {
          onProgress(`  [NON-BRAND] ${brand.slug}: ${triageResult?.nonBrandReason ?? 'non-brand'} (${triageResult?.confidence})`)

          if (target === 'brands' && !config.dryRun) {
            await insertTriageResult({
              brandId: brand.id,
              isNonBrand: true,
              nonBrandReason: triageResult?.nonBrandReason ?? null,
              slugGenerated: triageResult?.slugGenerated ?? null,
              productType: triageResult?.productType ?? null,
              confidence: triageResult?.confidence ?? 'high',
              rawResponse: triageResult,
            })
            await updateBrand(
              brand.id,
              {
                status: 'hidden',
                brand_enriched_at: new Date().toISOString(),
              } as never,
              { source: 'enriched' },
            )
          }

          result.brandOutcomes.push({
            slug: brand.slug,
            name: getDisplayBrandName(brand),
            ...(target === 'submissions' ? { submissionId: brand.id } : {}),
            status: 'skipped',
            changedFields: changedFieldsFromPhaseResults(state.phaseResults),
            phaseResults: state.phaseResults,
          })
          result.skipped += 1
          onProgress(formatBrandComplete(brand.slug, brandIndex, totalBrands, Date.now() - brandStartedAt))
          continue
        }

        if (searchError) {
          throw new Error(searchError)
        }

        if (phases.includes('discover')) {
          const searchResult = searchResults.get(getDisplayBrandName(brand)) ?? { urls: [], snippets: [] }
          state.discoveredUrls = uniqueUrls(
            searchResult.urls.filter((url) => !state.knownUrls.includes(url))
          )
          state.serpSnippets = searchResult.snippets
        } else if (searchResults.size > 0) {
          const searchResult = searchResults.get(getDisplayBrandName(brand)) ?? { urls: [], snippets: [] }
          state.serpSnippets = searchResult.snippets
        }

        const urlExtracted = extractLinksFromUrls(state.discoveredUrls)
        let imageSearchUrls: string[] = []
        if (phases.includes('images')) {
          imageSearchUrls = imageSearchResults.get(getDisplayBrandName(brand)) ?? []
          onProgress(`  [IMAGE-SEARCH] ${imageSearchUrls.length} images found`)
        }

        if (
          !phases.includes('tags') &&
          uniqueUrls([...state.knownUrls, ...state.discoveredUrls]).length === 0 &&
          !hasPatchValues(urlExtracted) &&
          imageSearchUrls.length === 0
        ) {
          if (includesDiscover && state.discoveredUrls.length <= 1) {
            weakBrandCount += 1
            onProgress(`  [WEAK-BRAND] ${brand.slug}: no useful data found (${state.discoveredUrls.length} search results, nothing to scrape)`)
          }
          result.brandOutcomes.push({
            slug: brand.slug,
            name: getDisplayBrandName(brand),
            ...(target === 'submissions' ? { submissionId: brand.id } : {}),
            status: 'skipped',
            changedFields: changedFieldsFromPhaseResults(state.phaseResults),
            phaseResults: state.phaseResults,
          })
          result.skipped += 1
          onProgress(formatBrandComplete(brand.slug, brandIndex, totalBrands, Date.now() - brandStartedAt))
          continue
        }

        const cleanResult = await runCleanPhase(brand, phases)
        state.phaseResults.push(cleanResult.phaseResult)
        logCurrentPhase(cleanResult.phaseResult)
        appendPatch(state, cleanResult.patch)

        const linksResult = await runLinksPhase({
          brand,
          phases,
          discoveredUrls: state.discoveredUrls,
          knownUrls: state.knownUrls,
        })
        state.phaseResults.push(linksResult.phaseResult)
        logCurrentPhase(linksResult.phaseResult)
        state.scrapedData = linksResult.scrapedData ?? {}
        appendPatch(state, linksResult.patch)

        const candidateImages = buildCandidatePool({
          scraped: linksResult.scrapedImageUrls,
          googleImages: imageSearchUrls,
        })
        const brandImageResult = await runBrandImagePhase({
          brand,
          phases,
          imageSearchUrls,
          candidateImages,
          dryRun: config.dryRun,
          imageStorageId: brand.id,
        })
        state.phaseResults.push(brandImageResult.phaseResult)
        logCurrentPhase(brandImageResult.phaseResult)
        appendPatch(state, brandImageResult.patch)

        const classifyImagesResult = await runClassifyImagesPhase({
          brand,
          phases,
          dryRun: config.dryRun || target !== 'brands',
        })
        state.phaseResults.push(classifyImagesResult.phaseResult)
        logCurrentPhase(classifyImagesResult.phaseResult)

        const descriptionsResult = await runDescriptionsPhase({
          brand,
          phases,
          scrapedData: state.scrapedData,
          serpSnippets: state.serpSnippets,
        })
        state.phaseResults.push(descriptionsResult.phaseResult)
        logCurrentPhase(descriptionsResult.phaseResult)
        appendPatch(state, descriptionsResult.patch)

        const expansionResult = await runExpansionPhase({
          brand,
          phases,
          serpSnippets: state.serpSnippets,
          scrapedData: state.scrapedData,
        })
        state.phaseResults.push(expansionResult.phaseResult)
        logCurrentPhase(expansionResult.phaseResult)
        appendPatch(state, expansionResult.patch)

        let classification: ClassificationResult | null = null
        let hasCompletedTagClassification = false
        if (!(phases.includes('descriptions') && state.serpSnippets.length > 0) && phases.includes('tags')) {
          classification = batchClassifications.get(brand.slug) ?? null
        }

        if (classification) {
          const tagStartedAt = Date.now()
          hasCompletedTagClassification = true
          if (classification.productType !== brand.product_type) {
            appendPatch(state, { product_type: classification.productType })
            const tagPhaseResult = buildPhaseResult('tags', 'succeeded', ['product_type'], Date.now() - tagStartedAt)
            state.phaseResults.push(tagPhaseResult)
            logCurrentPhase(tagPhaseResult)
            onProgress(`  [TAG] ${brand.slug}: ${brand.product_type ?? 'null'} → ${classification.productType} (${classification.confidence})`)
          } else {
            const tagPhaseResult = buildPhaseResult('tags', 'succeeded', [], Date.now() - tagStartedAt)
            state.phaseResults.push(tagPhaseResult)
            logCurrentPhase(tagPhaseResult)
            onProgress(`  [TAG] ${brand.slug}: ${brand.product_type} (unchanged)`)
          }
        }

        const patch = state.patches
        if (includesDiscover) {
          onProgress(`  [DISCOVER] ${state.discoveredUrls.length} new URLs found`)
        }
        const patchKeys = Object.keys(patch)
        if (patchKeys.length > 0) {
          for (const key of patchKeys) {
            const val = (patch as Record<string, unknown>)[key]
            const display = Array.isArray(val) ? `[${val.length} items]` : typeof val === 'string' && val.length > 60 ? `${val.slice(0, 60)}…` : val
            onProgress(`  [ENRICH] ${key}: ${display}`)
          }
        }

        const changedFields = changedFieldsFromPhaseResults(state.phaseResults)

        if (!hasPatchValues(patch) && !hasCompletedTagClassification) {
          if (includesDiscover && state.discoveredUrls.length <= 1) {
            weakBrandCount += 1
            onProgress(`  [WEAK-BRAND] ${brand.slug}: no useful data found (${state.discoveredUrls.length} search results, no enrichment changes)`)
          }
          result.brandOutcomes.push({
            slug: brand.slug,
            name: getDisplayBrandName(brand),
            ...(target === 'submissions' ? { submissionId: brand.id } : {}),
            status: 'skipped',
            changedFields,
            phaseResults: state.phaseResults,
          })
          result.skipped += 1
          onProgress(formatBrandComplete(brand.slug, brandIndex, totalBrands, Date.now() - brandStartedAt))
          continue
        }

        if (!config.dryRun) {
          if (target === 'brands' && triageResult) {
            await insertTriageResult({
              brandId: brand.id,
              isNonBrand: false,
              nonBrandReason: null,
              slugGenerated: triageResult.slugGenerated,
              productType: triageResult.productType,
              confidence: triageResult.confidence,
              rawResponse: triageResult,
            })
          }
          if (target === 'brands' && descriptionsResult.descriptionRewrite) {
            await insertDescriptionResult({
              brandId: brand.id,
              description: descriptionsResult.descriptionRewrite.description!,
              priceRange: descriptionsResult.descriptionRewrite.priceRange,
              productTags: descriptionsResult.descriptionRewrite.productTags,
              rawResponse: descriptionsResult.descriptionRewrite.rawResponse,
            })
          }
          if (target === 'brands' && classification) {
            await insertClassificationResult({
              brandId: brand.id,
              productType: classification.productType,
              confidence: classification.confidence,
              rawResponse: classification,
            })
          }
          try {
            if (target === 'submissions') {
              await persistSubmissionEnrichmentResults(
                supabase as unknown as SupabaseClient,
                brand.id,
                patch as JsonObject
              )
            } else {
              await persistEnrichmentResults(
                supabase as unknown as SupabaseClient,
                brand.id,
                patch as JsonObject
              )
            }
          } catch (err) {
            const errMsg = errorMessage(err)
            result.errors.push(`${brand.slug}: ${errMsg}`)
            result.brandOutcomes.push({
              slug: brand.slug,
              name: getDisplayBrandName(brand),
              ...(target === 'submissions' ? { submissionId: brand.id } : {}),
              status: 'failed',
              changedFields: changedFieldsFromPhaseResults(outcomePhaseResults),
              phaseResults: outcomePhaseResults,
              error: errMsg,
            })
            result.skipped += 1
            onProgress(formatBrandComplete(brand.slug, brandIndex, totalBrands, Date.now() - brandStartedAt))
            continue
          }

          if (target === 'brands' && triageSlug) {
            await insertSlugRedirect(brand.slug, triageSlug)
          }
        }

        result.brandOutcomes.push({
          slug: brand.slug,
          name: getDisplayBrandName(brand),
          ...(target === 'submissions' ? { submissionId: brand.id } : {}),
          status: 'succeeded',
          changedFields,
          phaseResults: state.phaseResults,
        })
        result.updated += 1
        onProgress(formatBrandComplete(brand.slug, brandIndex, totalBrands, Date.now() - brandStartedAt))
      } catch (err) {
        const errMsg = errorMessage(err)
        result.errors.push(`${brand.slug}: ${errMsg}`)
        result.brandOutcomes.push({
          slug: brand.slug,
          name: getDisplayBrandName(brand),
          ...(target === 'submissions' ? { submissionId: brand.id } : {}),
          status: 'failed',
          changedFields: changedFieldsFromPhaseResults(outcomePhaseResults),
          phaseResults: outcomePhaseResults,
          error: errMsg,
        })
        result.skipped += 1
        onProgress(formatBrandComplete(brand.slug, brandIndex, totalBrands, Date.now() - brandStartedAt))
      }
    }

    onProgress(`[PROGRESS] ${result.processed}/${totalBrands} processed | ${result.updated} updated | ${result.skipped} skipped | ${result.errors.length} errors`)
  }

  if (weakBrandCount > 0) {
    onProgress(`\n[WEAK-BRAND SUMMARY] ${weakBrandCount} brand(s) had no useful search results — review for potential non-brands`)
  }

  return finishEnrichResult(result, startedAt, onProgress)
}
